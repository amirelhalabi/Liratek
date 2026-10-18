/**
 * LIRA-335 — the ONE derivation of a checkpoint difference's direction,
 * open amount and status (data-model.md "Derived values"). Core attaches the
 * result to every `CheckpointDifferenceView`; the timeline renders it and
 * never recomputes (rule 14).
 *
 * Pure leaf reachable from `browser.ts` (rule 29): its only runtime import
 * is a constants module with no imports of its own. The view type it
 * redacts is imported type-only (erased at compile time).
 */
import { checkpointDifferenceEpsilon } from "../constants/checkpointAdjustment.js";
// Type-only: erased at compile time, so this module stays a browser leaf.
import type { CheckpointDifferenceView } from "../repositories/CheckpointDifferenceRepository.js";

export type CheckpointDifferenceStatus =
  | "OPEN"
  | "PARTLY_RESOLVED"
  | "RESOLVED"
  | "CLOSED";
export type CheckpointDifferenceDirection = "OVER" | "SHORT";

export interface CheckpointDifferenceInput {
  /** The posted correction, signed: > 0 Over, < 0 Short. */
  amount: number;
  /** Σ |active resolutions| (magnitude). */
  resolved: number;
  /** The owner closed what was left (`closed_at` set). */
  closed: boolean;
  currencyCode: string;
}

export interface CheckpointDifferenceSummary {
  direction: CheckpointDifferenceDirection;
  abs: number;
  open: number;
  status: CheckpointDifferenceStatus;
}

/**
 * status = RESOLVED when nothing is left open (resolution wins over a
 * close), else CLOSED when the owner closed it, else PARTLY_RESOLVED when
 * something was resolved, else OPEN. `open` is never below zero and is 0
 * whenever it is within the currency's tolerance.
 */
export function describeCheckpointDifference(
  input: CheckpointDifferenceInput,
): CheckpointDifferenceSummary {
  const eps = checkpointDifferenceEpsilon(input.currencyCode);
  const abs = Math.abs(input.amount);
  const resolved = Math.max(0, Math.abs(input.resolved));
  const rawOpen = Math.max(0, abs - resolved);
  const open = rawOpen <= eps ? 0 : rawOpen;
  const direction: CheckpointDifferenceDirection =
    input.amount > 0 ? "OVER" : "SHORT";
  let status: CheckpointDifferenceStatus;
  if (open === 0) status = "RESOLVED";
  else if (input.closed) status = "CLOSED";
  else if (resolved > eps) status = "PARTLY_RESOLVED";
  else status = "OPEN";
  return { direction, abs, open, status };
}

/** Still waiting for the owner: OPEN or PARTLY_RESOLVED. */
export function isOpenCheckpointDifference(d: {
  status: CheckpointDifferenceStatus;
}): boolean {
  return d.status === "OPEN" || d.status === "PARTLY_RESOLVED";
}

/**
 * Staff read open differences (the hint on cashier forms) but see no user
 * names: `resolutions` (each carries a `user_name`) and `closed_by_name` are
 * blanked, not deleted, so the payload still matches
 * `CheckpointDifferenceView`. Admin sees everything. The ONE rule both
 * transports apply to `get-open-differences-after` (rule 14). Never mutates
 * its input.
 */
export function redactCheckpointDifferencesForRole(
  views: readonly CheckpointDifferenceView[],
  role: string | undefined,
): CheckpointDifferenceView[] {
  if (role === "admin") return [...views];
  return views.map((d) => ({ ...d, resolutions: [], closed_by_name: null }));
}
