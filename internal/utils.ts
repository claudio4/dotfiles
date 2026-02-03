import os from "node:os";

export async function getDistroFamily(): Promise<string> {
  if (isWindows()) return "windows";

  try {
    const osRelease = await Bun.file("/etc/os-release").text();
    const info = parseOsRelease(osRelease);

    // 'ID_LIKE' usually contains the parent families (e.g. "ubuntu debian")
    // If missing, 'ID' is likely the main distro (e.g. "debian" or "arch")
    if (info.ID_LIKE) return info.ID_LIKE;
    if (info.ID) return info.ID;
  } catch (err) {}

  //  Try lsb_release command (common on Debian/Ubuntu systems)
  try {
    const proc = Bun.spawn(["lsb_release", "-si"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    await proc.exited;
    const output = (await proc.stdout.text()).trim().toLowerCase();
    if (output) return output;
  } catch (e) {}

  // Check for legacy specific files
  if (await Bun.file("/etc/debian_version").exists()) return "debian";
  if (await Bun.file("/etc/redhat-release").exists()) return "rhel";
  if (await Bun.file("/etc/arch-release").exists()) return "arch";
  if (await Bun.file("/etc/alpine-release").exists()) return "alpine";

  return "unknown";
}

/**
 * Helper to parse the KEY="VALUE" format of os-release
 */
function parseOsRelease(content: string): Record<string, string> {
  const info: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const [key, ...values] = trimmed.split("=");
    if (!key || values.length === 0) continue;

    // Remove quotes if present (e.g. "ubuntu")
    let value = values.join("="); // Rejoin in case value had =
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    info[key] = value;
  }

  return info;
}

/**
 * Check if we're on a Unix-like system that supports ownership
 */
export function isUnixLike(): boolean {
  return !isWindows();
}

/**
 * Check if we're on a Unix-like system that supports ownership
 */
export function isWindows(): boolean {
  return process.platform === "win32";
}

export function isWSL(): boolean {
  if (process.platform !== "linux") return false;

  const release = os.release().toLowerCase();
  return release.includes("microsoft");
}

/**
 * Mark a promise as handled, so that it won't throw an unhandled error.
 * Useful for when you want to await it later, but don't forget to do it.
 * @param p the promise
 */
export function markAsErrorHandled(p: Promise<unknown>) {
  p.catch(() => {});
}
