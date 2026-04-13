/** Normalize unknown errors (e.g. Tauri invoke failures) into a display string. */
export function errorMessageFromUnknown(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
