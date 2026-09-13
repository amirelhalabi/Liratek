import type { PartLine } from "./PartPicker";

/** Strip the display-only `product_name` before sending to `saveMaintenanceJob`. */
export function toPartsPayload(
  parts: PartLine[],
): Array<{
  id?: number;
  product_id: number;
  quantity: number;
  unit_price_usd: number;
}> {
  return parts.map((p) => ({
    ...(p.id != null ? { id: p.id } : {}),
    product_id: p.product_id,
    quantity: p.quantity,
    unit_price_usd: p.unit_price_usd,
  }));
}

/** Sum of `quantity * unit_price_usd` over a set of part lines. */
export function partsTotalUsd(parts: PartLine[]): number {
  return parts.reduce((sum, p) => sum + p.quantity * p.unit_price_usd, 0);
}
