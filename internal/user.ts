import { join } from "node:path";
import { homedir, userInfo } from "node:os";
import { spawn } from "./cmd";

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

/**
 * Returns the directory for configuration files.
 * Linux: $XDG_CONFIG_HOME or ~/.config
 * Mac:   ~/Library/Application Support
 * Win:   %APPDATA% (Roaming)
 */
export function getConfigHome(): string {
  if (process.env.XDG_CONFIG_HOME) return process.env.XDG_CONFIG_HOME;

  if (isWin) return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  if (isMac) return join(homedir(), "Library", "Application Support");

  // Linux/Unix fallback
  return join(homedir(), ".config");
}

/**
 * Returns the directory for user-specific data files.
 * Linux: $XDG_DATA_HOME or ~/.local/share
 * Mac:   ~/Library/Application Support
 * Win:   %LOCALAPPDATA% (Local)
 */
export function getDataHome(): string {
  if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME;

  if (isWin) return process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  if (isMac) return join(homedir(), "Library", "Application Support");

  // Linux/Unix fallback
  return join(homedir(), ".local", "share");
}

/**
 * Returns the directory for non-essential data (caches).
 * Linux: $XDG_CACHE_HOME or ~/.cache
 * Mac:   ~/Library/Caches
 * Win:   %LOCALAPPDATA%
 */
export function getCacheHome(): string {
  if (process.env.XDG_CACHE_HOME) return process.env.XDG_CACHE_HOME;

  if (isWin) return process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  if (isMac) return join(homedir(), "Library", "Caches");

  // Linux/Unix fallback
  return join(homedir(), ".cache");
}

/**
 * Returns the directory for state files (logs, history, etc).
 * Linux: $XDG_STATE_HOME or ~/.local/state
 * Mac:   ~/Library/Logs (closest equivalent for logs/state)
 * Win:   %LOCALAPPDATA%
 */
export function getStateHome(): string {
  if (process.env.XDG_STATE_HOME) return process.env.XDG_STATE_HOME;

  if (isWin) return process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  if (isMac) return join(homedir(), "Library", "Logs");

  // Linux/Unix fallback
  return join(homedir(), ".local", "state");
}

/**
 * Returns the current user's name.
 * Priority: System User Info -> $USER -> $USERNAME -> "unknown"
 */
export function getUserName(): string {
  try {
    return userInfo().username;
  } catch {
    // Fallback for restricted environments (containers/weird permissions)
    const username =
      process.env.USER || // Linux/Mac standard
      process.env.USERNAME || // Windows standard
      process.env.LOGNAME; // Older Unix standard

    if (!username) throw new Error("Failed to resolve user name");
    return username;
  }
}

export async function resolveGroupId(groupname: string): Promise<number> {
  if (isWin) throw new Error("Can not get group id on Windows");

  // Check if it's already a numeric gid
  const numericGid = parseInt(groupname, 10);
  if (!isNaN(numericGid)) {
    return numericGid;
  }

  const proc = await spawn(["getent", "group", groupname], { throwOnError: false });

  if (proc.exitCode !== 0) {
    throw new Error(`Failed to resolve group '${groupname}' to gid`);
  }

  // getent group format: groupname:x:gid:members
  const parts = proc.stdout.trim().split(":");
  if (parts.length < 3) {
    throw new Error(`Invalid getent output for group '${groupname}'`);
  }

  return parseInt(parts[2]!, 10);
}

/**
 * Returns the uid of the user
 * @returns the uid of the user
 */
export async function resolveUserId(username: string): Promise<number> {
  if (isWin) throw new Error("Can not get user id on Windows");

  // Check if it's already a numeric uid
  const numericUid = parseInt(username, 10);
  if (!isNaN(numericUid)) {
    return numericUid;
  }

  const proc = await spawn(["id", "-u", username], { throwOnError: false });

  if (proc.exitCode !== 0) {
    throw new Error(`Failed to resolve user '${username}' to uid`);
  }

  return parseInt(proc.stdout.trim(), 10);
}
