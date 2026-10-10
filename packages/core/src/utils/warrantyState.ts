/**
 * LIRA-296 — the ONE warranty-state helper (rule 14).
 *
 * Replaces two copies that had drifted: `ProductUnitService.
 * computeWarrantyStatus` (LIRA-143 decision #11, which knew about overrides)
 * and the frontend `getWarrantyState` (which did not). Both now call this.
 *
 * Precedence, exactly decision #11's:
 *   1. an operator-set `overrideUntil` always wins, covered/expired by date;
 *   2. otherwise a fully refunded line is VOID — nothing is left to cover;
 *   3. otherwise the sale's own stamped date, covered/expired by date;
 *   4. otherwise there never was a warranty: NONE.
 *
 * The end date is INCLUSIVE (the last day still counts), and only the first
 * 10 characters (`YYYY-MM-DD`) of either side are compared, so a full ISO
 * datetime works too. `todayIso` must be the SHOP's own day — the client's
 * `client_day` on a request path, never the server's clock (rule 27).
 *
 * Pure and browser-safe (rule 29): exported from `index.ts` and `browser.ts`.
 */

export type WarrantyState = "COVERED" | "EXPIRED" | "VOID" | "NONE";
export type WarrantySource = "OVERRIDE" | "REFUND" | "SALE" | null;

export interface WarrantyStateFlags {
  /** `product_units.warranty_override_until` (or a replacement's original
   *  end date, LIRA-296 D2). */
  overrideUntil?: string | null | undefined;
  /** Every unit of the line was refunded (or the sale was voided). */
  fullyRefunded?: boolean | undefined;
}

export interface WarrantyResolution {
  source: WarrantySource;
  until: string | null;
  state: WarrantyState;
}

const day = (iso: string): string => iso.slice(0, 10);

/** The full answer: which rule decided, the date it decided on, and the state. */
export function resolveWarranty(
  untilIso: string | null | undefined,
  todayIso: string,
  flags: WarrantyStateFlags = {},
): WarrantyResolution {
  const today = day(todayIso);
  if (flags.overrideUntil) {
    return {
      source: "OVERRIDE",
      until: flags.overrideUntil,
      state: day(flags.overrideUntil) >= today ? "COVERED" : "EXPIRED",
    };
  }
  if (flags.fullyRefunded) {
    return { source: "REFUND", until: null, state: "VOID" };
  }
  if (untilIso) {
    return {
      source: "SALE",
      until: untilIso,
      state: day(untilIso) >= today ? "COVERED" : "EXPIRED",
    };
  }
  return { source: null, until: null, state: "NONE" };
}

/** Just the state — see {@link resolveWarranty}. */
export function warrantyState(
  untilIso: string | null | undefined,
  todayIso: string,
  flags: WarrantyStateFlags = {},
): WarrantyState {
  return resolveWarranty(untilIso, todayIso, flags).state;
}

/**
 * "Nothing of this sale line is left to cover": the line's own
 * `is_refunded` flag (a whole-sale refund) OR every unit refunded
 * (`refunded_quantity >= quantity`). The JS twin of
 * `ProductUnitRepository.SALE_REFUNDED_EXPR`.
 */
export function isSaleLineFullyRefunded(line: {
  is_refunded?: number | boolean | null;
  quantity?: number | null;
  refunded_quantity?: number | null;
}): boolean {
  const quantity = line.quantity ?? 0;
  const refunded = line.refunded_quantity ?? 0;
  return !!line.is_refunded || (quantity > 0 && refunded >= quantity);
}

/**
 * LIRA-296 — the warranty LENGTH a sale line gets, defined once (rule 14):
 * the edit made at the till ?? the product's own length ?? the category's
 * default ?? none. `0` at any level is an explicit "no warranty" and wins
 * like any other value; `null`/`undefined` means "not set here".
 * Used by `SalesRepository.processSale` (the stamp) and the POS cart (the
 * default it shows before any edit).
 */
export function resolveWarrantyMonths(
  lineEdit: number | null | undefined,
  productMonths: number | null | undefined,
  categoryMonths: number | null | undefined,
): number | null {
  return lineEdit ?? productMonths ?? categoryMonths ?? null;
}
