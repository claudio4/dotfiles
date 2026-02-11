import { commandExists } from "internal/cmd";
import { link } from "internal/fs";
import { InstallPriority, installWithSystemPackageManager } from "internal/package-manager";
import { BaseTask } from "internal/task";
import { getConfigHome, getHome } from "internal/user";
import { markAsErrorHandled } from "internal/utils";
import { join } from "node:path";

class TmuxTask extends BaseTask {
  override id = "tmux";
  override async _execute(): Promise<void> {
    let installPromise;
    if (!commandExists("tmux")) {
      installPromise = installWithSystemPackageManager(["tmux"], InstallPriority.BACKGROUND);
      markAsErrorHandled(installPromise);
    }

    this.setMessage("Link config");
    await link(join(import.meta.dir, "tmux.conf"), join(getConfigHome(), "tmux", "tmux.conf"));
    this.setMessage("Link tb.sh");
    await link(join(import.meta.dir, "tb.sh"), join(getHome(), ".local", "bin", "tb.sh"));

    this.setMessage("Install tmux");
    await installPromise;
  }
}

export default new TmuxTask();
