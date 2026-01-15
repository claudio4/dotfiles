import { install, installWithSystemPackageManager, refresh } from "internal/package-manager";
import type { PackageDefinition } from "internal/package-manager/manager";
import { BaseTask } from "internal/task";

const buildPackages: PackageDefinition[] = [
  {
    apt: "build-essential",
    dnf: "@development-tools",
    zypper: "pattern:devel_basis",
    pacman: "base-devel",
    default: "build-essential",
  },
  {
    default: "procps",
    dnf: "procps-ng",
    pacman: "procps-ng",
  },
  "git",
  "curl",
  "file",
];

class BuildEssentialsTask extends BaseTask {
  override id = "BuildEssentials";
  override _execute(): Promise<void> {
    this.setMessage("Installing build essentials...");
    return installWithSystemPackageManager(buildPackages);
  }
}

export default new BuildEssentialsTask();
