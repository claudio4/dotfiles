import { which, spawn } from "bun";
import { rm } from "fs/promises";
import { sudo } from "internal/sudo";
import { markAsErrorHandled } from "internal/utils";
import { tmpdir } from "os";
import { join } from "path";

export type ManagerType = "apt" | "dnf" | "zypper" | "pacman" | "brew" | "winget";

/**
 * Allows defining a package` name simply as a string (if common across all systems)
 * or a map if names differ (e.g. { apt: 'python3', winget: 'Python.Python.3' })
 */
export type PackageDefinition = string | (Partial<Record<ManagerType, string>> & { default: string });

export interface PackageManager {
  readonly type: ManagerType;

  install(packages: PackageDefinition[], priority?: number): Promise<void>;

  /**
   * Updates the package manager repositories (e.g. apt-get update)
   */
  refresh(priority?: number): Promise<void>;

  /**
   * Adds a third-party repository so that its packages become installable.
   * Returns `true` if the repository was newly added, `false` if it was
   * already present or if the definition contains no configuration for
   * this manager type.
   */
  addRepository(definition: RepositoryDefinition): Promise<AddRepositoryResult>;
}

/**
 * Priority levels for package installation.
 * Higher values are processed first.
 */
export enum InstallPriority {
  /** Low priority - install when convenient, nothing is waiting for it */
  BACKGROUND = -100,

  /** Normal priority - default for regular package installations */
  NORMAL = 0,

  /** High priority - installation needed to keep working, may be needed for some I/O operations*/
  REQUIRED = 100,

  /** Critical priority - blocking long-running async operations or many tasks, needs immediate installation */
  BLOCKING = 500,
}

/**
 * Describes how to add a third-party repository to various package managers.
 * Only the fields relevant to the detected package manager are used; the rest
 * are silently ignored.
 */
export interface RepositoryDefinition {
  /** Unique name for the repository (used for file naming and idempotency) */
  name: string;
  apt?: AptRepositoryConfig;
  dnf?: RpmRepositoryConfig;
  zypper?: RpmRepositoryConfig;
  brew?: BrewRepositoryConfig;
}

/** Configuration for adding an APT repository (Debian/Ubuntu) */
export interface AptRepositoryConfig {
  /** URL to the GPG keyring file (.gpg binary format) */
  keyUrl: string;
  /** URL to the sources file (DEB822 .sources format) */
  sourcesUrl: string;
}

/** Configuration for adding an RPM repository (Fedora, openSUSE, RHEL) */
export interface RpmRepositoryConfig {
  /** URL to the .repo file */
  repoUrl: string;
}

/** Configuration for adding a Homebrew tap */
export interface BrewRepositoryConfig {
  /** Tap name, e.g. "user/repo" */
  tap: string;
}

/**
 * Describes how to add a third-party repository to various package managers.
 * Only the fields relevant to the detected package manager are used; the rest
 * are silently ignored.
 */
export interface RepositoryDefinition {
  /** Unique name for the repository (used for file naming and idempotency) */
  name: string;
  apt?: AptRepositoryConfig;
  dnf?: RpmRepositoryConfig;
  zypper?: RpmRepositoryConfig;
  brew?: BrewRepositoryConfig;
}

export interface AddRepositoryResult {
  // Whether the underlying package manager supports adding the repository
  supported: boolean;
  // Whether the repository was added. False when it was already there.
  // Always false when supported is false
  changed: boolean;
}

export class PackageManagerError extends Error {
  public readonly stdout: string;
  public readonly stderr: string;

  constructor(message: string, context: { stdout?: string; stderr?: string } = {}) {
    super(message);
    this.name = "InstallError";
    this.stdout = context.stdout ?? "";
    this.stderr = context.stderr ?? "";
  }
}

interface executeOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function hasRootprivileges(): boolean {
  return (process as any).getuid() === 0;
}

abstract class BasePackageManager implements PackageManager {
  abstract readonly type: ManagerType;
  protected abstract readonly installCommand: string[];
  protected abstract readonly updateCommand: string[];
  protected abstract readonly needsSudo: boolean;
  protected abstract readonly needsRefresh: boolean;

  protected hasRerefreshed: boolean = false;

  /**
   * Helper to resolve the specific package name from the definition
   */
  protected resolveName(pkg: PackageDefinition): string {
    if (typeof pkg === "string") return pkg;
    return pkg[this.type] || pkg.default;
  }

  protected async execute(cmd: string[]): Promise<executeOutput> {
    if (this.needsSudo && !hasRootprivileges()) {
      return sudo(cmd, { timeout: 300000 }); // timeout of 5 mins
    }
    let proc = spawn(cmd, {
      stderr: "pipe",
      env: process.env,
    });
    return {
      exitCode: await proc.exited,
      stdout: await proc.stdout.text(),
      stderr: await proc.stderr.text(),
    };
  }

  async install(packages: PackageDefinition[]): Promise<void> {
    if (packages.length === 0) return;

    if (this.needsRefresh && !this.hasRerefreshed) {
      await this.refresh();
    }

    const resolvedNames = packages.map((p) => this.resolveName(p));
    const cmd = [...this.installCommand, ...resolvedNames];
    const result = await this.execute(cmd);

    if (result.exitCode !== 0) {
      throw new PackageManagerError(`${this.type} failed when installing packages ${resolvedNames.concat()}:`, {
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }
  }

  async refresh(): Promise<void> {
    // Some managers (like winget) might not need an explicit update command or it's different
    if (this.updateCommand.length === 0) return;

    const result = await this.execute(this.updateCommand);
    if (result.exitCode !== 0) {
      throw new PackageManagerError(`${this.type} failed when refreshing`, {
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }
    this.hasRerefreshed = true;
  }

  /**
   * Default implementation: no repository support.
   * Managers that support adding repositories override this method.
   */
  async addRepository(_definition: RepositoryDefinition): Promise<AddRepositoryResult> {
    return {
      supported: false,
      changed: false,
    };
  }
}

export class AptManager extends BasePackageManager {
  protected installCommand = ["apt-get", "install", "-y"];
  protected updateCommand = ["apt-get", "update", "-y"];
  protected needsSudo = true;
  protected needsRefresh = true;
  readonly type = "apt";

  override async addRepository(definition: RepositoryDefinition): Promise<AddRepositoryResult> {
    const result = { supported: false, changed: false };
    if (!definition.apt) return result;

    result.supported = true;

    const { keyUrl, sourcesUrl } = definition.apt;
    const name = definition.name;

    const keyringPath = `/usr/share/keyrings/${name}.gpg`;
    const sourcesPath = `/etc/apt/sources.list.d/${name}.sources`;

    if (await Bun.file(sourcesPath).exists()) return result;

    const [keyringResp, sourcesResp] = await Promise.all([fetch(keyUrl), fetch(sourcesUrl)]);

    if (!keyringResp.ok) {
      throw new PackageManagerError(`Failed to download APT keyring from ${keyUrl}: ${keyringResp.status}`);
    }
    if (!sourcesResp.ok) {
      throw new PackageManagerError(`Failed to download APT sources from ${sourcesUrl}: ${sourcesResp.status}`);
    }

    // Writing to the appropiate directories is tricky becuase we need root for that. So we use a tpmdir and then copy
    const tmp = tmpdir();
    const tmpKeyring = join(tmp, `${name}.gpg`);
    const tmpSources = join(tmp, `${name}.sources`);

    try {
      await Promise.all([Bun.write(tmpKeyring, keyringResp), Bun.write(tmpSources, sourcesResp)]);

      // we copy the files to their appropriate directories. Use install becaause it also allow to set the mode.
      const [keyResult, sourcesResult] = await Promise.all([
        this.execute(["install", "-Dm644", tmpKeyring, keyringPath]),
        this.execute(["install", "-Dm644", tmpSources, sourcesPath]),
      ]);
    } finally {
      // Best effort to cleand behidn ourselves, but if it fails we don't really care. Is tmp it will go away eventuallly.
      markAsErrorHandled(rm(tmpKeyring, { force: true }));
      markAsErrorHandled(rm(tmpSources, { force: true }));
    }

    // Force a refresh on the next install so the new repo is picked up
    this.hasRerefreshed = false;

    result.changed = true;
    return result;
  }
}

export class DnfManager extends BasePackageManager {
  protected installCommand = ["dnf", "install", "-y"];
  protected updateCommand = ["dnf", "check-update", "-y"];
  protected needsSudo = true;
  protected needsRefresh = false;
  readonly type = "dnf";

  override async addRepository(definition: RepositoryDefinition): Promise<AddRepositoryResult> {
    const result = { supported: false, changed: false };
    if (!definition.dnf) return result;

    result.supported = true;

    const { repoUrl } = definition.dnf;
    const proc = await this.execute(["dnf", "config-manager", "addrepo", "--overwrite", `--from-repofile=${repoUrl}`]);

    if (proc.exitCode !== 0) {
      throw new PackageManagerError(`Failed to add DNF repository ${definition.name} from ${repoUrl}`, {
        stdout: proc.stdout,
        stderr: proc.stderr,
      });
    }

    // dnf does not tell us if it was changed or not, so we assume it did.
    result.changed = true;

    return result;
  }
}

export class ZypperManager extends BasePackageManager {
  protected installCommand = ["zypper", "install", "-y"];
  protected updateCommand = ["zypper", "--non-interactive", "refresh"];
  protected needsSudo = true;
  protected needsRefresh = false;
  private needsToAcceptGPGKeys = false;
  readonly type = "zypper";

  override async addRepository(definition: RepositoryDefinition): Promise<AddRepositoryResult> {
    const result = { supported: false, changed: false };
    if (!definition.zypper) return result;

    result.supported = true;
    const { repoUrl } = definition.zypper;

    const proc = await this.execute(["zypper", "--non-interactive", "addrepo", "--gpgcheck", "--repo", repoUrl]);

    if (proc.exitCode !== 0) {
      // zypper exits with 4 when the repo already exists
      if (proc.exitCode === 4) return result;
      throw new PackageManagerError(`Failed to add Zypper repository ${definition.name} from ${repoUrl}`, {
        stdout: proc.stdout,
        stderr: proc.stderr,
      });
    }

    // Before using the repository, we need to refresh the package list and accept the new keys
    // we delegate it to when the next install is done
    this.needsRefresh = true;
    this.needsToAcceptGPGKeys = true;

    result.changed = true;
    return result;
  }

  // if a repository is added, we need to accept GPG keys on refresh. So the easiest thing is to
  // override the refresh method
  override async refresh(): Promise<void> {
    let updateCommand = this.updateCommand;
    if (this.needsToAcceptGPGKeys) {
      updateCommand = ["zypper", "--non-interactive", "--gpg-auto-import-keys", "refresh"];
    }

    const result = await this.execute(updateCommand);
    if (result.exitCode !== 0) {
      throw new PackageManagerError(`zypper failed when refreshing`, {
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }

    this.hasRerefreshed = true;
    this.needsToAcceptGPGKeys = false;
  }
}

export class PacmanManager extends BasePackageManager {
  protected installCommand = ["pacman", "-S", "--noconfirm"];
  protected updateCommand = ["pacman", "-Sy", "--noconfirm"];
  protected needsSudo = true;
  protected needsRefresh = true;
  readonly type = "pacman";
}

export class BrewManager extends BasePackageManager {
  protected installCommand = ["brew", "install"];
  protected updateCommand = ["brew", "update"];
  protected needsSudo = false;
  protected needsRefresh = false;
  readonly type = "brew";

  override async addRepository(definition: RepositoryDefinition): Promise<AddRepositoryResult> {
    const result = { supported: false, changed: false };
    if (!definition.brew) return result;

    result.supported = true;
    const { tap } = definition.brew;

    const proc = await this.execute(["brew", "tap", tap]);
    if (proc.exitCode !== 0) {
      throw new PackageManagerError(`Failed to tap ${tap}`, {
        stdout: proc.stdout,
        stderr: proc.stderr,
      });
    }

    result.changed = true;
    return result;
  }
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
  protected needsRefresh = false;
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
 * A task in the priority queue
 */
interface QueuedTask {
  packages: string[];
  refresh?: boolean;
  priority: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Tracks an inflight installation with its current maximum priority
 */
interface InflightInstall {
  promise: Promise<void>;
  task: QueuedTask;
}

/**
 * Wraps a PackageManager to add:
 *  Priority-based queuing (higher priority tasks are processed first)
 *  Deduplication (same package requested multiple times uses the same installation)
 *  Caching (already installed packages are not reinstalled)
 *  Priority updates (if a package is inflight and requested with higher priority, its priority is updated)
 */
export class CachedPackageManager implements PackageManager {
  // Tracks packages successfully installed in this session
  private readonly _installed = new Set<string>();

  // Tracks packages currently being installed with their max priority
  private readonly _inflight = new Map<string, InflightInstall>();

  // Priority queue of pending tasks
  private readonly _queue: QueuedTask[] = [];

  // Worker processing state
  private _processing = false;
  private _refreshTask?: { promise: Promise<void>; task: QueuedTask };

  constructor(private readonly _delegate: PackageManager) {}

  addRepository(definition: RepositoryDefinition): Promise<AddRepositoryResult> {
    // this operation does not need caching nor queing so we ask the delegate directly.
    return this._delegate.addRepository(definition);
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

  async install(packages: PackageDefinition[], priority: number = 0): Promise<void> {
    if (packages.length === 0) return;

    const resolvedNames = packages.map((p) => this.resolveName(p));

    const brandNewPackages: string[] = [];
    const waitingPromises: Promise<void>[] = [];

    let needsResort = false;
    for (const name of resolvedNames) {
      if (this._installed.has(name)) {
        continue;
      }

      // Currently being installed
      if (this._inflight.has(name)) {
        const inflight = this._inflight.get(name)!;

        if (priority > inflight.task.priority) {
          inflight.task.priority = priority;
          needsResort = true;
        }

        waitingPromises.push(inflight.promise);
        continue;
      }

      brandNewPackages.push(name);
    }

    if (needsResort) this._resortQueue();

    // If we have new packages to install, add them to the queue
    if (brandNewPackages.length > 0) {
      const task: Partial<QueuedTask> = {
        packages: brandNewPackages,
        priority,
      };

      const installPromise = new Promise<void>((resolve, reject) => {
        // this is safe because the promise will not be resolved before we insert it in the queue
        task.resolve = resolve;
        task.reject = reject;

        this._insertAtPriority(task as QueuedTask);

        // Untie the qeue processing to this task.
        setImmediate(() => this._processQueue());
      });

      const inflightEntry: InflightInstall = {
        promise: installPromise,
        // for aa brief period of time this task misses some properties but
        // inflightEntry only needs Priority anyway
        task: task as QueuedTask,
      };

      brandNewPackages.forEach((name) => {
        this._inflight.set(name, inflightEntry);
      });

      waitingPromises.push(installPromise);
    }

    await Promise.all(waitingPromises);
  }

  /**
   * Inserts a task into the queue at the appropriate posiition given its priority
   */
  private _insertAtPriority(task: QueuedTask) {
    let insertIndex = this._queue.length;
    for (let i = 0; i < this._queue.length; i++) {
      if (task.priority > this._queue[i]!.priority) {
        insertIndex = i;
        break;
      }
    }

    this._queue.splice(insertIndex, 0, task);
  }

  /**
   * Resorts the queue when priorities are updated
   */
  private _resortQueue(): void {
    // Stable sort by priority (descending)
    this._queue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Processes tasks from the queue, highest priority first
   */
  private async _processQueue(): Promise<void> {
    if (this._processing) return;
    this._processing = true;

    while (this._queue.length > 0) {
      // Get highest priority task (first in queue)
      const task = this._queue.shift()!;

      try {
        if (task.refresh) {
          await this._delegate.refresh();
          this._refreshTask = undefined;
        }

        await this._delegate.install(task.packages);

        // Mark as installed
        task.packages.forEach((name) => {
          this._installed.add(name);
          this._inflight.delete(name);
        });

        task.resolve();
      } catch (error) {
        if (task.refresh) {
          this._refreshTask = undefined;
        }

        // Remove from inflight so they can be retried
        task.packages.forEach((name) => this._inflight.delete(name));

        task.reject(error as Error);
      }
    }

    this._processing = false;
  }

  /**
   * Refreshes the package manager's cache.
   * This method ensures that only one refresh operation is in progress at any given time.
   */
  async refresh(priority: number = 0): Promise<void> {
    if (this._refreshTask) {
      if (this._refreshTask.task.priority > priority) {
        this._refreshTask.task.priority = priority;
        this._resortQueue();
      }

      return this._refreshTask.promise;
    }

    const task: Partial<QueuedTask> = {
      refresh: true,
      packages: [],
      priority,
    };

    this._refreshTask = {
      promise: new Promise((resolve, reject) => {
        task.reject = reject;
        task.resolve = resolve;
        this._insertAtPriority(task as QueuedTask);
        setImmediate(() => this._processQueue());
      }),
      task: task as QueuedTask,
    };
  }
}
