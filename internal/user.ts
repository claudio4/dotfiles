import { join } from "node:path";
import { homedir, userInfo } from "node:os";
import { spawn } from "internal/cmd";
import { sudo, isEnabled as isSudoEnabled } from "internal/sudo";

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

export const getHome = homedir;

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

export interface SetShellResult {
  /**
   * True if the shell was changed
   */
  changed: boolean;

  /**
   * The resolved full path of the shell
   */
  shell: string;
}

/**
 * Idempotently sets a user's login shell.
 *
 * Accepts either a full path (e.g. "/bin/zsh") or just the binary name (e.g. "zsh").
 * When a binary name is given, it is resolved to a full path by looking it up in the
 * system's list of valid shells (/etc/shells on Linux and macOS).
 *
 * The function is idempotent: if the user's shell is already set to the target,
 * no changes are made.
 *
 * @requires sudo privileges
 * @param shell - Full path or binary name of the desired shell
 * @param options - Optional settings for the target user. Current user by default
 * @returns Result indicating whether a change was made and the resolved shell path
 * @throws On Windows, if sudo is not enabled, if the shell is not found in /etc/shells,
 *         or if chsh fails
 */
export async function setShell(shell: string, username?: string): Promise<SetShellResult> {
  if (isWin) throw new Error("setShell is not supported on Windows");

  if (!isSudoEnabled()) {
    throw new Error("setShell requires the sudo module to be enabled. Call sudo.enable() first.");
  }

  const targetUser = username || getUserName();

  // Read valid shells from the system
  const validShells = await getValidShells();

  // Resolve shell to a full path
  const resolvedShell = resolveShellPath(shell, validShells);

  // Get the user's current shell
  const currentShell = await getCurrentShell(targetUser);

  // Idempotent: already set
  if (currentShell === resolvedShell) {
    return { changed: false, shell: resolvedShell };
  }

  // Always use sudo to avoid interactive password prompt from chsh
  const result = await sudo(["chsh", "-s", resolvedShell, targetUser]);

  if (!result.success) {
    throw new Error(
      `Failed to change shell to '${resolvedShell}' for user '${targetUser}': ${result.stderr || result.stdout}`,
    );
  }

  return { changed: true, shell: resolvedShell };
}

/**
 * Reads the list of valid login shells from the system.
 * Parses /etc/shells on Linux and macOS, ignoring comments and blank lines.
 */
async function getValidShells(): Promise<string[]> {
  const content = await Bun.file("/etc/shells").text();
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Resolves a shell identifier to a full path.
 * If the input already contains a `/`, it is treated as a full path and validated
 * against the list of valid shells.
 * If it is a bare name (e.g. "zsh"), it is matched against the basenames in /etc/shells.
 */
function resolveShellPath(shell: string, validShells: string[]): string {
  if (shell.includes("/")) {
    // Full path provided — validate it exists in /etc/shells
    if (!validShells.includes(shell)) {
      throw new Error(`Shell '${shell}' is not listed in /etc/shells. Valid shells: ${validShells.join(", ")}`);
    }
    return shell;
  }

  // Bare binary name — find matching entry in /etc/shells
  const matches = validShells.filter((s) => s.endsWith(`/${shell}`));

  if (matches.length === 0) {
    throw new Error(`No shell matching '${shell}' found in /etc/shells. Valid shells: ${validShells.join(", ")}`);
  }

  if (matches.length > 1) {
    // Prefer the shortest path (e.g. /bin/zsh over /usr/local/bin/zsh)
    // as it's typically the system-canonical path
    matches.sort((a, b) => a.length - b.length);
  }

  return matches[0]!;
}

/**
 * Gets the current login shell for a user.
 * Uses `dscl` on macOS and `getent passwd` on Linux/Unix.
 * Falls back to `userInfo().shell` for the current user.
 */
async function getCurrentShell(username: string): Promise<string> {
  // Avoid external program calls if possible
  const currentUser = userInfo();
  if (username === currentUser.username) {
    try {
      const shell = currentUser.shell;
      // sometimes userInfo fails and returns unknown.
      if (shell && shell !== "unknown") {
        return shell;
      }
    } catch {}
  }

  if (!isMac) {
    const proc = await spawn(["getent", "passwd", username], { throwOnError: false });
    if (proc.exitCode === 0) {
      // getent passwd format: username:x:uid:gid:gecos:home:shell
      const parts = proc.stdout.trim().split(":");
      if (parts.length >= 7) return parts[6]!;
    }
  } else {
    const proc = await spawn(["dscl", ".", "-read", `/Users/${username}`, "UserShell"], {
      throwOnError: false,
    });
    if (proc.exitCode === 0) {
      // Output format: "UserShell: /bin/zsh"
      const match = proc.stdout.trim().match(/UserShell:\s*(.+)/);
      if (match) return match[1]!.trim();
    }
  }

  throw new Error(`Failed to determine current shell for user '${username}'`);
}
