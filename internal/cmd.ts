import { isTaskRegistered, TaskStatus } from "./task";
import type { Spawn } from "bun";

/**
 * Adds a path to the current PATH environment variable.
 * This makes the command available to the current process.
 */
export function addToCurrentPATH(path: string): void {
  process.env.PATH = `${path}:${process.env.PATH}`;
}

/**
 * Checks if a command exists in the system.
 */
export function commandExists(cmd: string): boolean {
  return !!Bun.which(cmd);
}

/**
 * Checks if a command exists in the system or if a task is registered.
 * Useful when you know that a task already handles the program
 * @param cmd The command to check.
 * @param taskId The task ID to check.
 * @returns if either the command exists or the task is registered.
 */
export async function commandOrTaskRegistered(cmd: string, taskId: string): Promise<boolean> {
  return commandExists(cmd) || isTaskRegistered(taskId);
}

/**
 * Error thrown when a spawned command fails.
 */
export class SpawnError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly command: string[],
  ) {
    super(message);
    this.name = "SpawnError";
  }
}

/**
 * Result of a spawned command.
 */
export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Options for the spawn wrapper function.
 */
export interface SpawnOptions<In extends Spawn.Writable> extends Omit<
  Spawn.SpawnOptions<In, "pipe", "pipe">,
  "stdout" | "stderr"
> {
  /**
   * Whether to throw an error when the command exits with a non-zero code.
   * @default true
   */
  throwOnError?: boolean;
}

/**
 * Wrapper around Bun.spawn that returns the exit code, stdout, and stderr.
 *
 * @param command The command to spawn as an array (e.g., ["ls", "-la"])
 * @param options Spawn options, including throwOnError (defaults to true)
 * @returns Promise resolving to SpawnResult with exitCode, stdout, and stderr
 * @throws SpawnError if the command fails and throwOnError is true
 */
export async function spawn<const In extends Spawn.Writable = "ignore">(
  command: string[],
  options: SpawnOptions<In> = {},
): Promise<SpawnResult> {
  const { throwOnError = true, ...spawnOptions } = options;

  const proc = Bun.spawn(command, {
    ...spawnOptions,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);

  if (throwOnError && exitCode !== 0) {
    throw new SpawnError(
      `Command failed with exit code ${exitCode}: ${command.join(" ")}`,
      exitCode,
      stdout,
      stderr,
      command,
    );
  }

  return {
    exitCode,
    stdout,
    stderr,
  };
}
