import { $ } from "bun";
import { commandExists, commandOrTaskRegistered } from "internal/cmd";
import { copy, mkdir, touch } from "internal/fs";
import { InstallPriority, installWithSystemPackageManager } from "internal/package-manager";
import { BaseTask, TaskStatus } from "internal/task";
import { renderTemplateToFile } from "internal/template";
import { getConfigHome, getHome } from "internal/user";
import { isWSL, markAsErrorHandled } from "internal/utils";
import { chmod, exists } from "node:fs/promises";
import { join } from "node:path";

class WSLTask extends BaseTask {
  override id = "wsl";
  options = {
    /** Whether to run this task only in WSL based systems */
    runOnlyInWSL: true,
    npiperelayDownloadURL:
      "https://github.com/albertony/npiperelay/releases/latest/download/npiperelay_windows_amd64.exe",
  };
  override async _execute(): Promise<void> {
    if (!isWSL() && this.options.runOnlyInWSL) {
      this.updateStatus(TaskStatus.Skipped, "Not in a WSL system");
      return;
    }

    let socatPromise;
    if (!commandExists("socat")) {
      socatPromise = installWithSystemPackageManager(["socat"], InstallPriority.BACKGROUND);
      markAsErrorHandled(socatPromise);
    }

    const npiperelayPromise = this.installNpiperelay();
    markAsErrorHandled(npiperelayPromise);

    this.setMessage("Copy shell files");

    const vars = {
      // systemd creates this directory when it is the system's init.
      systemd: await exists("/run/systemd/system"),
    };
    await renderTemplateToFile(
      join(import.meta.dir, "wsl-profile.tmpl.sh"),
      join(getConfigHome(), "shell", "wsl-profile.sh"),
      vars,
    );

    if (await commandOrTaskRegistered("nvim", "neovim")) {
      const scriptPath = join(getHome(), ".local", "bin", "neovide.sh");
      await copy(join(import.meta.dir, "neovide.sh"), scriptPath);
      await chmod(scriptPath, 0o755);
    }

    await touch(join(getHome(), ".profile"));

    let sshAgentServicePromise;
    if (vars.systemd) {
      const sshAgentFile = await copy(
        join(import.meta.dir, "wsl-ssh-agent.service"),
        join(getHome(), ".config", "systemd", "user", "wsl-ssh-agent.service"),
      );

      if (sshAgentFile.changed) {
        this.setMessage("Enable SSH agent");
        // Reload systemd daemon so it detects the new service and enable it
        sshAgentServicePromise =
          $`systemctl --user daemon-reload && systemctl --user enable --now wsl-ssh-agent.service`.quiet();
        markAsErrorHandled(sshAgentServicePromise);
      }
    }

    this.setMessage("Download npiperelay");
    await npiperelayPromise;

    this.setMessage("Install socat");
    await socatPromise;

    if (sshAgentServicePromise) {
      this.setMessage("Enable SSH Agent");
      await sshAgentServicePromise;
    }
  }

  async installNpiperelay(): Promise<void> {
    const binDir = join(getHome(), ".local", "bin");
    const binFile = Bun.file(join(binDir, "npiperelay.exe"));

    if (await binFile.exists()) return;

    const mkdirPromise = mkdir(binDir);
    markAsErrorHandled(mkdirPromise);

    try {
      const response = await fetch(this.options.npiperelayDownloadURL);
      if (!response.ok) {
        throw new Error(`Failed to npiperelay: ${response.status} ${response.statusText}`);
      }

      await mkdirPromise;
      await binFile.write(response);
    } catch (err) {
      // we attempt to delete the in case we had a partial download.
      // we ignore the error because we don't really care if it didn't exist already.
      markAsErrorHandled(binFile.delete());
      throw err;
    }

    await chmod(binFile.name!, 0o755);
  }
}

export default new WSLTask();
