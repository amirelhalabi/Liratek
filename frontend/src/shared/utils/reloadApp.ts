/**
 * Perform a full-page reload.
 *
 * This exists purely so call sites are testable. `window.location` is
 * non-configurable in modern jsdom, so a test cannot stub or spy on
 * `window.location.reload` directly — `Object.defineProperty(window,
 * "location", ...)` throws `TypeError: Cannot redefine property: location`
 * before any assertion runs. Routing the call through this one function lets
 * a test `jest.mock` the module instead, which is stable across jsdom
 * versions.
 *
 * That testability is not cosmetic: ResetDataModal relies on being able to
 * assert that a FAILED reset does NOT reload the page. A spurious reload on
 * a failed database reset would silently hide the failure from the operator
 * (the app would come back up looking normal, on the old, un-reset
 * database), so the "no reload on failure" behaviour has to stay under test.
 *
 * A full `location.reload()` works the same way in both the Electron
 * renderer and a browser tab, so this deliberately does NOT branch on
 * `window.api` / `isElectron()` — unlike `applyUiScale` in `uiScale.ts`,
 * there is no separate native path to route to here.
 */
export function reloadApp(): void {
  window.location.reload();
}
