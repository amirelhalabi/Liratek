/**
 * Apply the operator's UI scale, on whichever product they are running.
 *
 * Desktop has `webFrame.setZoomFactor` through the preload bridge. The web
 * build has no `window.api` at all, so the two call sites that used to write
 * `if (window.api?.display?.setZoomFactor)` simply did nothing in a browser:
 * the chosen scale was still saved to localStorage and still rendered as the
 * selected option in Settings, so the control looked like it worked and never
 * changed a pixel. A setting that silently no-ops is worse than one that is
 * absent, because the operator re-picks it and concludes the app is broken.
 *
 * In the browser the equivalent is the CSS `zoom` property on the root
 * element, which reflows the page the same way the Electron zoom factor does
 * — not a `transform: scale()`, which would scale a snapshot of the layout and
 * leave hit targets, scroll extents and fixed positioning wrong.
 *
 * One definition (rule 14) because there are two callers — App.tsx restores
 * the saved value at boot, ShopConfig applies it on change — and they drifted
 * before: only one of them is where a future zoom bug would be noticed.
 */

const UI_SCALE_KEY = "ui_scale";

/** Guard against a corrupt or hand-edited localStorage value. */
function isUsableScale(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Set the zoom level. Desktop routes to Electron; the browser falls back to
 * CSS zoom. Safe to call with anything — a non-finite or non-positive scale is
 * ignored rather than blanking the screen.
 */
export function applyUiScale(scale: number): void {
  if (!isUsableScale(scale)) return;

  const setZoomFactor = window.api?.display?.setZoomFactor;
  if (setZoomFactor) {
    setZoomFactor(scale);
    return;
  }

  if (typeof document !== "undefined") {
    // `zoom` is not in the CSSStyleDeclaration type in every lib.dom version,
    // so it is written through setProperty rather than cast away.
    document.documentElement.style.setProperty("zoom", String(scale));
  }
}

/** The saved scale, or null when nothing valid is stored. */
export function readSavedUiScale(): number | null {
  try {
    const saved = localStorage.getItem(UI_SCALE_KEY);
    if (!saved) return null;
    const factor = parseFloat(saved);
    return isUsableScale(factor) ? factor : null;
  } catch {
    // Private mode / blocked storage — no saved preference is a fine answer.
    return null;
  }
}

/** Persist and apply in one step, so the two can never disagree. */
export function saveAndApplyUiScale(scale: number): void {
  try {
    localStorage.setItem(UI_SCALE_KEY, String(scale));
  } catch {
    // Persisting can fail; applying it for this session still should not.
  }
  applyUiScale(scale);
}
