import { commandExists } from "internal/cmd";
import { mkdir } from "internal/fs";
import { gitClone } from "internal/git-clone";
import { install, installWithSystemPackageManager } from "internal/package-manager";
import { BaseTask } from "internal/task";
import { getConfigHome } from "internal/user";
import { markAsErrorHandled } from "internal/utils";
import { join } from "node:path";

class NeovimTask extends BaseTask {
  override id = "neovim";
  override async _execute(): Promise<void> {
    let installPromise: Promise<void> | undefined;
    if (!commandExists("nvim")) {
      installPromise = install(["nvim"]);
      markAsErrorHandled(installPromise);
    }
    await mkdir(getConfigHome());
    this.setMessage("install git");
    if (!commandExists("git")) {
      await installWithSystemPackageManager(["git"]);
    }
    this.setMessage("Clone nvim config");
    await gitClone({
      url: "https://github.com/claudio4/nvim-config.git",
      destination: join(getConfigHome(), "nvim"),
    });

    if (installPromise) {
      this.setMessage("Install neovim");
      await installPromise;
    }
  }
}

export default new NeovimTask();
