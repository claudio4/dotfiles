import { mkdir } from "internal/fs";
import { BaseTask } from "internal/task";
import { getHome } from "internal/user";
import { isWindows } from "internal/utils";
import { join } from "node:path";

class UsefulDirsTask extends BaseTask {
  override id = "useful-dirs";
  override async _execute(): Promise<void> {
    this.setMessage("Create useful dirs");
    const promises = [];
    if (isWindows()) {
      promises.push(mkdir(join(getHome(), "Documents", "dev")));
    } else {
      promises.push(
        mkdir(join(getHome(), "dev", "claudio4")),
        mkdir(join(getHome(), "scratchpad")),
        mkdir(join(getHome(), ".local", "bin")),
      );
    }

    await Promise.all(promises);
  }
}

export default new UsefulDirsTask();
