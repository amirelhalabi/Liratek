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
 */

export type CartLineMode = "unit-picker" | "free-text" | "none";

/**
 * Decide what IMEI-capture UI (if any) a cart line should render.
 *
 * - flag ON, at least one registered IN_STOCK unit -> "unit-picker" (a
 *   select of the product's IN_STOCK unit IMEIs).
 * - flag ON, zero registered units (drift: surplus unregistered stock
 *   sells as before) -> "free-text" (today's typed-IMEI input, unchanged).
 * - flag OFF -> "none" — byte-identical to a product outside phone
 *   tracking, including categories that used to false-positive on the old
 *   heuristic.
 */
export function resolveCartLineMode(
  tracksImeiUnits: number | boolean | null | undefined,
  registeredUnitCount: number,
): CartLineMode {
  if (!tracksImeiUnits) return "none";
  return registeredUnitCount > 0 ? "unit-picker" : "free-text";
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
