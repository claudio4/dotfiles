/**
 * Mark a promise as handled, so that it won't throw an unhandled error.
 * Useful for when you want to await it later, but don't forget to do it.
 * @param p the promise
 */
export function markAsErrorHandled(p: Promise<unknown>) {
  p.catch(() => {});
}
