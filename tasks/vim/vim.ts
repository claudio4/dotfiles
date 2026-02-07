import { commandExists } from "internal/cmd";
import { copy } from "internal/fs";
import { gitClone } from "internal/git-clone";
import type { downloadFile } from "internal/net";
import { install, InstallPriority } from "internal/package-manager";
import { BaseTask } from "internal/task";
import { getConfigHome, getHome } from "internal/user";
import { markAsErrorHandled } from "internal/utils";
import { join } from "node:path";

class VimTask extends BaseTask {
  override id = "vim";
  options = {};
  override async _execute(): Promise<void> {
    let installPromise;
    if (!commandExists("vim")) {
      installPromise = install(["vim"], InstallPriority.BACKGROUND);
      markAsErrorHandled(installPromise);
    }

    this.setMessage("Copy config files");
    const vimFolder = join(getConfigHome(), "vim");
    const pluginFolder = join(vimFolder, "plugins");

    await copy(join(import.meta.dir, "vimrc"), join(vimFolder, "vimrc"));
    await copy(join(import.meta.dir, "keybinds.vim"), join(pluginFolder, "keybinds.vim"));
    await copy(join(import.meta.dir, "osc52.vim"), join(pluginFolder, "osc52.vim"));

    if (!commandExists("git")) {
      this.setMessage("install git");
      await install(["git"], InstallPriority.BLOCKING);
    }

    const vimPoliglotPromise = gitClone({
      url: "https://github.com/sheerun/vim-polyglot.git",
      destination: join(vimFolder, "plugins", "start", "vim-polyglot"),
      shallow: true,
      update: true,
    });
    markAsErrorHandled(vimPoliglotPromise);

    this.setMessage("Install editoconfig-vim");
    await gitClone({
      url: "https://github.com/editorconfig/editorconfig-vim.git",
      destination: join(vimFolder, "plugins", "start", "editorconfig-vim"),
      shallow: true,
      update: true,
    });

    this.setMessage("Install vim-polyglot");
    await vimPoliglotPromise;

    this.setMessage("Install vim");
    await installPromise;
  }
}

export default new VimTask();
