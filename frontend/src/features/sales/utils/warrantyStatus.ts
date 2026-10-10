/**
 * LIRA-143 phase 6a — warranty state for a sale line.
 *
 * LIRA-296: a thin wrapper over core's ONE `warrantyState` helper (rule 14),
 * kept so existing imports keep working. The precedence (override > refund >
 * stamped date > none) and the inclusive, date-prefix comparison live in
 * `@liratek/core` (`utils/warrantyState.ts`) — never re-implemented here.
 */
import { warrantyState, type WarrantyState } from "@liratek/core";

export type { WarrantyState };

/**
 * `warrantyUntilIso`/`todayIso` are compared by their first 10 characters
 * (`YYYY-MM-DD` prefix), so a full ISO datetime works for either argument.
 */
export function getWarrantyState(
  warrantyUntilIso: string | null | undefined,
  todayIso: string,
  isVoided: boolean,
  overrideUntil?: string | null,
): WarrantyState {
  return warrantyState(warrantyUntilIso, todayIso, {
    fullyRefunded: isVoided,
    overrideUntil,
  });
}
