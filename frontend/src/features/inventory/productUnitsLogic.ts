/**
 * Product-unit (phone IMEI) frontend-only pure logic — LIRA-143 Phase 6b
 * (inventory/settings/refund UI). Kept dependency-free (no React, no API
 * calls) so it is unit-testable in isolation, same pattern as
 * features/audit/cashFlow.ts / refundLegOverride.ts.
 */

/**
 * Owner decision #6: intake-vs-`stock_quantity` drift is WARN-ONLY, never a
 * block. `inStockCount` is the number of `IN_STOCK` `product_units` rows on
 * record for the product; `stockQuantity` is the product's own
 * `stock_quantity` column. Both the intake register response (`{units,
 * drift}`) and the persistent Units/IMEIs list use this same predicate — the
 * register response's own `drift.matches` is equivalent to
 * `computeUnitDrift(...).matches` for the SAME two inputs, so callers may
 * use either the backend-supplied drift or recompute it locally from a
 * freshly loaded unit list.
 */
export interface UnitDrift {
  matches: boolean;
  /** inStockCount - stockQuantity; positive = more units registered than
   *  the stock count says, negative = fewer. */
  delta: number;
}

export function computeUnitDrift(
  inStockCount: number,
  stockQuantity: number,
): UnitDrift {
  return {
    matches: inStockCount === stockQuantity,
    delta: inStockCount - stockQuantity,
  };
}

/**
 * Splits a scan-friendly textarea/input value into individual IMEI
 * candidates — one per line (a barcode scanner's trailing Enter naturally
 * becomes a newline in a plain `<textarea>`), each trimmed, blank lines
 * dropped, and de-duplicated within the batch. The backend's own
 * `ProductUnitRepository.addUnits` already rejects an in-batch duplicate
 * outright (no partial intake) — de-duping here just avoids a guaranteed-
 * to-fail round trip for the most common mis-scan (the same IMEI scanned
 * twice in a row), never changes what a clean batch resolves to.
 */
export function parseImeiBatch(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Permissive IMEI-ish heuristic for the walk-in lookup (decision #7): digits
 * only, at least 6 characters. A real IMEI is 15 digits, but this is
 * deliberately permissive (per the ticket) so a shorter test value or a
 * manually-typed partial IMEI still triggers the lookup — a false positive
 * here just means an extra `getStory` call that comes back empty (rendered
 * silently, per decision #7), which is cheap; a false negative would hide a
 * real match from the operator, which is the worse failure mode.
 */
export function looksLikeImei(term: string): boolean {
  const trimmed = term.trim();
  return /^\d{6,}$/.test(trimmed);
}

// =============================================================================
// Warranty verdict -> display mapping (decision #7's walk-in lookup card)
// =============================================================================

/** Mirrors packages/core's `ProductUnitService` `WarrantySource`/`WarrantyState`/
 *  `WarrantyStatus` (independently duplicated on the frontend, same convention
 *  as the refund DTOs in features/audit/refundLegOverride.ts). */
export type WarrantySource = "OVERRIDE" | "REFUND" | "SALE" | null;
export type WarrantyState = "COVERED" | "EXPIRED" | "VOID" | "NONE";

export interface WarrantyStatus {
  source: WarrantySource;
  until: string | null;
  state: WarrantyState;
}

/**
 * Maps a unit's computed `warranty` verdict to display copy + a badge color
 * family (ImeiStoryCard, decision #7). Kept here rather than in
 * ImeiStoryCard.tsx itself so that file exports ONLY the component (a file
 * mixing a component export with a plain function export breaks React Fast
 * Refresh — `react-refresh/only-export-components`).
 *   - COVERED: green — still under warranty.
 *   - EXPIRED / VOID: amber — no coverage, but for a different reason each
 *     (ran out vs. voided by a refund) — the label spells out which.
 *   - NONE: neutral slate — the unit never had a warranty to begin with.
 */
export function warrantyBadgeInfo(warranty: WarrantyStatus): {
  label: string;
  className: string;
} {
  switch (warranty.state) {
    case "COVERED":
      return {
        label: warranty.until ? `Covered (until ${warranty.until})` : "Covered",
        className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
      };
    case "EXPIRED":
      return {
        label: warranty.until ? `Expired (${warranty.until})` : "Expired",
        className: "bg-amber-500/10 text-amber-400 border-amber-500/30",
      };
    case "VOID":
      return {
        label: "Void (refunded)",
        className: "bg-amber-500/10 text-amber-400 border-amber-500/30",
      };
    case "NONE":
    default:
      return {
        label: "No warranty",
        className: "bg-slate-700/40 text-slate-400 border-slate-600/40",
      };
  }
}
