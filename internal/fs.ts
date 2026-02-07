import { cp, exists, lstat, readdir, readFile, readlink, rm, symlink, writeFile } from "fs/promises";
import { mkdir as fsMkdir } from "fs/promises";
import { stat } from "fs/promises";
import { chown as fsChown } from "fs/promises";
import { sudo, isEnabled as isSudoEnabled } from "internal/sudo";
import { resolveGroupId, resolveUserId } from "./user";
import { isUnixLike } from "./utils";
import { dirname, join, resolve } from "path";

export interface CopyOptions {
  /**
   * If true, allows using sudo/elevation privileges to copy if needed
   * Requires the sudo module to be enabled globally (Unix-like systems only)
   */
  sudo?: boolean;

  /**
   * The owner of the destination. Supports multiple formats:
   * - "user" - change user only, leave group unchanged
   * - ":group" - change group only, leave user unchanged
   * - "user:group" - change both user and group
   * - "uid:gid" - numeric ids for both
   *
   * Only supported on Unix-like systems; silently ignored on Windows
   * Silently ignored if sudo/elevation is not available
   */
  owner?: string;

  /**
   * If true, always overwrite destination
   * Default: false
   */
  force?: boolean;

  /**
   * Pattern(s) to ignore when copying directories.
   * Files or directories matching this pattern will be skipped.
   * Can be a string (exact match), RegExp, or an array of either.
   * The pattern is matched against the full path of each file/directory being copied.
   * Note: When using sudo fallback, this option is not supported.
   */
  ignore?: string | RegExp | Array<string | RegExp>;
}

export interface CopyResult {
  /**
   * True if anything changed (file/directory copied or ownership updated)
   */
  changed: boolean;

  /**
   * True if the destination was created (copied)
   */
  created: boolean;

  /**
   * True if ownership was updated on an existing destination
   */
  ownershipChanged: boolean;
}

/**
 * Idempotently copies a file or directory to a destination
 * Creates parent directories as needed
 */
export async function copy(source: string, destination: string, options: CopyOptions = {}): Promise<CopyResult> {
  const { sudo: allowSudo = false, owner, force = false, ignore } = options;
  const sudoAvailable = canUseSudo(allowSudo);

  const result: CopyResult = {
    changed: false,
    created: false,
    ownershipChanged: false,
  };

  // Check if source exists
  const sourceExists = await exists(source);
  if (!sourceExists) {
    throw new Error(`Source does not exist: ${source}`);
  }

  // Owner parameter is only supported on Unix-like systems
  const shouldHandleOwnership = isUnixLike() && owner && sudoAvailable;

  const destExists = await exists(destination);

  if (!force && destExists) {
    const areIdentical = await compareSourceAndDest(source, destination, ignore);
    if (areIdentical) {
      // they might have the same content but ownership could be wrong
      if (shouldHandleOwnership) {
        const needsUpdate = await needsOwnershipUpdate(destination, owner!);
        if (needsUpdate) {
          await setOwnershipRecursive(destination, owner!);
          result.ownershipChanged = true;
          result.changed = true;
        }
      }

      return result;
    }
  }

  // Build filter function for ignore patterns
  const filter = ignore ? createFilterFunction(ignore) : undefined;

  try {
    await cp(source, destination, {
      recursive: true,
      force: true,
      preserveTimestamps: true,
      filter,
    });

    result.created = !destExists;
    result.changed = true;

    if (shouldHandleOwnership) {
      await setOwnershipRecursive(destination, owner!);
      result.ownershipChanged = true;
    }
  } catch (error) {
    const insufficientPermission = isPermissionError(error);

    if (insufficientPermission && sudoAvailable) {
      // Retry with sudo using cp command
      // Note: ignore patterns are not supported when using sudo fallback
      if (ignore) {
        throw new Error("Ignore patterns are not supported when using sudo fallback");
      }

      const cpArgs = ["-r", "-p", "-f"];
      cpArgs.push(source, destination);

      const cpResult = await sudo(["cp", ...cpArgs]);
      if (!cpResult.success) {
        throw new Error(`Failed to copy with sudo: ${cpResult.stderr || cpResult.stdout}`);
      }

      result.created = true;
      result.changed = true;

      if (shouldHandleOwnership) {
        await setOwnershipRecursive(destination, owner!);
        result.ownershipChanged = true;
      } else if (!owner) {
        // When creating the dir with sude it will be owned by root by default, but the user expects to own it
        // as they really don't know if sudo was user or not.
        await setOwnershipRecursive(destination, currentUserOwnerString());
      }
    } else {
      // Not a permission error or sudo not available, rethrow
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to copy: ${errorMessage}`);
    }
  }

  return result;
}

/**
 * Creates a filter function for use with fs.cp based on ignore patterns
 * Returns true to include the file, false to exclude it
 */
function createFilterFunction(ignore: string | RegExp | Array<string | RegExp>): (src: string) => boolean {
  const patterns = Array.isArray(ignore) ? ignore : [ignore];

  return (src: string) => {
    for (const pattern of patterns) {
      if (typeof pattern === "string") {
        // For string patterns, check if the path includes the pattern
        if (src.includes(pattern)) {
          return false;
        }
      } else if (pattern instanceof RegExp) {
        // For RegExp patterns, test against the full path
        if (pattern.test(src)) {
          return false;
        }
      }
    }
    // Include the file if no patterns matched
    return true;
  };
}

/**
 * Compare source and destination to check if they are identical
 * Returns true if they are the same, false if different
 */
async function compareSourceAndDest(
  source: string,
  dest: string,
  ignore?: string | RegExp | Array<string | RegExp>,
): Promise<boolean> {
  try {
    const sourceStat = await stat(source);
    const destStat = await stat(dest);

    // If types don't match (file vs directory), they're different
    if (sourceStat.isFile() !== destStat.isFile() || sourceStat.isDirectory() !== destStat.isDirectory()) {
      return false;
    }

    if (sourceStat.isFile()) {
      // For files, compare size and modification time
      // If both match, we consider them identical (avoids reading entire file content)
      return sourceStat.size === destStat.size && sourceStat.mtimeMs === destStat.mtimeMs;
    }

    if (sourceStat.isDirectory()) {
      return await compareDirectories(source, dest, ignore);
    }

    // For other types (symlinks, etc.), consider them different
    return false;
  } catch (error) {
    // If we can't stat either path, consider them different
    return false;
  }
}

/**
 * Recursively compare two directories
 */
async function compareDirectories(
  sourceDir: string,
  destDir: string,
  ignore?: string | RegExp | Array<string | RegExp>,
): Promise<boolean> {
  try {
    const filter = ignore ? createFilterFunction(ignore) : undefined;

    const sourceEntries = await readdir(sourceDir);
    const destEntries = await readdir(destDir);

    const filteredSourceEntries = filter
      ? sourceEntries.filter((entry) => filter(join(sourceDir, entry)))
      : sourceEntries;

    const sourceSet = new Set(filteredSourceEntries);

    // Check if all filtered source entries exist in dest and match
    for (const entry of sourceSet) {
      if (!destEntries.includes(entry)) {
        return false;
      }

      // Recursively compare each entry
      const sourcePath = join(sourceDir, entry);
      const destPath = join(destDir, entry);

      const areIdentical = await compareSourceAndDest(sourcePath, destPath, ignore);
      if (!areIdentical) {
        return false;
      }
    }

    return true;
  } catch (error) {
    // If we can't read directories, consider them different
    return false;
  }
}

/**
 * Recursively set ownership on a path and all its contents
 */
async function setOwnershipRecursive(path: string, ownerSpec: string): Promise<void> {
  const chownResult = await sudo(["chown", "-R", ownerSpec, path]);
  if (!chownResult.success) {
    throw new Error(`Failed to set ownership: ${chownResult.stderr || chownResult.stdout}`);
  }
}

function isPermissionError(error: any): Boolean {
  return (
    error instanceof Error &&
    (("code" in error && (error.code === "EACCES" || error.code === "EPERM")) ||
      error.message.toLowerCase().includes("permission denied"))
  );
}

export interface EnsureLineOptions {
  /**
   * Where to insert the line if it doesn't exist
   * - "start" - at the beginning of the file
   * - "end" - at the end of the file (default)
   * - "before" - before the first line matching the search pattern
   * - "after" - after the first line matching the search pattern
   */
  position?: "start" | "end" | "before" | "after";

  /**
   * Search pattern for before/after positioning
   * Can be a string (exact line match) or RegExp
   * Required when position is "before" or "after"
   */
  search?: string | RegExp;
}

export interface EnsureLineResult {
  /**
   * True if the file was modified
   */
  changed: boolean;

  /**
   * True if the file was created
   */
  created: boolean;

  /**
   * True if the line was added to the file
   */
  added: boolean;
}

/**
 * Idempotently ensures a line exists in a file
 * Creates the file if it doesn't exist
 */
export async function ensureLine(
  path: string,
  line: string,
  options: EnsureLineOptions = {},
): Promise<EnsureLineResult> {
  const { position = "end", search } = options;

  const result: EnsureLineResult = {
    changed: false,
    created: false,
    added: false,
  };

  // Validate options
  if ((position === "before" || position === "after") && !search) {
    throw new Error(`search pattern is required when position is "${position}"`);
  }

  const fileExists = await exists(path);

  if (!fileExists) {
    const lineEnding = process.platform === "win32" ? "\r\n" : "\n";
    await writeFile(path, line + lineEnding, "utf-8");

    result.created = true;
    result.added = true;
    result.changed = true;
    return result;
  }

  // Read file content
  const content = await readFile(path, "utf-8");
  const lineEnding = detectLineEnding(content);
  const lines = content.split(/\r?\n/);

  if (lines.includes(line)) {
    return result;
  }

  let newLines: string[];

  if (position === "start") {
    newLines = [line, ...lines];
  } else if (position === "end") {
    newLines = [...lines, line];
  } else if (position === "before" || position === "after") {
    // Find the first matching line
    const matchIndex = lines.findIndex((l) => lineMatches(l, search!));

    if (matchIndex === -1) {
      throw new Error(`Search pattern not found in file: ${search instanceof RegExp ? search.source : search}`);
    }

    if (position === "before") {
      newLines = [...lines.slice(0, matchIndex), line, ...lines.slice(matchIndex)];
    } else {
      newLines = [...lines.slice(0, matchIndex + 1), line, ...lines.slice(matchIndex + 1)];
    }
  } else {
    throw new Error(`Invalid position: ${position}`);
  }

  // Write back to file
  // Join lines and ensure file ends with a line ending
  let newContent = newLines.join(lineEnding);

  // preserve final new line if present
  if (content.endsWith(lineEnding)) {
    newContent += lineEnding;
  }

  await writeFile(path, newContent, "utf-8");

  result.added = true;
  result.changed = true;

  return result;
}

/**
 * Detect the line ending style used in content
 * Returns "\r\n" for Windows-style, "\n" for Unix-style
 * Falls back to OS default if content is empty or has no line breaks
 */
function detectLineEnding(content: string): "\n" | "\r\n" {
  if (content.includes("\r\n")) {
    return "\r\n";
  }
  if (content.includes("\n")) {
    return "\n";
  }
  // Default based on platform
  return process.platform === "win32" ? "\r\n" : "\n";
}

/**
 * Check if a line matches a search pattern
 */
function lineMatches(line: string, pattern: string | RegExp): boolean {
  if (typeof pattern === "string") {
    return line === pattern;
  }
  return pattern.test(line);
}

export interface LinkOptions {
  /**
   * How to handle source directories:
   * - "normal" - create a single symlink pointing to the target (default)
   * - "files" - replicate the directory structure at the destination with real directories,
   *   then create symlinks for each individual file. Same as normal if the target is a file
   */
  type?: "normal" | "files";

  /**
   * Pattern(s) to ignore when linking directories with type "files".
   * Files or directories matching this pattern will be skipped.
   * Can be a string (exact match), RegExp, or an array of either.
   * The pattern is matched against the full path of each file/directory.
   * Only applicable when type is "files"; ignored otherwise.
   */
  ignore?: string | RegExp | Array<string | RegExp>;
}

export interface LinkResult {
  /**
   * True if anything changed (symlinks created, replaced, or directories created)
   */
  changed: boolean;
}

/**
 * Idempotently creates a symbolic link (or a tree of symbolic links) from destination to source.
 *
 * If the destination already exists as a symlink pointing to the correct source, nothing happens.
 * If the destination exists but points elsewhere or is a regular file/directory, it is removed
 * and replaced with the correct symlink.
 *
 * When the source is a directory and `type` is "files", the directory structure is replicated
 * at the destination using real directories, and each individual file is symlinked.
 */
export async function link(source: string, destination: string, options: LinkOptions = {}): Promise<LinkResult> {
  const { type = "normal", ignore } = options;

  const result: LinkResult = { changed: false };

  // Resolve to absolute paths for consistent symlink targets
  const resolvedSource = resolve(source);
  const resolvedDest = resolve(destination);

  // Check if source exists
  const sourceExists = await exists(resolvedSource);
  if (!sourceExists) {
    throw new Error(`Source does not exist: ${resolvedSource}`);
  }

  const sourceStat = await stat(resolvedSource);

  // If source is a file, or type is "normal", create a single symlink
  if (sourceStat.isFile() || type === "normal") {
    const linkChanged = await ensureSymlink(resolvedSource, resolvedDest);
    if (linkChanged) {
      result.changed = true;
    }
    return result;
  }

  // Source is a directory and type is "files"
  if (sourceStat.isDirectory() && type === "files") {
    const changed = await linkDirectoryFiles(resolvedSource, resolvedDest, ignore);
    if (changed) {
      result.changed = true;
    }
    return result;
  }

  throw new Error(`Unsupported source type at: ${resolvedSource}`);
}

/**
 * Ensures a symlink exists at linkPath pointing to target.
 * Creates parent directories as needed.
 * Returns true if any changes were made.
 */
async function ensureSymlink(target: string, linkPath: string): Promise<boolean> {
  // Ensure parent directory exists
  await fsMkdir(dirname(linkPath), { recursive: true });

  // Check if linkPath already exists
  try {
    const linkStat = await lstat(linkPath);

    if (linkStat.isSymbolicLink()) {
      const currentTarget = await readlink(linkPath);
      // Resolve the current target relative to the symlink's directory
      const resolvedCurrentTarget = resolve(dirname(linkPath), currentTarget);

      if (resolvedCurrentTarget === target) {
        // Already points to the correct target
        return false;
      }
    }

    // Exists but is not the correct symlink — remove it
    await rm(linkPath, { recursive: true, force: true });
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    // Doesn't exist, we'll create it below
  }

  await symlink(target, linkPath);
  return true;
}

/**
 * Recursively replicates directory structure and symlinks individual files.
 * Returns true if any changes were made.
 */
async function linkDirectoryFiles(
  sourceDir: string,
  destDir: string,
  ignore?: string | RegExp | Array<string | RegExp>,
): Promise<boolean> {
  let changed = false;

  // Ensure destination directory exists (as a real directory, not a symlink)
  try {
    const destStat = await lstat(destDir);

    if (!destStat.isDirectory() || destStat.isSymbolicLink()) {
      // It's a file, symlink, or something else — remove and recreate as a real directory
      await rm(destDir, { recursive: true, force: true });
      await fsMkdir(destDir, { recursive: true });
      changed = true;
    }
  } catch (error: any) {
    if (error.code === "ENOENT") {
      await fsMkdir(destDir, { recursive: true });
      changed = true;
    } else {
      throw error;
    }
  }

  const filter = ignore ? createFilterFunction(ignore) : undefined;
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const destPath = join(destDir, entry.name);

    // Apply filter
    if (filter && !filter(sourcePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      const dirChanged = await linkDirectoryFiles(sourcePath, destPath, ignore);
      if (dirChanged) changed = true;
    } else {
      const linkChanged = await ensureSymlink(sourcePath, destPath);
      if (linkChanged) changed = true;
    }
  }

  return changed;
}

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

  const pathExists = await exists(path);

  if (pathExists) {
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
    const insufficientPermissions = isPermissionError(error);

    if (insufficientPermissions && sudoAvailable) {
      // Retry with sudo using mkdir command
      const mkdirResult = await sudo(["mkdir", "-p", path]);
      if (!mkdirResult.success) {
        throw new Error(`Failed to create directory with sudo: ${mkdirResult.stderr || mkdirResult.stdout}`);
      }

      result.created = true;
      result.changed = true;

      // Set ownership if specified
      if (shouldHandleOwnership) {
        await setOwnershipWithCommand(path, owner!);
        result.ownershipChanged = true;
      } else if (isUnixLike() && !owner) {
        // When creating the dir with sude it will be owned by root by default, but the user expects to own it
        // as they really don't know if sudo was user or not.
        await setOwnershipWithCommand(path, currentUserOwnerString());
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
  await setOwnershipWithCommand(path, ownerSpec);
}

/**
 * Returns the current user's owner string in the format "uid:gid".
 * @returns The current user's owner string.
 */
function currentUserOwnerString(): string {
  return `${process!.getuid()}:${process!.getgid()}`;
}

/**
 * Set ownership of a path using chown command
 * This handles all ownership formats: "user", ":group", "user:group"
 */
async function setOwnershipWithCommand(path: string, ownerSpec: string): Promise<void> {
  const chownResult = await sudo(["chown", ownerSpec, path]);
  if (!chownResult.success) {
    throw new Error(`Failed to set directory owner: ${chownResult.stderr || chownResult.stdout}`);
  }
}
