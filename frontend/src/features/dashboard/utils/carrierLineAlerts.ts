/**
 * Carrier-line expiry / missing-line banner logic (carrier-lines-validity
 * plan Phase 4, D11 + D4). Pulled out of `Dashboard.tsx` into its own file
 * rather than exported alongside the page's default component export —
 * `react-refresh/only-export-components` requires a component file to only
 * export components, and this is plain data-shaping logic with no React in
 * it at all, so it belongs here regardless.
 */

import type { CarrierLineEntity } from "@liratek/ui";
import { daysRemaining } from "@/shared/utils/daysRemaining";
import { classifyLineValidity, LINE_REVIVAL_GRACE_DAYS } from "@liratek/core";

export type CarrierKey = "mtc" | "alfa";

export const CARRIER_LABELS: Record<CarrierKey, string> = {
  mtc: "MTC",
  alfa: "Alfa",
};

export type CarrierLineAlert =
  /** D4's soft nudge — the carrier is enabled but has zero active lines. */
  | { kind: "missing"; carrier: CarrierKey }
  /** D11 — an active line expires in <= 7 days or has already expired. */
  | {
      kind: "expiring";
      carrier: CarrierKey;
      lineLabel: string;
      daysLeft: number;
    }
  /** #28 (LIRA-218) — a line carries a sold-ahead balance: days a DAYS sale
   *  promised customers that the line's real remaining days couldn't cover.
   *  Red, and stays up until the line is recharged (days_owed back to 0) —
   *  never conflated with "expiring"/"burned", since the line is never dead
   *  because of days sold ahead. */
  | {
      kind: "sold-ahead";
      carrier: CarrierKey;
      lineLabel: string;
      daysOwed: number;
      /** M6 fix (2026-09-24 adversarial review): whole days left, from the
       *  {@link LINE_REVIVAL_GRACE_DAYS} window, before the line the debt
       *  sits on would classify BURNED — the owner's "recharge within N
       *  days" deadline. 0 once that window has already closed (the charge
       *  payoff is still never refused, M4 — this is a countdown to act
       *  cleanly, not a refusal deadline). Computed from the SAME shared
       *  `classifyLineValidity` rule (rule 14), not re-derived. */
      deadlineDays: number;
    };

/**
 * One issue per active carrier line found, plus one per carrier with none.
 * Pure function of the loaded lines + whether the shared `recharge` module
 * (there is no per-carrier module — both MTC and Alfa hang off it) is on —
 * no I/O, so it is trivially unit-testable and reusable if another surface
 * ever needs the same computation (rule 14). See
 * `__tests__/carrierLineAlerts.test.ts` for the D11 boundary (<=7 days
 * fires, 8 does not, an already-expired date always fires).
 */
export function computeCarrierLineAlerts(
  lines: CarrierLineEntity[],
  rechargeModuleEnabled: boolean,
): CarrierLineAlert[] {
  if (!rechargeModuleEnabled) return [];
  const alerts: CarrierLineAlert[] = [];
  (Object.keys(CARRIER_LABELS) as CarrierKey[]).forEach((carrier) => {
    const linesForCarrier = lines.filter((l) => l.carrier === carrier);
    if (linesForCarrier.length === 0) {
      alerts.push({ kind: "missing", carrier });
      return;
    }
    linesForCarrier.forEach((line) => {
      // #28 — checked independently of the expiry branch below, not as a
      // substitute for it. A pinned sold-ahead line's real expiry sits at
      // `today` (0 real days left), which the branch below classifies as
      // "expires today" and DOES also fire (m7 fix, 2026-09-24 adversarial
      // review — a prior comment here wrongly claimed it never would). That
      // is correct, not a duplicate: "sold-ahead" and "expiring" are two
      // different facts about the same line (a promise owed vs. a deadline
      // approaching) and a line can legitimately carry both at once, so
      // both banners are meant to show together.
      if ((line.days_owed ?? 0) > 0) {
        const { lapseDays } = classifyLineValidity(line.validity_expires_at);
        alerts.push({
          kind: "sold-ahead",
          carrier,
          lineLabel: line.label || line.phone_number,
          daysOwed: line.days_owed,
          deadlineDays: Math.max(0, LINE_REVIVAL_GRACE_DAYS - lapseDays),
        });
      }

      if (!line.validity_expires_at) return;
      const daysLeft = daysRemaining(line.validity_expires_at);
      if (daysLeft <= 7) {
        alerts.push({
          kind: "expiring",
          carrier,
          lineLabel: line.label || line.phone_number,
          daysLeft,
        });
      }
    });
  });
  return alerts;
}

export function carrierLineAlertText(alert: CarrierLineAlert): string {
  if (alert.kind === "missing") {
    return `${CARRIER_LABELS[alert.carrier]} has no active line`;
  }
  if (alert.kind === "sold-ahead") {
    const deadline =
      alert.deadlineDays > 0
        ? `recharge within ${alert.deadlineDays}d to deliver them`
        : "recharge NOW to deliver them";
    return `${CARRIER_LABELS[alert.carrier]} — ${alert.lineLabel} has ${alert.daysOwed} days sold ahead — ${deadline}`;
  }
  const status =
    alert.daysLeft < 0
      ? `expired ${Math.abs(alert.daysLeft)}d ago`
      : alert.daysLeft === 0
        ? "expires today"
        : `expires in ${alert.daysLeft}d`;
  return `${CARRIER_LABELS[alert.carrier]} — ${alert.lineLabel} ${status}`;
}
