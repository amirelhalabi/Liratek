import {
  requestJson,
  setToken,
  getToken,
  isImpersonationActive,
  clearImpersonationSession,
} from "./httpClient";
import { decodeJwtPayload } from "@/shared/utils/jwt";

function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as any).api;
}

function getElectronApi(): any {
  return (window as any).api;
}

async function ipcOrHttp<T>(
  ipc: () => Promise<T>,
  http: () => Promise<T>,
): Promise<T> {
  if (isElectron()) {
    try {
      return await ipc();
    } catch (err) {
      // If Electron API fails, fall back to HTTP
      console.warn("Electron API call failed, falling back to HTTP:", err);
      return await http();
    }
  }
  return http();
}

export type ApiUser = {
  id: number;
  username: string;
  role: string;
  /**
   * Web-mode only — decoded client-side from the JWT `tenantId` claim
   * (plan §3: null only for `super_admin`). Undefined when decoding wasn't
   * possible, e.g. Electron sessions, which use opaque session tokens, not
   * JWTs, and never carry a tenant concept.
   */
  tenantId?: number | null;
};

/** Merges a decoded JWT's `tenantId` claim onto a login/me response user
 * object — the response body's `ApiUser` shape doesn't carry `tenantId` on
 * the wire, only the JWT does. `role` is trusted as-is from the response
 * (the `ApiUser` type guarantees it's present — it's the DB `users.role`
 * value). No-ops (returns `user` unchanged) if there's no token to decode or
 * the payload doesn't carry a usable `tenantId` claim. */
function withDecodedTenant(
  user: ApiUser | undefined,
  token: string | null | undefined,
): ApiUser | undefined {
  if (!user || !token) return user;
  const decoded = decodeJwtPayload(token);
  if (!decoded) return user;
  const tenantId =
    typeof decoded.tenantId === "number" || decoded.tenantId === null
      ? decoded.tenantId
      : undefined;
  return tenantId !== undefined ? { ...user, tenantId } : user;
}

export async function login(
  username: string,
  password: string,
  rememberMe: boolean = false,
) {
  if (isElectron()) {
    return (window as any).api.auth.login(username, password, rememberMe);
  }

  const res = await requestJson<{
    success: boolean;
    user?: ApiUser;
    token?: string;
    sessionToken?: string;
    error?: string;
    data?: { user?: ApiUser; token?: string; sessionToken?: string };
  }>("/api/auth/login", {
    method: "POST",
    body: { username, password, rememberMe },
    auth: false,
  });

  // The backend wraps the login payload in `data` (createSuccessResponse),
  // unlike /api/auth/me which responds flat — accept both shapes.
  const payload = res.data ?? res;
  if (res.success && payload.token) setToken(payload.token);
  return {
    success: res.success,
    user: withDecodedTenant(payload.user, payload.token),
    token: payload.token,
    sessionToken: payload.sessionToken,
    error: res.error,
  };
}

export async function logout(): Promise<void> {
  if (isElectron()) {
    const sessionToken = localStorage.getItem("sessionToken") || "";
    // Some Electron implementations require the sessionToken, but older ones may ignore the arg.
    return getElectronApi().auth.logout(sessionToken);
  }

  // Impersonation-aware: getToken() (used by requestJson) already prefers
  // the impersonation session, so this correctly revokes the IMPERSONATION
  // token's DB session server-side. The bug this guards against: unconditionally
  // clearing localStorage here would wipe the super admin's OWN session —
  // localStorage is shared across every tab of this origin, so a naive
  // `setToken(null)` from inside the impersonation tab would log the super
  // admin out of their own, untouched tab. Only clear whichever session was
  // actually active in THIS tab.
  const impersonating = isImpersonationActive();
  try {
    await requestJson("/api/auth/logout", { method: "POST" });
  } finally {
    if (impersonating) {
      clearImpersonationSession();
    } else {
      setToken(null);
    }
  }
}

export async function me() {
  type MeResult = { success: boolean; user?: ApiUser; error?: string };

  return ipcOrHttp<MeResult>(
    async () => {
      const token = localStorage.getItem("sessionToken") || undefined;
      const res = await getElectronApi().auth.restoreSession(token);
      const out: MeResult = { success: !!res?.success };
      if (res?.user) out.user = res.user;
      if (res?.error) out.error = res.error;
      return out;
    },
    async () => {
      const res = await requestJson<MeResult>("/api/auth/me");
      // /api/auth/me doesn't carry tenantId in its body — decode it from
      // whichever token is currently active (impersonation-aware via
      // getToken()'s precedence), so a page reload doesn't lose it.
      if (res.success && res.user) {
        const user = withDecodedTenant(res.user, getToken());
        if (user) return { ...res, user };
      }
      return res;
    },
  );
}

// Clients
export type ClientWriteResult = { success: boolean; id?: number; error?: string };

export async function createClient(payload: any): Promise<ClientWriteResult> {
  if (isElectron()) {
    return (window as any).api.clients.create(payload);
  }
  try {
    // REST createClientSchema wants a boolean whatsapp_opt_in (IPC accepts 0/1)
    const body = {
      ...payload,
      ...(payload.whatsapp_opt_in != null
        ? { whatsapp_opt_in: Boolean(payload.whatsapp_opt_in) }
        : {}),
    };
    // Route wraps in createSuccessResponse ({success, data:{id}})
    const res = await requestJson<ClientWriteResult & { data?: { id?: number } }>(
      `/api/clients`,
      { method: "POST", body },
    );
    const id = res.id ?? res.data?.id;
    return id != null ? { ...res, id } : res;
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? "Failed to create client" };
  }
}

export async function updateClient(payload: {
  id: number;
  [key: string]: unknown;
}): Promise<ClientWriteResult> {
  if (isElectron()) {
    return (window as any).api.clients.update(payload);
  }
  try {
    const { id, ...rest } = payload;
    const body = {
      ...rest,
      ...(rest.whatsapp_opt_in != null
        ? { whatsapp_opt_in: Boolean(rest.whatsapp_opt_in) }
        : {}),
    };
    return await requestJson<ClientWriteResult>(`/api/clients/${id}`, {
      method: "PUT",
      body,
    });
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? "Failed to update client" };
  }
}

export async function getClients(search: string) {
  return ipcOrHttp(
    async () => getElectronApi().clients.getAll(search),
    async () => {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      // Route wraps in createSuccessResponse ({success, data:{clients}})
      const res = await requestJson<{
        success: boolean;
        clients?: any[];
        data?: { clients?: any[] };
      }>(`/api/clients?${qs.toString()}`);
      return (res.data ?? res).clients ?? [];
    },
  );
}

export async function deleteClient(id: number) {
  return ipcOrHttp(
    async () => getElectronApi().clients.delete(id),
    async () =>
      requestJson<{ success: boolean; error?: string }>(`/api/clients/${id}`, {
        method: "DELETE",
      }),
  );
}

// Inventory
export async function getProducts(search: string = "") {
  return ipcOrHttp(
    async () => getElectronApi().inventory.getProducts(search),
    async () => {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      // Route wraps in createSuccessResponse ({success, data:{products}})
      const res = await requestJson<{
        success: boolean;
        products?: any[];
        data?: { products?: any[] };
      }>(`/api/inventory/products?${qs.toString()}`);
      return (res.data ?? res).products ?? [];
    },
  );
}

export type ProductWriteResult = {
  success: boolean;
  id?: number;
  error?: string;
  code?: string;
  suggested_barcode?: string;
};

export async function createProduct(payload: any): Promise<ProductWriteResult> {
  if (isElectron()) {
    return (window as any).api.inventory.createProduct(payload);
  }
  try {
    // REST createProductSchema uses different field names than the IPC form
    // payload (cost_price_usd vs cost_price, stock vs stock_quantity, ...)
    const body = {
      name: payload.name,
      category: payload.category,
      ...(payload.barcode ? { barcode: payload.barcode } : {}),
      cost_price_usd: payload.cost_price_usd ?? payload.cost_price ?? 0,
      retail_price_usd: payload.retail_price_usd ?? payload.retail_price ?? 0,
      stock: payload.stock ?? payload.stock_quantity ?? 0,
      min_stock_threshold:
        payload.min_stock_threshold ?? payload.min_stock_level ?? 0,
      supplier: payload.supplier ?? null,
    };
    // Route wraps in createSuccessResponse ({success, data:{id}})
    const res = await requestJson<ProductWriteResult & { data?: { id?: number } }>(
      `/api/inventory/products`,
      { method: "POST", body },
    );
    const id = res.id ?? res.data?.id;
    return id != null ? { ...res, id } : res;
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? "Failed to create product" };
  }
}

export async function updateProduct(
  id: number,
  payload: any,
): Promise<ProductWriteResult> {
  return ipcOrHttp(
    async () => getElectronApi().inventory.updateProduct({ id, ...payload }),
    async () =>
      requestJson<ProductWriteResult>(`/api/inventory/products/${id}`, {
        method: "PUT",
        body: payload,
      }),
  );
}

export async function deleteProduct(id: number): Promise<ProductWriteResult> {
  if (isElectron()) {
    return (window as any).api.inventory.deleteProduct(id);
  }
  return requestJson<ProductWriteResult>(`/api/inventory/products/${id}`, {
    method: "DELETE",
  });
}

export async function getLowStockProducts() {
  return ipcOrHttp(
    async () => getElectronApi().inventory.getLowStockProducts(),
    async () => {
      // Web fallback: derive from products list (if min_stock/quantity fields exist).
      const products = await getProducts("");
      return (products || []).filter((p: any) => {
        const qty = Number(p?.quantity ?? p?.stock_quantity ?? p?.stock ?? NaN);
        const min = Number(
          p?.min_stock ?? p?.minimum_stock ?? p?.low_stock_threshold ?? NaN,
        );
        if (!Number.isFinite(qty) || !Number.isFinite(min)) return false;
        return qty <= min;
      });
    },
  );
}

// Sales
export async function getDrafts() {
  if (isElectron()) {
    return (window as any).api.sales.getDrafts();
  }
  const res = await requestJson<{ success: boolean; drafts: any[] }>(
    `/api/sales/drafts`,
  );
  return res.drafts;
}

export async function deleteDraft(
  saleId: number,
): Promise<{ success: boolean; error?: string }> {
  if (isElectron()) {
    return (window as any).api.sales.deleteDraft(saleId);
  }
  return requestJson<{ success: boolean; error?: string }>(
    `/api/sales/drafts/${saleId}`,
    { method: "DELETE" },
  );
}

export type ProcessSaleResult = {
  success: boolean;
  id?: number;
  error?: string;
};

export async function processSale(payload: any): Promise<ProcessSaleResult> {
  if (isElectron()) {
    return (window as any).api.sales.process(payload);
  }
  return requestJson<ProcessSaleResult>(`/api/sales/process`, {
    method: "POST",
    body: payload,
  });
}

export async function getSale(saleId: number) {
  if (isElectron()) {
    return (window as any).api.sales.get(saleId);
  }
  const res = await requestJson<{ success: boolean; sale: any }>(
    `/api/sales/${saleId}`,
  );
  return res.sale;
}

export async function getSaleItems(saleId: number) {
  if (isElectron()) {
    return (window as any).api.sales.getItems(saleId);
  }
  const res = await requestJson<{ success: boolean; items: any[] }>(
    `/api/sales/${saleId}/items`,
  );
  return res.items;
}

// Debts
export async function getDebtors() {
  if (isElectron()) {
    return (window as any).api.debt.getDebtors();
  }
  const res = await requestJson<{ success: boolean; debtors: any[] }>(
    `/api/debts/debtors`,
  );
  return res.debtors;
}

export async function getClientDebtHistory(clientId: number) {
  if (isElectron()) {
    return (window as any).api.debt.getClientHistory(clientId);
  }
  const res = await requestJson<{ success: boolean; history: any[] }>(
    `/api/debts/clients/${clientId}/history`,
  );
  return res.history;
}

export async function getClientDebtTotal(clientId: number) {
  return ipcOrHttp(
    async () => getElectronApi().debt.getClientTotal(clientId),
    async () => {
      const res = await requestJson<{ success: boolean; total: number }>(
        `/api/debts/clients/${clientId}/total`,
      );
      return res.total;
    },
  );
}

export async function addRepayment(payload: any) {
  if (isElectron()) {
    return (window as any).api.debt.addRepayment(payload);
  }
  return requestJson<{ success: boolean; error?: string }>(
    `/api/debts/repayments`,
    { method: "POST", body: payload },
  );
}

// Exchange
export async function getExchangeRates() {
  return ipcOrHttp(
    async () => getElectronApi().rates.list(),
    async () => {
      const res = await requestJson<{ success: boolean; rates: any[] }>(
        `/api/exchange/rates`,
      );
      return res.rates;
    },
  );
}

export async function getCurrenciesList() {
  return ipcOrHttp(
    async () => getElectronApi().currencies.list(),
    async () => {
      const res = await requestJson<{ success: boolean; currencies: any[] }>(
        `/api/exchange/currencies`,
      );
      return res.currencies;
    },
  );
}

export async function getExchangeHistory(limit?: number) {
  if (isElectron()) {
    // Electron preload exposes getExchangeHistory() without limit
    return (window as any).api.exchange.getHistory();
  }
  const qs = new URLSearchParams();
  if (limit) qs.set("limit", String(limit));
  const res = await requestJson<{ success: boolean; history: any[] }>(
    `/api/exchange/history?${qs.toString()}`,
  );
  return res.history;
}

export async function addExchangeTransaction(payload: any) {
  if (isElectron()) {
    return (window as any).api.exchange.addTransaction(payload);
  }
  // REST createExchangeSchema requires `rate` and a full ISO transaction_time;
  // the form sends leg-based rates and a datetime-local string (IPC accepts
  // both). NOTE: the REST validator also strips the leg1*/leg2* profit fields
  // — leg-profit stamping parity is tracked in the plan doc (Appendix A).
  const body = {
    ...payload,
    rate:
      payload.rate ??
      payload.leg1Rate ??
      (payload.amountIn ? payload.amountOut / payload.amountIn : undefined),
    ...(payload.transaction_time
      ? { transaction_time: new Date(payload.transaction_time).toISOString() }
      : {}),
  };
  return requestJson<{ success: boolean; id?: number; error?: string }>(
    `/api/exchange/transactions`,
    { method: "POST", body },
  );
}

// Expenses
export async function getTodayExpenses() {
  if (isElectron()) {
    return (window as any).api.expenses.getToday();
  }
  const res = await requestJson<{ success: boolean; expenses: any[] }>(
    `/api/expenses/today`,
  );
  return res.expenses;
}

export async function addExpense(payload: any) {
  if (isElectron()) {
    return (window as any).api.expenses.add(payload);
  }
  return requestJson<{ success: boolean; id?: number; error?: string }>(
    `/api/expenses`,
    { method: "POST", body: payload },
  );
}

export async function deleteExpense(id: number) {
  if (isElectron()) {
    return (window as any).api.expenses.delete(id);
  }
  return requestJson<{ success: boolean; error?: string }>(
    `/api/expenses/${id}`,
    { method: "DELETE" },
  );
}

// Dashboard
export async function getDashboardStats() {
  return ipcOrHttp(
    async () => getElectronApi().dashboard.getStats(),
    async () => {
      const res = await requestJson<{ success: boolean; stats: any }>(
        `/api/dashboard/stats`,
      );
      return res.stats;
    },
  );
}

export async function getProfitSalesChart(type: "Sales" | "Profit") {
  return ipcOrHttp(
    async () => getElectronApi().dashboard.getProfitSalesChart(type),
    async () => {
      const qs = new URLSearchParams({ type });
      const res = await requestJson<{ success: boolean; chart: any[] }>(
        `/api/dashboard/chart?${qs.toString()}`,
      );
      return res.chart;
    },
  );
}

export async function getTodaysSales(date?: string) {
  return ipcOrHttp(
    async () => getElectronApi().sales.getTodaysSales(date),
    async () => {
      const qs = date ? `?date=${encodeURIComponent(date)}` : "";
      const res = await requestJson<{ success: boolean; sales: any[] }>(
        `/api/dashboard/todays-sales${qs}`,
      );
      return res.sales;
    },
  );
}

export async function getDrawerBalances() {
  return ipcOrHttp(
    async () => getElectronApi().dashboard.getDrawerBalances(),
    async () => {
      const res = await requestJson<{ success: boolean; balances: any }>(
        `/api/dashboard/drawer-balances`,
      );
      return res.balances;
    },
  );
}

export async function getDebtSummary() {
  return ipcOrHttp(
    async () => getElectronApi().debt.getSummary(),
    async () => {
      const res = await requestJson<{ success: boolean; debt: any }>(
        `/api/dashboard/debt-summary`,
      );
      return res.debt;
    },
  );
}

export async function getInventoryStockStats() {
  return ipcOrHttp(
    async () => getElectronApi().inventory.getStockStats(),
    async () => {
      const res = await requestJson<{ success: boolean; stats: any }>(
        `/api/dashboard/inventory-stock-stats`,
      );
      return res.stats;
    },
  );
}

export async function getMonthlyPL(month: string) {
  return ipcOrHttp(
    async () => getElectronApi().financial.getMonthlyPL(month),
    async () => {
      const qs = new URLSearchParams({ month });
      const res = await requestJson<{ success: boolean; pl: any }>(
        `/api/dashboard/monthly-pl?${qs.toString()}`,
      );
      return res.pl;
    },
  );
}

export async function getDrawerNames(): Promise<string[]> {
  return ipcOrHttp(
    async () => getElectronApi().financial.getDrawerNames(),
    async () => {
      const res = await requestJson<{
        success: boolean;
        drawerNames: string[];
      }>(`/api/dashboard/drawer-names`);
      return res.drawerNames;
    },
  );
}

// Settings
export async function getAllSettings() {
  return ipcOrHttp(
    async () => getElectronApi().settings.getAll(),
    async () => {
      const res = await requestJson<{ success: boolean; settings: any[] }>(
        `/api/settings`,
      );
      return res.settings;
    },
  );
}

export async function getSetting(key: string) {
  return ipcOrHttp(
    async () => {
      const all = await getElectronApi().settings.getAll();
      return all.find((s: any) => s.key_name === key) ?? null;
    },
    async () => {
      const res = await requestJson<{ success: boolean; setting: any }>(
        `/api/settings/${key}`,
      );
      return res.setting;
    },
  );
}

export async function updateSetting(key: string, value: string) {
  return ipcOrHttp(
    async () => getElectronApi().settings.update(key, value),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/settings/${key}`,
        {
          method: "PUT",
          body: { value },
        },
      ),
  );
}

// Recharge
export async function getRechargeStock() {
  if (isElectron()) {
    return (window as any).api.recharge.getStock();
  }
  const res = await requestJson<{ success: boolean; stock: any }>(
    `/api/recharge/stock`,
  );
  return res.stock;
}

export async function processRecharge(payload: any) {
  if (isElectron()) {
    return (window as any).api.recharge.process(payload);
  }
  return requestJson<{ success: boolean; error?: string }>(
    `/api/recharge/process`,
    {
      method: "POST",
      body: payload,
    },
  );
}

export async function topUpRecharge(payload: {
  provider: "MTC" | "Alfa";
  amount: number;
  currency?: string;
}) {
  if (isElectron()) {
    return (window as any).api.recharge.topUp(payload);
  }
  return requestJson<{ success: boolean; error?: string }>(
    `/api/recharge/top-up`,
    {
      method: "POST",
      body: payload,
    },
  );
}

export async function topUpApp(payload: {
  provider: "OMT_APP" | "WHISH_APP" | "iPick" | "Katsh";
  amount: number;
  currency: "USD" | "LBP";
  sourceDrawer: string;
}) {
  if (isElectron()) {
    return (window as any).api.recharge.topUpApp(payload);
  }
  return requestJson<{ success: boolean; error?: string }>(
    `/api/recharge/top-up-app`,
    {
      method: "POST",
      body: payload,
    },
  );
}

// Services (OMT/Whish/BOB)
export async function getOMTHistory(provider?: string) {
  if (isElectron()) {
    return (window as any).api.omt.getHistory(provider);
  }
  const qs = new URLSearchParams();
  if (provider) qs.set("provider", provider);
  const res = await requestJson<{ success: boolean; history: any[] }>(
    `/api/services/history?${qs.toString()}`,
  );
  return res.history;
}

export async function getOMTAnalytics(providers?: string[]) {
  if (isElectron()) {
    return (window as any).api.omt.getAnalytics(providers);
  }
  const qs = new URLSearchParams();
  if (providers) qs.set("providers", providers.join(","));
  const res = await requestJson<{ success: boolean; analytics: any }>(
    `/api/services/analytics?${qs.toString()}`,
  );
  return res.analytics;
}

export async function addOMTTransaction(payload: any) {
  if (isElectron()) {
    return (window as any).api.omt.addTransaction(payload);
  }
  return requestJson<{ success: boolean; error?: string; id?: number }>(
    `/api/services/transactions`,
    {
      method: "POST",
      body: payload,
    },
  );
}

// Maintenance
export async function getMaintenanceJobs(statusFilter?: string) {
  if (isElectron()) {
    return (window as any).api.maintenance.getJobs(statusFilter);
  }
  const qs = new URLSearchParams();
  if (statusFilter) qs.set("status", statusFilter);
  const res = await requestJson<{ success: boolean; jobs: any[] }>(
    `/api/maintenance/jobs?${qs.toString()}`,
  );
  return res.jobs;
}

export async function saveMaintenanceJob(payload: any) {
  if (isElectron()) {
    return (window as any).api.maintenance.save(payload);
  }
  return requestJson<{ success: boolean; error?: string; id?: number }>(
    `/api/maintenance/jobs`,
    {
      method: "POST",
      body: payload,
    },
  );
}

export async function deleteMaintenanceJob(id: number) {
  if (isElectron()) {
    return (window as any).api.maintenance.delete(id);
  }
  return requestJson<{ success: boolean; error?: string }>(
    `/api/maintenance/jobs/${id}`,
    {
      method: "DELETE",
    },
  );
}

// Currencies
export async function getCurrencies() {
  if (isElectron()) {
    return (window as any).api.currencies.list();
  }
  const res = await requestJson<{ success: boolean; currencies: any[] }>(
    `/api/currencies`,
  );
  return res.currencies;
}

// ==================== Closing API ====================

/**
 * Get system expected balances in dynamic format: Record<drawerName, Record<currencyCode, balance>>
 */
export async function getSystemExpectedBalancesDynamic(): Promise<
  Record<string, Record<string, number>>
> {
  if (isElectron()) {
    return (window as any).api.closing.getSystemExpectedBalancesDynamic();
  }
  const res = await requestJson<{
    success: boolean;
    balances: Record<string, Record<string, number>>;
  }>("/api/closing/system-expected-balances-dynamic");
  return res.balances;
}

export async function hasOpeningBalanceToday() {
  if (isElectron()) {
    return (window as any).api.closing.hasOpeningBalanceToday();
  }
  const res = await requestJson<{ success: boolean; hasOpening: boolean }>(
    "/api/closing/has-opening-balance-today",
  );
  return res.hasOpening;
}

export async function getDailyStatsSnapshot() {
  if (isElectron()) {
    return (window as any).api.closing.getDailyStatsSnapshot();
  }
  const res = await requestJson<{ success: boolean; stats: any }>(
    "/api/closing/daily-stats-snapshot",
  );
  return res.stats;
}

export async function recalculateDrawerBalances(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (isElectron()) {
    return (window as any).api.closing.recalculateDrawerBalances();
  }
  return requestJson<{ success: boolean; error?: string }>(
    "/api/closing/recalculate-drawer-balances",
    { method: "POST" },
  );
}

export async function getCheckpointTimeline(filters?: {
  date?: string;
  type?: "OPENING" | "CLOSING" | "ALL";
  drawer_name?: string;
  user_id?: number;
}) {
  if (isElectron()) {
    return (window as any).api.closing.getCheckpointTimeline(filters);
  }
  return requestJson<{ success: boolean; checkpoints?: any[]; error?: string }>(
    "/api/closing/checkpoint-timeline",
    { method: "POST", body: filters },
  );
}

export async function updateDailyClosing(
  id: number,
  data: {
    physical_usd?: number;
    physical_lbp?: number;
    physical_eur?: number;
    system_expected_usd?: number;
    system_expected_lbp?: number;
    variance_usd?: number;
    notes?: string;
    report_path?: string;
    user_id?: number;
  },
) {
  if (isElectron()) {
    return (window as any).api.closing.updateDailyClosing({ id, ...data });
  }
  return requestJson<{ success: boolean; error?: string }>(
    `/api/closing/daily-closing/${id}`,
    {
      method: "PUT",
      body: data,
    },
  );
}

// ==================== Suppliers API ====================

export async function getSuppliers(search?: string, includeInactive?: boolean) {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.list(search, includeInactive),
    async () => {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (includeInactive) qs.set("includeInactive", "true");
      const res = await requestJson<{ success: boolean; suppliers: any[] }>(
        `/api/suppliers?${qs.toString()}`,
      );
      return res.suppliers || [];
    },
  );
}

export async function getSupplierBalances(includeInactive?: boolean) {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.getBalances(includeInactive),
    async () => {
      const params = includeInactive ? "?includeInactive=true" : "";
      const res = await requestJson<{ success: boolean; balances: any[] }>(
        `/api/suppliers/balances${params}`,
      );
      return res.balances || [];
    },
  );
}

export async function getSupplierLedger(supplierId: number, limit?: number) {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.getLedger(supplierId, limit),
    async () => {
      const qs = new URLSearchParams();
      if (limit) qs.set("limit", limit.toString());
      const res = await requestJson<{ success: boolean; ledger: any[] }>(
        `/api/suppliers/${supplierId}/ledger?${qs.toString()}`,
      );
      return res.ledger || [];
    },
  );
}

export async function createSupplier(data: {
  name: string;
  contact_name?: string;
  phone?: string;
  note?: string;
  module_key?: string;
  provider?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.create(data),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        "/api/suppliers",
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

export async function addSupplierLedgerEntry(
  supplierId: number,
  data: {
    entry_type: string;
    amount_usd?: number;
    amount_lbp?: number;
    note?: string;
    drawer_name?: string;
  },
) {
  return ipcOrHttp(
    async () =>
      getElectronApi().suppliers.addLedgerEntry({
        supplier_id: supplierId,
        ...data,
      }),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/suppliers/${supplierId}/ledger`,
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

export async function getUnsettledTransactions(provider: string) {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.getUnsettledTransactions(provider),
    async () => {
      const res = await requestJson<{ success: boolean; transactions: any[] }>(
        `/api/suppliers/unsettled?provider=${encodeURIComponent(provider)}`,
      );
      return res.transactions || [];
    },
  );
}

export async function settleTransactions(data: {
  supplier_id: number;
  financial_service_ids: number[];
  amount_usd: number;
  amount_lbp: number;
  commission_usd: number;
  commission_lbp: number;
  drawer_name: string;
  note?: string;
  payments?: Array<{
    method: string;
    currency_code: string;
    amount: number;
  }>;
}) {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.settleTransactions(data),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/suppliers/${data.supplier_id}/settle`,
        { method: "POST", body: data },
      ),
  );
}

// ==================== Rates API ====================
// New schema (v30): one row per non-USD currency
// { to_code, market_rate, delta, is_stronger }

export async function getRates() {
  if (isElectron()) {
    return (window as any).api.rates.list();
  }
  const res = await requestJson<{ success: boolean; rates: any[] }>(
    `/api/rates`,
  );
  return res.rates || [];
}

export async function setRate(data: {
  to_code: string;
  market_rate: number;
  buy_rate: number;
  sell_rate: number;
  is_stronger: 1 | -1;
}) {
  return ipcOrHttp(
    async () => getElectronApi().rates.set(data),
    async () =>
      requestJson<{ success: boolean; error?: string }>("/api/rates", {
        method: "POST",
        body: data,
      }),
  );
}

export async function deleteRate(to_code: string) {
  return ipcOrHttp(
    async () => getElectronApi().rates.delete(to_code),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/rates/${to_code}`,
        { method: "DELETE" },
      ),
  );
}

// ==================== Users API ====================

export async function getNonAdminUsers() {
  if (isElectron()) {
    return (window as any).api.auth.getNonAdminUsers();
  }
  const res = await requestJson<{ success: boolean; users: any[] }>(
    "/api/users/non-admins",
  );
  return res.users || [];
}

export async function createUser(data: {
  username: string;
  password: string;
  role: string;
}) {
  return ipcOrHttp(
    async () =>
      getElectronApi().auth.createUser(data.username, data.password, data.role),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        "/api/users",
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

export async function setUserActive(userId: number, is_active: boolean) {
  return ipcOrHttp(
    async () => getElectronApi().auth.setUserActive(userId, is_active ? 1 : 0),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/users/${userId}/active`,
        {
          method: "PUT",
          body: { is_active },
        },
      ),
  );
}

export async function setUserRole(userId: number, role: string) {
  return ipcOrHttp(
    async () => getElectronApi().auth.setUserRole(userId, role),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/users/${userId}/role`,
        {
          method: "PUT",
          body: { role },
        },
      ),
  );
}

export async function setUserPassword(userId: number, password: string) {
  return ipcOrHttp(
    async () => getElectronApi().auth.setUserPassword(userId, password),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/users/${userId}/password`,
        {
          method: "PUT",
          body: { password },
        },
      ),
  );
}

// ==================== Activity API ====================

export async function getRecentActivity(limit: number = 100) {
  if (isElectron()) {
    // Electron exposes activity.getRecent(limit)
    return (window as any).api.activity.getRecent(limit);
  }
  const res = await requestJson<{ success: boolean; activities: any[] }>(
    `/api/activity/recent?limit=${limit}`,
  );
  return res.activities || [];
}

// ==================== Transactions API ====================

export interface TransactionFiltersParam {
  type?: string;
  status?: string;
  user_id?: number;
  client_id?: number;
  source_table?: string;
  from?: string;
  to?: string;
  provider?: string;
  service_type?: string;
  has_item_key?: boolean;
  search?: string;
  excludeTypes?: string[];
}

export async function getRecentTransactions(
  limit: number = 50,
  filters?: TransactionFiltersParam,
) {
  if (isElectron()) {
    return (window as any).api.transactions.getRecent(limit, filters);
  }
  const params = new URLSearchParams({ limit: String(limit) });
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined) params.set(k, String(v));
    });
  }
  const res = await requestJson<{ success: boolean; transactions: any[] }>(
    `/api/transactions/recent?${params}`,
  );
  return res.transactions || [];
}

export async function getTransactionById(id: number) {
  if (isElectron()) {
    return (window as any).api.transactions.getById(id);
  }
  const res = await requestJson<{ success: boolean; transaction: any }>(
    `/api/transactions/${id}`,
  );
  return res.transaction || null;
}

export async function getClientTransactions(
  clientId: number,
  limit: number = 100,
) {
  if (isElectron()) {
    return (window as any).api.transactions.getByClient(clientId, limit);
  }
  const res = await requestJson<{ success: boolean; transactions: any[] }>(
    `/api/transactions/client/${clientId}?limit=${limit}`,
  );
  return res.transactions || [];
}

export async function voidTransaction(id: number) {
  if (isElectron()) {
    return (window as any).api.transactions.void(id);
  }
  return requestJson<{ success: boolean; reversalId?: number; error?: string }>(
    `/api/transactions/${id}/void`,
    { method: "POST" },
  );
}

export async function refundTransaction(id: number) {
  if (isElectron()) {
    return (window as any).api.transactions.refund(id);
  }
  return requestJson<{ success: boolean; refundId?: number; error?: string }>(
    `/api/transactions/${id}/refund`,
    { method: "POST" },
  );
}

export async function getTransactionDailySummary(date: string) {
  if (isElectron()) {
    return (window as any).api.transactions.dailySummary(date);
  }
  const res = await requestJson<{ success: boolean; summary: any }>(
    `/api/transactions/analytics/daily-summary?date=${date}`,
  );
  return res.summary || null;
}

export async function getDebtAging(clientId: number) {
  if (isElectron()) {
    return (window as any).api.transactions.debtAging(clientId);
  }
  const res = await requestJson<{ success: boolean; aging: any }>(
    `/api/transactions/analytics/debt-aging/${clientId}`,
  );
  return res.aging || null;
}

export async function getOverdueDebts() {
  if (isElectron()) {
    return (window as any).api.transactions.overdueDebts();
  }
  const res = await requestJson<{ success: boolean; overdueDebts: any[] }>(
    `/api/transactions/analytics/overdue-debts`,
  );
  return res.overdueDebts || [];
}

export async function getRevenueByType(from: string, to: string) {
  if (isElectron()) {
    return (window as any).api.transactions.revenueByType(from, to);
  }
  const res = await requestJson<{ success: boolean; revenue: any[] }>(
    `/api/transactions/analytics/revenue-by-type?from=${from}&to=${to}`,
  );
  return res.revenue || [];
}

export async function getRevenueByUser(from: string, to: string) {
  if (isElectron()) {
    return (window as any).api.transactions.revenueByUser(from, to);
  }
  const res = await requestJson<{ success: boolean; revenue: any[] }>(
    `/api/transactions/analytics/revenue-by-user?from=${from}&to=${to}`,
  );
  return res.revenue || [];
}

// ==================== Reporting API ====================

export async function getDailySummaries(from: string, to: string) {
  if (isElectron()) {
    return (window as any).api.reporting.dailySummaries(from, to);
  }
  const res = await requestJson<{ success: boolean; summaries: any[] }>(
    `/api/transactions/reports/daily-summaries?from=${from}&to=${to}`,
  );
  return res.summaries || [];
}

export async function getClientHistory(clientId: number, limit?: number) {
  if (isElectron()) {
    return (window as any).api.reporting.clientHistory(clientId, limit);
  }
  const limitParam = limit ? `?limit=${limit}` : "";
  const res = await requestJson<{ success: boolean; history: any }>(
    `/api/transactions/reports/client-history/${clientId}${limitParam}`,
  );
  return res.history || null;
}

export async function getRevenueByModule(from: string, to: string) {
  if (isElectron()) {
    return (window as any).api.reporting.revenueByModule(from, to);
  }
  const res = await requestJson<{ success: boolean; revenue: any[] }>(
    `/api/transactions/reports/revenue-by-module?from=${from}&to=${to}`,
  );
  return res.revenue || [];
}

export async function getReportOverdueDebts() {
  if (isElectron()) {
    return (window as any).api.reporting.overdueDebts();
  }
  const res = await requestJson<{ success: boolean; overdueDebts: any[] }>(
    `/api/transactions/reports/overdue-debts`,
  );
  return res.overdueDebts || [];
}

// ==================== Profits API ====================

export async function getProfitSummary(from: string, to: string) {
  return ipcOrHttp(
    async () => getElectronApi().profits.summary(from, to),
    async () => {
      const qs = new URLSearchParams({ from, to });
      const res = await requestJson<{ success: boolean; data: any }>(
        `/api/profits/summary?${qs}`,
      );
      return res.data;
    },
  );
}

export async function getProfitByModule(from: string, to: string) {
  return ipcOrHttp(
    async () => getElectronApi().profits.byModule(from, to),
    async () => {
      const qs = new URLSearchParams({ from, to });
      const res = await requestJson<{ success: boolean; data: any[] }>(
        `/api/profits/by-module?${qs}`,
      );
      return res.data || [];
    },
  );
}

export async function getProfitByDate(from: string, to: string) {
  return ipcOrHttp(
    async () => getElectronApi().profits.byDate(from, to),
    async () => {
      const qs = new URLSearchParams({ from, to });
      const res = await requestJson<{ success: boolean; data: any[] }>(
        `/api/profits/by-date?${qs}`,
      );
      return res.data || [];
    },
  );
}

export async function getProfitByPaymentMethod(from: string, to: string) {
  return ipcOrHttp(
    async () => getElectronApi().profits.byPaymentMethod(from, to),
    async () => {
      const qs = new URLSearchParams({ from, to });
      const res = await requestJson<{ success: boolean; data: any[] }>(
        `/api/profits/by-payment-method?${qs}`,
      );
      return res.data || [];
    },
  );
}

export async function getProfitByUser(from: string, to: string) {
  return ipcOrHttp(
    async () => getElectronApi().profits.byUser(from, to),
    async () => {
      const qs = new URLSearchParams({ from, to });
      const res = await requestJson<{ success: boolean; data: any[] }>(
        `/api/profits/by-user?${qs}`,
      );
      return res.data || [];
    },
  );
}

export async function getProfitByClient(
  from: string,
  to: string,
  limit?: number,
) {
  return ipcOrHttp(
    async () => getElectronApi().profits.byClient(from, to, limit),
    async () => {
      const qs = new URLSearchParams({ from, to });
      if (limit) qs.set("limit", String(limit));
      const res = await requestJson<{ success: boolean; data: any[] }>(
        `/api/profits/by-client?${qs}`,
      );
      return res.data || [];
    },
  );
}

export async function getPendingProfit(from: string, to: string) {
  return ipcOrHttp(
    async () => getElectronApi().profits.pending(from, to),
    async () => {
      const qs = new URLSearchParams({ from, to });
      const res = await requestJson<{ success: boolean; data: any }>(
        `/api/profits/pending?${qs}`,
      );
      return res.data;
    },
  );
}

// ==================== Reports API ====================

export async function generatePDF(html: string, filename?: string) {
  return ipcOrHttp(
    async () => getElectronApi().report.generatePDF(html, filename),
    async () =>
      requestJson<{ success: boolean; path?: string; error?: string }>(
        "/api/reports/pdf",
        {
          method: "POST",
          body: { html, filename },
        },
      ),
  );
}

export async function backupDatabase() {
  return ipcOrHttp(
    async () => getElectronApi().report.backupDatabase(),
    async () =>
      requestJson<{ success: boolean; path?: string; error?: string }>(
        "/api/reports/backup",
        {
          method: "POST",
        },
      ),
  );
}

export async function listBackups() {
  return ipcOrHttp(
    async () => getElectronApi().report.listBackups(),
    async () =>
      requestJson<{ success: boolean; backups?: any[]; error?: string }>(
        "/api/reports/backups",
      ),
  );
}

export async function verifyBackup(path: string) {
  return ipcOrHttp(
    async () => getElectronApi().report.verifyBackup(path),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        "/api/reports/backup/verify",
        {
          method: "POST",
          body: { path },
        },
      ),
  );
}

export async function restoreDatabase(path: string) {
  return ipcOrHttp(
    async () => getElectronApi().report.restoreDatabase(path),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        "/api/reports/restore",
        {
          method: "POST",
          body: { path },
        },
      ),
  );
}

export async function createCurrency(
  code: string,
  name: string,
  symbol?: string,
  decimalPlaces?: number,
) {
  return ipcOrHttp(
    async () =>
      getElectronApi().currencies.create(code, name, symbol, decimalPlaces),
    async () =>
      requestJson<{ success: boolean; error?: string; id?: number }>(
        `/api/currencies`,
        {
          method: "POST",
          body: { code, name, symbol, decimal_places: decimalPlaces },
        },
      ),
  );
}

export async function updateCurrency(id: number, data: any) {
  return ipcOrHttp(
    async () => getElectronApi().currencies.update({ id, ...data }),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/currencies/${id}`,
        {
          method: "PUT",
          body: data,
        },
      ),
  );
}

export async function deleteCurrency(id: number) {
  return ipcOrHttp(
    async () => getElectronApi().currencies.delete(id),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/currencies/${id}`,
        {
          method: "DELETE",
        },
      ),
  );
}

// ==================== Module API ====================

export async function getModules() {
  return ipcOrHttp(
    async () => getElectronApi().modules.list(),
    async () => {
      const res = await requestJson<{ success: boolean; modules: any[] }>(
        `/api/modules`,
      );
      return res.modules;
    },
  );
}

export async function getEnabledModules() {
  return ipcOrHttp(
    async () => getElectronApi().modules.enabled(),
    async () => {
      const res = await requestJson<{ success: boolean; modules: any[] }>(
        `/api/modules/enabled`,
      );
      return res.modules;
    },
  );
}

export async function getToggleableModules() {
  return ipcOrHttp(
    async () => getElectronApi().modules.toggleable(),
    async () => {
      const res = await requestJson<{ success: boolean; modules: any[] }>(
        `/api/modules/toggleable`,
      );
      return res.modules;
    },
  );
}

export async function setModuleEnabled(key: string, enabled: boolean) {
  return ipcOrHttp(
    async () => getElectronApi().modules.setEnabled(key, enabled),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/modules/${key}/enabled`,
        {
          method: "PATCH",
          body: { enabled },
        },
      ),
  );
}

export async function reorderModules(orderedKeys: string[]) {
  return ipcOrHttp(
    async () => getElectronApi().modules.reorder(orderedKeys),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/modules/reorder`,
        {
          method: "POST",
          body: { orderedKeys },
        },
      ),
  );
}

// ==================== Payment Method API ====================

export type PaymentMethodEntity = {
  id: number;
  code: string;
  label: string;
  drawer_name: string;
  affects_drawer: number;
  sort_order: number;
  is_active: number;
  is_system: number;
  created_at: string;
};

export async function getPaymentMethods(): Promise<PaymentMethodEntity[]> {
  return ipcOrHttp(
    async () => getElectronApi().paymentMethods.list(),
    async () => {
      const res = await requestJson<{
        success: boolean;
        methods: PaymentMethodEntity[];
      }>(`/api/payment-methods`);
      return res.methods;
    },
  );
}

export async function getActivePaymentMethods(): Promise<
  PaymentMethodEntity[]
> {
  return ipcOrHttp(
    async () => getElectronApi().paymentMethods.listActive(),
    async () => {
      const res = await requestJson<{
        success: boolean;
        methods: PaymentMethodEntity[];
      }>(`/api/payment-methods/active`);
      return res.methods;
    },
  );
}

export async function createPaymentMethod(data: {
  code: string;
  label: string;
  drawer_name: string;
  affects_drawer?: number;
}) {
  return ipcOrHttp(
    async () => getElectronApi().paymentMethods.create(data),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/payment-methods`,
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

export async function updatePaymentMethod(
  id: number,
  data: {
    label?: string;
    drawer_name?: string;
    affects_drawer?: number;
    is_active?: number;
    sort_order?: number;
  },
) {
  return ipcOrHttp(
    async () => getElectronApi().paymentMethods.update(id, data),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/payment-methods/${id}`,
        {
          method: "PUT",
          body: data,
        },
      ),
  );
}

export async function deletePaymentMethod(id: number) {
  return ipcOrHttp(
    async () => getElectronApi().paymentMethods.delete(id),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/payment-methods/${id}`,
        {
          method: "DELETE",
        },
      ),
  );
}

export async function reorderPaymentMethods(ids: number[]) {
  return ipcOrHttp(
    async () => getElectronApi().paymentMethods.reorder(ids),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/payment-methods/reorder`,
        {
          method: "PUT",
          body: { ids },
        },
      ),
  );
}

// ==================== Currency–Module API ====================

export async function getModulesForCurrency(code: string) {
  return ipcOrHttp(
    async () => getElectronApi().currencies.getModules(code),
    async () => {
      const res = await requestJson<{ success: boolean; modules: string[] }>(
        `/api/currencies/${code}/modules`,
      );
      return res.modules;
    },
  );
}

export async function getCurrenciesByModule(moduleKey: string) {
  return ipcOrHttp(
    async () => getElectronApi().currencies.byModule(moduleKey),
    async () => {
      const res = await requestJson<{ success: boolean; currencies: any[] }>(
        `/api/currencies/by-module/${moduleKey}`,
      );
      return res.currencies;
    },
  );
}

export async function getFullCurrenciesByDrawer(drawerName: string) {
  return ipcOrHttp(
    async () => getElectronApi().currencies.fullForDrawer(drawerName),
    async () => {
      const res = await requestJson<{ success: boolean; currencies: any[] }>(
        `/api/currencies/by-drawer/${drawerName}`,
      );
      return res.currencies;
    },
  );
}

export async function setModulesForCurrency(code: string, modules: string[]) {
  return ipcOrHttp(
    async () => getElectronApi().currencies.setModules(code, modules),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/currencies/${code}/modules`,
        {
          method: "PUT",
          body: { modules },
        },
      ),
  );
}

// ==================== Currency–Drawer API ====================

export async function getAllDrawerCurrencies(): Promise<
  Record<string, string[]>
> {
  return ipcOrHttp(
    async () => getElectronApi().currencies.allDrawerCurrencies(),
    async () => {
      const res = await requestJson<{
        success: boolean;
        drawerCurrencies: Record<string, string[]>;
      }>(`/api/currencies/drawer-currencies`);
      return res.drawerCurrencies;
    },
  );
}

export async function getCurrenciesForDrawer(
  drawerName: string,
): Promise<string[]> {
  return ipcOrHttp(
    async () => getElectronApi().currencies.forDrawer(drawerName),
    async () => {
      const res = await requestJson<{
        success: boolean;
        currencies: string[];
      }>(`/api/currencies/drawers/${drawerName}/currencies`);
      return res.currencies;
    },
  );
}

export async function getDrawersForCurrency(code: string): Promise<string[]> {
  return ipcOrHttp(
    async () => getElectronApi().currencies.getDrawers(code),
    async () => {
      const res = await requestJson<{
        success: boolean;
        drawers: string[];
      }>(`/api/currencies/${code}/drawers`);
      return res.drawers;
    },
  );
}

export async function setDrawerCurrencies(
  drawerName: string,
  currencies: string[],
) {
  return ipcOrHttp(
    async () =>
      getElectronApi().currencies.setDrawerCurrencies(drawerName, currencies),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/currencies/drawers/${drawerName}/currencies`,
        {
          method: "PUT",
          body: { currencies },
        },
      ),
  );
}

// Customer Sessions

export async function getConfiguredDrawerNames(): Promise<string[]> {
  return ipcOrHttp(
    async () => getElectronApi().currencies.configuredDrawers(),
    async () => {
      // Fall back to getting drawer names from drawer currencies keys
      const all = await getAllDrawerCurrencies();
      return Object.keys(all);
    },
  );
}

export async function startSession(data: {
  customer_name: string;
  customer_phone?: string;
  customer_notes?: string;
}) {
  return ipcOrHttp(
    async () => {
      const api = getElectronApi();
      if (!api.session?.start) {
        throw new Error("Electron session API not available");
      }
      const username = localStorage.getItem("username") || "unknown";
      return api.session.start({ ...data, started_by: username });
    },
    async () =>
      requestJson<{ success: boolean; sessionId?: number; error?: string }>(
        "/api/sessions/start",
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

export async function getActiveSession() {
  return ipcOrHttp(
    async () => {
      const api = getElectronApi();
      if (!api.session?.getActive) {
        throw new Error("Electron session API not available");
      }
      return api.session.getActive();
    },
    async () =>
      requestJson<{
        success: boolean;
        session?: {
          id: number;
          customer_name?: string;
          customer_phone?: string;
          customer_notes?: string;
          started_at: string;
          closed_at?: string;
          started_by: string;
          closed_by?: string;
          is_active: 1 | 0;
        };
        error?: string;
      }>("/api/sessions/active"),
  );
}

export async function getSessionDetails(sessionId: number) {
  return ipcOrHttp(
    async () => {
      const api = getElectronApi();
      if (!api.session?.get) {
        throw new Error("Electron session API not available");
      }
      return api.session.get(sessionId);
    },
    async () =>
      requestJson<{
        success: boolean;
        session?: any;
        transactions?: any[];
        error?: string;
      }>(`/api/sessions/${sessionId}`),
  );
}

export async function updateSession(
  sessionId: number,
  data: {
    customer_name?: string;
    customer_phone?: string;
    customer_notes?: string;
  },
) {
  return ipcOrHttp(
    async () => {
      const api = getElectronApi();
      if (!api.session?.update) {
        throw new Error("Electron session API not available");
      }
      return api.session.update(sessionId, data);
    },
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/sessions/${sessionId}`,
        {
          method: "PUT",
          body: data,
        },
      ),
  );
}

export async function closeSession(sessionId: number) {
  return ipcOrHttp(
    async () => {
      const api = getElectronApi();
      if (!api.session?.close) {
        throw new Error("Electron session API not available");
      }
      const username = localStorage.getItem("username") || "unknown";
      return api.session.close(sessionId, username);
    },
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/sessions/${sessionId}/close`,
        {
          method: "POST",
        },
      ),
  );
}

export async function listSessions(limit = 50, offset = 0) {
  return ipcOrHttp(
    async () => {
      const api = getElectronApi();
      if (!api.session?.list) {
        throw new Error("Electron session API not available");
      }
      return api.session.list(limit, offset);
    },
    async () => {
      const qs = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });
      return requestJson<{
        success: boolean;
        sessions?: any[];
        error?: string;
      }>(`/api/sessions?${qs.toString()}`);
    },
  );
}

export async function linkTransactionToSession(data: {
  sessionId: number;
  transactionType: string;
  transactionId: number;
  amountUsd: number;
  amountLbp: number;
  profitUsd?: number;
  profitLbp?: number;
}) {
  return ipcOrHttp(
    async () => {
      const api = getElectronApi();
      if (!api.session?.linkTransaction) {
        throw new Error("Electron session API not available");
      }
      return api.session.linkTransaction(data);
    },
    async () =>
      requestJson<{ success: boolean; linked: boolean; error?: string }>(
        "/api/sessions/link-transaction",
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

// ── Session read + cart (WP2) — dual-mode, matching window.api.session ──────

export async function getActiveSessions() {
  return ipcOrHttp(
    async () => getElectronApi().session.getActiveSessions(),
    async () =>
      requestJson<{ success: boolean; sessions?: any[]; error?: string }>(
        "/api/sessions/active-list",
      ),
  );
}

export async function getSessionsByDateRange(from: string, to: string) {
  return ipcOrHttp(
    async () => getElectronApi().session.getByDateRange(from, to),
    async () =>
      requestJson<{ success: boolean; sessions?: any[]; error?: string }>(
        `/api/sessions/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
  );
}

export async function getTodaySessions() {
  return ipcOrHttp(
    async () => getElectronApi().session.getTodaySessions(),
    async () =>
      requestJson<{ success: boolean; sessions?: any[]; error?: string }>(
        "/api/sessions/today",
      ),
  );
}

export async function getTodayAllSessions() {
  return ipcOrHttp(
    async () => getElectronApi().session.getTodayAllSessions(),
    async () =>
      requestJson<{ success: boolean; sessions?: any[]; error?: string }>(
        "/api/sessions/today-all",
      ),
  );
}

export async function getSessionsByCustomer(data: {
  customerName: string;
  customerPhone?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().session.getByCustomer(data),
    async () => {
      const qs = new URLSearchParams({ name: data.customerName });
      if (data.customerPhone) qs.set("phone", data.customerPhone);
      return requestJson<{ success: boolean; sessions?: any[]; error?: string }>(
        `/api/sessions/by-customer?${qs.toString()}`,
      );
    },
  );
}

export async function deleteSession(sessionId: number) {
  return ipcOrHttp(
    async () => getElectronApi().session.delete(sessionId),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/sessions/${sessionId}`,
        { method: "DELETE" },
      ),
  );
}

export async function sessionCartGet(sessionId: number) {
  return ipcOrHttp(
    async () => getElectronApi().session.cartGet(sessionId),
    async () =>
      requestJson<{ success: boolean; items?: any[]; error?: string }>(
        `/api/sessions/${sessionId}/cart`,
      ),
  );
}

export async function sessionCartAdd(
  sessionId: number,
  item: {
    item_id: string;
    module: string;
    label: string;
    amount: number;
    currency: string;
    form_data: string;
    ipc_channel: string;
    user_id?: number;
  },
) {
  return ipcOrHttp(
    async () => getElectronApi().session.cartAdd(sessionId, item),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/sessions/${sessionId}/cart`,
        { method: "POST", body: item },
      ),
  );
}

export async function sessionCartRemove(sessionId: number, itemId: string) {
  return ipcOrHttp(
    async () => getElectronApi().session.cartRemove(sessionId, itemId),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/sessions/${sessionId}/cart/${encodeURIComponent(itemId)}`,
        { method: "DELETE" },
      ),
  );
}

export async function sessionCartClear(sessionId: number) {
  return ipcOrHttp(
    async () => getElectronApi().session.cartClear(sessionId),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/sessions/${sessionId}/cart`,
        { method: "DELETE" },
      ),
  );
}

// Basket checkout — dual-mode. Both transports feed the same core
// SessionCheckoutService (WP4). REST route: POST /api/sessions/checkout.
export async function processSessionCheckout(data: any) {
  return ipcOrHttp(
    async () => getElectronApi().session.checkout(data),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        "/api/sessions/checkout",
        { method: "POST", body: data },
      ),
  );
}

// ── Hold money (dual-mode) — cash held in / collected out of the General drawer ──

export async function holdMoneyList(filter?: {
  status?: "held" | "collected";
}) {
  return ipcOrHttp(
    async () => getElectronApi().holdMoney.list(filter),
    async () => {
      const qs = filter?.status ? `?status=${filter.status}` : "";
      return requestJson<{ success: boolean; data?: any[]; error?: string }>(
        `/api/hold-money${qs}`,
      );
    },
  );
}

export async function holdMoneyActive() {
  return ipcOrHttp(
    async () => getElectronApi().holdMoney.active(),
    async () =>
      requestJson<{ success: boolean; data?: any[]; error?: string }>(
        "/api/hold-money/active",
      ),
  );
}

export async function holdMoneyCreate(data: {
  client_name: string;
  phone_number?: string;
  usd_amount?: number;
  lbp_amount?: number;
  notes?: string;
  transaction_time?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().holdMoney.create(data),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        "/api/hold-money",
        { method: "POST", body: data },
      ),
  );
}

export async function holdMoneyCollect(id: number) {
  return ipcOrHttp(
    async () => getElectronApi().holdMoney.collect(id),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/hold-money/${id}/collect`,
        { method: "POST" },
      ),
  );
}

// ── Service presets (dual-mode) — config CRUD for custom-service templates ──

export async function servicePresetsList(filter?: {
  category?: string;
  includeInactive?: boolean;
}) {
  return ipcOrHttp(
    async () => getElectronApi().servicePresets.list(filter),
    async () => {
      const qs = new URLSearchParams();
      if (filter?.category) qs.set("category", filter.category);
      if (filter?.includeInactive) qs.set("includeInactive", "true");
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return requestJson<{ success: boolean; data?: any[]; error?: string }>(
        `/api/service-presets${suffix}`,
      );
    },
  );
}

export async function servicePresetsCreate(data: {
  name: string;
  category: string;
  cost_usd?: number;
  cost_lbp?: number;
  price_usd?: number;
  price_lbp?: number;
  is_active?: number;
  sort_order?: number;
}) {
  return ipcOrHttp(
    async () => getElectronApi().servicePresets.create(data),
    async () =>
      requestJson<{ success: boolean; data?: any; error?: string }>(
        "/api/service-presets",
        { method: "POST", body: data },
      ),
  );
}

export async function servicePresetsUpdate(
  id: number,
  data: {
    name?: string;
    category?: string;
    cost_usd?: number;
    cost_lbp?: number;
    price_usd?: number;
    price_lbp?: number;
    is_active?: number;
    sort_order?: number;
  },
) {
  return ipcOrHttp(
    async () => getElectronApi().servicePresets.update(id, data),
    async () =>
      requestJson<{ success: boolean; data?: any; error?: string }>(
        `/api/service-presets/${id}`,
        { method: "PUT", body: data },
      ),
  );
}

export async function servicePresetsDelete(id: number) {
  return ipcOrHttp(
    async () => getElectronApi().servicePresets.delete(id),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/service-presets/${id}`,
        { method: "DELETE" },
      ),
  );
}

// ── Audit log (dual-mode, read-only) — user-action audit trail ──

export async function auditSearch(filters: {
    userId?: number;
    action?: string;
    entityType?: string;
    entityId?: string;
    from?: string;
    to?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
  return ipcOrHttp(
    async () => getElectronApi().audit.search(filters),
    async () =>
      requestJson<{
        success: boolean;
        rows?: any[];
        total?: number;
        error?: string;
      }>("/api/audit/search", { method: "POST", body: filters ?? {} }),
  );
}

export async function auditGetRecent(limit?: number) {
  return ipcOrHttp(
    async () => getElectronApi().audit.getRecent(limit),
    async () => {
      const qs = limit ? `?limit=${limit}` : "";
      return requestJson<{ success: boolean; rows?: any[]; error?: string }>(
        `/api/audit/recent${qs}`,
      );
    },
  );
}

export async function auditGetByEntity(entityType: string, entityId: string) {
  return ipcOrHttp(
    async () => getElectronApi().audit.getByEntity(entityType, entityId),
    async () => {
      const qs = new URLSearchParams({ entityType, entityId });
      return requestJson<{ success: boolean; rows?: any[]; error?: string }>(
        `/api/audit/by-entity?${qs.toString()}`,
      );
    },
  );
}

// ── Drawer top-ups (dual-mode) — cash into a drawer / transfer between drawers ──

export async function drawerTopUpSourceDrawers() {
  return ipcOrHttp(
    async () => getElectronApi().drawerTopUp.getSourceDrawers(),
    async () =>
      requestJson<{ success: boolean; data?: any[]; error?: string }>(
        "/api/drawer-topup/source-drawers",
      ),
  );
}

export async function drawerTopUpHistory(limit?: number) {
  return ipcOrHttp(
    async () => getElectronApi().drawerTopUp.getHistory(limit),
    async () => {
      const qs = limit ? `?limit=${limit}` : "";
      return requestJson<{ success: boolean; data?: any[]; error?: string }>(
        `/api/drawer-topup/history${qs}`,
      );
    },
  );
}

export async function drawerTopUpCreate(data: {
  amount_usd: number;
  amount_lbp: number;
  notes?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().drawerTopUp.create(data),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        "/api/drawer-topup",
        { method: "POST", body: data },
      ),
  );
}

export async function drawerTopUpCreateFromDrawer(data: {
  amount_usd: number;
  amount_lbp: number;
  source_drawer: string;
  notes?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().drawerTopUp.createFromDrawer(data),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        "/api/drawer-topup/from-drawer",
        { method: "POST", body: data },
      ),
  );
}

// WhatsApp
export async function sendWhatsAppTestMessage(
  recipientPhone: string,
  shopName: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().whatsapp.sendTest(recipientPhone, shopName),
    async () =>
      requestJson<{ success: boolean; messageId?: string; error?: string }>(
        "/api/whatsapp/send-test",
        {
          method: "POST",
          body: { recipientPhone, shopName },
        },
      ),
  );
}

export async function sendWhatsAppMessage(
  recipientPhone: string,
  message: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().whatsapp.sendMessage(recipientPhone, message),
    async () =>
      requestJson<{ success: boolean; messageId?: string; error?: string }>(
        "/api/whatsapp/send-message",
        {
          method: "POST",
          body: { recipientPhone, message },
        },
      ),
  );
}

// =============================================================================
// Item Costs
// =============================================================================

export async function getItemCosts(): Promise<any[]> {
  return ipcOrHttp(
    async () => getElectronApi().itemCosts.getAll(),
    async () => {
      const res = await requestJson<{ success: boolean; costs: any[] }>(
        "/api/item-costs",
      );
      return res.costs ?? [];
    },
  );
}

export async function setItemCost(data: {
  provider: string;
  category: string;
  itemKey: string;
  cost: number;
  currency: string;
}): Promise<{ success: boolean; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().itemCosts.set(data),
    async () =>
      requestJson<{ success: boolean; error?: string }>("/api/item-costs", {
        method: "POST",
        body: data,
      }),
  );
}

// =============================================================================
// Voucher Images
// =============================================================================

export async function getVoucherImages(): Promise<any[]> {
  return ipcOrHttp(
    async () => getElectronApi().voucherImages.getAll(),
    async () => {
      const res = await requestJson<{ success: boolean; images: any[] }>(
        "/api/voucher-images",
      );
      return res.images ?? [];
    },
  );
}

export async function setVoucherImage(data: {
  provider: string;
  category: string;
  itemKey: string;
  imageData: string;
}): Promise<{ success: boolean; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().voucherImages.set(data),
    async () =>
      requestJson<{ success: boolean; error?: string }>("/api/voucher-images", {
        method: "POST",
        body: data,
      }),
  );
}

export async function deleteVoucherImage(
  id: number,
): Promise<{ success: boolean; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().voucherImages.delete(id),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/voucher-images/${id}`,
        {
          method: "DELETE",
        },
      ),
  );
}

// =============================================================================
// Custom Services
// =============================================================================

export async function getCustomServices(filter?: {
  date?: string;
}): Promise<any[]> {
  return ipcOrHttp(
    async () => getElectronApi().customServices.list(filter),
    async () => {
      const qs = new URLSearchParams();
      if (filter?.date) qs.set("date", filter.date);
      const res = await requestJson<{ success: boolean; services: any[] }>(
        `/api/custom-services?${qs.toString()}`,
      );
      return res.services ?? [];
    },
  );
}

export async function getCustomServicesSummary(): Promise<{
  count: number;
  totalCostUsd: number;
  totalCostLbp: number;
  totalPriceUsd: number;
  totalPriceLbp: number;
  totalProfitUsd: number;
  totalProfitLbp: number;
}> {
  return ipcOrHttp(
    async () => getElectronApi().customServices.summary(),
    async () => {
      const res = await requestJson<{ success: boolean; summary: any }>(
        `/api/custom-services/summary`,
      );
      return res.summary;
    },
  );
}

export async function getCustomServiceById(id: number): Promise<any> {
  return ipcOrHttp(
    async () => getElectronApi().customServices.get(id),
    async () => {
      const res = await requestJson<{ success: boolean; service: any }>(
        `/api/custom-services/${id}`,
      );
      return res.service ?? null;
    },
  );
}

export async function addCustomService(data: {
  description: string;
  cost_usd?: number;
  cost_lbp?: number;
  price_usd?: number;
  price_lbp?: number;
  paid_by?: string;
  status?: string;
  client_id?: number;
  client_name?: string;
  phone_number?: string;
  note?: string;
  category?: string;
  transaction_time?: string;
}): Promise<{ success: boolean; id?: number; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().customServices.add(data),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/custom-services`,
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

export async function deleteCustomService(
  id: number,
): Promise<{ success: boolean; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().customServices.delete(id),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/custom-services/${id}`,
        {
          method: "DELETE",
        },
      ),
  );
}

// ==================== Loto API ====================

export async function lotoSell(data: {
  ticket_number?: string;
  sale_amount: number;
  commission_rate?: number;
  is_winner?: boolean;
  prize_amount?: number;
  sale_date?: string;
  payment_method?: string;
  currency?: string;
  note?: string;
}): Promise<{ success: boolean; ticket?: any; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.sell(data),
    async () =>
      requestJson<{ success: boolean; ticket?: any; error?: string }>(
        `/api/loto/sell`,
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

export async function lotoGet(
  id: number,
): Promise<{ success: boolean; ticket?: any; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.get(id),
    async () => {
      const res = await requestJson<{ success: boolean; ticket?: any }>(
        `/api/loto/${id}`,
      );
      return res.ticket ?? null;
    },
  );
}

export async function lotoGetByDateRange(
  from: string,
  to: string,
): Promise<{ success: boolean; tickets?: any[]; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.getByDateRange(from, to),
    async () => {
      const res = await requestJson<{ success: boolean; tickets?: any[] }>(
        `/api/loto?from=${from}&to=${to}`,
      );
      return res.tickets ?? [];
    },
  );
}

export async function lotoGetUncheckpointed(): Promise<{
  success: boolean;
  tickets?: any[];
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().loto.getUncheckpointed(),
    async () =>
      requestJson<{ success: boolean; tickets?: any[]; error?: string }>(
        `/api/loto/uncheckpointed`,
      ),
  );
}

export async function lotoUpdate(
  id: number,
  data: any,
): Promise<{ success: boolean; ticket?: any; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.update(id, data),
    async () =>
      requestJson<{ success: boolean; ticket?: any; error?: string }>(
        `/api/loto/${id}`,
        {
          method: "PUT",
          body: data,
        },
      ),
  );
}

export async function lotoReport(
  from: string,
  to: string,
): Promise<{
  success: boolean;
  reportData?: {
    total_tickets: number;
    total_sales: number;
    total_commission: number;
    total_prizes: number;
    total_cash_prizes: number;
    outstanding_prizes: number;
    total_fees: number;
  };
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().loto.report(from, to),
    async () => {
      const res = await requestJson<{
        success: boolean;
        reportData?: {
          total_tickets: number;
          total_sales: number;
          total_commission: number;
          total_prizes: number;
          total_cash_prizes: number;
          outstanding_prizes: number;
          total_fees: number;
        };
      }>(`/api/loto/report?from=${from}&to=${to}`);
      return res.reportData ?? null;
    },
  );
}

export async function lotoSettlement(
  from: string,
  to: string,
): Promise<{
  success: boolean;
  settlement?: {
    totalSales: number;
    totalFees: number;
    totalCommission: number;
    totalPrizes: number;
    shopPaysSupplier: number;
    supplierPaysShop: number;
    netSettlement: number;
  };
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().loto.settlement(from, to),
    async () => {
      const res = await requestJson<{
        success: boolean;
        settlement?: {
          totalSales: number;
          totalFees: number;
          totalCommission: number;
          totalPrizes: number;
          shopPaysSupplier: number;
          supplierPaysShop: number;
          netSettlement: number;
        };
      }>(`/api/loto/settlement?from=${from}&to=${to}`);
      return res.settlement ?? null;
    },
  );
}

export async function lotoFeesCreate(data: {
  fee_amount: number;
  fee_month: string;
  fee_year: number;
  recorded_date?: string;
  note?: string;
}): Promise<{ success: boolean; fee?: any; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.fees.create(data),
    async () =>
      requestJson<{ success: boolean; fee?: any; error?: string }>(
        `/api/loto/fees`,
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

export async function lotoFeesGet(
  year: number,
): Promise<{ success: boolean; fees?: any[]; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.fees.get(year),
    async () => {
      const res = await requestJson<{ success: boolean; fees?: any[] }>(
        `/api/loto/fees?year=${year}`,
      );
      return res.fees ?? [];
    },
  );
}

export async function lotoFeesPay(
  id: number,
): Promise<{ success: boolean; fee?: any; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.fees.pay(id),
    async () =>
      requestJson<{ success: boolean; fee?: any; error?: string }>(
        `/api/loto/fees/${id}/pay`,
        {
          method: "POST",
        },
      ),
  );
}

export async function lotoSettingsGet(): Promise<{
  success: boolean;
  settings?: Record<string, string>;
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().loto.settings.get(),
    async () => {
      const res = await requestJson<{
        success: boolean;
        settings?: Record<string, string>;
      }>(`/api/loto/settings`);
      return res.settings ?? {};
    },
  );
}

export async function lotoSettingsUpdate(
  key: string,
  value: string,
): Promise<{ success: boolean; setting?: any; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.settings.update(key, value),
    async () =>
      requestJson<{ success: boolean; setting?: any; error?: string }>(
        `/api/loto/settings/${key}`,
        {
          method: "PUT",
          body: { value },
        },
      ),
  );
}

// Loto Cash Prize functions

export async function lotoCashPrizeCreate(data: {
  ticket_number?: string;
  prize_amount: number;
  customer_name?: string;
  prize_date?: string;
  note?: string;
}): Promise<{ success: boolean; prize?: any; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.cashPrize.create(data),
    async () =>
      requestJson<{ success: boolean; prize?: any; error?: string }>(
        `/api/loto/cash-prizes`,
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

export async function lotoCashPrizeGetByDateRange(
  from: string,
  to: string,
): Promise<{ success: boolean; prizes?: any[]; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.cashPrize.getByDateRange(from, to),
    async () => {
      const res = await requestJson<{ success: boolean; prizes?: any[] }>(
        `/api/loto/cash-prizes?from=${from}&to=${to}`,
      );
      return res.prizes ?? [];
    },
  );
}

export async function lotoCashPrizeGetUnreimbursed(): Promise<{
  success: boolean;
  prizes?: any[];
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().loto.cashPrize.getUnreimbursed(),
    async () => {
      const res = await requestJson<{ success: boolean; prizes?: any[] }>(
        `/api/loto/cash-prizes/unreimbursed`,
      );
      return res.prizes ?? [];
    },
  );
}

export async function lotoCashPrizeMarkReimbursed(
  id: number,
  reimbursedDate?: string,
  settlementId?: number,
): Promise<{ success: boolean; prize?: any; error?: string }> {
  return ipcOrHttp(
    async () =>
      getElectronApi().loto.cashPrize.markReimbursed(
        id,
        reimbursedDate,
        settlementId,
      ),
    async () =>
      requestJson<{ success: boolean; prize?: any; error?: string }>(
        `/api/loto/cash-prizes/${id}/reimburse`,
        {
          method: "POST",
          body: { reimbursedDate, settlementId },
        },
      ),
  );
}

export async function lotoCashPrizeGetTotalUnreimbursed(): Promise<{
  success: boolean;
  total?: number;
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().loto.cashPrize.getTotalUnreimbursed(),
    async () => {
      const res = await requestJson<{ success: boolean; total?: number }>(
        `/api/loto/cash-prizes/total-unreimbursed`,
      );
      return res.total ?? 0;
    },
  );
}

// Loto Checkpoint functions

export async function lotoCheckpointCreate(data: {
  checkpoint_date: string;
  period_start: string;
  period_end: string;
  note?: string;
}): Promise<{ success: boolean; checkpoint?: any; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.checkpoint.create(data),
    async () =>
      requestJson<{ success: boolean; checkpoint?: any; error?: string }>(
        `/api/loto/checkpoints`,
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

export async function lotoCheckpointGet(
  id: number,
): Promise<{ success: boolean; checkpoint?: any; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.checkpoint.get(id),
    async () => {
      const res = await requestJson<{ success: boolean; checkpoint?: any }>(
        `/api/loto/checkpoints/${id}`,
      );
      return res.checkpoint ?? null;
    },
  );
}

export async function lotoCheckpointGetByDate(
  date: string,
): Promise<{ success: boolean; checkpoint?: any; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.checkpoint.getByDate(date),
    async () => {
      const res = await requestJson<{ success: boolean; checkpoint?: any }>(
        `/api/loto/checkpoints/date/${date}`,
      );
      return res.checkpoint ?? null;
    },
  );
}

export async function lotoCheckpointGetByDateRange(
  from: string,
  to: string,
): Promise<{ success: boolean; checkpoints?: any[]; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.checkpoint.getByDateRange(from, to),
    async () => {
      const res = await requestJson<{ success: boolean; checkpoints?: any[] }>(
        `/api/loto/checkpoints?from=${from}&to=${to}`,
      );
      return res.checkpoints ?? [];
    },
  );
}

export async function lotoCheckpointGetUnsettled(): Promise<{
  success: boolean;
  checkpoints?: any[];
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().loto.checkpoint.getUnsettled(),
    async () => {
      const res = await requestJson<{ success: boolean; checkpoints?: any[] }>(
        `/api/loto/checkpoints/unssettled`,
      );
      return res.checkpoints ?? [];
    },
  );
}

export async function lotoCheckpointUpdate(
  id: number,
  data: any,
): Promise<{ success: boolean; checkpoint?: any; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.checkpoint.update(id, data),
    async () =>
      requestJson<{ success: boolean; checkpoint?: any; error?: string }>(
        `/api/loto/checkpoints/${id}`,
        {
          method: "PUT",
          body: data,
        },
      ),
  );
}

export async function lotoCheckpointMarkSettled(
  id: number,
  settledAt?: string,
  settlementId?: number,
): Promise<{ success: boolean; checkpoint?: any; error?: string }> {
  return ipcOrHttp(
    async () =>
      getElectronApi().loto.checkpoint.markSettled(id, settledAt, settlementId),
    async () =>
      requestJson<{ success: boolean; checkpoint?: any; error?: string }>(
        `/api/loto/checkpoints/${id}/settle`,
        {
          method: "POST",
          body: { settledAt, settlementId },
        },
      ),
  );
}

export async function lotoCheckpointSettle(data: {
  id: number;
  totalSales: number;
  totalCommission: number;
  totalPrizes: number;
  totalCashPrizes?: number;
  settledAt?: string;
  payments?: Array<{ method: string; currency_code: string; amount: number }>;
}): Promise<{ success: boolean; checkpoint?: any; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.checkpoint.settle(data),
    async () =>
      requestJson<{ success: boolean; checkpoint?: any; error?: string }>(
        `/api/loto/checkpoints/${data.id}/settle`,
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

export async function lotoCheckpointSettleBatch(data: {
  checkpointIds: number[];
  totalSales: number;
  totalCommission: number;
  settledAt?: string;
  payment?: {
    method: string;
    drawer_name: string;
    currency_code: string;
    amount: number;
  };
}): Promise<{ success: boolean; checkpoints?: any[]; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.checkpoint.settleBatch(data),
    async () =>
      requestJson<{ success: boolean; checkpoints?: any[]; error?: string }>(
        `/api/loto/checkpoints/settle-batch`,
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

export async function lotoCheckpointGetTotalSalesUnsettled(): Promise<{
  success: boolean;
  totalSales?: number;
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().loto.checkpoint.getTotalSalesUnsettled(),
    async () => {
      const res = await requestJson<{ success: boolean; totalSales?: number }>(
        `/api/loto/checkpoints/total-sales-unssettled`,
      );
      return res.totalSales ?? 0;
    },
  );
}

export async function lotoCheckpointGetTotalCommissionUnsettled(): Promise<{
  success: boolean;
  totalCommission?: number;
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().loto.checkpoint.getTotalCommissionUnsettled(),
    async () => {
      const res = await requestJson<{
        success: boolean;
        totalCommission?: number;
      }>(`/api/loto/checkpoints/total-commission-unssettled`);
      return res.totalCommission ?? 0;
    },
  );
}

export async function lotoCheckpointGetLast(): Promise<{
  success: boolean;
  checkpoint?: any;
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().loto.checkpoint.getLast(),
    async () => {
      const res = await requestJson<{ success: boolean; checkpoint?: any }>(
        `/api/loto/checkpoints/last`,
      );
      return res.checkpoint ?? null;
    },
  );
}

export async function lotoCheckpointCreateScheduled(
  checkpointDate?: string,
): Promise<{ success: boolean; checkpoint?: any; error?: string }> {
  return ipcOrHttp(
    async () =>
      getElectronApi().loto.checkpoint.createScheduled(checkpointDate),
    async () => {
      const res = await requestJson<{ success: boolean; checkpoint?: any }>(
        `/api/loto/checkpoints/scheduled?date=${checkpointDate || ""}`,
      );
      return res.checkpoint ?? null;
    },
  );
}

export async function lotoCheckpointDelete(
  id: number,
): Promise<{ success: boolean; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().loto.checkpoint.delete(id),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/loto/checkpoints/${id}`,
        { method: "DELETE" },
      ),
  );
}

// =============================================================================
// Admin — super admin control plane (web-only, plan §5)
//
// There is no Electron equivalent: super admins don't exist in desktop mode
// (single-tenant, fixed tenant context at boot). Every function here throws
// if called from Electron rather than silently no-op'ing or falling back to
// IPC — a misplaced call into this realm is a programming error, not a
// runtime branch, and should fail loudly in development.
// =============================================================================

export type AdminTenantStatus = "active" | "suspended" | "archived";

export type AdminTenant = {
  id: number;
  name: string;
  slug: string;
  status: AdminTenantStatus;
  contact_name: string | null;
  contact_phone: string | null;
  notes: string | null;
  created_at: string;
  user_count: number;
  last_activity: string | null;
};

export type AdminCreateTenantPayload = {
  name: string;
  slug: string;
  contactName?: string;
  contactPhone?: string;
  notes?: string;
  adminUsername: string;
  adminPassword: string;
};

export type AdminUpdateTenantPayload = {
  name?: string;
  status?: AdminTenantStatus;
  contactName?: string;
  contactPhone?: string;
  notes?: string;
};

export type AdminImpersonateResult = {
  tenantName: string;
  token: string;
  /**
   * NOT guaranteed by the documented API contract (plan §5 lists only
   * `{ tenantName, token }`) — the JWT itself has no username claim either.
   * If/when the backend (WP6) adds it to this response, "Connect as admin"
   * forwards it to the new tab the same way it already forwards
   * `tenantName`, and the impersonation banner shows the real username.
   * Until then the banner falls back to a generic label. See
   * ImpersonationBanner / getImpersonationInfo for the fallback chain —
   * flagging this loudly because it's a contract gap, not an oversight.
   */
  username?: string;
};

function assertWebOnly(action: string): void {
  if (isElectron()) {
    throw new Error(
      `${action} is only available in web mode (super admin control plane)`,
    );
  }
}

export async function adminListTenants(): Promise<AdminTenant[]> {
  assertWebOnly("Listing tenants");
  const res = await requestJson<{
    success: boolean;
    data?: { tenants: AdminTenant[] };
    error?: string;
  }>("/api/admin/tenants");
  if (!res.success) throw new Error(res.error || "Failed to load tenants");
  return res.data?.tenants ?? [];
}

export async function adminCreateTenant(
  payload: AdminCreateTenantPayload,
): Promise<AdminTenant> {
  assertWebOnly("Creating a tenant");
  const res = await requestJson<{
    success: boolean;
    data?: { tenant: AdminTenant };
    error?: string;
  }>("/api/admin/tenants", { method: "POST", body: payload });
  if (!res.success || !res.data?.tenant) {
    throw new Error(res.error || "Failed to create tenant");
  }
  return res.data.tenant;
}

export async function adminUpdateTenant(
  id: number,
  patch: AdminUpdateTenantPayload,
): Promise<AdminTenant> {
  assertWebOnly("Updating a tenant");
  const res = await requestJson<{
    success: boolean;
    data?: { tenant: AdminTenant };
    error?: string;
  }>(`/api/admin/tenants/${id}`, { method: "PATCH", body: patch });
  if (!res.success || !res.data?.tenant) {
    throw new Error(res.error || "Failed to update tenant");
  }
  return res.data.tenant;
}

export async function adminImpersonate(
  id: number,
): Promise<AdminImpersonateResult> {
  assertWebOnly("Impersonating a tenant");
  const res = await requestJson<{
    success: boolean;
    data?: AdminImpersonateResult;
    error?: string;
  }>(`/api/admin/tenants/${id}/impersonate`, { method: "POST" });
  if (!res.success || !res.data) {
    throw new Error(res.error || "Failed to start impersonation");
  }
  return res.data;
}
