import { commandExists, spawn } from "internal/cmd";
import { link, mkdir } from "internal/fs";
import { downloadFile } from "internal/net";
import { installWithSystemPackageManager, InstallPriority } from "internal/package-manager";
import { BaseTask } from "internal/task";
import { getConfigHome, getHome } from "internal/user";
import { isLinux, isWindows, markAsErrorHandled } from "internal/utils";
import { join } from "node:path";
import { tmpdir } from "node:os";

class ZedTask extends BaseTask {
  override id = "zed";

  override async _execute(): Promise<void> {
    // Start installation if Zed is not already available
    let installPromise: Promise<void> | undefined;
    if (!commandExists("zed") && !commandExists("zeditor")) {
      if (isWindows) {
        installPromise = this.installWindows();
      } else if (isLinux) {
        installPromise = this.installLinux();
      }
      if (installPromise) {
        markAsErrorHandled(installPromise);
      }
    }

    this.setMessage("Link configuration files");
    const configDir = isWindows ? join(getConfigHome(), "Zed") : join(getConfigHome(), "zed");
    await mkdir(configDir);

    await Promise.all([
      link(join(import.meta.dir, "settings.json"), join(configDir, "settings.json")),
      link(join(import.meta.dir, "keymap.json"), join(configDir, "keymap.json")),
    ]);

    if (installPromise) {
      this.setMessage("Install Zed");
      await installPromise;
    }
  }

  private installWindows(): Promise<void> {
    return installWithSystemPackageManager(["Zed.Zed"], InstallPriority.BACKGROUND);
  }

  private async installLinux(): Promise<void> {
    const home = getHome();
    const installDir = join(home, ".local", "zed.app");
    const binDir = join(home, ".local", "bin");

    const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
    const url = `https://zed.dev/api/releases/stable/latest/zed-linux-${arch}.tar.gz`;
    const tarPath = join(tmpdir(), `zed-linux-${arch}.tar.gz`);

    try {
      this.setMessage("Download Zed");
      await downloadFile(url, tarPath, { force: true });

      // Extract to install directory (strip the top-level zed.app directory)
      this.setMessage("Extract Zed");
      await mkdir(installDir);
      await spawn(["tar", "-xf", tarPath, "-C", installDir, "--strip-components=1"]);
    } finally {
      // clean up is best effort
      markAsErrorHandled(Bun.file(tarPath).delete());
    }

    this.setMessage("Link Zed binary");
    await link(join(installDir, "bin", "zed"), join(binDir, "zed"));

    // Install XDG desktop entry
    this.setMessage("Install desktop entry");
    const applicationsDir = join(home, ".local", "share", "applications");
    await mkdir(applicationsDir);

    const desktopSource = join(installDir, "share", "applications", "zed.desktop");
    const desktopDest = join(applicationsDir, "dev.zed.Zed.desktop");

    const desktopContent = await Bun.file(desktopSource).text();
    const modifiedContent = desktopContent
      .replace(/Icon=zed/g, `Icon=${join(installDir, "share", "icons", "hicolor", "512x512", "apps", "zed.png")}`)
      .replace(/Exec=zed/g, `Exec=${join(installDir, "libexec", "zed-editor")}`);
    await Bun.file(desktopDest).write(modifiedContent);
  }
}

export default new ZedTask();
