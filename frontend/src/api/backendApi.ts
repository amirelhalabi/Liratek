import {
  requestJson,
  setToken,
  getToken,
  isImpersonationActive,
  clearImpersonationSession,
} from "./httpClient";
import { decodeJwtPayload } from "@/shared/utils/jwt";
import type { ProductListFilters } from "@liratek/core";
import type { UnsettledSummary } from "@liratek/ui";

export type { ProductListFilters };

export function isElectron(): boolean {
  // The e2e web-mode `window.api` shim (tests/e2e-electron/helpers/webApiShim.ts)
  // sets this flag so it does NOT masquerade as a real Electron preload bridge:
  // app code keeps taking the HTTP path (identical to shim-absent web mode),
  // while the shim exists only to serve the specs' direct `window.api.*` calls.
  if (typeof window !== "undefined" && (window as any).__LIRATEK_WEB_API_SHIM)
    return false;
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
export type ClientWriteResult = {
  success: boolean;
  id?: number;
  error?: string;
};

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
    const res = await requestJson<
      ClientWriteResult & { data?: { id?: number } }
    >(`/api/clients`, { method: "POST", body });
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

/** Appends a scalar query param ONLY when it carries a value — the REST route
 *  rejects an EMPTY param (`?costMin=`) rather than treating it as absent, so
 *  unset filters must be omitted from the query string entirely. */
function setIfPresent(
  qs: URLSearchParams,
  key: string,
  value: string | number | undefined,
): void {
  if (value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return;
    qs.set(key, String(value));
    return;
  }
  if (value === "") return;
  qs.set(key, value);
}

/**
 * Product list. `filters` is applied SERVER-SIDE (SQL) on both transports, so
 * the returned array is already the filtered set.
 *
 * REST takes `category` / `supplier` as REPEATED params (one per selected
 * value), not a comma-joined list.
 */
export async function getProducts(
  search: string = "",
  filters?: ProductListFilters,
) {
  return ipcOrHttp(
    async () => getElectronApi().inventory.getProducts(search, filters),
    async () => {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (filters) {
        for (const c of filters.categories ?? []) {
          if (c) qs.append("category", c);
        }
        for (const s of filters.suppliers ?? []) {
          if (s) qs.append("supplier", s);
        }
        setIfPresent(qs, "addedFrom", filters.addedFrom);
        setIfPresent(qs, "addedTo", filters.addedTo);
        setIfPresent(qs, "costMin", filters.costMin);
        setIfPresent(qs, "costMax", filters.costMax);
        setIfPresent(qs, "retailMin", filters.retailMin);
        setIfPresent(qs, "retailMax", filters.retailMax);
        setIfPresent(qs, "profitPctMin", filters.profitPctMin);
        setIfPresent(qs, "profitPctMax", filters.profitPctMax);
        setIfPresent(qs, "stockMin", filters.stockMin);
        setIfPresent(qs, "stockMax", filters.stockMax);
      }
      // Route wraps in createSuccessResponse ({success, data:{products}})
      const res = await requestJson<{
        success: boolean;
        error?: string;
        products?: any[];
        data?: { products?: any[] };
      }>(`/api/inventory/products?${qs.toString()}`);
      // A refused call (a filter bound the core schema rejects, a tenant/auth
      // problem) answers `{success:false}` with HTTP 200. Falling through to
      // `?? []` would render that as "no products match" and hide the error;
      // throwing puts web on the SAME path as desktop, where the IPC handler
      // throws and the caller's catch reports it.
      if (res.success === false) {
        throw new Error(res.error ?? "Failed to load products");
      }
      return (res.data ?? res).products ?? [];
    },
  );
}

/** Distinct category / supplier values across the tenant's products — feeds
 *  the inventory filter dropdowns. Reads return the RAW object shape. */
export async function getProductFilterOptions(): Promise<{
  categories: string[];
  suppliers: string[];
}> {
  return ipcOrHttp(
    async () => {
      const res = await getElectronApi().inventory.getProductFilterOptions();
      return {
        categories: res?.categories ?? [],
        suppliers: res?.suppliers ?? [],
      };
    },
    async () => {
      const res = await requestJson<{
        success: boolean;
        categories?: string[];
        suppliers?: string[];
        data?: { categories?: string[]; suppliers?: string[] };
      }>(`/api/inventory/product-filter-options`);
      const payload = res.data ?? res;
      return {
        categories: payload.categories ?? [],
        suppliers: payload.suppliers ?? [],
      };
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
    const res = await requestJson<
      ProductWriteResult & { data?: { id?: number } }
    >(`/api/inventory/products`, { method: "POST", body });
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

export type StockAdjustPayload = {
  id: number;
  newQuantity?: number;
  delta?: number;
  reason: string;
};

export type StockAdjustmentEntity = {
  id: number;
  product_id: number;
  delta: number;
  old_quantity: number;
  new_quantity: number;
  reason: string;
  user_id: number | null;
  username: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * LIRA-077: adjust a product's stock (absolute set via `newQuantity`, or a
 * +/- correction via `delta`), always with a `reason` for the
 * `stock_adjustments` audit trail. `userId` is injected server-side (IPC:
 * auth.userId; REST: req.user) — never sent from here (rule 19c).
 */
export async function adjustStock(
  payload: StockAdjustPayload,
): Promise<{ success: boolean; error?: string }> {
  if (isElectron()) {
    return getElectronApi().inventory.adjustStock(payload);
  }
  try {
    const { id, ...body } = payload;
    return await requestJson<{ success: boolean; error?: string }>(
      `/api/inventory/products/${id}/stock`,
      { method: "POST", body },
    );
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? "Failed to adjust stock" };
  }
}

/** LIRA-077: adjustment audit history — one product, or the most recent
 *  across all products when productId is omitted. */
export async function getStockAdjustments(
  productId?: number,
): Promise<StockAdjustmentEntity[]> {
  return ipcOrHttp(
    async () => getElectronApi().inventory.getStockAdjustments(productId),
    async () => {
      const qs = new URLSearchParams();
      if (productId != null) qs.set("productId", String(productId));
      const res = await requestJson<{
        success: boolean;
        adjustments?: StockAdjustmentEntity[];
        data?: { adjustments?: StockAdjustmentEntity[] };
      }>(`/api/inventory/stock-adjustments?${qs.toString()}`);
      return (res.data ?? res).adjustments ?? [];
    },
  );
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

// Standalone debt write-off (CQ-10, admin-only) — pure forgiveness, no cash
// movement. Envelope { success, id?, error? }.
export async function debtWriteOff(payload: {
  clientId: number;
  // camelCase — matches core's debtWriteOffSchema (validated identically on
  // both IPC and REST; no per-transport field translation here).
  amountUSD: number;
  amountLBP: number;
  reason?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().debt.writeOff(payload),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/debts/write-off`,
        { method: "POST", body: payload },
      ),
  );
}

// Per-currency raw client balance ({success, data:{balance_usd, balance_lbp}}).
export async function getClientBalance(clientId: number) {
  return ipcOrHttp(
    async () => getElectronApi().debt.getClientBalance(clientId),
    async () =>
      requestJson<{
        success: boolean;
        data?: { balance_usd: number; balance_lbp: number };
        error?: string;
      }>(`/api/debts/clients/${clientId}/balance`),
  );
}

// Cash out a client's prepaid credit (drawer OUT).
export async function debtCashOut(payload: any) {
  return ipcOrHttp(
    async () => getElectronApi().debt.cashOut(payload),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/debts/cash-out`,
        { method: "POST", body: payload },
      ),
  );
}

// Manual till-moving account credit/debt entry.
export async function debtAccountEntry(payload: any) {
  return ipcOrHttp(
    async () => getElectronApi().debt.addAccountEntry(payload),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/debts/account-entry`,
        { method: "POST", body: payload },
      ),
  );
}

// Consume a client's prepaid credit balance (mirrors IPC "debt:use-credit" /
// DebtService.useCredit). CQ-9: no REST route existed for this before; zero
// frontend call sites today (grepped — nothing calls
// window.api.debt.useCredit), added for transport parity ahead of a caller.
export async function debtUseCredit(payload: {
  clientId: number;
  amountUsd: number;
  amountLbp: number;
  note?: string;
  transactionTime?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().debt.useCredit(payload),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/debts/use-credit`,
        { method: "POST", body: payload },
      ),
  );
}

// Edit a debt_ledger row's note (mirrors IPC channel "debts:update-metadata",
// exposed at window.api.debt.updateMetadata — note the singular/plural
// SPLIT between the `debt` namespace and its `debts:*` channel name, verified
// against electron-app/preload.ts). CQ-9: no REST route existed for this
// before; zero frontend call sites today (grepped — nothing calls
// window.api.debt.updateMetadata), added for transport parity ahead of a
// caller.
export async function debtUpdateMetadata(payload: {
  id: number;
  note?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().debt.updateMetadata(payload),
    async () =>
      requestJson<{ success: boolean; data?: any; error?: string }>(
        `/api/debts/update-metadata`,
        { method: "POST", body: payload },
      ),
  );
}

// Partners (config CRUD + partner_ledger money writes).
// Reads mirror the IPC handlers' RAW return shape (array / statement object);
// writes return the { success, data? } envelope.
export async function partnersGetAll(includeInactive = false) {
  return ipcOrHttp(
    async () => getElectronApi().partners.getAll(includeInactive),
    async () => {
      const res = await requestJson<{ success: boolean; partners: any[] }>(
        `/api/partners?includeInactive=${includeInactive}`,
      );
      return res.partners;
    },
  );
}

export async function partnersGetById(id: number) {
  return ipcOrHttp(
    async () => getElectronApi().partners.getById(id),
    async () => {
      const res = await requestJson<{ success: boolean; partner?: any }>(
        `/api/partners/${id}`,
      );
      return res.partner;
    },
  );
}

export async function partnersGetAllBalances(includeInactive = false) {
  return ipcOrHttp(
    async () => getElectronApi().partners.getAllBalances(includeInactive),
    async () => {
      const res = await requestJson<{ success: boolean; balances: any[] }>(
        `/api/partners/balances?includeInactive=${includeInactive}`,
      );
      return res.balances;
    },
  );
}

export async function partnersGetBalance(partnerId: number) {
  return ipcOrHttp(
    async () => getElectronApi().partners.getBalance(partnerId),
    async () => {
      const res = await requestJson<{ success: boolean; balance?: any }>(
        `/api/partners/${partnerId}/balance`,
      );
      return res.balance;
    },
  );
}

export async function partnersGetLedger(
  partnerId: number,
  filters?: {
    startDate?: string;
    endDate?: string;
    type?: string;
    mode?: "FOR" | "THROUGH";
    provider?: string;
    direction?: "DEBIT" | "CREDIT";
  },
) {
  return ipcOrHttp(
    async () => getElectronApi().partners.getLedger(partnerId, filters),
    async () => {
      const qs = new URLSearchParams();
      if (filters?.startDate) qs.set("startDate", filters.startDate);
      if (filters?.endDate) qs.set("endDate", filters.endDate);
      if (filters?.type) qs.set("type", filters.type);
      if (filters?.mode) qs.set("mode", filters.mode);
      if (filters?.provider) qs.set("provider", filters.provider);
      if (filters?.direction) qs.set("direction", filters.direction);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const res = await requestJson<{ success: boolean; statement?: any }>(
        `/api/partners/${partnerId}/ledger${suffix}`,
      );
      return res.statement;
    },
  );
}

export async function partnersCreate(payload: any) {
  return ipcOrHttp(
    async () => getElectronApi().partners.create(payload),
    async () =>
      requestJson<{ success: boolean; data?: any; error?: string }>(
        `/api/partners`,
        { method: "POST", body: payload },
      ),
  );
}

export async function partnersUpdate(id: number, payload: any) {
  return ipcOrHttp(
    async () => getElectronApi().partners.update(id, payload),
    async () =>
      requestJson<{ success: boolean; data?: any; error?: string }>(
        `/api/partners/${id}`,
        { method: "PUT", body: payload },
      ),
  );
}

export async function partnersDeactivate(id: number) {
  return ipcOrHttp(
    async () => getElectronApi().partners.deactivate(id),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/partners/${id}/deactivate`,
        { method: "POST" },
      ),
  );
}

export async function partnersActivate(id: number) {
  return ipcOrHttp(
    async () => getElectronApi().partners.activate(id),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/partners/${id}/activate`,
        { method: "POST" },
      ),
  );
}

export async function partnersRecordTransaction(payload: any) {
  return ipcOrHttp(
    async () => getElectronApi().partners.recordTransaction(payload),
    async () =>
      requestJson<{ success: boolean; data?: any; error?: string }>(
        `/api/partners/transactions`,
        { method: "POST", body: payload },
      ),
  );
}

export async function partnersSettle(payload: any) {
  return ipcOrHttp(
    async () => getElectronApi().partners.settle(payload),
    async () =>
      requestJson<{ success: boolean; data?: any; error?: string }>(
        `/api/partners/settle`,
        { method: "POST", body: payload },
      ),
  );
}

// Standalone partner write-off (CQ-10, admin-only) — we forgive what the
// partner owes us. Envelope { success, id?, error? }.
export async function partnerWriteOff(payload: {
  partnerId: number;
  amount_usd: number;
  amount_lbp: number;
  reason?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().partners.writeOff(payload),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/partners/write-off`,
        { method: "POST", body: payload },
      ),
  );
}

// Vouchers (gift cards) — config CRUD; all channels return the service
// envelope directly ({ success, voucher?/vouchers?, error? }).
export async function vouchersGetAll(filters?: {
  status?: string;
  clientId?: number;
}) {
  return ipcOrHttp(
    async () => getElectronApi().vouchers.getAll(filters),
    async () => {
      const qs = new URLSearchParams();
      if (filters?.status) qs.set("status", filters.status);
      if (filters?.clientId != null)
        qs.set("clientId", String(filters.clientId));
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return requestJson<{
        success: boolean;
        vouchers?: any[];
        error?: string;
      }>(`/api/vouchers${suffix}`);
    },
  );
}

export async function vouchersCreate(payload: any) {
  return ipcOrHttp(
    async () => getElectronApi().vouchers.create(payload),
    async () =>
      requestJson<{ success: boolean; voucher?: any; error?: string }>(
        `/api/vouchers`,
        { method: "POST", body: payload },
      ),
  );
}

export async function vouchersValidate(code: string) {
  return ipcOrHttp(
    async () => getElectronApi().vouchers.validate(code),
    async () =>
      requestJson<{ success: boolean; voucher?: any; error?: string }>(
        `/api/vouchers/validate`,
        { method: "POST", body: { code } },
      ),
  );
}

export async function vouchersCancel(id: number) {
  return ipcOrHttp(
    async () => getElectronApi().vouchers.cancel(id),
    async () =>
      requestJson<{ success: boolean; voucher?: any; error?: string }>(
        `/api/vouchers/${id}/cancel`,
        { method: "POST" },
      ),
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
  // EXCHANGE_LOT_SETTLEMENT.md "Named follow-up" F3: the REST route now
  // validates against exchangeSubmitSchema — the same full leg-based
  // contract the IPC handler uses — and calls
  // ExchangeService.addDirectTransaction, so the payload the form already
  // built (leg1/leg2 rates, profits, viaCurrency, payments, ...) travels
  // through unchanged. No more field-stripping, no more server-side rate
  // recompute.
  return requestJson<{
    success: boolean;
    id?: number;
    error?: string;
    // Server-authoritative final transactions.profit_usd — always present
    // on success; the session-link profit stamp must prefer this over both
    // realizedProfitUsd and the client's own pre-submit total.
    bookedProfitUsd?: number;
    realizedProfitUsd?: number;
    lotCoveredQty?: number;
    lotMarketQty?: number;
  }>(`/api/exchange/transactions`, { method: "POST", body: payload });
}

// Edit non-financial metadata (client name / note) on an exchange row — the
// History modal's inline edit (EXCHANGE_LOT_SETTLEMENT.md Phase 5). Was the
// last raw, unguarded `window.api.exchange.updateMetadata()` call in the
// Exchange feature (rule 19a) — no REST twin existed, so editing a history
// row's metadata silently failed in a real browser.
export async function updateExchangeMetadata(payload: {
  id: number;
  client_name?: string;
  note?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().exchange.updateMetadata(payload),
    async () =>
      requestJson<{ success: boolean; data?: any; error?: string }>(
        `/api/exchange/update-metadata`,
        { method: "POST", body: payload },
      ),
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

export type RechargeHistoryEntry = {
  id: number;
  carrier: string;
  recharge_type: string;
  amount: number;
  cost: number;
  price: number;
  default_price_to_client: number | null;
  currency_code: string;
  paid_by: string;
  phone_number: string | null;
  client_id: number | null;
  client_name: string | null;
  note: string | null;
  created_at: string;
  created_by: number;
  edited_by: string | null;
  edited_at: string | null;
  // LIRA-131: mirrors RechargeEntity — now projected by
  // RechargeRepository.getColumns(). Kept here for type completeness (rule
  // 12) even though this passthrough doesn't strip properties at runtime.
  is_refunded?: number;
  refunded_at?: string | null;
};

// MTC/Alfa recharge history for the history tab (Recharge/index.tsx's
// `loadRechargeHistory`). LIRA-103: was a raw, unguarded
// `window.api.recharge.getHistory()` call with no REST twin, so in the
// browser it threw before `setRechargeHistory` ever ran, silently yielding
// an empty history list (wrapped in try/catch, so no crash — just no data).
export async function getRechargeHistory(
  provider: "MTC" | "Alfa",
): Promise<RechargeHistoryEntry[]> {
  if (isElectron()) {
    return (window as any).api.recharge.getHistory(provider);
  }
  const res = await requestJson<{
    success: boolean;
    history: RechargeHistoryEntry[];
  }>(`/api/recharge/history?provider=${encodeURIComponent(provider)}`);
  return res.history;
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

// Funding-source drawer balances for the top-up modal `handleTopUpClick`
// opens — feeds the four top-up arms below. Was a raw, unguarded
// `window.api.recharge.getDrawerBalances()` call with no REST twin, so in
// web mode it threw before the modal ever opened (rule 19 gap).
export async function getRechargeDrawerBalances(): Promise<
  Array<{
    name: string;
    usdBalance: number;
    lbpBalance: number;
    usdtBalance: number;
  }>
> {
  if (isElectron()) {
    return (window as any).api.recharge.getDrawerBalances();
  }
  const res = await requestJson<{
    success: boolean;
    balances: Array<{
      name: string;
      usdBalance: number;
      lbpBalance: number;
      usdtBalance: number;
    }>;
  }>(`/api/recharge/drawer-balances`);
  return res.balances;
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

// CARRIER_LINES_VALIDITY_PLAN.md Phase 8.4 — the remaining three top-up arms
// (Katsh/iPick supplier credit, Whish App via partner, Whish App from a
// client) close the same rule-19 gap `topUpApp` above already had a (dead)
// REST branch for.
export async function topUpFromSupplier(payload: {
  provider: "iPick" | "Katsh";
  amount: number;
  currency: "USD" | "LBP";
}) {
  if (isElectron()) {
    return (window as any).api.recharge.topUpFromSupplier(payload);
  }
  return requestJson<{ success: boolean; error?: string }>(
    `/api/recharge/top-up-from-supplier`,
    {
      method: "POST",
      body: payload,
    },
  );
}

export async function topUpFromPartner(payload: {
  provider: "WHISH_APP";
  partnerId: number;
  amount: number;
  currency: "USD" | "LBP";
}) {
  if (isElectron()) {
    return (window as any).api.recharge.topUpFromPartner(payload);
  }
  return requestJson<{ success: boolean; error?: string }>(
    `/api/recharge/top-up-from-partner`,
    {
      method: "POST",
      body: payload,
    },
  );
}

export async function topUpFromClient(payload: {
  amount: number;
  cashPaid: number;
  currency: "USD" | "LBP";
  clientName?: string;
  clientId?: number;
}) {
  if (isElectron()) {
    return (window as any).api.recharge.topUpFromClient(payload);
  }
  return requestJson<{ success: boolean; error?: string }>(
    `/api/recharge/top-up-from-client`,
    {
      method: "POST",
      body: payload,
    },
  );
}

// Edit non-financial metadata (phone number / client name / note) on a
// recharge row — the History modal's inline edit (LIRA-109). Was the last
// raw, unguarded `window.api.recharge.updateMetadata()` call in the Recharge
// feature: no REST twin existed, so editing a history row's metadata
// silently failed in a real browser (the call site threw before
// `onRefreshHistory` ever ran).
export async function updateRechargeMetadata(payload: {
  id: number;
  phone_number?: string;
  client_name?: string;
  note?: string;
}) {
  if (isElectron()) {
    return (window as any).api.recharge.updateMetadata(payload);
  }
  return requestJson<{ success: boolean; data?: any; error?: string }>(
    `/api/recharge/update-metadata`,
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
  // `code`/`details` surface any AppError's structured payload (general
  // Drawer plan §8.5) on a blocked RECEIVE payout — the route forwards the
  // service result verbatim, so the fields are present on the wire whenever
  // the core layer sets them.
  return requestJson<{
    success: boolean;
    error?: string;
    id?: number;
    code?: string;
    details?: unknown;
  }>(`/api/services/transactions`, {
    method: "POST",
    body: payload,
  });
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

// CQ-9 follow-up (dashboard staleness badges) — mirrors IPC's
// closing:get-last-checkpoint-per-drawer envelope ({success, data}) on both
// transports, unwrapped here so callers get the raw Record directly (matches
// getInitialCheckpointDate's "raw value" convention below). Returns null on
// failure (non-critical read — callers already treat it as such).
export async function getLastCheckpointPerDrawer(): Promise<Record<
  string,
  {
    drawer_name: string;
    checked_at: string;
    amounts: Record<string, { physical: number; expected: number }>;
  }
> | null> {
  if (isElectron()) {
    const res = await (window as any).api.closing.getLastCheckpointPerDrawer();
    return res?.success && res.data ? res.data : null;
  }
  try {
    const res = await requestJson<{
      success: boolean;
      data?: Record<
        string,
        {
          drawer_name: string;
          checked_at: string;
          amounts: Record<string, { physical: number; expected: number }>;
        }
      >;
    }>("/api/closing/last-checkpoint-per-drawer");
    return res.success && res.data ? res.data : null;
  } catch {
    return null;
  }
}

// CQ-9 follow-up — mirrors closing:has-initial-balances-set. The IPC handler
// never throws to its caller; it resolves with a conservative default (false)
// on internal failure. The REST route matches that (always 200), and this
// wrapper additionally swallows any network-level failure to the same
// default, so both transports share one never-rejects contract.
export async function hasInitialBalancesSet(): Promise<boolean> {
  if (isElectron()) {
    return (window as any).api.closing.hasInitialBalancesSet();
  }
  try {
    const res = await requestJson<{ success: boolean; isSet: boolean }>(
      "/api/closing/has-initial-balances-set",
    );
    return res.isSet;
  } catch {
    return false;
  }
}

// CQ-9 follow-up — mirrors closing:has-starting-checkpoint. Conservative
// default on failure is `true` here (opposite of hasInitialBalancesSet above)
// so the session-management setup banner never wrongly fires — matches
// dbHandlers.ts:373-389.
export async function hasStartingCheckpoint(): Promise<boolean> {
  if (isElectron()) {
    return (window as any).api.closing.hasStartingCheckpoint();
  }
  try {
    const res = await requestJson<{ success: boolean; isSet: boolean }>(
      "/api/closing/has-starting-checkpoint",
    );
    return res.isSet;
  } catch {
    return true;
  }
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
  date_from?: string;
  date_to?: string;
  type?: "OPENING" | "CLOSING" | "CHECKPOINT" | "ALL";
  drawer_name?: string;
  user_id?: number;
}) {
  return ipcOrHttp(
    async () => getElectronApi().closing.getCheckpointTimeline(filters),
    async () => {
      const qs = new URLSearchParams();
      if (filters?.date_from) qs.set("date_from", filters.date_from);
      if (filters?.date_to) qs.set("date_to", filters.date_to);
      if (filters?.type) qs.set("type", filters.type);
      if (filters?.drawer_name) qs.set("drawer_name", filters.drawer_name);
      if (filters?.user_id != null) qs.set("user_id", String(filters.user_id));
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return requestJson<{
        success: boolean;
        checkpoints?: any[];
        error?: string;
      }>(`/api/closing/checkpoint-timeline${suffix}`);
    },
  );
}

// Create a unified checkpoint (money write — drawer_balances + payments
// journal reconciliation). Envelope { success, id?, error? }.
export async function createCheckpoint(payload: any) {
  return ipcOrHttp(
    async () => getElectronApi().closing.createCheckpoint(payload),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        "/api/closing/checkpoint",
        { method: "POST", body: payload },
      ),
  );
}

// The setup (initial) checkpoint's closing_date, or null. Raw value (matches IPC).
export async function getInitialCheckpointDate(): Promise<string | null> {
  return ipcOrHttp(
    async () => getElectronApi().closing.getInitialCheckpointDate(),
    async () => {
      const res = await requestJson<{
        success: boolean;
        date?: string | null;
      }>("/api/closing/initial-checkpoint-date");
      return res.date ?? null;
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
  // COMMISSION_AT_SETTLEMENT_PLAN.md D8 — entry mode + audit snapshot of the
  // rate/count used for a new-model (commission_model=1) batch. Ignored for
  // a legacy batch.
  entry_mode?: "LUMP" | "RATE";
  commission_rate?: number;
  commission_unit_count?: number;
  /** Owner follow-up (2026-08-13) — bills-only batch only: 'TOP_UP'
   *  (default) credits the provider's own drawer, 'OTHER_PAYMENT' means
   *  `payments` below carries the real collection legs instead. See
   *  SupplierRepository.SettleTransactionsData for the full contract. */
  commission_collection_mode?: "TOP_UP" | "OTHER_PAYMENT";
  /** @deprecated no longer used to move money — see SupplierRepository.SettleTransactionsData */
  drawer_name?: string;
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

// Pay a supplier down / record a supplier paying us, via payment-method legs
// (CQ-9 — this had NO dual-mode wrapper at all before, so it was `undefined`
// in the browser; useSuppliers.ts called window.api.suppliers.recordCashflow
// directly).
export async function recordSupplierCashflow(data: {
  supplier_id: number;
  direction: "PAY" | "RECEIVE";
  payments: Array<{
    method: string;
    currency_code: string;
    amount: number;
  }>;
  note?: string;
  exchange_rate?: number;
  // CQ-10: bundled discount — PAY direction only (backend rejects it on
  // RECEIVE). Posts a signed-profit 'DISCOUNT' supplier_ledger row.
  discount?: { amount_usd: number; amount_lbp: number; reason?: string };
}) {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.recordCashflow(data),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/suppliers/${data.supplier_id}/cashflow`,
        { method: "POST", body: data },
      ),
  );
}

// Standalone supplier write-off (CQ-10, admin-only) — the supplier forgives
// what we owe them. Envelope { success, id?, error? }.
export async function supplierWriteOff(payload: {
  supplier_id: number;
  amount_usd: number;
  amount_lbp: number;
  reason?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.writeOff(payload),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/suppliers/${payload.supplier_id}/write-off`,
        { method: "POST", body: payload },
      ),
  );
}

// All transactions for a provider (history tab) — wider scope than
// getUnsettledTransactions (settled + unsettled). Raw array, matching IPC.
export async function getAllSupplierTransactions(
  provider: string,
  limit?: number,
) {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.getAllTransactions(provider, limit),
    async () => {
      const qs = new URLSearchParams({ provider });
      if (limit) qs.set("limit", String(limit));
      const res = await requestJson<{ success: boolean; transactions: any[] }>(
        `/api/suppliers/all-transactions?${qs.toString()}`,
      );
      return res.transactions || [];
    },
  );
}

// Per-provider unsettled commission summary (dashboard + profits page).
// NOTE: named to match the pre-existing (until now dead) `(api as
// any).getUnsettledSummary?.()` fallback already written in
// frontend/src/features/dashboard/pages/Dashboard.tsx and
// frontend/src/features/profits/pages/Profits.tsx — those files are outside
// this ticket's ownership (not the suppliers feature) and still gate on raw
// `window.api` truthiness (a separate rule-19a violation), but adding this
// method under the name they already expect means their REST fallback starts
// working the moment the backend route lands, instead of silently resolving
// to `undefined`.
export async function getUnsettledSummary() {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.getUnsettledSummary(),
    async () => {
      const res = await requestJson<{
        success: boolean;
        summary: UnsettledSummary[];
      }>(`/api/suppliers/unsettled-summary`);
      return res.summary || [];
    },
  );
}

// Product-supplier aggregate balances (Inventory-linked suppliers). Raw array.
export async function getSupplierProductBalances() {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.getProductBalances(),
    async () => {
      const res = await requestJson<{ success: boolean; balances: any[] }>(
        `/api/suppliers/product-balances`,
      );
      return res.balances || [];
    },
  );
}

// Inventory items sourced from one product supplier. Raw array.
export async function getSupplierProductItems(supplierId: number) {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.getProductItems(supplierId),
    async () => {
      const res = await requestJson<{ success: boolean; items: any[] }>(
        `/api/suppliers/${supplierId}/product-items`,
      );
      return res.items || [];
    },
  );
}

// Purchase (delivery batch) records for a product supplier. Raw array.
export async function getSupplierPurchases(supplierId: number) {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.getPurchases(supplierId),
    async () => {
      const res = await requestJson<{ success: boolean; purchases: any[] }>(
        `/api/suppliers/${supplierId}/purchases`,
      );
      return res.purchases || [];
    },
  );
}

// Log a delivery batch for a product supplier (FIFO payment coverage).
// NOTE: the core SupplierService.createPurchase return shape is unusual — on
// success it returns the raw SupplierPurchase entity (no `success` wrapper),
// only returning `{ success: false, error }` on failure (see
// packages/core/src/services/SupplierService.ts createPurchase). This wrapper
// passes the result through unchanged on both transports rather than
// reshaping it, matching what the (currently unused-by-the-page)
// useCreatePurchaseMutation hook already expected from the Electron path.
export async function createSupplierPurchase(data: {
  supplier_id: number;
  total_usd: number;
  note?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().suppliers.createPurchase(data),
    async () =>
      requestJson<any>(`/api/suppliers/${data.supplier_id}/purchases`, {
        method: "POST",
        body: data,
      }),
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

/**
 * Resolve the unified transaction for a module row (LIRA-069 W1.c/d) — the
 * History-modal Print button and the auto-print-on-success hook only know
 * the module's own PK (e.g. recharges.id, financial_services.id), never the
 * unified transactions.id `printServiceReceiptByTransaction` needs.
 */
export async function getTransactionBySource(
  sourceTable: string,
  sourceId: number,
) {
  if (isElectron()) {
    return (window as any).api.transactions.getBySource(sourceTable, sourceId);
  }
  const res = await requestJson<{ success: boolean; transaction: any }>(
    `/api/transactions/by-source/${encodeURIComponent(sourceTable)}/${sourceId}`,
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

/** A single operator-chosen refund return leg (LIRA-078 method-override). */
export interface RefundLegOverride {
  method: string;
  currencyCode: string;
  amount: number;
}

/** LIRA-143 phase 5 — the phone-refund UI's per-unit flag override, riding
 *  alongside `refundLegs` on the SAME `refundTransaction` call. */
export interface RefundUnitExtraOverride {
  unit_id: number;
  is_defective?: boolean;
  warranty_override_until?: string | null;
}

/**
 * Refund a transaction. `refundLegs` is optional — omit for the default
 * reversal (mirrors the original payment legs verbatim, pre-LIRA-078
 * behavior, byte-identical); pass one entry per currency to let the operator
 * choose which drawer/method the money returns through instead.
 * `unitExtras` is optional too (LIRA-143 phase 5) — the phone-refund UI's
 * per-unit defective/warranty-override flags, sent on the SAME call.
 */
export async function refundTransaction(
  id: number,
  refundLegs?: RefundLegOverride[],
  unitExtras?: RefundUnitExtraOverride[],
) {
  if (isElectron()) {
    return (window as any).api.transactions.refund(id, refundLegs, unitExtras);
  }
  return requestJson<{ success: boolean; refundId?: number; error?: string }>(
    `/api/transactions/${id}/refund`,
    {
      method: "POST",
      body:
        refundLegs || unitExtras
          ? { refundLegs, refundUnitExtras: unitExtras }
          : undefined,
    },
  );
}

export interface VoidCheckoutGroupResult {
  success: boolean;
  groupId?: string;
  memberCount?: number;
  voidedTransactionIds?: number[];
  reversalIds?: number[];
  error?: string;
}

/**
 * Void every non-voided member of a multi-unit split checkout in ONE
 * transaction (CARRIER_LEGS_VOID_ASYMMETRY.md, design B+). A single void of
 * one member alone (via `voidTransaction`/`refundTransaction` above) is
 * refused by the repository guard — this is the only legitimate way to
 * reverse one.
 */
export async function voidCheckoutGroup(
  groupId: string,
): Promise<VoidCheckoutGroupResult> {
  if (isElectron()) {
    return (window as any).api.transactions.voidCheckoutGroup(groupId);
  }
  return requestJson<VoidCheckoutGroupResult>(
    `/api/transactions/checkout-group/${encodeURIComponent(groupId)}/void`,
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

// ==================== Service Provider API ====================
// FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 4a — the real provider
// list behind the Partners "System Association" dropdown (previously
// hardcoded to `{None, <shop's non-owned system>}`).

export type ServiceProviderEntity = {
  id: number;
  code: string;
  label: string;
  drawer_name: string;
  is_system_provider: number;
  sort_order: number;
  is_active: number;
  is_system: number;
  created_at: string;
};

export async function getActiveServiceProviders(): Promise<
  ServiceProviderEntity[]
> {
  return ipcOrHttp(
    async () => getElectronApi().serviceProviders.listActive(),
    async () => {
      const res = await requestJson<{
        success: boolean;
        providers: ServiceProviderEntity[];
      }>(`/api/service-providers/active`);
      return res.providers;
    },
  );
}

// §5b phase 5 — the write path: ServiceProviderRepository's create/update/
// delete existed since phase 1 but nothing exposed them. See
// ServiceProviderService's own doc comment for the two money-safety
// invariants (new providers always settle to `General`; `code` is never
// editable) enforced at the service layer on BOTH transports.

/** ALL service providers (including inactive/system) — the Settings
 *  management UI. */
export async function getServiceProviders(): Promise<ServiceProviderEntity[]> {
  return ipcOrHttp(
    async () => getElectronApi().serviceProviders.list(),
    async () => {
      const res = await requestJson<{
        success: boolean;
        providers: ServiceProviderEntity[];
      }>(`/api/service-providers`);
      return res.providers;
    },
  );
}

export async function createServiceProvider(data: {
  code: string;
  label: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().serviceProviders.create(data),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/service-providers`,
        {
          method: "POST",
          body: data,
        },
      ),
  );
}

export async function updateServiceProvider(
  id: number,
  data: { label?: string; is_active?: number },
) {
  return ipcOrHttp(
    async () => getElectronApi().serviceProviders.update(id, data),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/service-providers/${id}`,
        {
          method: "PUT",
          body: data,
        },
      ),
  );
}

export async function deleteServiceProvider(id: number) {
  return ipcOrHttp(
    async () => getElectronApi().serviceProviders.delete(id),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/service-providers/${id}`,
        {
          method: "DELETE",
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

export async function getCountableDrawerCurrencies(): Promise<
  Record<string, string[]>
> {
  return ipcOrHttp(
    async () => getElectronApi().currencies.countableDrawerCurrencies(),
    async () => {
      const res = await requestJson<{
        success: boolean;
        drawerCurrencies: Record<string, string[]>;
      }>(`/api/currencies/countable-drawer-currencies`);
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
      return requestJson<{
        success: boolean;
        sessions?: any[];
        error?: string;
      }>(`/api/sessions/by-customer?${qs.toString()}`);
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
  /** External (Cash In) mode only — see ElectronApiAdapter's drawerTopUp doc. */
  extra_currencies?: {
    currency_code: string;
    amount: number;
    /** EXCHANGE_LOT_SETTLEMENT.md Q3, refined 2026-08-23 — operator
     *  cost-basis override, sent only via the modal's "edit" link. */
    acquisition_usd_per_unit?: number;
    /** NEW (2026-08-23 refinement) — live-feed USD-per-unit rate for a
     *  currency with no configured exchange_rates row. */
    market_usd_per_unit_hint?: number;
  }[];
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

/** Generic, reversible cash transfer between any two of the shop's own
 *  drawers (Primary Cash Drawer plan §8.6) — General <-> the primary cash
 *  drawer (OMT_System/Whish_System) is the pair the UI exposes. Replaces the
 *  retired `drawerTopUpFundSystem` (one-directional float-funding, now-
 *  superseded 2026-07-29 model). Both transports return the envelope
 *  verbatim (rule 19c) — including `code: "INSUFFICIENT_DRAWER_FUNDS"` /
 *  `details` when `fromDrawer` can't cover the amount, per plan §8.5. */
export async function transferBetweenDrawers(data: {
  fromDrawer: string;
  toDrawer: string;
  amount_usd: number;
  amount_lbp: number;
  notes?: string;
  transaction_time?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().drawerTopUp.transfer(data),
    async () =>
      requestJson<{
        success: boolean;
        id?: number;
        error?: string;
        code?: string;
        details?: unknown;
      }>("/api/drawer-topup/transfer", { method: "POST", body: data }),
  );
}

// ── Drawer cash-out (dual-mode) — pull physical cash OUT of the General drawer ──

export async function drawerCashoutCreate(data: {
  amount_usd: number;
  amount_lbp: number;
  extra_currencies?: { currency_code: string; amount: number }[];
  notes: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().drawerCashout.create(data),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        "/api/drawer-cashout",
        { method: "POST", body: data },
      ),
  );
}

export async function drawerCashoutHistory(limit?: number) {
  return ipcOrHttp(
    async () => getElectronApi().drawerCashout.getHistory(limit),
    async () => {
      const qs = limit ? `?limit=${limit}` : "";
      return requestJson<{ success: boolean; data?: any[]; error?: string }>(
        `/api/drawer-cashout/history${qs}`,
      );
    },
  );
}

// ── Wallet exchange (dual-mode) — convert a provider wallet's OWN USD balance
// to LBP or vice versa (OMT App / Whish App only, never General) ──

export async function walletExchangeCreate(data: {
  drawerName: "OMT_App" | "Whish_App";
  fromCurrency: "USD" | "LBP";
  toCurrency: "USD" | "LBP";
  amountIn: number;
  rate: number;
  note?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().walletExchange.create(data),
    async () =>
      requestJson<{
        success: boolean;
        id?: number;
        amountOut?: number;
        error?: string;
      }>("/api/wallet-exchange", { method: "POST", body: data }),
  );
}

export async function walletExchangeHistory(
  drawerName?: "OMT_App" | "Whish_App",
  limit?: number,
) {
  return ipcOrHttp(
    async () => getElectronApi().walletExchange.getHistory(drawerName, limit),
    async () => {
      const params = new URLSearchParams();
      if (drawerName) params.set("drawerName", drawerName);
      if (limit) params.set("limit", String(limit));
      const qs = params.toString() ? `?${params.toString()}` : "";
      return requestJson<{ success: boolean; data?: any[]; error?: string }>(
        `/api/wallet-exchange/history${qs}`,
      );
    },
  );
}

// ── Exchange lots (dual-mode) — cost-basis lot tracking read/admin API for
// exotic-currency exchange positions (EXCHANGE_LOT_SETTLEMENT.md Phase 4a).
// Reads (preview/positions/breakdown) return the RAW data shape — the
// envelope's `success`/`error` are unwrapped here (throwing on failure, same
// convention as `unwrapIpc`); `adjustLotPosition` is a write and returns the
// envelope untouched. ──

interface LotSettlementResultDto {
  id: number | null;
  lot_id: number | null;
  basis_source: "LOT" | "MARKET";
  qty: number;
  unit_cost_usd: number;
  unit_proceeds_usd: number;
  profit_usd: number;
}

type PreviewLotSettlementResponse =
  | { success: true; lotTracked: false; reason?: "NO_RATE_ANCHOR" }
  | {
      success: true;
      lotTracked: true;
      marketUnitCostUsd: number;
      settlements: LotSettlementResultDto[];
      realizedProfitUsd: number;
      coveredQty: number;
      marketQty: number;
    }
  | { success: false; error: string };

export type LotSettlementPreview =
  | { lotTracked: false; reason?: "NO_RATE_ANCHOR" }
  | {
      lotTracked: true;
      marketUnitCostUsd: number;
      settlements: LotSettlementResultDto[];
      realizedProfitUsd: number;
      coveredQty: number;
      marketQty: number;
    };

export async function previewLotSettlement(data: {
  currencyCode: string;
  qty: number;
  unitProceedsUsd: number;
  /** EXCHANGE_LOT_SETTLEMENT.md — the exchange's fromCurrency, needed so the
   *  server can detect a cross pair (both sides non-USD) with no USD rate
   *  anchor and skip a fabricated preview (reason: "NO_RATE_ANCHOR"). */
  fromCurrency?: string;
}): Promise<LotSettlementPreview> {
  const res = await ipcOrHttp<PreviewLotSettlementResponse>(
    async () => getElectronApi().exchangeLots.preview(data),
    async () =>
      requestJson<PreviewLotSettlementResponse>("/api/exchange-lots/preview", {
        method: "POST",
        body: data,
      }),
  );
  if (!res.success) {
    throw new Error(
      "error" in res ? res.error : "Failed to preview exchange lot settlement",
    );
  }
  return res.lotTracked
    ? {
        lotTracked: true,
        marketUnitCostUsd: res.marketUnitCostUsd,
        settlements: res.settlements,
        realizedProfitUsd: res.realizedProfitUsd,
        coveredQty: res.coveredQty,
        marketQty: res.marketQty,
      }
    : { lotTracked: false, ...(res.reason ? { reason: res.reason } : {}) };
}

export interface LotPositionDto {
  currency_code: string;
  open_qty: number;
  avg_unit_cost_usd: number;
  lot_count: number;
  current_market_unit_usd: number | null;
  unrealized_profit_usd: number | null;
}

export async function getLotPositions(): Promise<LotPositionDto[]> {
  return ipcOrHttp(
    async () => {
      const res = await getElectronApi().exchangeLots.getPositions();
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load exchange lot positions");
      }
      return res.data ?? [];
    },
    async () => {
      const res = await requestJson<{
        success: boolean;
        data?: LotPositionDto[];
        error?: string;
      }>("/api/exchange-lots/positions");
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load exchange lot positions");
      }
      return res.data ?? [];
    },
  );
}

export interface LotSettlementEntityDto extends LotSettlementResultDto {
  tenant_id: number | null;
  settled_by_table: string;
  settled_by_id: number;
  is_refunded: number;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LotSettlementWithLotDto extends LotSettlementEntityDto {
  lot_acquired_at: string | null;
  lot_source_table: string | null;
  lot_source_id: number | null;
}

export interface LotBreakdownDto {
  asSettler: LotSettlementWithLotDto[];
  againstSource: LotSettlementEntityDto[];
}

export async function getLotBreakdown(
  exchangeId: number,
): Promise<LotBreakdownDto> {
  const empty: LotBreakdownDto = { asSettler: [], againstSource: [] };
  return ipcOrHttp(
    async () => {
      const res = await getElectronApi().exchangeLots.getBreakdown(exchangeId);
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load exchange lot breakdown");
      }
      return res.data ?? empty;
    },
    async () => {
      const res = await requestJson<{
        success: boolean;
        data?: LotBreakdownDto;
        error?: string;
      }>(`/api/exchange-lots/breakdown/${exchangeId}`);
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load exchange lot breakdown");
      }
      return res.data ?? empty;
    },
  );
}

export async function adjustLotPosition(data: {
  currencyCode: string;
  qty: number;
  unitCostUsd?: number;
  note?: string;
}) {
  return ipcOrHttp(
    async () => getElectronApi().exchangeLots.adjust(data),
    async () =>
      requestJson<{
        success: boolean;
        data?: {
          adjustment: {
            id: number;
            tenant_id: number | null;
            currency_code: string;
            qty: number;
            unit_cost_usd: number | null;
            note: string | null;
            created_by: string | null;
            created_at: string;
            updated_at: string;
          };
          lot?: {
            id: number;
            tenant_id: number | null;
            currency_code: string;
            drawer_name: string;
            source_type: "EXCHANGE_BUY" | "DRAWER_TOPUP" | "ADJUSTMENT";
            source_table: string | null;
            source_id: number | null;
            original_qty: number;
            remaining_qty: number;
            unit_cost_usd: number;
            acquired_at: string;
            is_voided: number;
            created_at: string;
            updated_at: string;
          };
          consume?: {
            settlements: LotSettlementResultDto[];
            realizedProfitUsd: number;
            coveredQty: number;
            marketQty: number;
          };
        };
        error?: string;
      }>("/api/exchange-lots/adjust", { method: "POST", body: data }),
  );
}

// ── Product Units (LIRA-143 Phase 5 — phone IMEI units & warranty). Reads
// return the RAW data shape (throwing on failure, same convention as the
// exchange-lot reads above); `registerProductUnits`/`deleteProductUnit` are
// writes and return the envelope untouched. ──

export interface ProductUnitDto {
  id: number;
  tenant_id: number | null;
  product_id: number;
  imei: string;
  status: "IN_STOCK" | "SOLD";
  sale_item_id: number | null;
  is_defective: number;
  warranty_override_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductUnitSummaryDto {
  in_stock: number;
  sold: number;
  defective: number;
}

export interface ProductUnitStoryDto extends ProductUnitDto {
  product_name: string | null;
  /** The owning MODEL's warranty term — display-only (decision #4 starts the
   *  warranty clock at the sale), never a coverage claim. */
  product_warranty_months: number | null;
  warranty_until: string | null;
  is_refunded: number | null;
  refunded_quantity: number | null;
  quantity: number | null;
  sold_price_usd: number | null;
  sale_id: number | null;
  sold_at: string | null;
  client_id: number | null;
  client_name: string | null;
  warranty: {
    source: "OVERRIDE" | "REFUND" | "SALE" | null;
    until: string | null;
    state: "COVERED" | "EXPIRED" | "VOID" | "NONE";
  };
}

export interface RegisterProductUnitsResultDto {
  units: ProductUnitDto[];
  drift: { inStockUnits: number; stockQuantity: number; matches: boolean };
}

export async function registerProductUnits(data: {
  product_id: number;
  imeis: string[];
}): Promise<{
  success: boolean;
  data?: RegisterProductUnitsResultDto;
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().productUnits.register(data),
    async () =>
      requestJson("/api/product-units/register", {
        method: "POST",
        body: data,
      }),
  );
}

export async function getProductUnitsForProduct(
  productId: number,
  status?: "IN_STOCK" | "SOLD",
): Promise<ProductUnitDto[]> {
  return ipcOrHttp(
    async () => {
      const res = await getElectronApi().productUnits.getForProduct(
        productId,
        status,
      );
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load product units");
      }
      return res.data ?? [];
    },
    async () => {
      const qs = status ? `?status=${status}` : "";
      const res = await requestJson<{
        success: boolean;
        data?: ProductUnitDto[];
        error?: string;
      }>(`/api/product-units/for-product/${productId}${qs}`);
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load product units");
      }
      return res.data ?? [];
    },
  );
}

/** One row of the Phone Units management view — the unit joined with its
 *  product name, its last sale's provenance, and the computed warranty
 *  verdict. Every sale-side field is `null` for a never-sold unit;
 *  `sale_refunded` is `null` there too (vs `0` = sold, not refunded). */
export interface ProductUnitListRowDto {
  id: number;
  product_id: number;
  imei: string;
  status: "IN_STOCK" | "SOLD";
  is_defective: number;
  warranty_override_until: string | null;
  created_at: string;
  product_name: string;
  /** The owning MODEL's warranty term — display-only, so unsold stock reads
   *  "N mo — starts at sale" rather than "No warranty". */
  product_warranty_months: number | null;
  sale_item_id: number | null;
  sold_at: string | null;
  sold_price_usd: number | null;
  client_name: string | null;
  warranty_until: string | null;
  sale_refunded: 0 | 1 | null;
  warranty: {
    source: "OVERRIDE" | "REFUND" | "SALE" | null;
    until: string | null;
    state: "COVERED" | "EXPIRED" | "VOID" | "NONE";
  };
}

/** `total` is the UNPAGED count over the same filters — the pager's
 *  denominator, not `rows.length`. */
export interface ProductUnitListResultDto {
  rows: ProductUnitListRowDto[];
  total: number;
}

/** Filter/page payload. `limit`/`offset` may be omitted — the shared Zod
 *  schema (`listProductUnitsSchema`) applies 50/0 on BOTH transports. */
export interface ProductUnitListFiltersDto {
  status?: "IN_STOCK" | "SOLD";
  defectiveOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

/** The Phone Units management view read. RAW shape (throws on failure),
 *  same read convention as the fns around it — the caller gets
 *  `{ rows, total }` directly, never the envelope. */
export async function listProductUnits(
  filters: ProductUnitListFiltersDto,
): Promise<ProductUnitListResultDto> {
  return ipcOrHttp(
    async () => {
      const res = await getElectronApi().productUnits.list(filters);
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load product units");
      }
      return res.data ?? { rows: [], total: 0 };
    },
    async () => {
      const res = await requestJson<{
        success: boolean;
        data?: ProductUnitListResultDto;
        error?: string;
      }>("/api/product-units/list", { method: "POST", body: filters });
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load product units");
      }
      return res.data ?? { rows: [], total: 0 };
    },
  );
}

export async function getProductUnitsSummary(
  productIds: number[],
): Promise<Record<number, ProductUnitSummaryDto>> {
  return ipcOrHttp(
    async () => {
      const res = await getElectronApi().productUnits.getSummary(productIds);
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load product unit summary");
      }
      return res.data ?? {};
    },
    async () => {
      const res = await requestJson<{
        success: boolean;
        data?: Record<number, ProductUnitSummaryDto>;
        error?: string;
      }>("/api/product-units/summary", {
        method: "POST",
        body: { product_ids: productIds },
      });
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load product unit summary");
      }
      return res.data ?? {};
    },
  );
}

export async function deleteProductUnit(
  unitId: number,
): Promise<{ success: boolean; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().productUnits.delete(unitId),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/product-units/${unitId}`,
        { method: "DELETE" },
      ),
  );
}

export async function getUnitStory(
  imei: string,
): Promise<ProductUnitStoryDto[]> {
  return ipcOrHttp(
    async () => {
      const res = await getElectronApi().productUnits.getStory(imei);
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load unit story");
      }
      return res.data ?? [];
    },
    async () => {
      const res = await requestJson<{
        success: boolean;
        data?: ProductUnitStoryDto[];
        error?: string;
      }>(`/api/product-units/story?imei=${encodeURIComponent(imei)}`);
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load unit story");
      }
      return res.data ?? [];
    },
  );
}

/** Phase 6 refund UI — the units linked to a sale being refunded (imei +
 *  defective checkbox + warranty-override date per unit). */
export async function getProductUnitsForSaleItems(
  saleItemIds: number[],
): Promise<ProductUnitDto[]> {
  return ipcOrHttp(
    async () => {
      const res =
        await getElectronApi().productUnits.getForSaleItems(saleItemIds);
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load units for sale items");
      }
      return res.data ?? [];
    },
    async () => {
      const res = await requestJson<{
        success: boolean;
        data?: ProductUnitDto[];
        error?: string;
      }>("/api/product-units/for-sale-items", {
        method: "POST",
        body: { sale_item_ids: saleItemIds },
      });
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load units for sale items");
      }
      return res.data ?? [];
    },
  );
}

/** LIRA-143 Phase 3 (owner decision #2): barcode first, then an active
 *  (IN_STOCK) unit IMEI. `matched_unit` is null on a barcode hit. */
export async function resolveScanCode(code: string): Promise<{
  success: boolean;
  data?: { product: any; matched_unit: ProductUnitDto | null } | null;
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().inventory.resolveScanCode(code),
    async () =>
      requestJson(
        `/api/inventory/resolve-scan?code=${encodeURIComponent(code)}`,
      ),
  );
}

// ── Categories (LIRA-143 Phase 5 — Settings manager; decision #9's
// tracks_imei_units toggle). Reads return the RAW data shape; writes return
// the envelope untouched — same convention as the fns above. ──

export interface CategoryDto {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
  tracks_imei_units: number;
}

export async function getCategoriesFull(): Promise<CategoryDto[]> {
  return ipcOrHttp(
    async () => {
      const data = await getElectronApi().inventory.getCategoriesFull();
      return data ?? [];
    },
    async () => {
      const res = await requestJson<{
        success: boolean;
        data?: CategoryDto[];
        error?: string;
      }>("/api/inventory/categories-full");
      if (!res.success) {
        throw new Error(res.error ?? "Failed to load categories");
      }
      return res.data ?? [];
    },
  );
}

export async function createCategory(
  name: string,
): Promise<{ success: boolean; id?: number; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().inventory.createCategory(name),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        "/api/inventory/categories",
        { method: "POST", body: { name } },
      ),
  );
}

export async function updateCategory(
  id: number,
  data: { name?: string; tracks_imei_units?: boolean },
): Promise<{ success: boolean; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().inventory.updateCategory(id, data),
    async () =>
      requestJson<{ success: boolean; error?: string }>(
        `/api/inventory/categories/${id}`,
        { method: "PUT", body: data },
      ),
  );
}

export async function deleteCategory(
  id: number,
): Promise<{ success: boolean; deleted?: boolean; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().inventory.deleteCategory(id),
    async () =>
      requestJson<{ success: boolean; deleted?: boolean; error?: string }>(
        `/api/inventory/categories/${id}`,
        { method: "DELETE" },
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
  /** Operator-edited USD↔LBP rate of record — stamped verbatim onto the
   *  transaction; omitted falls back to a live snapshot rate. */
  exchange_rate?: number;
  partnerId?: number;
  /** LIRA-154: "VIA" is the mirror of "FOR" — the partner performs the
   *  service and we owe them the cost instead. */
  partnerMode?: "FOR" | "VIA";
  /** FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §2 — set only when the
   *  operator picked a product from the inventory SearchBar; decrements 1
   *  unit of stock. Omitted (preset/free-text) -> NULL -> no stock movement. */
  product_id?: number;
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

// LIRA-155 — advance an insurance-style custom service's fulfilment status
// (ORDERED -> ISSUED -> RECEIVED -> DELIVERED). Moves no money; a rejected
// transition (illegal step, not-found, non-tracked row) answers
// { success: false, error } from the server, not a thrown exception.
export async function advanceCustomServiceFulfillment(data: {
  id: number;
  fulfillment_status: "ORDERED" | "ISSUED" | "RECEIVED" | "DELIVERED";
}): Promise<{ success: boolean; data?: unknown; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().customServices.advanceFulfillment(data),
    async () =>
      requestJson<{ success: boolean; data?: unknown; error?: string }>(
        `/api/custom-services/fulfillment`,
        {
          method: "POST",
          body: data,
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

// ==================== Carrier Line API (LIRA W6.a) ====================
// Shop-owned alfa/mtc SIM lines: remaining credits + validity expiry date.
// Informational only — no drawer legs, no checkout/closing involvement.

export type CarrierLineEntity = {
  id: number;
  carrier: "alfa" | "mtc";
  phone_number: string;
  label: string | null;
  credits: number;
  validity_expires_at: string | null;
  notes: string | null;
  is_active: number;
  /** LIRA-090 (v140): 1 if this is the primary line for its carrier.
   *  At most one primary per carrier per tenant. Set via setPrimaryCarrierLine. */
  is_primary: number;
  created_at: string;
  updated_at: string;
};

export type CarrierLineWriteResult = {
  success: boolean;
  data?: CarrierLineEntity;
  error?: string;
};

export async function getActiveCarrierLines(
  carrier: "alfa" | "mtc",
): Promise<CarrierLineEntity[]> {
  return ipcOrHttp(
    async () => {
      const res =
        await getElectronApi().carrierLines.getActiveByCarrier(carrier);
      return res.success ? (res.data ?? []) : [];
    },
    async () => {
      const res = await requestJson<{
        success: boolean;
        data?: CarrierLineEntity[];
      }>(`/api/carrier-lines/active/${carrier}`);
      return res.success ? (res.data ?? []) : [];
    },
  );
}

export async function getAllActiveCarrierLines(): Promise<CarrierLineEntity[]> {
  return ipcOrHttp(
    async () => {
      const res = await getElectronApi().carrierLines.getAllActive();
      return res.success ? (res.data ?? []) : [];
    },
    async () => {
      const res = await requestJson<{
        success: boolean;
        data?: CarrierLineEntity[];
      }>(`/api/carrier-lines/active`);
      return res.success ? (res.data ?? []) : [];
    },
  );
}

export async function getAdminCarrierLines(): Promise<CarrierLineEntity[]> {
  return ipcOrHttp(
    async () => {
      const res = await getElectronApi().carrierLines.getAllAdmin();
      return res.success ? (res.data ?? []) : [];
    },
    async () => {
      const res = await requestJson<{
        success: boolean;
        data?: CarrierLineEntity[];
      }>(`/api/carrier-lines`);
      return res.success ? (res.data ?? []) : [];
    },
  );
}

export async function createCarrierLine(data: {
  carrier: "alfa" | "mtc";
  phone_number: string;
  label?: string | null;
  credits?: number;
  validity_expires_at?: string | null;
  notes?: string | null;
}): Promise<CarrierLineWriteResult> {
  return ipcOrHttp(
    async () => getElectronApi().carrierLines.create(data),
    async () =>
      requestJson<CarrierLineWriteResult>(`/api/carrier-lines`, {
        method: "POST",
        body: data,
      }),
  );
}

export async function updateCarrierLine(
  id: number,
  data: {
    carrier?: "alfa" | "mtc";
    phone_number?: string;
    label?: string | null;
    credits?: number;
    validity_expires_at?: string | null;
    notes?: string | null;
    is_active?: number;
  },
): Promise<CarrierLineWriteResult> {
  return ipcOrHttp(
    async () => getElectronApi().carrierLines.update(id, data),
    async () =>
      requestJson<CarrierLineWriteResult>(`/api/carrier-lines/${id}`, {
        method: "PUT",
        body: data,
      }),
  );
}

/** Recharge-tab inline quick-update: credits and/or a new expiry date. */
export async function updateCarrierLineBalance(
  id: number,
  data: { credits?: number; validity_expires_at?: string | null },
): Promise<CarrierLineWriteResult> {
  return ipcOrHttp(
    async () => getElectronApi().carrierLines.updateBalance(id, data),
    async () =>
      requestJson<CarrierLineWriteResult>(`/api/carrier-lines/${id}/balance`, {
        method: "PUT",
        body: data,
      }),
  );
}

export async function archiveCarrierLine(
  id: number,
): Promise<CarrierLineWriteResult> {
  return ipcOrHttp(
    async () => getElectronApi().carrierLines.archive(id),
    async () =>
      requestJson<CarrierLineWriteResult>(`/api/carrier-lines/${id}/archive`, {
        method: "PUT",
      }),
  );
}

export async function toggleCarrierLineActive(
  id: number,
): Promise<CarrierLineWriteResult> {
  return ipcOrHttp(
    async () => getElectronApi().carrierLines.toggleActive(id),
    async () =>
      requestJson<CarrierLineWriteResult>(
        `/api/carrier-lines/${id}/toggle-active`,
        { method: "PUT" },
      ),
  );
}

/** LIRA-145 — payload for {@link recordCarrierLineUsage}. Runtime twin of
 *  core's `recordCarrierLineUsageSchema` (validators/carrierLine.ts). */
export type CarrierLineUsagePayload = {
  carrierLineId: number;
  /** The line's NEW credit balance, as read off the SIM. A "credits used"
   *  input is resolved to a new balance before it gets here. */
  newCredits: number;
  /** Optimistic-concurrency guard: the balance the form was rendered
   *  against. The server rejects when the stored balance has moved since. */
  expectedCurrentCredits?: number;
  note?: string;
};

/** LIRA-145 — envelope returned by {@link recordCarrierLineUsage}. */
export type CarrierLineUsageResult = {
  success: boolean;
  data?: {
    expenseId: number;
    /** The unified EXPENSE `transactions` row; the `carrier_line_movements`
     *  row hangs off it, which is what makes a void restore the line. */
    transactionId: number;
    /** BOOKED expense magnitude in USD (round2 of the raw delta). */
    creditsUsed: number;
    newCredits: number;
  };
  error?: string;
};

/** LIRA-145: book a shop line's consumed credits as a `Line_Usage` expense.
 *  Everything happens server-side in ONE db transaction — the expense row,
 *  the unified EXPENSE transaction, a single payment leg against the
 *  carrier's credit drawer (no cash drawer moves), and the linked
 *  `carrier_line_movements` row that decrements the line. Face value, USD
 *  only ($1 per credit). Rejections (line missing/inactive, stale
 *  `expectedCurrentCredits`, non-positive delta) come back as
 *  `{ success: false, error }`, never as a throw. */
export async function recordCarrierLineUsage(
  data: CarrierLineUsagePayload,
): Promise<CarrierLineUsageResult> {
  return ipcOrHttp(
    async () => getElectronApi().carrierLines.recordUsage(data),
    async () =>
      requestJson<CarrierLineUsageResult>(`/api/carrier-lines/record-usage`, {
        method: "POST",
        body: data,
      }),
  );
}

// ==================== Mobile Service Item API — admin (LIRA W6.b) ====================
// Scoped to the ops the Settings manager's validity-days/credits editing
// exercises. create/delete/toggle/seed/public-list stay desktop-IPC-only
// (pre-existing gap predating this ticket).

export type MobileServiceItemEntity = {
  id: number;
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: number;
  sell_lbp: number;
  sort_order: number;
  is_active: number;
  validity_days: number | null;
  credits: number | null;
  /** LIRA-090 (v140): LBP cost attributable to validity days alone (spec §2.3).
   *  Null until a shop admin fills in the split. */
  days_cost_lbp: number | null;
  /** LIRA-090 (v140): customer-facing price when only the days are sold. */
  sell_days_lbp: number | null;
  /** LIRA-090 (v140): decision-aid display price for resold recovered credit
   *  (spec §2.4). Null until configured. */
  sell_credit_lbp: number | null;
  /** v160: per-card override of the returnable credit maximum; null = computed. */
  max_returned_credits_usd: number | null;
  created_at: string;
  updated_at: string;
};

export async function getAdminMobileServiceItems(): Promise<
  MobileServiceItemEntity[]
> {
  return ipcOrHttp(
    async () => {
      const res = await getElectronApi().mobileServiceItems.getAllAdmin();
      return res.success ? (res.data ?? []) : [];
    },
    async () => {
      const res = await requestJson<{
        success: boolean;
        data?: MobileServiceItemEntity[];
      }>(`/api/mobile-service-items/admin`);
      return res.success ? (res.data ?? []) : [];
    },
  );
}

export async function getActiveMobileServiceItems(): Promise<
  MobileServiceItemEntity[]
> {
  return ipcOrHttp(
    async () => {
      const res = await getElectronApi().mobileServiceItems.getAll();
      return res.success ? (res.data ?? []) : [];
    },
    async () => {
      const res = await requestJson<{
        success: boolean;
        data?: MobileServiceItemEntity[];
      }>(`/api/mobile-service-items`);
      return res.success ? (res.data ?? []) : [];
    },
  );
}

export async function createMobileServiceItem(data: {
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: number;
  sell_lbp: number;
  sort_order?: number;
  is_active?: number;
  validity_days?: number | null;
  credits?: number | null;
  /** LIRA-090 (v140) Only-Days split columns — nullable, all optional. */
  days_cost_lbp?: number | null;
  sell_days_lbp?: number | null;
  sell_credit_lbp?: number | null;
  /** v160: per-card override of the returnable credit maximum; null = computed. */
  max_returned_credits_usd?: number | null;
}): Promise<{
  success: boolean;
  data?: MobileServiceItemEntity;
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().mobileServiceItems.create(data),
    async () =>
      requestJson<{
        success: boolean;
        data?: MobileServiceItemEntity;
        error?: string;
      }>(`/api/mobile-service-items`, { method: "POST", body: data }),
  );
}

export async function updateMobileServiceItem(
  id: number,
  data: {
    label?: string;
    cost_lbp?: number;
    sell_lbp?: number;
    sort_order?: number;
    is_active?: number;
    validity_days?: number | null;
    credits?: number | null;
    /** LIRA-090 (v140) Only-Days split columns — nullable, all optional. */
    days_cost_lbp?: number | null;
    sell_days_lbp?: number | null;
    sell_credit_lbp?: number | null;
    /** v160: per-card override of the returnable credit maximum; null = computed. */
    max_returned_credits_usd?: number | null;
  },
): Promise<{
  success: boolean;
  data?: MobileServiceItemEntity;
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().mobileServiceItems.update(id, data),
    async () =>
      requestJson<{
        success: boolean;
        data?: MobileServiceItemEntity;
        error?: string;
      }>(`/api/mobile-service-items/${id}`, { method: "PUT", body: data }),
  );
}

/** LIRA-090: get the current primary line for a carrier.
 *  Returns success:false (not an error) when no primary is configured.
 *  Read-only, no role gate. */
export async function getPrimaryCarrierLine(carrier: "alfa" | "mtc"): Promise<{
  success: boolean;
  data?: CarrierLineEntity | null;
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().carrierLines.getPrimary(carrier),
    async () =>
      requestJson<{
        success: boolean;
        data?: CarrierLineEntity | null;
        error?: string;
      }>(`/api/carrier-lines/primary/${carrier}`),
  );
}

/** LIRA-090: designate a line as the primary for its carrier (admin only).
 *  Atomically clears the previous holder. */
export async function setPrimaryCarrierLine(
  id: number,
): Promise<CarrierLineWriteResult> {
  return ipcOrHttp(
    async () => getElectronApi().carrierLines.setPrimary(id),
    async () =>
      requestJson<CarrierLineWriteResult>(
        `/api/carrier-lines/${id}/set-primary`,
        { method: "PUT" },
      ),
  );
}

export type SelfChargeTelecomItemResult = {
  transactionId: number;
  carrierLineId: number;
  costLbp: number;
  creditsAdded: number;
  validityDaysAdded: number;
};

/** LIRA-090 §5.2: charge a telecom catalog item to the shop's own carrier line.
 *  No customer is debited; debits the iPick/Katsh LBP drawer. Admin or staff only. */
export async function selfChargeTelecomItem(data: {
  mobileServiceItemId: number;
  carrierLineId?: number;
  transaction_time?: string;
}): Promise<{
  success: boolean;
  data?: SelfChargeTelecomItemResult;
  error?: string;
}> {
  return ipcOrHttp(
    async () => getElectronApi().financial.selfChargeTelecomItem(data),
    async () =>
      requestJson<{
        success: boolean;
        data?: SelfChargeTelecomItemResult;
        error?: string;
      }>(`/api/services/self-charge`, { method: "POST", body: data }),
  );
}
