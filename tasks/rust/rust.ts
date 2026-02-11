import { install, InstallPriority } from "internal/package-manager";
import { BaseTask } from "internal/task";

class RustTask extends BaseTask {
  override id = "rust";
  override _execute(): Promise<void> {
    this.setMessage("Install rustup");
    return install(["rustup"], InstallPriority.BACKGROUND);
  }
}

export default new RustTask();
