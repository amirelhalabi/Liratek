/**
 * Route a real-path sign-up link into the HashRouter (LIRA-267).
 *
 * Invite emails carry `<base>/signup?invite=<token>` (built by core's
 * SignupInvitationService), but the app routes on the URL HASH (HashRouter,
 * App.tsx). On that URL the router sees an empty hash, so the person would be
 * bounced to the login page and `useSearchParams()` would never see the
 * token. Rewriting to `/#/signup?invite=<token>` here — once, at boot, before
 * React renders — keeps every link already sent working without changing the
 * link format.
 *
 * `replaceState`, not a navigation: no reload, and the bare-path URL does not
 * stay in history. No-op (returns false) for every other URL, including an
 * already-hashed one and every desktop (file://) boot.
 */
export function normalizeSignupLink(): boolean {
  const { pathname, search, hash } = window.location;
  if (hash) return false;
  if (pathname !== "/signup" && pathname !== "/signup/") return false;
  window.history.replaceState(window.history.state, "", `/#/signup${search}`);
  return true;
}
