import { getSystemPackageManager, type PackageDefinition, type PackageManager, CachedPackageManager } from "./manager";

const systemPkgManager = getCachedSystemPackageManagerOrFailed();
let defaultPkgManager = systemPkgManager;

/**
 * Installs packages using the default package manager.
 * The default package manager is initially the system package manager but can be overridden.
 */
export function install(packages: PackageDefinition[]): Promise<void> {
  return defaultPkgManager.install(packages);
}

/**
 * Refreshes the package index using the default package manager.
 * The default package manager is initially the system package manager but can be overridden.
 */
export function refresh(): Promise<void> {
  return defaultPkgManager.refresh();
}

/**
 * Installs packages using the system package manager, bypassing any override.
 * Use this when you need to ensure installation happens through the system package manager
 * regardless of any custom package manager configuration.
 */
export function installWithSystemPackageManager(packages: PackageDefinition[]): Promise<void> {
  return systemPkgManager.install(packages);
}

/**
 * Refreshes the package index using the system package manager, bypassing any override.
 * Use this when you need to ensure refresh happens through the system package manager
 * regardless of any custom package manager configuration.
 */
export function refreshWithSystemPackageManager(): Promise<void> {
  return systemPkgManager.refresh();
}

/**
 * Overrides the default package manager used by `install()` and `refresh()`.
 * This allows substituting a custom package manager implementation for most tasks.
 */
export function overrideDefaultPackageManager(pm: PackageManager) {
  defaultPkgManager = pm;
}

function getCachedSystemPackageManagerOrFailed(): PackageManager {
  try {
    const pm = getSystemPackageManager();
    return new CachedPackageManager(pm);
  } catch (err) {
    return {
      type: "apt",
      install: function (packages: PackageDefinition[]): Promise<void> {
        return Promise.reject(new Error("Package manager is unavailable"));
      },
      refresh: function () {
        return Promise.reject(new Error("Package manager is unavailable"));
      },
    };
  }
}
