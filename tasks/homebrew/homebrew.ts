import { commandExists, commandOrTaskRegistered, spawn } from "internal/cmd";
import { mkdir } from "internal/fs";
import { gitClone } from "internal/git-clone";
import { installWithSystemPackageManager, overrideDefaultPackageManager } from "internal/package-manager";
import { BrewManager, CachedPackageManager } from "internal/package-manager/manager";
import { BaseTask, TaskStatus } from "internal/task";

class HomebrewTask extends BaseTask {
  override id = "homebrew";
  public options = {
    homebrewPath: "/home/linuxbrew/.linuxbrew",
    homebrewUrl: "https://github.com/Homebrew/brew.git",
  };
  private packageMngrQueueResolveFunction?: () => void;

  /*
   * Registers the tasks and also sets homebrew as the default package manager.
   * Install operations to it will wait until this task finishes.
   */
  override register(): void {
    if (this.status !== TaskStatus.Unregistered) return;
    this.updateStatus(TaskStatus.Pending);
    const pm = new CachedPackageManager(new BrewManager());
    pm._queue._workerChain = new Promise((resolve) => {
      this.packageMngrQueueResolveFunction = resolve;
    });
    overrideDefaultPackageManager(pm);
  }

  async _executeInternal(): Promise<void> {
    if (process.platform === "win32") throw new Error("Homebrew is not supported on Windows");

    this.setMessage("Create directory");
    await mkdir(this.options.homebrewPath, { sudo: true });

    if (!commandExists("git")) {
      this.setMessage("Install git");
      await installWithSystemPackageManager(["git"]);
    }

    this.setMessage("Clone repository");
    const cloneResult = await gitClone({
      url: this.options.homebrewUrl,
      destination: this.options.homebrewPath,
      update: false,
    });

    if (!cloneResult.changed) return;

    this.setMessage("Install homebrew");
    await spawn([`${this.options.homebrewPath}/bin/brew`, "update", "--force", "--quiet"]);
  }

  override _execute(): Promise<void> {
    return this._executeInternal().finally(() => {
      this.packageMngrQueueResolveFunction?.();
    });
  }
}

export default new HomebrewTask();
