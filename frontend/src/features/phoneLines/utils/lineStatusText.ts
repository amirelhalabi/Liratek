/**
 * LIRA-309 — plain words for a phone line's status (chip and alert text).
 * The status itself comes from core's `classifyLineStatus`.
 */
import type { LineStatusResult } from "@liratek/core";
import { i18n } from "@/i18n/setup";

/**
 * Plain words for a status, for the chip and for alert text, in the current
 * UI language (LIRA-331). Read at call time, so a language switch applies on
 * the next render.
 */
export function lineStatusText(s: LineStatusResult): string {
  const t = i18n.getFixedT(null, "phoneLines");
  switch (s.status) {
    case "OK":
      return t("status.daysLeft", { count: s.daysLeft });
    case "EXPIRING":
      return s.daysLeft === 0
        ? t("status.expiresToday")
        : s.daysLeft === 1
          ? t("status.expiresInOne", { count: s.daysLeft })
          : t("status.expiresIn", { count: s.daysLeft });
    case "IN_GRACE":
      return s.daysToSave === 1
        ? t("status.graceOne", { count: s.daysToSave })
        : t("status.grace", { count: s.daysToSave });
    case "LOST":
      return t("status.lost");
    case "NO_EXPIRY":
      return t("status.noExpiry");
  }
}
