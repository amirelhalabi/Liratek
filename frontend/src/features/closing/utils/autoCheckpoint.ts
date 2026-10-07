/**
 * Which drawers the Checkpoint window lists right after a sign-in.
 *
 * Pure (no React, no transport) so the rule is unit-tested on its own; the
 * hook `useAutoCheckpointAfterSignIn` only fetches the inputs.
 */

import { localDay } from "@/shared/utils/localDay";
import { parseDbDate } from "@/shared/utils/parseDbDate";

/** The till's own drawer: always offered first, never hidden by a module. */
export const FIRST_CHECKPOINT_DRAWER = "General";

/** The part of `getLastCheckpointPerDrawer()`'s answer this rule reads. */
export type LastCheckpointByDrawer = Record<
  string,
  { checked_at: string } | undefined
> | null;

/** One row of the after-sign-in "all drawers" Checkpoint window. */
export interface DrawerForCheckpoint {
  name: string;
  countedToday: boolean;
}

/**
 * Every visible drawer, in the dashboard's order with General moved to the
 * front, each marked whether its last checkpoint is from `today`. Null when
 * every visible drawer was already counted today (or there are none) — the
 * window then does not open at all.
 *
 * `today` is the browser's own `YYYY-MM-DD` (rule 27 — the shop's day, never
 * the server's). A checkpoint's `checked_at` is SQLite's UTC
 * `CURRENT_TIMESTAMP`, so it is read with `parseDbDate` and compared on the
 * LOCAL calendar day, the same way the dashboard's "last checked" label
 * decides "today".
 */
export function listDrawersForCheckpoint(
  drawerNames: readonly string[],
  lastCheckpoints: LastCheckpointByDrawer,
  today: string,
  isVisible: (drawerName: string) => boolean,
): DrawerForCheckpoint[] | null {
  const visible = drawerNames.filter(isVisible);
  const ordered = [
    ...visible.filter((name) => name === FIRST_CHECKPOINT_DRAWER),
    ...visible.filter((name) => name !== FIRST_CHECKPOINT_DRAWER),
  ];
  const drawers = ordered.map((name) => {
    const checkedAt = lastCheckpoints?.[name]?.checked_at;
    return {
      name,
      countedToday: !!checkedAt && localDay(parseDbDate(checkedAt)) === today,
    };
  });
  return drawers.some((d) => !d.countedToday) ? drawers : null;
}
