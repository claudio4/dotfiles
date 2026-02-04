import { Glob } from "bun";
import { commandExists, spawn } from "internal/cmd";
import { copy, mkdir } from "internal/fs";
import { install, InstallPriority, installWithSystemPackageManager } from "internal/package-manager";
import { BaseTask, getTask, isTaskRegistered, TaskStatus } from "internal/task";
import { renderTemplateToFile } from "internal/template";
import { getConfigHome, getDataHome } from "internal/user";
import { isWSL, markAsErrorHandled } from "internal/utils";
import { exists, readdir } from "node:fs/promises";
import { join } from "node:path";

class FishTask extends BaseTask {
  override id = "fish";
  override async _execute(): Promise<void> {
    let installPromise;
    if (!commandExists("fish")) {
      installPromise = install(["fish"], InstallPriority.REQUIRED);
      markAsErrorHandled(installPromise);
    }

    const fishConfigDir = join(getConfigHome(), "fish");
    const taskFilesDir = join(import.meta.dir, "files");

    await mkdir(fishConfigDir);

    this.setMessage("Copy config");
    await copy(taskFilesDir, fishConfigDir, {
      // .cond. files are only to be copied if conditions are met.
      // we copy fish_plugins later because we need to know if it has changed
      ignore: [".cond.", "fish_plugins"],
    });

    this.setMessage("Copy conditional config");
    const condFilesPromises = [];
    const modernUtils = await isTaskRegistered("modern-utils");

    const vars: any = {
      wsl: isWSL(),
      bat: commandExists("bat") || modernUtils,
      eza: commandExists("eza") || modernUtils,
      fzf: commandExists("fzf") || modernUtils,
      zoxide: commandExists("zoxide") || modernUtils,
      go: commandExists("go") || (await isTaskRegistered("go")),
      nvim: commandExists("nvim") || (await isTaskRegistered("neovim")),
    };

    if (vars.bat) {
      const p = copy(
        join(taskFilesDir, "functions", "cat.cond.fish"),
        join(fishConfigDir, "functions", "cat.cond.fish"),
      );
      condFilesPromises.push(p);
    }
    if (vars.eza) {
      const p = copy(join(taskFilesDir, "functions", "ls.cond.fish"), join(fishConfigDir, "functions", "ls.cond.fish"));
      condFilesPromises.push(p);
    }
    if (vars.zoxide) {
      const p = copy(join(taskFilesDir, "functions", "z.cond.fish"), join(fishConfigDir, "functions", "z.cond.fish"));
      condFilesPromises.push(p);
    }
    if (vars.wsl) {
      const p1 = copy(
        join(taskFilesDir, "functions", "wcd.cond.fish"),
        join(fishConfigDir, "functions", "wcd.cond.fish"),
      );
      const p2 = copy(
        join(taskFilesDir, "functions", "__register_windows_terminal_hook.cond.fish"),
        join(fishConfigDir, "functions", "__register_windows_terminal_hook.cond.fish"),
      );
      condFilesPromises.push(p1, p2);
    }

    await Promise.all(condFilesPromises);

    const homebrew = await getTask("homebrew");
    if (homebrew && homebrew.getInfo().status !== TaskStatus.Unregistered) {
      vars.homebrew = homebrew.options!.homebrewPath;
    }

    this.setMessage("Apply template files");
    const templatesDir = join(import.meta.dir, "templates");
    const tmplFiles = await Array.fromAsync(new Glob("**").scan({ cwd: templatesDir }));
    const tmplPromises = tmplFiles.map((f) => renderTemplateToFile(join(templatesDir, f), join(fishConfigDir, f)));

    await Promise.all(tmplPromises);

    if (installPromise) {
      this.setMessage("Install fish");
      await installPromise;
    }

    // this nifty command ask fish if fisher is installed.
    const testFisher = await spawn(["fish", "-c", "type -q fisher"], { throwOnError: false });
    if (testFisher.exitCode !== 0) {
      this.setMessage("install curl");
      await installWithSystemPackageManager(["curl"], InstallPriority.BLOCKING);

      this.setMessage("Install fisher");
      await spawn([
        "fish",
        "-c",
        "curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher",
      ]);
    }

    const fishPluginsCopy = await copy(join(taskFilesDir, "fish_plugins"), join(fishConfigDir, "fish_plugins"));

    if (!fishPluginsCopy.changed) return;
    this.setMessage("Install fish plugins");

    await spawn(["fish", "-c", "fisher update"]);
  }
}

export default new FishTask();
