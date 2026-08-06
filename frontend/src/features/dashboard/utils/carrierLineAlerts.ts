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
  const status =
    alert.daysLeft < 0
      ? `expired ${Math.abs(alert.daysLeft)}d ago`
      : alert.daysLeft === 0
        ? "expires today"
        : `expires in ${alert.daysLeft}d`;
  return `${CARRIER_LABELS[alert.carrier]} — ${alert.lineLabel} ${status}`;
}
