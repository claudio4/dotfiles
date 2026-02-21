import { mkdir } from "internal/fs";
import { BaseTask } from "internal/task";
import { getHome } from "internal/user";
import { isWindows } from "internal/utils";
import { join } from "node:path";

class UsefulDirsTask extends BaseTask {
  override id = "useful-dirs";
  options = {
    /** Whether this is a desktop install. When true, dev and scratchpad are created under ~/Documents */
    isDesktop: isWindows,
  };

  override async _execute(): Promise<void> {
    this.setMessage("Create useful dirs");
    const home = getHome();
    const base = this.options.isDesktop ? join(home, "Documents") : home;
    const promises = [mkdir(join(base, "dev", "claudio4")), mkdir(join(base, "scratchpad"))];

    if (!isWindows) {
      promises.push(mkdir(join(home, ".local", "bin")));
    }

    await Promise.all(promises);
  }
}

export default new UsefulDirsTask();
