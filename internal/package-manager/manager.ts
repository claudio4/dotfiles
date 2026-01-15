import { which, spawn } from "bun";

export type ManagerType = "apt" | "dnf" | "zypper" | "pacman" | "brew" | "winget";

/**
 * Allows defining a package` name simply as a string (if common across all systems)
 * or a map if names differ (e.g. { apt: 'python3', winget: 'Python.Python.3' })
 */
export type PackageDefinition = string | (Partial<Record<ManagerType, string>> & { default: string });

export interface PackageManager {
  readonly type: ManagerType;

  install(packages: PackageDefinition[]): Promise<void>;

  /**
   * Updates the package manager repositories (e.g. apt-get update)
   */
  refresh(): Promise<void>;
}

function hasRootprivileges(): boolean {
  return (process as any).getuid() === 0;
}

abstract class BasePackageManager implements PackageManager {
  abstract readonly type: ManagerType;
  protected abstract readonly installCommand: string[];
  protected abstract readonly updateCommand: string[];
  protected abstract readonly needsSudo: boolean;

  /**
   * Helper to resolve the specific package name from the definition
   */
  protected resolveName(pkg: PackageDefinition): string {
    if (typeof pkg === "string") return pkg;
    return pkg[this.type] || pkg.default;
  }

  protected execute(cmd: string[]): Promise<number> {
    if (this.needsSudo && !hasRootprivileges()) {
      cmd.unshift("sudo");
    }

    const proc = spawn(cmd, {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });

    return proc.exited;
  }

  async install(packages: PackageDefinition[]): Promise<void> {
    if (packages.length === 0) return;

    const resolvedNames = packages.map((p) => this.resolveName(p));
    const cmd = [...this.installCommand, ...resolvedNames];
    const exitCode = await this.execute(cmd);

    if (exitCode !== 0) {
      throw new Error(`${this.type} failed when installing packages ${resolvedNames.concat()}`);
    }
  }

  async refresh(): Promise<void> {
    // Some managers (like winget) might not need an explicit update command or it's different
    if (this.updateCommand.length === 0) return;

    const exitCode = await this.execute(this.updateCommand);
    if (exitCode !== 0) {
      throw new Error(`${this.type} failed when refreshing`);
    }
  }
}

export class AptManager extends BasePackageManager {
  protected installCommand = ["apt-get", "install", "-y"];
  protected updateCommand = ["apt-get", "update", "-y"];
  protected needsSudo = true;
  readonly type = "apt";
}

export class DnfManager extends BasePackageManager {
  protected installCommand = ["dnf", "install", "-y"];
  protected updateCommand = ["dnf", "check-update", "-y"];
  protected needsSudo = true;
  readonly type = "dnf";
}

export class ZypperManager extends BasePackageManager {
  protected installCommand = ["zypper", "install", "-y"];
  protected updateCommand = ["zypper", "refresh"];
  protected needsSudo = true;
  readonly type = "zypper";
}

export class PacmanManager extends BasePackageManager {
  protected installCommand = ["pacman", "-S", "--noconfirm"];
  protected updateCommand = ["pacman", "-Sy", "--noconfirm"];
  protected needsSudo = true;
  readonly type = "pacman";
}

export class BrewManager extends BasePackageManager {
  protected installCommand = ["brew", "install"];
  protected updateCommand = ["brew", "update"];
  protected needsSudo = false;
  readonly type = "brew";
}

export class WingetManager extends BasePackageManager {
  protected installCommand = [
    "winget",
    "install",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--exact",
  ];
  protected updateCommand = [];
  protected needsSudo = false;
  readonly type = "winget";
}

export function getSystemPackageManager(): PackageManager {
  if (process.platform === "win32") {
    if (which("winget")) return new WingetManager();
    throw new Error("Winget not found on Windows system.");
  }

  if (process.platform === "darwin") {
    if (which("brew")) return new BrewManager();
    throw new Error("Homebrew not found on macOS system.");
  }

  if (which("zypper")) return new ZypperManager();
  if (which("pacman")) return new PacmanManager();
  if (which("dnf")) return new DnfManager();
  if (which("apt-get")) return new AptManager();
  if (which("brew")) return new BrewManager();

  throw new Error("No supported package manager found.");
}

/**
 * Wraps an PackageManager to ensure operations are executed sequentially.
 * If multiple callers call install(), they are queued.
 * Callers can await their specific request.
 */

export class QueuedPackageManager implements PackageManager {
  _workerChain: Promise<void> = Promise.resolve();
  private refreshPromise?: Promise<void>;

  constructor(readonly _delegate: PackageManager) {}

  get type(): ManagerType {
    return this._delegate.type;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    // We create a new promise that waits for the previous one to finish (success or fail)
    // and then runs the current task.
    const resultPromise = this._workerChain.then(async () => {
      return task();
    });

    // We update the chain tail.
    // We catch errors here so the NEXT task in line still runs even if this one fails.
    this._workerChain = resultPromise.catch(() => {}) as Promise<void>;

    return resultPromise;
  }

  /**
   * Installs the requested packages.
   * If multiple callers call install(), they are queued.
   */
  install(packages: PackageDefinition[]): Promise<void> {
    return this.enqueue(() => this._delegate.install(packages));
  }

  /**
   * Refreshes the package manager's cache.
   * This method ensures that only one refresh operation is in progress at any given time.
   */
  refresh(): Promise<void> {
    if (this.refreshPromise === undefined) {
      this.refreshPromise = this.enqueue(() => this._delegate.refresh());
      return this.refreshPromise;
    }
    const current = Bun.peek(this.refreshPromise);
    // if its the same then it means that a refresh requesh is already in queue or in-flight.
    if (current === this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.enqueue(() => this._delegate.refresh());
    return this.refreshPromise;
  }
}

/**
 * Wraps a PackageManager to add Deduplication and Caching.
 *
 * 1. Checks if a package is already installed (returns immediately).
 * 2. Checks if a package is currently being installed by another task (returns that existing promise).
 * 3. Only enqueues ACTUAL new installations to the underlying worker.
 *
 */
export class CachedPackageManager implements PackageManager {
  private readonly _queue: QueuedPackageManager;

  // Tracks packages successfully installed in this session
  private readonly _installed = new Set<string>();

  // Tracks packages currently in the queue or running
  private readonly _inflight = new Map<string, Promise<void>>();

  constructor(private readonly _delegate: PackageManager) {
    this._queue = new QueuedPackageManager(_delegate);
  }

  get type(): ManagerType {
    return this._delegate.type;
  }

  /**
   * Replicates the resolution logic to identify packages before hitting the queue
   */
  private resolveName(pkg: PackageDefinition): string {
    if (typeof pkg === "string") return pkg;
    return pkg[this._delegate.type] || pkg.default;
  }

  async install(packages: PackageDefinition[]): Promise<void> {
    if (packages.length === 0) return;

    const resolvedNames = packages.map((p) => this.resolveName(p));

    const brandNewPackages: string[] = [];
    const waitingPromises: Promise<void>[] = [];

    for (const name of resolvedNames) {
      if (this._installed.has(name)) {
        continue;
      }

      if (this._inflight.has(name)) {
        waitingPromises.push(this._inflight.get(name)!);
        continue;
      }

      brandNewPackages.push(name);
    }

    if (brandNewPackages.length > 0) {
      const installTask = this._queue
        .install(brandNewPackages)
        .then(() => {
          // On success, mark as installed
          brandNewPackages.forEach((n) => this._installed.add(n));
        })
        .finally(() => {
          // Whether success or fail, remove from inflight so they can be retried if needed
          brandNewPackages.forEach((n) => this._inflight.delete(n));
        });

      brandNewPackages.forEach((name) => {
        this._inflight.set(name, installTask);
      });

      waitingPromises.push(installTask);
    }

    await Promise.all(waitingPromises);
  }

  async refresh(): Promise<void> {
    return this._queue.refresh();
  }
}
