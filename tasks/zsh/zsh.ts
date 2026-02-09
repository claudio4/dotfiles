import { commandExists, which } from "internal/cmd";
import { copy, mkdir } from "internal/fs";
import { gitClone } from "internal/git-clone";
import { InstallPriority, installWithSystemPackageManager } from "internal/package-manager";
import { BaseTask, isTaskRegistered } from "internal/task";
import { renderTemplateToFile } from "internal/template";
import { getCacheHome, getConfigHome, getDataHome, getHome, getStateHome, getUserName, setShell } from "internal/user";
import { isWSL, markAsErrorHandled } from "internal/utils";
import { join } from "node:path";
import { sudo, isEnabled as isSudoEnabled } from "internal/sudo";

class ZshTask extends BaseTask {
  override id = "zsh";
  options = {
    setDefaultShell: true,
  };
  override async _execute(): Promise<void> {
    let installPromise;
    if (!commandExists("zsh")) {
      installPromise = installWithSystemPackageManager(["zsh"], InstallPriority.BACKGROUND);
      markAsErrorHandled(installPromise);
    }

    if (!commandExists("git")) {
      this.setMessage("Install git");
      await installWithSystemPackageManager(["git"], InstallPriority.BLOCKING);
    }

    const omzDir = join(getDataHome(), "oh-my-zsh");

    this.setMessage("Install Oh-My-Zsh");
    await gitClone({
      url: "https://github.com/ohmyzsh/ohmyzsh.git",
      destination: omzDir,
      shallow: true,
      update: true,
    });

    this.setMessage("Install PowerLevel10k");
    await gitClone({
      url: "https://github.com/romkatv/powerlevel10k.git",
      destination: join(omzDir, "custom", "themes", "powerlevel10k"),
      shallow: true,
      update: true,
    });

    this.setMessage("Copy config files");
    const shellConfigFolder = join(getConfigHome(), "shell");

    const localShellFile = Bun.file(join(getConfigHome(), "shell", "local-shell.sh"));
    if (!(await localShellFile.exists())) {
      await mkdir(shellConfigFolder);
      await localShellFile.write("");
    }

    await copy(join(import.meta.dir, "p10k.zsh"), join(shellConfigFolder, "p10k.zsh"));

    const modernUtils = await isTaskRegistered("modern-utils");
    const vars: any = {
      wsl: isWSL(),
      bat: commandExists("bat") || modernUtils,
      eza: commandExists("eza") || modernUtils,
      fzf: commandExists("fzf") || modernUtils,
      zoxide: commandExists("zoxide") || modernUtils,
      nvim: commandExists("nvim") || (await isTaskRegistered("neovim")),
    };

    await renderTemplateToFile(join(import.meta.dir, "zshrc"), join(getHome(), ".zshrc"), vars);

    await Promise.all([mkdir(join(getStateHome(), "zsh")), mkdir(join(getCacheHome(), "zsh"))]);

    this.setMessage("Install zsh");
    await installPromise;

    if (this.options.setDefaultShell && isSudoEnabled()) {
      this.setMessage("Set zsh as the default shell");
      await setShell("zsh");
    }
  }
}

export default new ZshTask();
