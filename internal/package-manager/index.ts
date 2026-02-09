import {
  getSystemPackageManager,
  type PackageDefinition,
  type PackageManager,
  CachedPackageManager,
  type RepositoryDefinition,
  type AddRepositoryResult,
  type ManagerType,
} from "./manager";
export { InstallPriority, type PackageDefinition } from "./manager";

let systemPkgManager = getCachedSystemPackageManagerOrFailed();
let defaultPkgManager = systemPkgManager;

/**
 * Installs packages using the default package manager.
 * The default package manager is initially the system package manager but can be overridden.
 */
export function install(packages: PackageDefinition[], priority: number = 0): Promise<void> {
  return defaultPkgManager.install(packages, priority);
}

/**
 * Refreshes the package index using the default package manager.
 * The default package manager is initially the system package manager but can be overridden.
 */
export function refresh(priority: number = 0): Promise<void> {
  return defaultPkgManager.refresh(priority);
}

/**
 * Adds a third-party repository to the default package manager.
 * The default package manager is initially the system package manager but can be overridden.
 */
export function addRepository(definition: RepositoryDefinition): Promise<AddRepositoryResult> {
  return defaultPkgManager.addRepository(definition);
}

/**
 * Installs packages using the system package manager, bypassing any override.
 * Use this when you need to ensure installation happens through the system package manager
 * regardless of any custom package manager configuration.
 */
export function installWithSystemPackageManager(packages: PackageDefinition[], priority: number = 0): Promise<void> {
  return systemPkgManager.install(packages, priority);
}

/**
 * Refreshes the package index using the system package manager, bypassing any override.
 * Use this when you need to ensure refresh happens through the system package manager
 * regardless of any custom package manager configuration.
 */
export function refreshWithSystemPackageManager(priority: number = 0): Promise<void> {
  return systemPkgManager.refresh(priority);
}

/**
 * Adds a third-party repository using the system package manager, bypassing any override.
 * Returns true if the repository was newly added, false if already present or
 * if the definition has no configuration for the active manager type.
 */
export function addRepositoryToSystemPackageManager(definition: RepositoryDefinition): Promise<AddRepositoryResult> {
  return systemPkgManager.addRepository(definition);
}

/**
 * Returns the type of the default package manager.
 * The default package manager is initially the system package manager but can be overridden
 * and its type changed.
 */
export function getDefaultPackageManagerType(): ManagerType {
  return defaultPkgManager.type;
}

/**
 * Returns the type of the system package manager.
 */
export function getSystemPackageManagerType(): ManagerType {
  return systemPkgManager.type;
}

/**
 * Overrides the default package manager used by `install()` and `refresh()`.
 * This allows substituting a custom package manager implementation for most tasks.
 */
export function overrideDefaultPackageManager(pm: PackageManager) {
  defaultPkgManager = pm;
}

/**
 * Overrides the system package manager used by `installWithSystemPackageManager()` and `refreshWithSystemPackageManager()`.
 * This allows substituting a custom package manager implementation for system package manager tasks.
 */
export function overrideSystemPackageManager(pm: PackageManager) {
  systemPkgManager = pm;
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
      addRepository: function (definition: RepositoryDefinition): Promise<AddRepositoryResult> {
        return Promise.reject(new Error("Package manager is unavailable"));
      },
    };
  }
}
