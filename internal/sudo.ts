import { spawn, spawnSync, type SpawnOptions } from "bun";

// Refresh sudo timestamp every 2 minutes to keep it alive
const KEEPALIVE_INTERVAL_MS = 1000 * 60 * 2;
let keepAliveTimer: Timer | null = null;

/**
 * Executes a command with sudo privileges.
 * It keeps the sudo `hot` so it only asks for credentials once.
 */
export async function authenticate() {
  const check = spawn(["sudo", "-n", "true"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  // 'sudo -n true' returns exit code 0 if we have privileges, non-zero if we need a password.
  if ((await check.exited) === 0) {
    startKeepAlive();
    return;
  }

  console.log("\nRoot privileges required for this operation.");

  // We use "inherit" for stdin/out/err so the sudo prompt appears directly in the terminal
  // and the user can type the password securely without us handling the string.
  // Sync is used because we don't want anything else messing with the terminal.
  const auth = spawnSync(["sudo", "-v"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  if (auth.exitCode !== 0) {
    throw new Error("Failed to authenticate with sudo. Operation aborted.");
  }

  console.log("Authentication successful.\n");
  startKeepAlive();
}

/**
 * Spawns a command with root privileges.
 * Will fail if autehnticate has not been called first.
 * Otherwise it behaves the same as Bun.spawn
 */
export function sudo<
  const In extends SpawnOptions.Writable = "ignore",
  const Out extends SpawnOptions.Readable = "pipe",
  const Err extends SpawnOptions.Readable = "inherit",
>(cmd: string[], options?: SpawnOptions.SpawnOptions<In, Out, Err>) {
  if (!keepAliveTimer) {
    throw new Error("sudo authentication required");
  }
  return spawn(["sudo", ...cmd], options);
}

/**
 * Starts a background loop to refresh the sudo timestamp.
 * This ensures long-running scripts don't prompt for a password again.
 */
function startKeepAlive() {
  if (keepAliveTimer) return;

  keepAliveTimer = setInterval(() => {
    // Run 'sudo -v' silently to update the timestamp
    spawn(["sudo", "-v"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
  }, KEEPALIVE_INTERVAL_MS);

  // Unref the timer so it doesn't prevent the process from exiting
  // when the main script finishes.
  if (keepAliveTimer && typeof (keepAliveTimer as any).unref === "function") {
    (keepAliveTimer as any).unref();
  }
}
