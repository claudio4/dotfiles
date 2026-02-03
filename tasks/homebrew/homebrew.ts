import { addToCurrentPATH, commandExists, spawn } from "internal/cmd";
import { mkdir } from "internal/fs";
import { gitClone } from "internal/git-clone";
import { installWithSystemPackageManager, overrideDefaultPackageManager } from "internal/package-manager";
import {
  BrewManager,
  CachedPackageManager,
  InstallPriority,
  type PackageDefinition,
  type PackageManager,
} from "internal/package-manager/manager";
import { BaseTask, TaskStatus } from "internal/task";

class HomebrewTask extends BaseTask {
  override id = "homebrew";
  public options = {
    homebrewPath: "/home/linuxbrew/.linuxbrew",
    homebrewUrl: "https://github.com/Homebrew/brew.git",
  };

  pm?: CachedPackageManager;
  private unlockPM?: () => void;

  /*
   * Registers the tasks and also sets homebrew as the default package manager.
   * Install operations to it will wait until this task finishes.
   */
  override register(): void {
    if (this.status !== TaskStatus.Unregistered) return;
    this.updateStatus(TaskStatus.Pending);

    // we create a new package manager to overwrite the defaut one
    const pm = new CachedPackageManager(new BrewManager());
    this.pm = pm;

    // we need to block installations until we are done, otherwise homebrew will
    // not be available, this promise does just that and by resolving it we allow
    // installations to go through
    const lockingPromise = new Promise((resolve) => {
      this.unlockPM = resolve as () => {};
    });

    const wrapperPm: PackageManager = {
      type: "brew",
      install(packages: PackageDefinition[], priority?: number) {
        return lockingPromise.then(() => pm.install(packages, priority));
      },
      refresh(priority?: number) {
        return lockingPromise.then(() => pm.refresh(priority));
      },
    };

    overrideDefaultPackageManager(wrapperPm);
  }

  async _executeInternal(): Promise<void> {
    if (process.platform === "win32") throw new Error("Homebrew is not supported on Windows");

    this.setMessage("Create directory");
    await mkdir(this.options.homebrewPath, { sudo: true });

    if (!commandExists("git")) {
      this.setMessage("Install git");
      await installWithSystemPackageManager(["git"], InstallPriority.BLOCKING);
    }

    this.setMessage("Clone repository");
    const cloneResult = await gitClone({
      url: this.options.homebrewUrl,
      destination: this.options.homebrewPath,
      update: false,
    });

    addToCurrentPATH(`${this.options.homebrewPath}/bin`);
    if (!cloneResult.changed) return;

    this.setMessage("Install homebrew");
    await spawn([`${this.options.homebrewPath}/bin/brew`, "update", "--force", "--quiet"]);
  }

  override _execute(): Promise<void> {
    return this._executeInternal().finally(() => {
      this.unlockPM?.();
      if (this.pm) {
        // we no longer need our wrapper holding installs
        // so we let the real pm to handle the installs from now on.
        overrideDefaultPackageManager(this.pm);
      }
    });
  }
}

export default new HomebrewTask();
