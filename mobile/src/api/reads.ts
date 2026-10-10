import { request, type ApiResult } from "./client";

/** Per-drawer, per-currency live balances: `{ Whish_App: { USD: 12.5 }, … }`. */
export type DrawerBalances = Record<string, Record<string, number>>;

/** GET /api/closing/system-expected-balances-dynamic (the drawer_balances table, read-only). */
export async function getDrawerBalances(): Promise<ApiResult<DrawerBalances>> {
  const r = await request<{ balances?: DrawerBalances }>("GET", "/api/closing/system-expected-balances-dynamic");
  if (!r.success) return r;
  return { success: true, data: r.data.balances ?? {} };
}

export interface RecentTransaction {
  id: number;
  type: string;
  status?: string;
  amount_usd: number;
  amount_lbp: number;
  client_name?: string | null;
  summary?: string | null;
  created_at: string;
}

/** GET /api/transactions/recent (read-only). */
export async function getRecentTransactions(limit = 15): Promise<ApiResult<RecentTransaction[]>> {
  const r = await request<{ transactions?: RecentTransaction[] }>("GET", `/api/transactions/recent?limit=${limit}`);
  if (!r.success) return r;
  return { success: true, data: r.data.transactions ?? [] };
}

export interface SinceLastCountTxn {
  id: number;
  type: string;
  summary: string | null;
  client_name: string | null;
  created_at: string;
  drawer_amounts: Record<string, number>;
}

export interface SinceLastCountDrawerView {
  drawer: string;
  lastCountAt: string | null;
  transactions: SinceLastCountTxn[];
}

/** GET /api/closing/since-last-count (admin) — sales per drawer since its last count. */
export async function getSinceLastCount(drawers: string[]): Promise<ApiResult<SinceLastCountDrawerView[]>> {
  const r = await request<SinceLastCountDrawerView[]>(
    "GET",
    `/api/closing/since-last-count?drawers=${encodeURIComponent(drawers.join(","))}`,
  );
  return r;
}
