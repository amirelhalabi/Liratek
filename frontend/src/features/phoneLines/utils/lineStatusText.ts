/**
 * LIRA-309 — plain words for a phone line's status (chip and alert text).
 * The status itself comes from core's `classifyLineStatus`.
 */
import type { LineStatusResult } from "@liratek/core";

/** Plain words for a status, for the chip and for alert text. */
export function lineStatusText(s: LineStatusResult): string {
  switch (s.status) {
    case "OK":
      return `${s.daysLeft} days left`;
    case "EXPIRING":
      return s.daysLeft === 0
        ? "Expires today"
        : `Expires in ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}`;
    case "IN_GRACE":
      return `Expired — ${s.daysToSave} day${s.daysToSave === 1 ? "" : "s"} left to save it`;
    case "LOST":
      return "Lost";
    case "NO_EXPIRY":
      return "No expiry set";
  }
}
