import { commandExists } from "internal/cmd";
import { ensureLine, mkdir } from "internal/fs";
import { install } from "internal/package-manager";
import { BaseTask } from "internal/task";
import { getDataHome, getHome } from "internal/user";
import { isUnixLike, markAsErrorHandled } from "internal/utils";
import { join } from "node:path";

class GoTask extends BaseTask {
  override id = "go";
  options = {
    addToDotProfile: true,
    goPath: join(getDataHome(), "go"),
  };
  override async _execute(): Promise<void> {
    let installPromise;
    if (!commandExists("go")) {
      installPromise = install([{ apt: "golang-go", dnf: "golang", default: "go" }]);
      markAsErrorHandled(installPromise);
    }

    this.setMessage("Create Go Path");
    await mkdir(this.options.goPath);

    if (this.options.addToDotProfile && isUnixLike()) {
      this.setMessage("Add GoPath to .profile");
      await ensureLine(
        join(getHome(), ".profile"),
        `export GOPATH="${this.options.goPath}"\nexport PATH="$GOPATH/bin:$PATH"`,
      );
    }

    if (installPromise) {
      this.setMessage("Install Go");
      await installPromise;
    }
  }
}

export default new GoTask();
