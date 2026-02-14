import { commandExists, spawn } from "internal/cmd";
import { copy, mkdir } from "internal/fs";
import {
  addRepositoryToSystemPackageManager,
  installWithSystemPackageManager,
  InstallPriority,
  type PackageDefinition,
  getSystemPackageManagerType,
} from "internal/package-manager";
import { BaseTask } from "internal/task";
import { isLinux, isWindows, markAsErrorHandled } from "internal/utils";
import { join } from "node:path";

type BraveChannel = "release" | "beta" | "nightly";

class BraveBrowserTask extends BaseTask {
  override id = "brave-browser";

  options = {
    channel: "release" as BraveChannel,
  };

  override async _execute(): Promise<void> {
    const channel = this.options.channel;
    const dashChannel = channel === "release" ? "" : `-${channel}`;

    let installPromise;
    if (commandExists(`brave-browser${dashChannel}`) || commandExists(`brave${dashChannel}`)) {
      installPromise = this.install(channel, dashChannel);
      markAsErrorHandled(installPromise);
    }

    if (isLinux) {
      this.setMessage("Copy policies");
      const policiesDir = "/etc/brave/policies/managed/";
      await mkdir(policiesDir, { sudo: true, owner: "0:0" });
      await copy(
        join(import.meta.dir, "brave-debloat-policies.json"),
        join(policiesDir, "brave-debloat-policies.json"),
        {
          sudo: true,
          owner: "0:0",
        },
      );
    } else if (isWindows) {
      this.setMessage("Apply policies");
      const checkReg = await spawn(
        ["reg", "query", "HKEY_LOCAL_MACHINE\\Software\\Policies\\BraveSoftware\\Brave", "/v", "BraveWalletDisable"],
        { throwOnError: false },
      );

      // if reg query exits with non-zero it means that the key is not in place so whe should place it.
      if (checkReg.exitCode !== 0) {
        // To apply this policies we need admin rights, which is complicated, so we use regedit
        // but we need to the cmd dance so the elevation prompt appears, otherwise it just fails.
        await spawn(["cmd", "/c", `regedit ${join(import.meta.dir, "brave-debloat-policies.reg")}`]);
      }
    }

    this.setMessage("Install Brave");
    await installPromise;
  }

  private install(channel: string, dashChannel: string) {
    const pmType = getSystemPackageManagerType();

    if (pmType === "pacman") {
      return this.installOnArch(dashChannel);
    }
    if (isWindows) {
      return this.installOnWindows(channel);
    }

    return this.installOnGeneralLinux(channel, dashChannel);
  }

  private async installOnGeneralLinux(channel: string, dashChannel: string) {
    this.setMessage("Add Brave repository");
    await addRepositoryToSystemPackageManager({
      name: `brave-browser${dashChannel}-release`,
      apt: {
        keyUrl: `https://brave-browser-apt-${channel}.s3.brave.com/brave-browser${dashChannel}-archive-keyring.gpg`,
        sourcesUrl: `https://brave-browser-apt-${channel}.s3.brave.com/brave-browser.sources`,
      },
      dnf: {
        repoUrl: `https://brave-browser-rpm-${channel}.s3.brave.com/brave-browser${dashChannel}.repo`,
      },
      zypper: {
        repoUrl: `https://brave-browser-rpm-${channel}.s3.brave.com/brave-browser${dashChannel}.repo`,
      },
    });

    this.setMessage("Install Brave");
    const pkg: PackageDefinition = {
      default: `brave-browser${dashChannel}`,
    };
    await installWithSystemPackageManager([pkg], InstallPriority.BACKGROUND);
  }

  private installOnWindows(channel: string) {
    this.setMessage("Install Brave");
    const capitalizedChannel = channel.charAt(0).toUpperCase() + channel.slice(1);
    const dotChannel = channel === "release" ? "" : `.${capitalizedChannel}`;

    return installWithSystemPackageManager([`Brave.Brave${dotChannel}`], InstallPriority.BACKGROUND);
  }

  private async installOnArch(dashChannel: string): Promise<void> {
    // Brave for arch is officially distributed on AUR rather than in a custom repo.
    const aurHelpers = ["paru", "pikaur", "yay"] as const;
    const helper = aurHelpers.find((h) => commandExists(h));

    if (!helper) {
      throw new Error(
        "Brave Browser is not in the standard repos and no AUR helper (paru/pikaur/yay) was found. " +
          "Please install an AUR helper to proceed.",
      );
    }

    this.setMessage(`Install via ${helper}`);
    // AUR helpers handle privilege escalation internally
    await spawn([helper, "-Sy", "--needed", "--noconfirm", `brave${dashChannel}-bin`]);
  }
}

export default new BraveBrowserTask();
