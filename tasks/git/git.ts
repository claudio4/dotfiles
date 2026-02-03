import { commandExists } from "internal/cmd";
import { copy } from "internal/fs";
import { installWithSystemPackageManager } from "internal/package-manager";
import { BaseTask } from "internal/task";
import { getConfigHome } from "internal/user";
import { markAsErrorHandled } from "internal/utils";
import { join } from "path";

class GitTask extends BaseTask {
  override id = "git";
  override async _execute(): Promise<void> {
    let installPromise;
    if (!commandExists("git")) {
      installPromise = installWithSystemPackageManager(["git"]);
      markAsErrorHandled(installPromise);
    }

    this.setMessage("Copy config");
    await copy(join(import.meta.dir, "gitconfig"), join(getConfigHome(), "git", "config"));

    if (installPromise) {
      this.setMessage("Install git");
      await installPromise;
    }
  }
}

export default new GitTask();
