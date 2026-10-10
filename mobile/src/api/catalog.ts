import { request, type ApiResult } from "./client";

/** A row of GET /api/mobile-service-items (active catalog items, all providers). */
export interface CatalogRow {
  id: number;
  provider: string;
  category: string;
  subcategory: string | null;
  label: string;
  cost_lbp: number | null;
  sell_lbp: number | null;
}

/** GET /api/mobile-service-items — the catalog the web's Katsh / iPick screens use. */
export async function getCatalog(): Promise<ApiResult<CatalogRow[]>> {
  const r = await request<CatalogRow[] | { items?: CatalogRow[]; data?: CatalogRow[] }>("GET", "/api/mobile-service-items");
  if (!r.success) return r;
  const d = r.data;
  return { success: true, data: Array.isArray(d) ? d : (d.items ?? d.data ?? []) };
}

/** GET /api/rates — the shop's exchange rates (read with core's readUsdLbpRates). */
export async function getRates(): Promise<ApiResult<unknown[]>> {
  const r = await request<unknown[] | { rates?: unknown[]; data?: unknown[] }>("GET", "/api/rates");
  if (!r.success) return r;
  const d = r.data;
  return { success: true, data: Array.isArray(d) ? d : (d.rates ?? d.data ?? []) };
}
