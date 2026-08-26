/**
 * LIRA-143 phase 6a — pure decision rules for the POS cart's per-line IMEI
 * UI.
 *
 * Extracted so the "headline trap" this ticket calls out (Cart.tsx used to
 * gate on `(item.category?.toLowerCase() || "").includes("phone")`, which
 * both false-positived on things like "Headphones" and missed every real
 * phone category that wasn't literally named "phone") has a single,
 * independently testable source of truth instead of an inline JSX
 * conditional. `resolveCartLineMode` never looks at `category` at all —
 * that is the fix.
 *
 * Owner decision 2026-08-26: the free-text typed-IMEI input is removed
 * entirely. The unit system now owns IMEIs — a registered IN_STOCK unit
 * gets the picker, and a flag-ON product with zero registered units (the
 * drift case) gets NO imei field at all, same as flag-OFF. The accepted
 * trade-off is that an unregistered phone can still be sold (drift stock
 * isn't blocked), just with no IMEI captured on the line or the receipt;
 * the fix for that is to register the unit first, not to type one in.
 */

export type CartLineMode = "unit-picker" | "none";

/**
 * Decide what IMEI-capture UI (if any) a cart line should render.
 *
 * - flag ON, at least one registered IN_STOCK unit -> "unit-picker" (a
 *   select of the product's IN_STOCK unit IMEIs).
 * - flag ON, zero registered units (drift: surplus unregistered stock
 *   sells as before, just with no IMEI UI) -> "none".
 * - flag OFF -> "none" — byte-identical to a product outside phone
 *   tracking, including categories that used to false-positive on the old
 *   heuristic.
 */
export function resolveCartLineMode(
  tracksImeiUnits: number | boolean | null | undefined,
  registeredUnitCount: number,
): CartLineMode {
  if (!tracksImeiUnits) return "none";
  return registeredUnitCount > 0 ? "unit-picker" : "none";
}

/**
 * A unit-picker line always represents exactly one physical unit — the
 * repository rejects quantity > 1 on a line carrying `product_unit_id`
 * (SalesRepository's unit-line strictness check). Adding the SAME
 * imei-tracked product again must therefore always start a NEW line rather
 * than incrementing an existing one's quantity (POS/index.tsx's
 * `handleAddToCart`); every other mode keeps the pre-existing
 * increment-on-repeat-add behavior.
 */
export function shouldAlwaysAddNewLine(mode: CartLineMode): boolean {
  return mode === "unit-picker";
}
