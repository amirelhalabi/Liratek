/**
 * LIRA-309 (US2) — expiry alerts for lines held for sale, shared by the
 * Dashboard "needs attention" panel and the top-bar bell.
 *
 * Owner rule 2026-10-11: amber 3 days before expiry, red during the 5-day
 * grace, and once lost a red "write off?" prompt until the owner writes it
 * off. The status comes from core's `classifyLineStatus` (one rule, rule 14);
 * this only picks which statuses alert and words them. Shop lines keep their
 * own alerts in `dashboard/utils/carrierLineAlerts.ts` (7 days, unchanged).
 *
 * Pure, no I/O: `today` is the shop's own day (`localDay()`, rule 27).
 */
import {
  classifyLineStatus,
  RESALE_LINE_EXPIRY_WARNING_DAYS,
  type ResaleLineRow,
} from "@liratek/core";

export type ResaleLineAlertKind = "expiring" | "grace" | "lost";

export interface ResaleLineAlert {
  kind: ResaleLineAlertKind;
  productId: number;
  number: string;
  carrier: "mtc" | "alfa" | null;
  daysLeft: number;
  daysToSave: number;
  /** `resale:<productId>:<kind>:<day>` — the bell shows each key once. */
  key: string;
}

const CARRIER_LABEL = { mtc: "MTC", alfa: "Alfa" } as const;

export function computeResaleLineAlerts(
  lines: ResaleLineRow[],
  today: string,
  rechargeModuleEnabled: boolean,
): ResaleLineAlert[] {
  if (!rechargeModuleEnabled) return [];
  const alerts: ResaleLineAlert[] = [];
  for (const line of lines) {
    if (!line.is_unsold || !line.validity_expires_at) continue;
    const s = classifyLineStatus(
      line.validity_expires_at,
      today,
      RESALE_LINE_EXPIRY_WARNING_DAYS,
    );
    const kind: ResaleLineAlertKind | null =
      s.status === "EXPIRING"
        ? "expiring"
        : s.status === "IN_GRACE"
          ? "grace"
          : s.status === "LOST"
            ? "lost"
            : null;
    if (!kind) continue;
    alerts.push({
      kind,
      productId: line.product_id,
      number: line.phone_number ?? line.name,
      carrier: line.carrier,
      daysLeft: s.daysLeft,
      daysToSave: s.daysToSave,
      key: `resale:${line.product_id}:${kind}:${today}`,
    });
  }
  return alerts;
}

export function resaleLineAlertText(a: ResaleLineAlert): string {
  const who = `Line for sale ${a.number}${a.carrier ? ` (${CARRIER_LABEL[a.carrier]})` : ""}`;
  switch (a.kind) {
    case "expiring":
      return a.daysLeft === 0
        ? `${who} expires today`
        : `${who} expires in ${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"}`;
    case "grace":
      return `${who} expired — ${a.daysToSave} day${a.daysToSave === 1 ? "" : "s"} left to save it`;
    case "lost":
      return `${who} is lost — write it off?`;
  }
}
