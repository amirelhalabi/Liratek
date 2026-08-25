/**
 * LIRA-143 phase 6a — warranty state for a sold, IMEI-tracked sale line.
 *
 * Mirrors the "COVERED" | "EXPIRED" | "VOID" | "NONE" vocabulary
 * `ProductUnitStoryDto.warranty.state` already uses
 * (frontend/src/api/backendApi.ts) so SaleDetailModal's inline hint reads
 * the same way as the fuller IMEI story card (a parallel LIRA-143
 * workstream, out of this ticket's scope). Deliberately minimal — the
 * story card owns full warranty-precedence UI (overrides, refund
 * interaction); this only answers "is THIS stamped date still good".
 */

export type WarrantyState = "COVERED" | "EXPIRED" | "VOID" | "NONE";

/**
 * `warrantyUntilIso`/`todayIso` are compared by their first 10 characters
 * (`YYYY-MM-DD` prefix), so a full ISO datetime works for either argument.
 */
export function getWarrantyState(
  warrantyUntilIso: string | null | undefined,
  todayIso: string,
  isVoided: boolean,
): WarrantyState {
  if (!warrantyUntilIso) return "NONE";
  if (isVoided) return "VOID";
  return warrantyUntilIso.slice(0, 10) >= todayIso.slice(0, 10)
    ? "COVERED"
    : "EXPIRED";
}
