import { requestJson, setToken } from './httpClient';

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

export async function getRechargeStock() {
  const res = await requestJson<{ success: boolean; stock: any }>(`/api/dashboard/recharge-stock`);
  return res.stock;
}

export async function getMonthlyPL(month: string) {
  const qs = new URLSearchParams({ month });
  const res = await requestJson<{ success: boolean; pl: any }>(`/api/dashboard/monthly-pl?${qs.toString()}`);
  return res.pl;
}
