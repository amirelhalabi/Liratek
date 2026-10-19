import { isLineChargeProvider } from "@liratek/core";
import type { ServiceItem } from "../hooks/useMobileServiceItems";

/**
 * Self-charge (LIRA-090 §5.2) is only eligible for MTC/Alfa Prepaid items
 * that carry BOTH a face credit and validity days, sold by iPick, Katsh or
 * (LIRA-338) Whish App — `LINE_CHARGE_PROVIDERS`, the list
 * `selfChargeTelecomItem` accepts — see
 * `FinancialServiceRepository.selfChargeTelecomItem`). This mirrors that
 * repository's own guard clauses so no entry point ever offers an item the
 * backend would reject.
 *
 * Defined ONCE (CLAUDE.md rule 14) — imported by `KatshForm.tsx` (the
 * iPick/Katsh item card's "Charge to shop line" action, carrier-lines-
 * validity plan Phase 5 / D5).
 */
export function isSelfChargeEligible(
  item: ServiceItem,
  carrier: "alfa" | "mtc",
): boolean {
  return (
    item.id != null &&
    item.category.toLowerCase() === carrier &&
    isLineChargeProvider(item.provider) &&
    typeof item.credits === "number" &&
    item.credits > 0 &&
    typeof item.validityDays === "number" &&
    item.validityDays > 0 &&
    typeof item.catalogCost === "number" &&
    item.catalogCost > 0
  );
}
