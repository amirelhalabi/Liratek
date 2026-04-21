import { requestJson, setToken } from "./httpClient";

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

export type ApiUser = { id: number; username: string; role: string };

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
    error?: string;
  }>("/api/auth/login", {
    method: "POST",
    body: { username, password, rememberMe },
    auth: false,
  });

  if (res.success && res.token) setToken(res.token);
  return res;
}

export async function logout(): Promise<void> {
  if (isElectron()) {
    const sessionToken = localStorage.getItem("sessionToken") || "";
    // Some Electron implementations require the sessionToken, but older ones may ignore the arg.
    return getElectronApi().auth.logout(sessionToken);
  }

  try {
    await requestJson("/api/auth/logout", { method: "POST" });
  } finally {
    setToken(null);
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
    async () => requestJson<MeResult>("/api/auth/me"),
  );
}

// Clients
export async function getClients(search: string) {
  return ipcOrHttp(
    async () => getElectronApi().clients.getAll(search),
    async () => {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      const res = await requestJson<{ success: boolean; clients: any[] }>(
        `/api/clients?${qs.toString()}`,
      );
      return res.clients;
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
      const res = await requestJson<{ success: boolean; products: any[] }>(
        `/api/inventory/products?${qs.toString()}`,
      );
      return res.products;
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
  return requestJson<ProductWriteResult>(`/api/inventory/products`, {
    method: "POST",
    body: payload,
  });
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
  return requestJson<{ success: boolean; id?: number; error?: string }>(
    `/api/exchange/transactions`,
    { method: "POST", body: payload },
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

export async function getOMTAnalytics() {
  if (isElectron()) {
    return (window as any).api.omt.getAnalytics();
  }
  const res = await requestJson<{ success: boolean; analytics: any }>(
    `/api/services/analytics`,
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

export async function setOpeningBalances(data: {
  closing_date: string;
  amounts: any[];
  user_id?: number;
}) {
  if (isElectron()) {
    return (window as any).api.closing.setOpeningBalances(data);
  }
  return requestJson<{ success: boolean; error?: string }>(
    "/api/closing/opening-balances",
    {
      method: "POST",
      body: data,
    },
  );
}

export async function createDailyClosing(data: {
  closing_date: string;
  amounts: any[];
  variance_notes?: string;
  report_path?: string;
  system_expected_usd?: number;
  system_expected_lbp?: number;
  user_id?: number;
}) {
  if (isElectron()) {
    return (window as any).api.closing.createDailyClosing(data);
  }
  return requestJson<{ success: boolean; id?: number; error?: string }>(
    "/api/closing/daily-closing",
    {
      method: "POST",
      body: data,
    },
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

export async function getSuppliers(search?: string) {
  if (isElectron()) {
    return (window as any).api.suppliers.list(search);
  }
  const qs = new URLSearchParams();
  if (search) qs.set("search", search);
  const res = await requestJson<{ success: boolean; suppliers: any[] }>(
    `/api/suppliers?${qs.toString()}`,
  );
  return res.suppliers || [];
}

export async function getSupplierBalances() {
  if (isElectron()) {
    return (window as any).api.suppliers.getBalances();
  }
  const res = await requestJson<{ success: boolean; balances: any[] }>(
    "/api/suppliers/balances",
  );
  return res.balances || [];
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
