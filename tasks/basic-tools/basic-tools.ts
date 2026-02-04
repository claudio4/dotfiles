import { InstallPriority, installWithSystemPackageManager } from "internal/package-manager";
import { BaseTask } from "internal/task";

class BasicToolsTask extends BaseTask {
  override id = "basic-tools";
  override _execute(): Promise<void> {
    this.setMessage("Install tools");
    return installWithSystemPackageManager(["curl", "tmux", "vim"], InstallPriority.BACKGROUND);
  }
}

export default new BasicToolsTask();
