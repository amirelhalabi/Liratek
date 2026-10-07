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

/**
 * What the server says on a rate-limit refusal (backend `RATE_LIMIT_MESSAGE`,
 * `backend/src/middleware/rateLimit.ts`). Used only when a 429 arrives
 * without a usable message of its own, so the cashier is still told to wait.
 */
const RATE_LIMITED_FALLBACK =
  "Too many requests — please wait a minute and try again.";

/**
 * Message for a page whose initial LOAD failed (LIRA-282).
 *
 * A load failure keeps the page's own generic `fallback` — a raw server or
 * database message ("SQLITE_BUSY…") means nothing to a cashier — EXCEPT a
 * rate-limit refusal (HTTP 429, thrown by `requestJson` as
 * `{ status: 429, message }`), where the server's message is the one thing
 * that tells them what to do: wait a minute. Without this, several tills in
 * one shop hitting the limit all saw "Failed to load data" and kept
 * refreshing, which only made it worse.
 */
export function getLoadErrorMessage(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    (error as { status?: unknown }).status === 429
  ) {
    return getApiErrorMessage(error, RATE_LIMITED_FALLBACK);
  }
  return fallback;
}
