import { spawn } from "bun";
import { exists } from "fs/promises";

export interface GitCloneOptions {
  /**
   * The git repository URL to clone
   */
  url: string;

  /**
   * The destination path where the repository should be cloned
   */
  destination: string;

  /**
   * The version to checkout (commit hash, tag, or branch name)
   * If not specified, the default branch will be used
   */
  version?: string;

  /**
   * If true, discard any local changes before updating
   * This performs a hard reset to the specified version
   */
  force?: boolean;

  /**
   * If true and the repository already exists and version is a branch,
   * pull the latest changes from the remote
   */
  update?: boolean;

  /**
   * If true, perform a shallow clone with depth of 1
   * This reduces clone time and disk usage
   */
  shallow?: boolean;
}

export interface GitCloneResult {
  /**
   * True if any content changed (clone, update, checkout, or force)
   */
  changed: boolean;

  /**
   * True if the repository was newly cloned
   */
  created: boolean;

  /**
   * True if changes were pulled from remote
   */
  updated: boolean;

  /**
   * True if local changes were discarded via force
   */
  forced: boolean;

  /**
   * True if a different version was checked out
   */
  checkedOut: boolean;
}

/**
 * Run a git command silently (no output to console)
 */
async function runGit(args: string[], cwd?: string): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const proc = spawn({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return {
    success: exitCode === 0,
    stdout: output.trim(),
    stderr: errorOutput.trim(),
  };
}

/**
 * Check if a directory is a git repository
 */
async function isGitRepo(path: string): Promise<boolean> {
  const pathExists = await exists(path);
  if (!pathExists) {
    return false;
  }

  const result = await runGit(["rev-parse", "--git-dir"], path);
  return result.success;
}

/**
 * Get the current commit hash (HEAD)
 */
async function getCurrentCommit(repoPath: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "HEAD"], repoPath);
  return result.success ? result.stdout : null;
}

/**
 * Check if a version string refers to a branch in the remote repository
 */
async function isRemoteBranch(repoPath: string, version: string): Promise<boolean> {
  // Fetch remote refs to ensure we have up-to-date information
  await runGit(["fetch", "--quiet"], repoPath);

  // Check if the version exists as a remote branch
  const result = await runGit(["rev-parse", "--verify", `origin/${version}`], repoPath);
  return result.success;
}

/**
 * Get the current branch name, or null if in detached HEAD state
 */
async function getCurrentBranch(repoPath: string): Promise<string | null> {
  const result = await runGit(["symbolic-ref", "--short", "HEAD"], repoPath);
  return result.success ? result.stdout : null;
}

/**
 * Idempotently clone a git repository
 */
export async function gitClone(options: GitCloneOptions): Promise<GitCloneResult> {
  const { url, destination, version, force = false, update = false, shallow = false } = options;

  const result: GitCloneResult = {
    changed: false,
    created: false,
    updated: false,
    forced: false,
    checkedOut: false,
  };

  const repoExists = await isGitRepo(destination);

  if (!repoExists) {
    // Repository doesn't exist, clone it
    const cloneArgs = ["clone", "--quiet"];

    if (shallow) {
      cloneArgs.push("--depth", "1");
    }

    // If a specific version is provided and we're doing a shallow clone,
    // we can use --branch to clone only that branch/tag
    if (version && shallow) {
      cloneArgs.push("--branch", version);
    }

    cloneArgs.push(url, destination);

    const cloneResult = await runGit(cloneArgs);
    if (!cloneResult.success) {
      throw new Error(`Failed to clone repository: ${cloneResult.stderr || cloneResult.stdout}`);
    }

    result.created = true;
    result.changed = true;

    // If version is specified and we didn't use --branch (non-shallow clone),
    // checkout the specific version
    if (version && !shallow) {
      const checkoutResult = await runGit(["checkout", "--quiet", version], destination);
      if (!checkoutResult.success) {
        throw new Error(`Failed to checkout version '${version}': ${checkoutResult.stderr || checkoutResult.stdout}`);
      }
      result.checkedOut = true;
    }

    return result;
  }

  // Repository exists, handle updates
  if (force) {
    // Discard any local changes
    const cleanResult = await runGit(["clean", "-fdx", "--quiet"], destination);
    if (!cleanResult.success) {
      throw new Error(`Failed to clean repository: ${cleanResult.stderr || cleanResult.stdout}`);
    }

    const resetResult = await runGit(["reset", "--hard", "--quiet"], destination);
    if (!resetResult.success) {
      throw new Error(`Failed to reset repository: ${resetResult.stderr || resetResult.stdout}`);
    }

    result.forced = true;
    result.changed = true;
  }

  // If version is specified, check if it's a branch and handle accordingly
  if (version) {
    const isBranch = await isRemoteBranch(destination, version);

    if (isBranch) {
      // It's a branch
      const currentBranch = await getCurrentBranch(destination);

      if (currentBranch === version) {
        // Already on the correct branch
        if (update) {
          // Get commit before pull
          const commitBefore = await getCurrentCommit(destination);

          // Pull latest changes
          const pullResult = await runGit(["pull", "--quiet", "origin", version], destination);
          if (!pullResult.success) {
            throw new Error(`Failed to pull branch '${version}': ${pullResult.stderr || pullResult.stdout}`);
          }

          // Check if commit changed
          const commitAfter = await getCurrentCommit(destination);
          if (commitBefore !== commitAfter) {
            result.updated = true;
            result.changed = true;
          }
        }
      } else {
        // Switch to the branch
        const commitBefore = await getCurrentCommit(destination);

        const checkoutResult = await runGit(["checkout", "--quiet", version], destination);
        if (!checkoutResult.success) {
          throw new Error(`Failed to checkout branch '${version}': ${checkoutResult.stderr || checkoutResult.stdout}`);
        }

        const commitAfter = await getCurrentCommit(destination);
        if (commitBefore !== commitAfter) {
          result.checkedOut = true;
          result.changed = true;
        }

        if (update) {
          // Get commit before pull
          const commitBeforePull = commitAfter;

          // Pull latest changes after checkout
          const pullResult = await runGit(["pull", "--quiet", "origin", version], destination);
          if (!pullResult.success) {
            throw new Error(`Failed to pull branch '${version}': ${pullResult.stderr || pullResult.stdout}`);
          }

          // Check if commit changed
          const commitAfterPull = await getCurrentCommit(destination);
          if (commitBeforePull !== commitAfterPull) {
            result.updated = true;
            result.changed = true;
          }
        }
      }
    } else {
      // It's a commit or tag, just checkout
      const commitBefore = await getCurrentCommit(destination);

      const checkoutResult = await runGit(["checkout", "--quiet", version], destination);
      if (!checkoutResult.success) {
        throw new Error(`Failed to checkout version '${version}': ${checkoutResult.stderr || checkoutResult.stdout}`);
      }

      const commitAfter = await getCurrentCommit(destination);
      if (commitBefore !== commitAfter) {
        result.checkedOut = true;
        result.changed = true;
      }
    }
  } else if (update) {
    // No version specified, but update is requested
    // Pull the current branch if we're on one
    const currentBranch = await getCurrentBranch(destination);
    if (currentBranch) {
      const commitBefore = await getCurrentCommit(destination);

      const pullResult = await runGit(["pull", "--quiet", "origin", currentBranch], destination);
      if (!pullResult.success) {
        throw new Error(`Failed to pull current branch: ${pullResult.stderr || pullResult.stdout}`);
      }

      const commitAfter = await getCurrentCommit(destination);
      if (commitBefore !== commitAfter) {
        result.updated = true;
        result.changed = true;
      }
    }
  }

  return result;
}
