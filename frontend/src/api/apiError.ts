/**
 * Turn anything the transport can hand back into one line for the user.
 *
 * Three shapes actually reach here and only the first is obvious:
 *   - the 200-with-`success:false` envelope, whose `error` is a bare string
 *     (Zod rejections) or a `{ code, message }` object (createErrorResponse);
 *   - the `ApiError` OBJECT that `requestJson` THROWS on any non-2xx — a plain
 *     `{ status, message, details }`, NOT an `Error`, so an `instanceof Error`
 *     check misses it and the invite-code 403 would read as "could not reach
 *     the server". Its own `message` can itself be the nested object, because
 *     it is lifted straight off `data.error`;
 *   - a real `Error` from fetch when the backend is genuinely unreachable.
 *
 * Getting this wrong does not throw — it renders "[object Object]" or falls
 * through to the fallback and silently discards the real reason. That is how
 * every failed web login came to read "An unexpected error occurred" instead
 * of "Invalid username or password".
 *
 * Lived in Signup.tsx until the login path needed the same unwrapping.
 */
export function messageFrom(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const nested = (value as { message?: unknown }).message;
    if (typeof nested === "string" && nested.trim()) return nested;
    if (nested && typeof nested === "object") {
      return messageFrom(nested, fallback);
    }
  }
  return fallback;
}
