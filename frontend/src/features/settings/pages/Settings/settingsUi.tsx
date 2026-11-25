import type { ReactNode } from "react";

/**
 * One look for every Settings section (owner request 2026-11-25).
 *
 * The section's title and intro are rendered ONCE by the Settings shell
 * (`index.tsx`); a panel never repeats them. Inside a panel:
 *   - each part is headed with `SettingsSectionHeading`;
 *   - a plain form keeps its fields in `SETTINGS_FORM_WIDTH`;
 *   - the main action uses `SETTINGS_PRIMARY_BUTTON` (left-aligned, normal
 *     size), a destructive one `SETTINGS_DANGER_BUTTON`, a secondary one
 *     `SETTINGS_SECONDARY_BUTTON`.
 */

/** Width of a plain form's fields — the same for every form section. */
export const SETTINGS_FORM_WIDTH = "max-w-2xl";

const BUTTON_BASE =
  "px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed";

export const SETTINGS_PRIMARY_BUTTON = `${BUTTON_BASE} bg-violet-600 hover:bg-violet-500`;
export const SETTINGS_SECONDARY_BUTTON = `${BUTTON_BASE} bg-slate-700 hover:bg-slate-600`;
export const SETTINGS_DANGER_BUTTON = `${BUTTON_BASE} bg-red-600 hover:bg-red-500`;

/** Field label and input, as on Shop Config. */
export const SETTINGS_LABEL = "block text-sm text-slate-400 mb-2";
export const SETTINGS_INPUT =
  "w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500";

/** Heading for one part of a Settings section. */
export function SettingsSectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
      {children}
    </h3>
  );
}
