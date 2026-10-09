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
 * The WEB app has no UI scale (LIRA-295, owner decision 2026-10-09): the
 * browser's own zoom (Ctrl/⌘ + / −) does it properly. The CSS `zoom` on
 * <html> this used to apply multiplied every viewport-height size
 * (`h-screen`, `max-h-[90vh]`) by the scale, so at 125% the bottom of each
 * page and modal fell below the window and the `h-screen overflow-hidden`
 * shell would not scroll to it. On the web this now only clears a zoom an
 * older build may have left, and My account → Display hides the control.
 *
 * One definition (rule 14) because there are two callers — App.tsx restores
 * the saved value at boot, My account → Display applies it on change.
 */

const UI_SCALE_KEY = "ui_scale";

/** Guard against a corrupt or hand-edited localStorage value. */
function isUsableScale(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Set the zoom level — desktop only, through Electron. On the web it does
 * nothing except remove a CSS zoom an older build may have set (a saved
 * `ui_scale` from before LIRA-295 is therefore ignored). Safe to call with
 * anything — a non-finite or non-positive scale is ignored rather than
 * blanking the screen.
 */
export function applyUiScale(scale: number): void {
  const setZoomFactor = window.api?.display?.setZoomFactor;
  if (setZoomFactor) {
    if (isUsableScale(scale)) setZoomFactor(scale);
    return;
  }

  if (typeof document !== "undefined") {
    document.documentElement.style.removeProperty("zoom");
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
