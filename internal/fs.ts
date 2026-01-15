import { exists } from "fs/promises";
import { mkdir as fsMkdir } from "fs/promises";
import { stat } from "fs/promises";
import { chown as fsChown } from "fs/promises";
import { spawn } from "bun";
import { sudo, isEnabled as isSudoEnabled } from "internal/sudo";

export interface MkdirOptions {
  /**
   * If true, allows using sudo/elevation privileges to create the directory if needed
   * Requires the sudo module to be enabled globally (Unix-like systems only)
   */
  sudo?: boolean;

  /**
   * The owner of the directory. Supports multiple formats:
   * - "user" - change user only, leave group unchanged
   * - ":group" - change group only, leave user unchanged
   * - "user:group" - change both user and group
   * - "uid:gid" - numeric ids for both
   *
   * Only supported on Unix-like systems; silently ignored on Windows
   * Silently ignored if sudo/elevation is not available
   */
  owner?: string;
}

export interface MkdirResult {
  /**
   * True if anything changed (directory created or ownership updated)
   */
  changed: boolean;

  /**
   * True if the directory was newly created
   */
  created: boolean;

  /**
   * True if ownership was updated on an existing directory
   */
  ownershipChanged: boolean;
}

/**
 * Check if we're on a Unix-like system that supports ownership
 */
function isUnixLike(): boolean {
  return process.platform !== "win32";
}

/**
 * Check if we can effectively use sudo (both allowed by caller and globally enabled)
 * Only applicable on Unix-like systems
 */
function canUseSudo(allowed: boolean): boolean {
  return isUnixLike() && allowed && isSudoEnabled();
}

/**
 * Parse owner string to determine what's specified
 */
function parseOwner(owner: string): { user?: string; group?: string } {
  if (owner.startsWith(":")) {
    // Only group specified: ":group"
    return { group: owner.slice(1) };
  } else if (owner.includes(":")) {
    // Both specified: "user:group"
    const [user, group] = owner.split(":");
    return { user, group };
  } else {
    // Only user specified: "user"
    return { user: owner };
  }
}

/**
 * Resolve username to uid using the id command
 */
async function resolveUserId(username: string): Promise<number> {
  // Check if it's already a numeric uid
  const numericUid = parseInt(username, 10);
  if (!isNaN(numericUid)) {
    return numericUid;
  }

  const proc = spawn({
    cmd: ["id", "-u", username],
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Failed to resolve user '${username}' to uid`);
  }

  return parseInt(output.trim(), 10);
}

/**
 * Resolve groupname to gid using the id command
 */
async function resolveGroupId(groupname: string): Promise<number> {
  // Check if it's already a numeric gid
  const numericGid = parseInt(groupname, 10);
  if (!isNaN(numericGid)) {
    return numericGid;
  }

  const proc = spawn({
    cmd: ["getent", "group", groupname],
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Failed to resolve group '${groupname}' to gid`);
  }

  // getent group format: groupname:x:gid:members
  const parts = output.trim().split(":");
  if (parts.length < 3) {
    throw new Error(`Invalid getent output for group '${groupname}'`);
  }

  return parseInt(parts[2]!, 10);
}

/**
 * Get the current ownership as uid:gid using native fs.stat
 */
async function getCurrentOwnership(path: string): Promise<{ uid: number; gid: number }> {
  const stats = await stat(path);
  return { uid: stats.uid, gid: stats.gid };
}

/**
 * Check if ownership needs to be updated
 * Only compares the parts that are specified in the target owner string
 */
async function needsOwnershipUpdate(path: string, ownerSpec: string): Promise<boolean> {
  const current = await getCurrentOwnership(path);
  const parsed = parseOwner(ownerSpec);

  // Resolve specified parts
  const targetUid = parsed.user ? await resolveUserId(parsed.user) : undefined;
  const targetGid = parsed.group ? await resolveGroupId(parsed.group) : undefined;

  // Compare only specified parts
  if (targetUid !== undefined && current.uid !== targetUid) {
    return true;
  }
  if (targetGid !== undefined && current.gid !== targetGid) {
    return true;
  }

  return false;
}

/**
 * Set ownership of a path using chown command
 * This handles all ownership formats: "user", ":group", "user:group"
 */
async function setOwnershipWithCommand(path: string, ownerSpec: string, useSudo: boolean): Promise<void> {
  if (useSudo) {
    const chownResult = await sudo(["chown", ownerSpec, path]);
    if (!chownResult.success) {
      throw new Error(`Failed to set directory owner: ${chownResult.stderr || chownResult.stdout}`);
    }
  } else {
    const proc = spawn({
      cmd: ["chown", ownerSpec, path],
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`Failed to set directory owner: ${stderr}`);
    }
  }
}

/**
 * Set ownership of a path
 * Tries native chown first if both user and group are specified, otherwise uses chown command
 */
async function setOwnership(path: string, ownerSpec: string, useSudo: boolean): Promise<void> {
  const parsed = parseOwner(ownerSpec);

  // If both user and group are specified, we can try native fs.chown
  if (parsed.user && parsed.group) {
    const uid = await resolveUserId(parsed.user);
    const gid = await resolveGroupId(parsed.group);

    try {
      await fsChown(path, uid, gid);
      return;
    } catch (error) {
      const isPermissionError =
        error instanceof Error && "code" in error && (error.code === "EPERM" || error.code === "EACCES");

      if (!isPermissionError || !useSudo) {
        throw error;
      }
      // Fall through to command-based approach with sudo
    }
  }

  // For partial specifications or if native chown failed, use chown command
  // This properly handles ":group" and "user" formats
  await setOwnershipWithCommand(path, ownerSpec, useSudo);
}

/**
 * Idempotently creates a directory, including any necessary parent directories.
 * If the directory already exists, this function does nothing unless ownership needs updating.
 */
export async function mkdir(path: string, options: MkdirOptions = {}): Promise<MkdirResult> {
  const { sudo: allowSudo = false, owner } = options;
  const sudoAvailable = canUseSudo(allowSudo);

  const result: MkdirResult = {
    changed: false,
    created: false,
    ownershipChanged: false,
  };

  // Owner parameter is only supported on Unix-like systems
  const shouldHandleOwnership = isUnixLike() && owner && sudoAvailable;

  // Check if directory already exists
  const pathExists = await exists(path);

  if (pathExists) {
    // Directory exists - check if we need to update ownership
    if (shouldHandleOwnership) {
      const needsUpdate = await needsOwnershipUpdate(path, owner!);
      if (needsUpdate) {
        await setOwnership(path, owner!, sudoAvailable);
        result.ownershipChanged = true;
        result.changed = true;
      }
    }
    // Directory exists and ownership is correct (or not applicable)
    return result;
  }

  // Directory doesn't exist - need to create it
  try {
    // Always try to create with native mkdir first
    await fsMkdir(path, { recursive: true });
    result.created = true;
    result.changed = true;

    // Set ownership if needed
    if (shouldHandleOwnership) {
      await setOwnership(path, owner!, sudoAvailable);
      result.ownershipChanged = true;
    }
  } catch (error) {
    const isPermissionError =
      error instanceof Error &&
      (("code" in error && (error.code === "EACCES" || error.code === "EPERM")) ||
        error.message.toLowerCase().includes("permission denied"));

    if (isPermissionError && sudoAvailable) {
      // Retry with sudo using mkdir command
      const mkdirResult = await sudo(["mkdir", "-p", path]);
      if (!mkdirResult.success) {
        throw new Error(`Failed to create directory with sudo: ${mkdirResult.stderr || mkdirResult.stdout}`);
      }

      result.created = true;
      result.changed = true;

      // Set ownership if specified
      if (shouldHandleOwnership) {
        await setOwnershipWithCommand(path, owner!, sudoAvailable);
        result.ownershipChanged = true;
      }

      // When creating the dir with sude it will be owned by root by default, but the user expects to own it
      // as they really don't know if sudo was user or not.
      if (isUnixLike() && !owner) {
        await setOwnershipWithCommand(path, `${process!.getuid()}:${process!.getgid()}`, sudoAvailable);
        result.ownershipChanged = true;
      }
    } else {
      // Not a permission error or sudo not available, rethrow
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create directory: ${errorMessage}`);
    }
  }

  return result;
}
