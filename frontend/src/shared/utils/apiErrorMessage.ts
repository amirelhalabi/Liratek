/**
 * Extracts a human-readable message from whatever a failed API call handed
 * back — the ONE place this logic lives (CLAUDE.md rule 14), reused by every
 * catch block that used to hardcode a generic string and throw away the real
 * reason.
 *
 * `requestJson` (`frontend/src/api/httpClient.ts`) throws a PLAIN OBJECT on a
 * non-2xx response — `{ status, message, details }` — NOT an `Error`
 * instance, so `error instanceof Error` is false for it and a naive catch
 * block silently falls back to a generic message (the exact trap a prior
 * session's memory note calls out: "requestJson throws a plain object").
 * This helper handles BOTH shapes a caller can land in:
 *   - a THROWN ApiError-like object (`{ message: string }`) — the REST 403 /
 *     500 / network-failure path.
 *   - a RESOLVED `{ success: false, error: string }` envelope passed straight
 *     into a catch block by a caller that re-threw it, or any other
 *     object carrying an `error` string.
 *   - a genuine `Error` instance (IPC-side failures, thrown synchronously).
 *
 * Falls back to `fallback` only when nothing usable is found, so a refusal
 * NEVER surfaces as a blank message but also never crashes on a weird shape.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const withMessage = error as { message?: unknown };
    if (typeof withMessage.message === "string" && withMessage.message) {
      return withMessage.message;
    }
    const withError = error as { error?: unknown };
    if (typeof withError.error === "string" && withError.error) {
      return withError.error;
    }
  }
  return fallback;
}
