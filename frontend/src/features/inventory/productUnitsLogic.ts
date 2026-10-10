import { unitWarrantyDisplay } from "@liratek/core";

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
export interface WarrantyBadge {
  label: string;
  className: string;
}

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

/** The inputs `warrantyDisplayBadge` needs: the computed verdict, the
 *  unit's stock status, and the owning MODEL's term. */
export interface WarrantyBadgeInput {
  warranty: WarrantyStatus;
  status: "IN_STOCK" | "SOLD";
  /** The owning MODEL's `products.warranty_months` — a term, not coverage. */
  productWarrantyMonths: number | null;
}

/** "Not sold" in sky: informative, deliberately NOT the emerald of real
 *  coverage, because nothing is covered yet. When the model grants a term,
 *  it says what the next sale will carry (owner-reported 2026-08-26). */
function notSoldBadge(months: number): WarrantyBadge {
  return {
    label: months > 0 ? `Not sold (${months} mo from sale)` : "Not sold",
    className: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  };
}

/** A model term is present only when it is a positive number of months —
 *  `null` (no column value) and `0` (the form's `min`) both mean "none". */
function modelTermMonths(input: WarrantyBadgeInput): number {
  return input.productWarrantyMonths ?? 0;
}

/**
 * The Warranty badge for one unit — the Phone Units table cell, its export,
 * and the unit story card (`ImeiStoryCard`) all use this ONE mapping.
 *
 * LIRA-296 follow-up (owner decision 2026-10-10): a unit on the shelf has no
 * warranty yet — the warranty is chosen at the till when it is sold. So the
 * rule is core's `unitWarrantyDisplay` (rule 14): every IN_STOCK unit reads
 * "Not sold", whatever its stored verdict — an old refund-time override date
 * (COVERED/EXPIRED), a refunded sale's VOID, or NONE — plus the model's term
 * when it has one. A SOLD unit renders its verdict verbatim, and the model's
 * term never leaks onto it (decision #4: a unit sold before its model gained
 * a term stamped nothing, and must keep reading "No warranty").
 *
 * Supersedes the 2026-08-26/27 split ("N mo — starts at sale" in the table,
 * an override outranking it, and the story card keeping "Void (refunded)").
 */
export function warrantyDisplayBadge(input: WarrantyBadgeInput): WarrantyBadge {
  if (unitWarrantyDisplay(input) === "NOT_SOLD") {
    return notSoldBadge(modelTermMonths(input));
  }
  return warrantyBadgeInfo(input.warranty);
}

// =============================================================================
// Product-delete confirmation copy (owner decision #7 — inform, never block)
// =============================================================================

/** How many IMEIs a single product spells out before the message truncates.
 *  A confirm dialog that scrolls is a confirm dialog nobody reads. */
export const UNIT_DELETE_IMEI_PREVIEW_MAX = 12;

/** One product about to be deleted, with the `IN_STOCK` IMEIs found for it. */
export interface UnitDeleteEntry {
  name?: string | null;
  /** The product's `IN_STOCK` IMEIs. Empty when it has none registered. */
  imeis: string[];
}

/**
 * The extra paragraph the product-delete confirm shows when the product(s)
 * being deleted still hold registered `IN_STOCK` units — the cascade removes
 * those `product_units` rows too, so the operator is told the count and the
 * actual IMEIs BEFORE confirming.
 *
 * Returns `null` when there is nothing to disclose (no entry has a unit and
 * nothing failed to check) — the caller then shows its existing message
 * unchanged, so a normal grocery-item delete is exactly as it was.
 *
 * `probeFailed` is the honest half: the units are fetched per product, and a
 * failed fetch must NOT be reported as "no units" (a silent under-count on a
 * destructive dialog). It adds a line saying the check was incomplete.
 */
export function buildUnitDeleteWarning(
  entries: UnitDeleteEntry[],
  probeFailed = false,
): string | null {
  const withUnits = entries.filter((e) => e.imeis.length > 0);
  const totalImeis = withUnits.reduce((sum, e) => sum + e.imeis.length, 0);

  if (totalImeis === 0) {
    return probeFailed
      ? "Some products could not be checked for registered IMEIs — any that exist will be removed too."
      : null;
  }

  const plural = totalImeis === 1 ? "" : "s";
  const lines: string[] = [];

  if (entries.length === 1) {
    lines.push(
      `Deleting this product also removes ${totalImeis} registered in-stock IMEI${plural}: ${formatImeiList(
        withUnits[0]!.imeis,
      )}`,
    );
  } else {
    lines.push(
      `Deleting these products also removes ${totalImeis} registered in-stock IMEI${plural} across ${withUnits.length} product${
        withUnits.length === 1 ? "" : "s"
      }:`,
    );
    for (const entry of withUnits) {
      const label = entry.name?.trim() ? entry.name.trim() : "Unnamed product";
      lines.push(
        `• ${label} (${entry.imeis.length}): ${formatImeiList(entry.imeis)}`,
      );
    }
  }

  if (probeFailed) {
    lines.push(
      "Some products could not be checked for registered IMEIs — any that exist will be removed too.",
    );
  }

  return lines.join("\n");
}

/** Comma-joined IMEIs, truncated past {@link UNIT_DELETE_IMEI_PREVIEW_MAX}. */
function formatImeiList(imeis: string[]): string {
  if (imeis.length <= UNIT_DELETE_IMEI_PREVIEW_MAX) return imeis.join(", ");
  const shown = imeis.slice(0, UNIT_DELETE_IMEI_PREVIEW_MAX);
  const hidden = imeis.length - shown.length;
  return `${shown.join(", ")} … and ${hidden} more`;
}
