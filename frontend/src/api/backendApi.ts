import { requestJson, setToken } from './httpClient';

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).api;
}

export type ApiUser = { id: number; username: string; role: string };

export async function login(username: string, password: string) {
  const res = await requestJson<{ success: boolean; user?: ApiUser; token?: string; error?: string }>(
    '/api/auth/login',
    { method: 'POST', body: { username, password }, auth: false },
  );

  if (res.success && res.token) setToken(res.token);
  return res;
}

export async function logout(): Promise<void> {
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
  } finally {
    setToken(null);
  }
}

export async function me() {
  return requestJson<{ success: boolean; user?: ApiUser; error?: string }>('/api/auth/me');
}

// Clients
export async function getClients(search: string) {
  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  const res = await requestJson<{ success: boolean; clients: any[] }>(`/api/clients?${qs.toString()}`);
  return res.clients;
}

export async function deleteClient(id: number) {
  return requestJson<{ success: boolean; error?: string }>(`/api/clients/${id}`, { method: 'DELETE' });
}

// Inventory
export async function getProducts(search: string) {
  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  const res = await requestJson<{ success: boolean; products: any[] }>(`/api/inventory/products?${qs.toString()}`);
  return res.products;
}

export type ProductWriteResult = {
  success: boolean;
  id?: number;
  error?: string;
  code?: string;
  suggested_barcode?: string;
};

export async function createProduct(payload: any): Promise<ProductWriteResult> {
  return requestJson<ProductWriteResult>(`/api/inventory/products`, { method: 'POST', body: payload });
}

export async function updateProduct(id: number, payload: any): Promise<ProductWriteResult> {
  return requestJson<ProductWriteResult>(`/api/inventory/products/${id}`, { method: 'PUT', body: payload });
}

export async function deleteProduct(id: number): Promise<ProductWriteResult> {
  return requestJson<ProductWriteResult>(`/api/inventory/products/${id}`, { method: 'DELETE' });
}

// Sales
export async function getDrafts() {
  const res = await requestJson<{ success: boolean; drafts: any[] }>(`/api/sales/drafts`);
  return res.drafts;
}

export type ProcessSaleResult = {
  success: boolean;
  saleId?: number;
  error?: string;
};

export async function processSale(payload: any): Promise<ProcessSaleResult> {
  return requestJson<ProcessSaleResult>(`/api/sales/process`, { method: 'POST', body: payload });
}

// Debts
export async function getDebtors() {
  const res = await requestJson<{ success: boolean; debtors: any[] }>(`/api/debts/debtors`);
  return res.debtors;
}

export async function getClientDebtHistory(clientId: number) {
  const res = await requestJson<{ success: boolean; history: any[] }>(`/api/debts/clients/${clientId}/history`);
  return res.history;
}

export async function getClientDebtTotal(clientId: number) {
  const res = await requestJson<{ success: boolean; total: number }>(`/api/debts/clients/${clientId}/total`);
  return res.total;
}

export async function addRepayment(payload: any) {
  return requestJson<{ success: boolean; error?: string }>(`/api/debts/repayments`, { method: 'POST', body: payload });
}

// Exchange
export async function getExchangeRates() {
  const res = await requestJson<{ success: boolean; rates: any[] }>(`/api/exchange/rates`);
  return res.rates;
}

export async function getCurrenciesList() {
  const res = await requestJson<{ success: boolean; currencies: any[] }>(`/api/exchange/currencies`);
  return res.currencies;
}

export async function getExchangeHistory(limit?: number) {
  const qs = new URLSearchParams();
  if (limit) qs.set('limit', String(limit));
  const res = await requestJson<{ success: boolean; history: any[] }>(`/api/exchange/history?${qs.toString()}`);
  return res.history;
}

export async function addExchangeTransaction(payload: any) {
  return requestJson<{ success: boolean; id?: number; error?: string }>(`/api/exchange/transactions`, { method: 'POST', body: payload });
}

// Expenses
export async function getTodayExpenses() {
  const res = await requestJson<{ success: boolean; expenses: any[] }>(`/api/expenses/today`);
  return res.expenses;
}

export async function addExpense(payload: any) {
  return requestJson<{ success: boolean; id?: number; error?: string }>(`/api/expenses`, { method: 'POST', body: payload });
}

export async function deleteExpense(id: number) {
  return requestJson<{ success: boolean; error?: string }>(`/api/expenses/${id}`, { method: 'DELETE' });
}

// Dashboard
export async function getDashboardStats() {
  const res = await requestJson<{ success: boolean; stats: any }>(`/api/dashboard/stats`);
  return res.stats;
}

export async function getProfitSalesChart(type: 'Sales' | 'Profit') {
  const qs = new URLSearchParams({ type });
  const res = await requestJson<{ success: boolean; chart: any[] }>(`/api/dashboard/chart?${qs.toString()}`);
  return res.chart;
}

export async function getTodaysSales() {
  const res = await requestJson<{ success: boolean; sales: any[] }>(`/api/dashboard/todays-sales`);
  return res.sales;
}

export async function getDrawerBalances() {
  const res = await requestJson<{ success: boolean; balances: any }>(`/api/dashboard/drawer-balances`);
  return res.balances;
}

export async function getDebtSummary() {
  const res = await requestJson<{ success: boolean; debt: any }>(`/api/dashboard/debt-summary`);
  return res.debt;
}

export async function getInventoryStockStats() {
  const res = await requestJson<{ success: boolean; stats: any }>(`/api/dashboard/inventory-stock-stats`);
  return res.stats;
}

export async function getMonthlyPL(month: string) {
  const qs = new URLSearchParams({ month });
  const res = await requestJson<{ success: boolean; pl: any }>(`/api/dashboard/monthly-pl?${qs.toString()}`);
  return res.pl;
}

// Settings
export async function getAllSettings() {
  if (isElectron()) {
    return (window as any).api.settings.getAll();
  }
  const res = await requestJson<{ success: boolean; settings: any[] }>(`/api/settings`);
  return res.settings;
}

export async function getSetting(key: string) {
  if (isElectron()) {
    return (window as any).api.settings.get(key);
  }
  const res = await requestJson<{ success: boolean; setting: any }>(`/api/settings/${key}`);
  return res.setting;
}

export async function updateSetting(key: string, value: string) {
  if (isElectron()) {
    return (window as any).api.settings.update(key, value);
  }
  return requestJson<{ success: boolean; error?: string }>(`/api/settings/${key}`, { 
    method: 'PUT', 
    body: { value } 
  });
}

// Recharge
export async function getRechargeStock() {
  if (isElectron()) {
    return (window as any).api.getRechargeStock();
  }
  const res = await requestJson<{ success: boolean; stock: any }>(`/api/recharge/stock`);
  return res.stock;
}

export async function processRecharge(payload: any) {
  if (isElectron()) {
    return (window as any).api.processRecharge(payload);
  }
  return requestJson<{ success: boolean; error?: string }>(`/api/recharge/process`, { 
    method: 'POST', 
    body: payload 
  });
}

// Services (OMT/Whish/BOB)
export async function getOMTHistory(provider?: string) {
  if (isElectron()) {
    return (window as any).api.getOMTHistory(provider);
  }
  const qs = new URLSearchParams();
  if (provider) qs.set('provider', provider);
  const res = await requestJson<{ success: boolean; history: any[] }>(`/api/services/history?${qs.toString()}`);
  return res.history;
}

export async function getOMTAnalytics() {
  if (isElectron()) {
    return (window as any).api.getOMTAnalytics();
  }
  const res = await requestJson<{ success: boolean; analytics: any }>(`/api/services/analytics`);
  return res.analytics;
}

export async function addOMTTransaction(payload: any) {
  if (isElectron()) {
    return (window as any).api.addOMTTransaction(payload);
  }
  return requestJson<{ success: boolean; error?: string; id?: number }>(`/api/services/transactions`, { 
    method: 'POST', 
    body: payload 
  });
}

// Maintenance
export async function getMaintenanceJobs(statusFilter?: string) {
  if (isElectron()) {
    return (window as any).api.getMaintenanceJobs(statusFilter);
  }
  const qs = new URLSearchParams();
  if (statusFilter) qs.set('status', statusFilter);
  const res = await requestJson<{ success: boolean; jobs: any[] }>(`/api/maintenance/jobs?${qs.toString()}`);
  return res.jobs;
}

export async function saveMaintenanceJob(payload: any) {
  if (isElectron()) {
    return (window as any).api.saveMaintenanceJob(payload);
  }
  return requestJson<{ success: boolean; error?: string; id?: number }>(`/api/maintenance/jobs`, { 
    method: 'POST', 
    body: payload 
  });
}

export async function deleteMaintenanceJob(id: number) {
  if (isElectron()) {
    return (window as any).api.deleteMaintenanceJob(id);
  }
  return requestJson<{ success: boolean; error?: string }>(`/api/maintenance/jobs/${id}`, { 
    method: 'DELETE' 
  });
}

// Currencies
export async function getCurrencies() {
  if (isElectron()) {
    return (window as any).api.currencies.list();
  }
  const res = await requestJson<{ success: boolean; currencies: any[] }>(`/api/currencies`);
  return res.currencies;
}

// ==================== Closing API ====================

export async function getSystemExpectedBalances() {
  if (isElectron()) {
    return (window as any).api.closing.getSystemExpectedBalances();
  }
  const res = await requestJson<{ success: boolean; balances: any }>('/api/closing/system-expected-balances');
  return res.balances;
}

export async function hasOpeningBalanceToday() {
  if (isElectron()) {
    return (window as any).api.closing.hasOpeningBalanceToday();
  }
  const res = await requestJson<{ success: boolean; hasOpening: boolean }>('/api/closing/has-opening-balance-today');
  return res.hasOpening;
}

export async function getDailyStatsSnapshot() {
  if (isElectron()) {
    return (window as any).api.closing.getDailyStatsSnapshot();
  }
  const res = await requestJson<{ success: boolean; stats: any }>('/api/closing/daily-stats-snapshot');
  return res.stats;
}

export async function setOpeningBalances(data: {
  closing_date: string;
  amounts: any[];
  user_id?: number;
}) {
  if (isElectron()) {
    return (window as any).api.closing.setOpeningBalances(data);
  }
  return requestJson<{ success: boolean; error?: string }>('/api/closing/opening-balances', {
    method: 'POST',
    body: data,
  });
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
  return requestJson<{ success: boolean; id?: number; error?: string }>('/api/closing/daily-closing', {
    method: 'POST',
    body: data,
  });
}

export async function updateDailyClosing(id: number, data: {
  physical_usd?: number;
  physical_lbp?: number;
  physical_eur?: number;
  system_expected_usd?: number;
  system_expected_lbp?: number;
  variance_usd?: number;
  notes?: string;
  report_path?: string;
  user_id?: number;
}) {
  if (isElectron()) {
    return (window as any).api.closing.updateDailyClosing({ id, ...data });
  }
  return requestJson<{ success: boolean; error?: string }>(`/api/closing/daily-closing/${id}`, {
    method: 'PUT',
    body: data,
  });
}

// ==================== Suppliers API ====================

export async function getSuppliers(search?: string) {
  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  const res = await requestJson<{ success: boolean; suppliers: any[] }>(`/api/suppliers?${qs.toString()}`);
  return res.suppliers || [];
}

export async function getSupplierBalances() {
  const res = await requestJson<{ success: boolean; balances: any[] }>('/api/suppliers/balances');
  return res.balances || [];
}

export async function getSupplierLedger(supplierId: number, limit?: number) {
  const qs = new URLSearchParams();
  if (limit) qs.set('limit', limit.toString());
  const res = await requestJson<{ success: boolean; ledger: any[] }>(`/api/suppliers/${supplierId}/ledger?${qs.toString()}`);
  return res.ledger || [];
}

export async function createSupplier(data: {
  name: string;
  contact_name?: string;
  phone?: string;
  note?: string;
}) {
  return requestJson<{ success: boolean; id?: number; error?: string }>('/api/suppliers', {
    method: 'POST',
    body: data,
  });
}

export async function addSupplierLedgerEntry(supplierId: number, data: {
  entry_type: string;
  amount_usd?: number;
  amount_lbp?: number;
  note?: string;
  drawer_name?: string;
}) {
  return requestJson<{ success: boolean; id?: number; error?: string }>(`/api/suppliers/${supplierId}/ledger`, {
    method: 'POST',
    body: data,
  });
}

// ==================== Rates API ====================

export async function getRates() {
  const res = await requestJson<{ success: boolean; rates: any[] }>('/api/rates');
  return res.rates || [];
}

export async function setRate(from_code: string, to_code: string, rate: number) {
  return requestJson<{ success: boolean; error?: string }>('/api/rates', {
    method: 'POST',
    body: { from_code, to_code, rate },
  });
}

// ==================== Users API ====================

export async function getNonAdminUsers() {
  const res = await requestJson<{ success: boolean; users: any[] }>('/api/users/non-admins');
  return res.users || [];
}

export async function createUser(data: {
  username: string;
  password: string;
  role: string;
}) {
  return requestJson<{ success: boolean; id?: number; error?: string }>('/api/users', {
    method: 'POST',
    body: data,
  });
}

export async function setUserActive(userId: number, is_active: boolean) {
  return requestJson<{ success: boolean; error?: string }>(`/api/users/${userId}/active`, {
    method: 'PUT',
    body: { is_active },
  });
}

export async function setUserRole(userId: number, role: string) {
  return requestJson<{ success: boolean; error?: string }>(`/api/users/${userId}/role`, {
    method: 'PUT',
    body: { role },
  });
}

export async function setUserPassword(userId: number, password: string) {
  return requestJson<{ success: boolean; error?: string }>(`/api/users/${userId}/password`, {
    method: 'PUT',
    body: { password },
  });
}

// ==================== Activity API ====================

export async function getRecentActivity(limit: number = 100) {
  const res = await requestJson<{ success: boolean; activities: any[] }>(`/api/activity/recent?limit=${limit}`);
  return res.activities || [];
}

// ==================== Reports API ====================

export async function generatePDF(html: string, filename?: string) {
  return requestJson<{ success: boolean; path?: string; error?: string }>('/api/reports/pdf', {
    method: 'POST',
    body: { html, filename },
  });
}

export async function backupDatabase() {
  return requestJson<{ success: boolean; path?: string; error?: string }>('/api/reports/backup', {
    method: 'POST',
  });
}

export async function listBackups() {
  return requestJson<{ success: boolean; backups?: any[]; error?: string }>('/api/reports/backups');
}

export async function verifyBackup(path: string) {
  return requestJson<{ success: boolean; error?: string }>('/api/reports/backup/verify', {
    method: 'POST',
    body: { path },
  });
}

export async function restoreDatabase(path: string) {
  return requestJson<{ success: boolean; error?: string }>('/api/reports/restore', {
    method: 'POST',
    body: { path },
  });
}

export async function createCurrency(code: string, name: string) {
  return requestJson<{ success: boolean; error?: string; id?: number }>(`/api/currencies`, { 
    method: 'POST', 
    body: { code, name } 
  });
}

export async function updateCurrency(id: number, data: any) {
  return requestJson<{ success: boolean; error?: string }>(`/api/currencies/${id}`, { 
    method: 'PUT', 
    body: data 
  });
}

export async function deleteCurrency(id: number) {
  return requestJson<{ success: boolean; error?: string }>(`/api/currencies/${id}`, { 
    method: 'DELETE' 
  });
}
