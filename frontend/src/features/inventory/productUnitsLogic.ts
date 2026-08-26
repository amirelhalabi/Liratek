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

/** The inputs both surface mappings below need: the computed verdict, the
 *  unit's stock status, and the owning MODEL's term. */
export interface WarrantyBadgeInput {
  warranty: WarrantyStatus;
  status: "IN_STOCK" | "SOLD";
  /** The owning MODEL's `products.warranty_months` — a term, not coverage. */
  productWarrantyMonths: number | null;
}

/** "N mo — starts at sale" in sky: informative, deliberately NOT the emerald
 *  of real coverage, because nothing is covered yet. */
function termBadge(months: number): WarrantyBadge {
  return {
    label: `${months} mo — starts at sale`,
    className: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  };
}

/** A model term is present only when it is a positive number of months —
 *  `null` (no column value) and `0` (the form's `min`) both mean "none". */
function modelTermMonths(input: WarrantyBadgeInput): number {
  return input.productWarrantyMonths ?? 0;
}

/**
 * ── SURFACE 1 of 2: the Phone Units TABLE cell (FORWARD-looking) ───────────
 *
 * The register answers "what does this unit carry from here on?", so for a
 * unit sitting IN STOCK it shows the term the NEXT sale will stamp rather
 * than a verdict about a sale that is over.
 *
 * Why the `NONE` half exists (owner-reported 2026-08-26): the warranty CLOCK
 * starts at the SALE (decision #4 — `sale_items.warranty_until` is stamped at
 * checkout), so an IN_STOCK unit has no coverage yet and
 * `computeWarrantyStatus` correctly returns `NONE`. Rendering that as "No
 * warranty" told the operator something false about a 6-month model's fresh
 * stock.
 *
 * Why the `VOID` half exists (owner decision, 2026-08-27): a refund voids the
 * warranty of the sale it reverses AND puts the unit back on the shelf. The
 * verdict `VOID` is the truth about that finished sale, but on a shelved unit
 * it reads as "this phone has no warranty" — false, since selling it again
 * stamps the model's full term. Both branches are therefore the same rule:
 * *an in-stock unit's warranty is a promise about its next sale.*
 *
 *   - (`NONE` | `VOID`) + `IN_STOCK` + a model term -> "N mo — starts at sale"
 *   - (`NONE` | `VOID`) + `IN_STOCK` + no model term -> `warrantyBadgeInfo`
 *     verbatim ("No warranty" / "Void (refunded)") — the honest answer for a
 *     model that grants none.
 *   - `COVERED` / `EXPIRED` on an IN_STOCK unit -> verbatim. These can only
 *     come from an operator OVERRIDE on a shelved unit, which is a deliberate
 *     statement about THIS unit and must outrank the model's default.
 *   - Anything SOLD -> verbatim, always. A unit sold BEFORE its model gained
 *     a term stamped no `warranty_until`, and the model's term must never
 *     retroactively imply that sale carried one.
 *
 * NOT for the story card — see {@link warrantyStoryBadge}. A third surface
 * must pick one of the two deliberately, never default to this one.
 */
export function warrantyDisplayBadge(input: WarrantyBadgeInput): WarrantyBadge {
  const months = modelTermMonths(input);
  const forwardLooking =
    input.warranty.state === "NONE" || input.warranty.state === "VOID";
  if (forwardLooking && input.status === "IN_STOCK" && months > 0) {
    return termBadge(months);
  }
  return warrantyBadgeInfo(input.warranty);
}

/**
 * ── SURFACE 2 of 2: `ImeiStoryCard` (BACKWARD-looking) ─────────────────────
 *
 * The story card is this unit's provenance — product, sale, client, and what
 * happened to the warranty of that sale. It therefore keeps the TRUE verdict
 * including `VOID`: "Void (refunded)" is exactly the fact the operator opened
 * the card to learn, and hiding it behind the model's term would erase the
 * refund from the one surface whose job is to show it.
 *
 * Diverges from {@link warrantyDisplayBadge} in exactly one pair — `VOID` +
 * `IN_STOCK` — and is otherwise identical: `NONE` + `IN_STOCK` + a term still
 * reads "N mo — starts at sale", because `NONE` records no past event to
 * preserve (nothing ever happened to this unit's warranty), so the forward
 * statement is also the complete backward one.
 */
export function warrantyStoryBadge(input: WarrantyBadgeInput): WarrantyBadge {
  const months = modelTermMonths(input);
  if (
    input.warranty.state === "NONE" &&
    input.status === "IN_STOCK" &&
    months > 0
  ) {
    return termBadge(months);
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
