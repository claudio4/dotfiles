import { spawn } from "bun";

export type BecomeMethod = "sudo" | "su" | "doas" | "pkexec";

export interface BecomeOptions {
  method?: BecomeMethod;
  user?: string;
  password?: string;
  flags?: string[];
  timeout?: number;
  env?: Record<string, string>;
}

export interface BecomeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export class BecomeError extends Error {
  public readonly exitCode: number | null;
  public readonly stdout: string;
  public readonly stderr: string;

  constructor(message: string, context: { stdout?: string; stderr?: string; exitCode?: number | null } = {}) {
    super(message);
    this.name = "BecomeError";
    this.stdout = context.stdout ?? "";
    this.stderr = context.stderr ?? "";
    this.exitCode = context.exitCode ?? null;
  }
}

const DEFAULT_METHOD: BecomeMethod = "sudo";
const DEFAULT_USER = "root";
const DEFAULT_TIMEOUT = 30_000;

// password to be used by default.
// any caller can set it with setDefaultPassword but it can not be read.
let defaultPassword: string | undefined;

// Module must be explicitly enabled before use
let isModuleEnabled = false;

export async function sudo(command: string | string[], options: BecomeOptions = {}): Promise<BecomeResult> {
  if (!isModuleEnabled) {
    throw new BecomeError("sudo module must be enabled before use. Call enable() first.");
  }

  const method = options.method || DEFAULT_METHOD;
  const user = options.user || DEFAULT_USER;
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  // Prepare command string
  const cmdString = Array.isArray(command) ? command.map(quoteArg).join(" ") : command;

  const fullArgs = buildEscalationArgs(cmdString, method, user, options.flags);

  return executeWithEscalation(fullArgs, method, options.password ?? defaultPassword, timeout, options.env);
}

/**
 * Checks if superuser powers can be obtained
 * @param method the method to be used to gain superuser powers
 * @returns wether superuser powers could be obtained
 */
export async function check(method: BecomeMethod = "sudo"): Promise<boolean> {
  if (!isModuleEnabled) return false;

  try {
    const result = await sudo("true", { method, timeout: 1000 });
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Checks if sudo requires a password to run commands.
 * Returns true if a password is needed, false if sudo can run passwordless
 * (e.g. NOPASSWD rule or cached credentials).
 */
export async function needsPassword(method: BecomeMethod = "sudo"): Promise<boolean> {
  if (!isModuleEnabled) {
    throw new BecomeError("sudo module must be enabled before use. Call enable() first.");
  }

  switch (method) {
    case "sudo": {
      // sudo -n (non-interactive) will fail if a password is required
      const proc = spawn(["sudo", "-n", "true"], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 1000,
      });
      const exitCode = await proc.exited;
      return exitCode !== 0;
    }
    case "doas": {
      // doas -n (non-interactive) will fail if a password is required
      const proc = spawn(["doas", "-n", "true"], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 1000,
      });
      const exitCode = await proc.exited;
      return exitCode !== 0;
    }
    case "su":
    case "pkexec":
      // su and pkexec always require authentication
      return true;
    default:
      return true;
  }
}

// Enables the sudo module for use
export function enable(): void {
  isModuleEnabled = true;
}

// Disables the sudo module, preventing further use
export function disable(): void {
  isModuleEnabled = false;
}

// Returns whether the sudo module is currently enabled
export function isEnabled(): boolean {
  return isModuleEnabled;
}

// Sets the password to be used by default in all sudo calls
// WARNING! Setting a default password will allow any caller to run commands with sudo.
export function setDefaultPassword(password: string | undefined): void {
  defaultPassword = password;
}

function quoteArg(arg: string): string {
  if (/^[a-z0-9/_.-]+$/i.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function buildEscalationArgs(command: string, method: BecomeMethod, user: string, customFlags?: string[]): string[] {
  switch (method) {
    case "sudo":
      return ["sudo", ...(customFlags || ["-H", "-S", "-p", ""]), "-u", user, "sh", "-c", command];
    case "su":
      return ["su", ...(customFlags || []), user, "-c", command];
    case "doas":
      return ["doas", ...(customFlags || []), "-u", user, "sh", "-c", command];
    case "pkexec":
      return ["pkexec", ...(customFlags || []), "--user", user, "sh", "-c", command];
    default:
      throw new BecomeError(`Unknown become method: ${method}`);
  }
}

async function executeWithEscalation(
  args: string[],
  method: BecomeMethod,
  password: string | undefined,
  timeout: number,
  env?: Record<string, string>,
): Promise<BecomeResult> {
  const [executable, ...cmdArgs] = args;
  const inputBuffer = password ? new TextEncoder().encode(`${password}\n`) : undefined;

  const proc = spawn([executable!, ...cmdArgs], {
    stdin: inputBuffer ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
    timeout: timeout,
  });

  // Read streams immediately to prevent buffer filling
  const stdoutPromise = proc.stdout.text();
  const stderrPromise = proc.stderr.text();

  const exitCode = await proc.exited;

  const stdout = await stdoutPromise;
  const stderr = await stderrPromise;

  const cleanStderr = stripPasswordPrompt(stderr);

  if (exitCode !== 0) {
    // Check if it was a timeout (Bun kills with signal)
    if (proc.signalCode === "SIGTERM") {
      throw new BecomeError("Command execution timed out", { stdout, stderr: cleanStderr, exitCode });
    }

    checkCommonErrors(cleanStderr, stdout, method, exitCode);
  }

  return {
    stdout: stdout.trim(),
    stderr: cleanStderr,
    exitCode,
    success: exitCode === 0,
  };
}

function checkCommonErrors(stderr: string, stdout: string, method: BecomeMethod, exitCode: number): void {
  const combined = (stderr + stdout).toLowerCase();
  const context = { stdout, stderr, exitCode };

  if (combined.includes("incorrect password") || combined.includes("sorry, try again")) {
    throw new BecomeError(`Incorrect ${method} password`, context);
  }
  if (combined.includes("password is required") || combined.includes("must provide a password")) {
    throw new BecomeError(`${method} requires a password but none was provided`, context);
  }
  if (combined.includes("not in the sudoers file") || combined.includes("not allowed to execute")) {
    throw new BecomeError(`User is not authorized to run commands with ${method}`, context);
  }
  if (combined.includes("unknown user")) {
    throw new BecomeError("Target user does not exist", context);
  }
}

function stripPasswordPrompt(output: string): string {
  return output
    .replace(/\[sudo\] password for .*?:/g, "")
    .replace(/^Password:\s*/gm, "")
    .trim();
}
