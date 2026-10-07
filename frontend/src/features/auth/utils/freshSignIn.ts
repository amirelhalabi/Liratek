/**
 * A one-shot "this boot follows a FRESH sign-in" marker (LIRA-280).
 *
 * A password login runs its post-sign-in steps (today's opening-balance
 * check) in place. "Continue with Google" cannot: the shop's login page
 * trades the hand-off for a session and RELOADS the app, which then boots
 * through the session-restore path — the same path as a plain refresh, which
 * deliberately skips those steps. The hand-off sets this marker just before
 * the reload; AuthProvider consumes it once, so the Google sign-in ends in
 * the same auth state as a password sign-in and a later refresh does not.
 *
 * sessionStorage (this tab only), and every access guarded: storage can be
 * unavailable (private mode, blocked site data), and then the sign-in simply
 * behaves like a refresh — never an error.
 */

const FRESH_SIGN_IN_KEY = "liratek:fresh-sign-in";

export function markFreshSignIn(): void {
  try {
    sessionStorage.setItem(FRESH_SIGN_IN_KEY, "1");
  } catch {
    // Storage unavailable: the post-sign-in check is skipped, nothing else.
  }
}

/** True once after `markFreshSignIn()`, and clears the marker. */
export function consumeFreshSignIn(): boolean {
  try {
    const marked = sessionStorage.getItem(FRESH_SIGN_IN_KEY) === "1";
    sessionStorage.removeItem(FRESH_SIGN_IN_KEY);
    return marked;
  } catch {
    return false;
  }
}
