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

/**
 * Mark a promise as handled, so that it won't throw an unhandled error.
 * Useful for when you want to await it later, but don't forget to do it.
 * @param p the promise
 */
export function markAsErrorHandled(p: Promise<unknown>) {
  p.catch(() => {});
}
