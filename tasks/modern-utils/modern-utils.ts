import { install, InstallPriority } from "internal/package-manager";
import { isEnabled as isSudoEnabled, sudo } from "internal/sudo";
import { BaseTask } from "internal/task";
import { getDistroFamily } from "internal/utils";

class ModernUtilsTask extends BaseTask {
  override id = "modern-utils";
  override async _execute(): Promise<void> {
    this.setMessage("Install utils");
    await install(["bat", "fzf", "zoxide", "ripgrep", "eza"], InstallPriority.BACKGROUND);

    // On Debian system for compatibility reasons with an old package the binary name is batcat
    // I do not really care for this old package, so I do a symbolic link to have the command available as
    // bat as usual.
    if (isSudoEnabled() && (await getDistroFamily()) === "debian") {
      const debianPath = "/usr/bin/batcat";

      if (!(await Bun.file(debianPath).exists())) return;
      sudo(["ln", "-s", debianPath, "/usr/bin/bat"]);
    }
  }
}

export default new ModernUtilsTask();
