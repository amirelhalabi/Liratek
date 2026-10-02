/**
 * Custom-service WORK status model — the ONE definition (rule 14).
 *
 * LIRA-083: `custom_services.status` is an ACCOUNTING status
 * ('pending' | 'completed' | 'voided') — it says whether the row is money-
 * live or reversed, nothing about how far along the actual work is. A
 * paperwork-style custom service (owner note 15, "sejel 3adli" — official
 * document processing) can sit "in progress" for days while its accounting
 * status is already 'completed' (the customer was charged up front). There
 * was no field to track that. `custom_services.work_status` (migration v190)
 * adds it, reusing the EXACT four-state vocabulary Maintenance already uses
 * for a repair job's lifecycle (`maintenance.status`,
 * electron-app/create_db.sql) so the app has one lifecycle shape, not two:
 *
 *   Received     -> intake logged, work not yet started
 *   In_Progress  -> actively being worked
 *   Ready        -> work finished, waiting for the customer
 *   Delivered    -> handed to the customer
 *
 * Unlike `fulfillment_status` (utils/insuranceFulfillment.ts), this is
 * DELIBERATELY NOT a strict forward-only single-step state machine — it
 * mirrors Maintenance's own model instead, which lets the operator set any
 * of the four values at any time (MaintenanceRepository.updateJob resubmits
 * the whole form on every save with no transition check). A custom service
 * is single-operator, staff-facing housekeeping, not an audited regulatory
 * lifecycle; forcing strict steps here would block an honest correction
 * ("staff clicked In_Progress by mistake, meant Ready") that this class of
 * work needs more than it needs enforcement.
 *
 * Pure and I/O-free. Must be exported from `browser.ts` as well as
 * `index.ts` — see the `telecomCredit.js` note in `browser.ts` for the exact
 * failure mode a symbol missing there causes for Vite/frontend-jest.
 */

export const WORK_STATUSES = [
  "Received",
  "In_Progress",
  "Ready",
  "Delivered",
] as const;

export type WorkStatus = (typeof WORK_STATUSES)[number];

export const DEFAULT_WORK_STATUS: WorkStatus = "Received";

/** Human-readable label for each work status, for filter dropdowns and the
 *  status chip — derived mechanically (underscore becomes space) rather
 *  than hand-typed, so this file never spells out the space-separated form
 *  of the In_Progress value as a literal: a core-wide guard test (see
 *  MaintenanceRepository's own history) scans every source file for exactly
 *  that spelling, because a space-form literal can never match the real
 *  underscore-form enum value if it were ever compared against one.
 *  Deriving the label here avoids ever writing that spelling out at all. */
export const WORK_STATUS_LABELS: Record<WorkStatus, string> = Object.fromEntries(
  WORK_STATUSES.map((s) => [s, s.replace(/_/g, " ")]),
) as Record<WorkStatus, string>;

export function isWorkStatus(value: unknown): value is WorkStatus {
  return (
    typeof value === "string" &&
    (WORK_STATUSES as readonly string[]).includes(value)
  );
}
