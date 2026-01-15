#!/usr/bin/env bun
import { parseArgs } from "util";
import { hostname } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { Profile } from "./internal/profile";
import { runProfileWithDisplay } from "./internal/display";
import * as sudo from "./internal/sudo";
import * as packageManager from "./internal/package-manager";
import type { PackageManager } from "internal/package-manager/manager";

/**
 * CLI configuration parsed from arguments and environment variables
 */
interface CLIConfig {
  profileName: string | null;
  enableSudo: boolean;
  sudoPassword?: string;
  disablePackageManager: boolean;
  ignoreTasks: Set<string>;
  profileOptions: Record<string, any>;
  taskOptions: Map<string, Record<string, any>>;
  showHelp: boolean;
  showVersion: boolean;
}

const VERSION = "3.0.0";

/**
 * Parse CLI arguments and environment variables
 */
function parseCliConfig(): CLIConfig {
  const args = process.argv.slice(2);

  // Parse arguments
  const { values, positionals } = parseArgs({
    args,
    options: {
      profile: { type: "string", short: "p" },
      sudo: { type: "boolean", short: "s" },
      "sudo-password": { type: "string", short: "S" },
      "disable-package-manager": { type: "boolean" },
      ignore: { type: "string", multiple: true, short: "i" },
      "profile-option": { type: "string", multiple: true, short: "P" },
      "task-option": { type: "string", multiple: true, short: "T" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    allowPositionals: true,
  });

  // Parse environment variables
  const envProfile = process.env.DOTFILES_PROFILE;
  const envSudoPassword = process.env.DOTFILES_SUDO_PASSWORD;
  const envEnableSudo = process.env.DOTFILES_ENABLE_SUDO === "1" || process.env.DOTFILES_ENABLE_SUDO === "true";
  const envDisablePackageManager =
    process.env.DOTFILES_DISABLE_PACKAGE_MANAGER === "1" || process.env.DOTFILES_DISABLE_PACKAGE_MANAGER === "true";
  const envIgnoreTasks = process.env.DOTFILES_IGNORE_TASKS?.split(",").map((t) => t.trim()) || [];

  // Determine profile name
  let profileName: string | null = null;
  if (positionals.length > 0) {
    profileName = positionals[0]!;
  } else if (values.profile) {
    profileName = values.profile;
  } else if (envProfile) {
    profileName = envProfile;
  }

  // Determine sudo settings
  const enableSudo = values.sudo || envEnableSudo || !!envSudoPassword;
  const sudoPassword = values["sudo-password"] || envSudoPassword;

  // Parse ignore list
  const ignoreTasks = new Set([...envIgnoreTasks, ...(values.ignore || [])]);

  // Parse profile options (format: key=value or key:value)
  const profileOptions: Record<string, any> = {};
  for (const opt of values["profile-option"] || []) {
    const parsed = parseOption(opt);
    if (parsed) {
      profileOptions[parsed.key] = parsed.value;
    }
  }

  // Parse task options (format: taskId.key=value or taskId:key=value)
  const taskOptions = new Map<string, Record<string, any>>();
  for (const opt of values["task-option"] || []) {
    const match = opt.match(/^([^.=:]+)[.:](.+)$/);
    if (match) {
      const [, taskId, rest] = match;
      const parsed = parseOption(rest!);
      if (parsed) {
        if (!taskOptions.has(taskId!)) {
          taskOptions.set(taskId!, {});
        }
        taskOptions.get(taskId!)![parsed.key] = parsed.value;
      }
    }
  }

  return {
    profileName,
    enableSudo,
    sudoPassword,
    disablePackageManager: values["disable-package-manager"] || envDisablePackageManager,
    ignoreTasks,
    profileOptions,
    taskOptions,
    showHelp: values.help || false,
    showVersion: values.version || false,
  };
}

/**
 * Parse a key=value or key:value option string
 */
function parseOption(opt: string): { key: string; value: any } | null {
  const match = opt.match(/^([^=:]+)[=:](.*)$/);
  if (!match) return null;

  const [, key, rawValue] = match;
  let value: any = rawValue;

  // Try to parse as JSON for complex values
  if (rawValue!.startsWith("{") || rawValue!.startsWith("[")) {
    try {
      value = JSON.parse(rawValue!);
    } catch {
      // Keep as string if JSON parse fails
    }
  } else if (rawValue === "true") {
    value = true;
  } else if (rawValue === "false") {
    value = false;
  } else if (!isNaN(Number(rawValue))) {
    value = Number(rawValue);
  }

  return { key: key!, value };
}

/**
 * Load a profile by name
 */
async function loadProfile(name: string): Promise<Profile<any> | null> {
  const profilesDir = join(import.meta.dir, "profiles");
  const profilePath = join(profilesDir, `${name}.ts`);

  if (!existsSync(profilePath)) {
    return null;
  }

  try {
    const module = await import(profilePath);
    const profile = module.default;

    if (!profile || !(profile instanceof Profile)) {
      console.error(`Error: Profile "${name}" does not export a Profile instance as default`);
      return null;
    }

    return profile;
  } catch (err) {
    console.error(`Error loading profile "${name}":`, err);
    return null;
  }
}

/**
 * Get the default profile name based on hostname
 */
function getDefaultProfileName(): string {
  return `machine-${hostname().toLocaleLowerCase()}`;
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
Dotfiles Manager v${VERSION}

USAGE:
  bun install.ts [OPTIONS] [PROFILE]

ARGUMENTS:
    PROFILE                  Name of the profile to run (without .ts extension)
                             If not specified, tries to use machine-{hostname}
                             (e.j. ${getDefaultProfileName()})

OPTIONS:
  -p, --profile <NAME>       Select profile by name
  -s, --sudo                 Enable sudo/privilege escalation
  -S, --sudo-password <PASS> Provide sudo password (also enables sudo)
  --disable-package-manager  Disable system package manager
  -i, --ignore <TASK>        Ignore specific task(s) - can be used multiple times
  -P, --profile-option <OPT> Pass option to profile (format: key=value)
  -T, --task-option <OPT>    Pass option to task (format: taskId.key=value)
  -h, --help                 Show this help message
  -v, --version              Show version

ENVIRONMENT VARIABLES:
  DOTFILES_PROFILE                Profile name to use
  DOTFILES_ENABLE_SUDO            Enable sudo (set to "1" or "true")
  DOTFILES_SUDO_PASSWORD          Sudo password (also enables sudo)
  DOTFILES_DISABLE_PACKAGE_MANAGER Disable package manager (set to "1" or "true")
  DOTFILES_IGNORE_TASKS           Comma-separated list of tasks to ignore
`);
}

/**
 * Show version
 */
function showVersion(): void {
  console.log(`Dotfiles Manager v${VERSION}`);
}

/**
 * Apply CLI configuration to profile and tasks
 */
function applyConfiguration(profile: Profile<any>, config: CLIConfig): void {
  // Apply profile options
  if (Object.keys(config.profileOptions).length > 0) {
    profile.options = { ...profile.options, ...config.profileOptions };
  }

  // Apply task options and filter ignored tasks
  const filteredTasks = [];
  for (const task of profile.tasks) {
    // Skip ignored tasks (don't register them)
    if (config.ignoreTasks.has(task.id)) {
      console.log(`Ignoring task: ${task.id}`);
      continue;
    }

    // Apply task-specific options
    if (config.taskOptions.has(task.id)) {
      task.options = { ...task.options, ...config.taskOptions.get(task.id) };
    }

    filteredTasks.push(task);
  }

  profile.tasks = filteredTasks;
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const config = parseCliConfig();

  // Handle help and version
  if (config.showHelp) {
    showHelp();
    process.exit(0);
  }

  if (config.showVersion) {
    showVersion();
    process.exit(0);
  }

  // Determine which profile to use
  let profileName = config.profileName;
  if (!profileName) {
    profileName = getDefaultProfileName();
    const profile = await loadProfile(profileName);
    if (!profile) {
      console.error(`No profile specified and default profile not found: ${profileName}.ts`);
      console.error();
      console.error(`Hint: Create a profile at profiles/${profileName}.ts for automatic selection.`);
      console.error(`      Or specify a profile explicitly with: bun install.ts --profile <name>`);
      console.error();
      console.error(`Run 'bun install.ts --help' for more information.`);
      process.exit(1);
    }
  }

  // Load the profile
  const profile = await loadProfile(profileName);
  if (!profile) {
    console.error(`Profile not found: ${profileName}.ts`);
    console.error(`Profiles directory: profiles/`);
    process.exit(1);
  }

  // Configure sudo
  if (config.enableSudo) {
    sudo.enable();
    if (config.sudoPassword) {
      sudo.setDefaultPassword(config.sudoPassword);
    }
  }

  // Configure package manager
  if (config.disablePackageManager) {
    const disabledPkgMngr: PackageManager = {
      type: "apt",
      install: function (packages) {
        return Promise.reject(new Error("Package manager is unavailable"));
      },
      refresh: function () {
        return Promise.reject(new Error("Package manager is unavailable"));
      },
    };
    packageManager.overrideDefaultPackageManager(disabledPkgMngr);
    packageManager.overrideSystemPackageManager(disabledPkgMngr);
  }

  // Apply configuration
  applyConfiguration(profile, config);

  // Register profile
  profile.register();

  await runProfileWithDisplay(profile);

  // Check if any tasks failed
  const failedTask = profile.tasks.find((t) => t.status === "failed");
  if (failedTask) {
    process.exit(1);
  }
}

// Run the CLI
main();
