import { exists, writeFile } from "fs/promises";
import { dirname } from "path";
import { mkdir } from "internal/fs"; // reuse the existing idempotent mkdir
import { markAsErrorHandled } from "./utils";

export interface DownloadOptions {
  /**
   * Expected SHA-256 hex digest of the file.
   * When provided, an existing file with a matching hash is considered up-to-date
   * and the download is skipped. A freshly downloaded file is also verified against
   * this hash and an error is thrown on mismatch.
   *
   * When omitted the function falls back to a simple existence check
   * (the file is re-downloaded only when it does not exist or `force` is true).
   */
  hash?: string;

  /**
   * If true, always download even if the destination already exists.
   * Default: false
   */
  force?: boolean;

  /**
   * Optional headers to send with the HTTP request.
   */
  headers?: Record<string, string>;
}

export interface DownloadResult {
  /**
   * True if the file was (re-)downloaded.
   */
  changed: boolean;

  /**
   * True if the file was newly created.
   */
  created: boolean;
}

/**
 * Idempotently downloads a file from `url` to `destination`.
 *
 * - Creates parent directories as needed.
 * - When a SHA-256 `hash` is provided in options, skips the download if the
 *   existing file already matches, and verifies the downloaded content.
 * - Without a hash the download is skipped when the destination already exists
 *   (unless `force` is set).
 */
export async function downloadFile(
  url: string,
  destination: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const { hash, force = false, headers } = options;

  const result: DownloadResult = {
    changed: false,
    created: false,
  };

  const destFile = Bun.file(destination);
  const destExists = await destFile.exists();

  if (!force && destExists) {
    if (hash) {
      const existingHash = await hashFile(destination);
      if (existingHash === normalizeHash(hash)) {
        return result;
      }
    } else {
      // No hash provided and file exists, assume up-to-date
      return result;
    }
  }

  const parentDir = dirname(destination);
  await mkdir(parentDir);

  const response = await fetch(url, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const writer = destFile.writer();
  try {
    if (hash) {
      const hasher = new Bun.CryptoHasher("sha256");

      for await (const chunk of response.body!) {
        hasher.update(chunk);
        writer.write(chunk);
      }

      const downloadedHash = hasher.digest("hex");
      const expected = normalizeHash(hash);

      if (downloadedHash !== expected) {
        // prevent leavign behind a undesired file
        markAsErrorHandled(destFile.delete());
        throw new Error(`Hash mismatch for ${url}: expected ${expected}, got ${downloadedHash}`);
      }
    } else {
      // for some reason this is way faster than destfile.Write(response)
      for await (const chunk of response.body!) {
        writer.write(chunk);
      }
    }
  } finally {
    await writer.end();
  }

  result.changed = true;
  result.created = !destExists;

  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────

function normalizeHash(hash: string): string {
  return hash.toLowerCase().trim();
}

function hashBuffer(data: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

async function hashFile(path: string): Promise<string> {
  const file = Bun.file(path);
  const data = new Uint8Array(await file.arrayBuffer());
  return hashBuffer(data);
}
