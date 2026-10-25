import type { TransactionPaymentLeg } from "@liratek/core/repositories/TransactionRepository";
import { request, type ApiResult } from "./client";

/** Per-drawer, per-currency live balances: `{ Whish_App: { USD: 12.5 }, … }`. */
export type DrawerBalances = Record<string, Record<string, number>>;

/** GET /api/closing/system-expected-balances-dynamic (the drawer_balances table, read-only). */
export async function getDrawerBalances(): Promise<ApiResult<DrawerBalances>> {
  const r = await request<{ balances?: DrawerBalances }>(
    "GET",
    "/api/closing/system-expected-balances-dynamic",
  );
  if (!r.success) return r;
  return { success: true, data: r.data.balances ?? {} };
}

/** GET /api/settings/shop_base_system — the shop's primary system, or null when unset or unreadable. */
export async function getShopBaseSystem(): Promise<ApiResult<"OMT" | "WHISH" | null>> {
  const r = await request<{ setting?: { value?: string } | null }>("GET", "/api/settings/shop_base_system");
  if (!r.success) return r;
  const value = r.data.setting?.value;
  return { success: true, data: value === "OMT" || value === "WHISH" ? value : null };
}

export interface RecentTransaction {
  id: number;
  type: string;
  status?: string;
  amount_usd: number;
  amount_lbp: number;
  client_name?: string | null;
  summary: string | null;
  /** Provider / service type: the shared title wording reads it (LIRA-301). */
  metadata_json: string | null;
  created_at: string;
  /** Set on a void/refund: its cash arrow is the original's, reversed. */
  reverses_id?: number | null;
  /** This row's own cash/wallet legs (in = customer paid, out = paid out / change). */
  payments?: TransactionPaymentLeg[];
  /** On-account (CUSTOMER_ACCOUNT) settlement legs; move no drawer. */
  account_payments?: TransactionPaymentLeg[];
  /** Session basket this row belongs to; the basket's pooled legs ride on its members. */
  session_id?: number | null;
  session_payments?: TransactionPaymentLeg[];
  session_account_payments?: TransactionPaymentLeg[];
  /** The rate the customer paid at (basket checkout rate), else the row's own stamp. */
  display_exchange_rate?: number | null;
  exchange_rate?: number | null;
  /** Cashier. */
  username?: string;
  /** Only-Days sale: telecom credit returned to the shop (USD), when any. */
  returned_credits_usd?: number;
}

/** GET /api/transactions/recent (read-only). `excludeTypes` is dropped server-side, before the limit. */
export async function getRecentTransactions(
  limit = 15,
  excludeTypes: readonly string[] = [],
  search = "",
): Promise<ApiResult<RecentTransaction[]>> {
  const exclude = excludeTypes.length
    ? `&excludeTypes=${encodeURIComponent(excludeTypes.join(","))}`
    : "";
  // Same server search as the web Transactions page: summary, client name, cashier.
  const q = search ? `&search=${encodeURIComponent(search)}` : "";
  const r = await request<{ transactions?: RecentTransaction[] }>(
    "GET",
    `/api/transactions/recent?limit=${limit}${exclude}${q}`,
  );
  if (!r.success) return r;
  return { success: true, data: r.data.transactions ?? [] };
}

export interface SinceLastCountTxn {
  id: number;
  type: string;
  summary: string | null;
  metadata_json: string | null;
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
export async function getSinceLastCount(
  drawers: string[],
): Promise<ApiResult<SinceLastCountDrawerView[]>> {
  const r = await request<SinceLastCountDrawerView[]>(
    "GET",
    `/api/closing/since-last-count?drawers=${encodeURIComponent(drawers.join(","))}`,
  );
  return r;
}
