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

export type ProcessSaleResult = {
  success: boolean;
  saleId?: number;
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

// Binance
export async function getBinanceHistory(limit?: number) {
  if (isElectron()) {
    return (window as any).api.binance.getHistory(limit);
  }
  const qs = new URLSearchParams();
  if (limit) qs.set("limit", String(limit));
  const res = await requestJson<{ success: boolean; history: any[] }>(
    `/api/binance/history?${qs.toString()}`,
  );
  return res.history;
}

export async function getBinanceTodayStats() {
  if (isElectron()) {
    return (window as any).api.binance.getTodayStats();
  }
  const res = await requestJson<{
    success: boolean;
    stats: { totalSent: number; totalReceived: number; count: number };
  }>(`/api/binance/today-stats`);
  return res.stats;
}

export async function addBinanceTransaction(payload: {
  type: "SEND" | "RECEIVE";
  amount: number;
  currencyCode?: string;
  description?: string;
  clientName?: string;
}) {
  if (isElectron()) {
    return (window as any).api.binance.addTransaction(payload);
  }
  return requestJson<{ success: boolean; id?: number; error?: string }>(
    `/api/binance/transactions`,
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

export async function getTodaysSales() {
  return ipcOrHttp(
    async () => getElectronApi().sales.getTodaysSales(),
    async () => {
      const res = await requestJson<{ success: boolean; sales: any[] }>(
        `/api/dashboard/todays-sales`,
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

// ==================== Rates API ====================

export async function getRates() {
  if (isElectron()) {
    return (window as any).api.rates.list();
  }
  const res = await requestJson<{ success: boolean; rates: any[] }>(
    `/api/rates`,
  );
  return res.rates || [];
}

export async function setRate(
  from_code: string,
  to_code: string,
  rate: number,
) {
  return ipcOrHttp(
    async () => getElectronApi().rates.set(from_code, to_code, rate),
    async () =>
      requestJson<{ success: boolean; error?: string }>("/api/rates", {
        method: "POST",
        body: { from_code, to_code, rate },
      }),
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
