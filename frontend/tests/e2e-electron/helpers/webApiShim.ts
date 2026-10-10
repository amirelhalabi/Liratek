/**
 * Phase-3 web-mode `window.api` shim.
 *
 * The desktop e2e specs seed/verify money state by calling `window.api.<ns>.<method>`
 * inside `page.evaluate`. In the browser there is no Electron preload bridge, so
 * this installs a browser-side `window.api` that proxies each call to the Express
 * REST backend — letting the IPC-driven specs run UNCHANGED over HTTP.
 *
 * Installed via `context.addInitScript` (web-shared fixture only) so it exists
 * before any app code runs. Two consequences, both handled here:
 *
 *  1. `isElectron()` (== `!!window.api`) flips TRUE app-wide. App code that goes
 *     through `ipcOrHttp` will now try the ipc branch (this shim) first. Unmapped
 *     methods REJECT, so `ipcOrHttp` catches and falls back to HTTP — app pages
 *     keep working on a partial shim. Spec direct-calls (no try/catch) surface a
 *     loud "web-api-shim miss: ns.method" telling you exactly what to map next.
 *  2. The shim implements the IPC CONTRACT (preload.ts): reads return the RAW
 *     value (array / object), writes return the `{ success, ... }` envelope —
 *     because both the specs and the (now-ipc-routed) app expect that shape.
 *     REST paths/verbs MUST match the existing backend/src/api/* routes; field
 *     translations (IPC arg → REST body) are centralized here.
 *
 * Grow the route table per-spec: enable a spec, run it, add whatever it reports
 * missing. Reads unwrap the REST envelope; writes pass it through.
 */
import type { BrowserContext } from "@playwright/test";

export async function installWebApiShim(
  context: BrowserContext,
): Promise<void> {
  await context.addInitScript(webApiShimBody);
}

// Serialized and executed in the browser page context by addInitScript.
// MUST be fully self-contained — browser globals only (fetch, localStorage,
// Proxy), no outer references, no app imports.
function webApiShimBody(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const g = globalThis as any;

  function backendUrl(): string {
    return g.__LIRATEK_BACKEND_URL || "http://127.0.0.1:3000";
  }
  function token(): string | null {
    try {
      return localStorage.getItem("liratek.jwt");
    } catch {
      return null;
    }
  }
  async function rest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const t = token();
    const res = await fetch(backendUrl() + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(t ? { Authorization: "Bearer " + t } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    try {
      return await res.json();
    } catch {
      return { success: false, error: "non-JSON response " + res.status };
    }
  }
  // The web app re-polls sessions only every 120s (desktop: 7s), so a
  // session a spec starts or closes here would stay stale on screen and
  // capture (or miss) the next spec's transactions. visibilitychange is the
  // app's own refresh trigger (SessionContext.tsx).
  function syncSessions(): void {
    try {
      document.dispatchEvent(new Event("visibilitychange"));
    } catch {
      // no document (never in a page) — nothing to refresh
    }
  }
  function qs(params: Record<string, unknown>): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    }
    const s = p.toString();
    return s ? "?" + s : "";
  }

  // "ns.method" -> (args) => Promise. Reads unwrap to raw; writes pass envelope.
  const routes: Record<string, (args: any[]) => Promise<any>> = {
    // ── Debts (the Debts page still has raw window.api ternaries; app.spec
    //    renders it, so the canary needs these mapped) ──
    "debt.getDebtors": async () =>
      (await rest("GET", "/api/debts/debtors")).debtors,
    "debt.getClientHistory": async ([clientId]) =>
      (await rest("GET", `/api/debts/clients/${clientId}/history`)).history,
    "debt.getClientTotal": async ([clientId]) =>
      (await rest("GET", `/api/debts/clients/${clientId}/total`)).total,
    "debt.getClientBalance": async ([clientId]) =>
      rest("GET", `/api/debts/clients/${clientId}/balance`),
    "debt.addRepayment": async ([payload]) =>
      rest("POST", "/api/debts/repayments", payload),
    "debt.addCredit": async ([payload]) =>
      rest("POST", "/api/debts/credit", payload),

    // ── Clients ── create takes whatsapp_opt_in as 0/1 over IPC; the REST
    //    createClientSchema wants a boolean. Normalize the id out of {data:{id}}.
    "clients.create": async ([data]) => {
      const d = (data ?? {}) as Record<string, unknown>;
      const body = {
        ...d,
        ...(d.whatsapp_opt_in != null
          ? { whatsapp_opt_in: Boolean(d.whatsapp_opt_in) }
          : {}),
      };
      const res = await rest("POST", "/api/clients", body);
      const id = res.id ?? res.data?.id;
      return id != null ? { ...res, id } : res;
    },

    // ── Customer sessions ──
    // start: the spec passes { customer_name, started_by }; started_by is
    // IPC-only (REST derives the actor from the JWT) so it's dropped — a real
    // arg→body field translation, not passthrough.
    "session.start": async ([data]) => {
      const { started_by: _b, ...body } = (data ?? {}) as Record<
        string,
        unknown
      >;
      const res = await rest("POST", "/api/sessions/start", body);
      syncSessions();
      return res;
    },
    // close(id, closedBy) — closedBy is IPC-only (JWT actor on REST); drop it.
    "session.close": async ([id]) => {
      const res = await rest("POST", `/api/sessions/${id}/close`);
      syncSessions();
      return res;
    },
    "session.getActiveSessions": async () =>
      rest("GET", "/api/sessions/active-list"),
    "session.getTodayAllSessions": async () =>
      rest("GET", "/api/sessions/today-all"),
    "session.getActive": async () => rest("GET", "/api/sessions/active"),
    "session.cartAdd": async ([sessionId, item]) =>
      rest("POST", `/api/sessions/${sessionId}/cart`, item),
    "session.checkout": async ([data]) =>
      rest("POST", "/api/sessions/checkout", data),

    // ── Suppliers (ledger) — addLedgerEntry is a MONEY path (drawer + supplier
    //    ledger). IPC passes supplier_id INSIDE the object; REST puts it in the
    //    URL — extract it (arg→URL+body translation). ──
    "suppliers.list": async ([search, includeInactive]) =>
      (await rest("GET", "/api/suppliers" + qs({ search, includeInactive })))
        .suppliers,
    "suppliers.getBalances": async ([includeInactive]) =>
      (await rest("GET", "/api/suppliers/balances" + qs({ includeInactive })))
        .balances,
    "suppliers.addLedgerEntry": async ([data]) => {
      const { supplier_id, ...body } = (data ?? {}) as Record<string, unknown>;
      return rest("POST", `/api/suppliers/${supplier_id}/ledger`, body);
    },

    // ── Maintenance (repair jobs) — REST routes already exist. save is a MONEY
    //    path (job → unified transaction + drawers + optional CUSTOMER_ACCOUNT
    //    debt_ledger), routed through the same core MaintenanceService. ──
    "maintenance.getJobs": async ([statusFilter]) =>
      (
        await rest(
          "GET",
          "/api/maintenance/jobs" + qs({ status: statusFilter }),
        )
      ).jobs,
    "maintenance.save": async ([job]) =>
      rest("POST", "/api/maintenance/jobs", job),
    "maintenance.delete": async ([id]) =>
      rest("DELETE", `/api/maintenance/jobs/${id}`),

    // ── Inventory (products) — LIRA-176 8b (lira-web-030): the maintenance
    //    parts spec seeds its own "Parts"-category product directly (the
    //    shared seedProduct() helper hardcodes category "General") and reads
    //    stock back around the attach/refund actions. REST field names differ
    //    from the IPC payload (createProductSchema: cost_price_usd/stock/
    //    min_stock_threshold vs the IPC cost_price/stock_quantity/
    //    min_stock_level) — same remap seedProduct's own web branch does.
    "inventory.createProduct": async ([product]) => {
      const p = (product ?? {}) as Record<string, unknown>;
      // REST answers createSuccessResponse({ id }) = { success, data: { id } };
      // the IPC contract is { success, id } — lift the id to the top level
      // (same normalization as clients.create above).
      const res = await rest("POST", "/api/inventory/products", {
        name: p.name,
        category: p.category,
        ...(p.barcode ? { barcode: p.barcode } : {}),
        cost_price_usd: p.cost_price,
        retail_price_usd: p.retail_price,
        stock: p.stock_quantity ?? 0,
        min_stock_threshold: p.min_stock_level ?? 0,
        // createProductSchema accepts both; dropping them broke lira-143
        // (warranty stamp) and lira-144 (supplier filter) in web mode.
        ...(p.supplier != null ? { supplier: p.supplier } : {}),
        ...(p.warranty_months !== undefined
          ? { warranty_months: p.warranty_months }
          : {}),
      });
      // Error path is createErrorResponse → { success:false, error:{ message } };
      // the IPC contract's `error` is a string.
      if (!res.success) {
        const err = res.error;
        return {
          success: false,
          error: typeof err === "string" ? err : (err?.message ?? String(err)),
        };
      }
      const id = res.id ?? res.data?.id;
      return { success: true, id };
    },
    "inventory.getProduct": async ([id]) =>
      (await rest("GET", `/api/inventory/products/${id}`)).product,

    // ── Transactions (by-source lookup) — LIRA-176 8b: resolve the unified
    //    transaction for a maintenance job the same way the History-modal
    //    Print button does, to read back amount_usd/amount_lbp/profit_usd/
    //    profit_lbp around a parts checkout. ──
    "transactions.getBySource": async ([sourceTable, sourceId]) =>
      (
        await rest(
          "GET",
          `/api/transactions/by-source/${sourceTable}/${sourceId}`,
        )
      ).transaction,

    // ── Dashboard / rates (reads) ──
    "dashboard.getDrawerBalances": async () =>
      (await rest("GET", "/api/dashboard/drawer-balances")).balances,
    "rates.list": async () => (await rest("GET", "/api/rates")).rates,

    // ── Transactions (unified) ──
    "transactions.getRecent": async ([limit, filters]) =>
      (
        await rest(
          "GET",
          "/api/transactions/recent" +
            qs({ limit, ...(filters as Record<string, unknown>) }),
        )
      ).transactions,

    // ── Auth (boot restore) — AuthContext.loadUser gates on RAW `window.api`
    //    (not isElectron()), so under this shim a page reload takes the
    //    desktop branch and calls auth.restoreSession; unmapped, it rejected
    //    and every reload landed on the login screen. Real web users never
    //    hit this (no window.api there). Answer it the way the web branch
    //    does — GET /api/auth/me with the stored JWT — returning the IPC
    //    `{ success, user }` shape with no sessionToken (nothing to store).
    "auth.restoreSession": async () => {
      const res = await rest("GET", "/api/auth/me");
      return res.success && res.user
        ? { success: true, user: res.user }
        : { success: false, error: res.error ?? "No session" };
    },

    // ── LIRA-297 batch: the 15 most-needed unmapped methods across the
    //    desktop specs. Every path below is the one backendApi.ts's own
    //    REST branch calls (the app's source of truth for the web wire
    //    shape). Reads unwrap to the IPC handler's RAW return; writes pass
    //    the envelope through — except where the IPC handler itself returns
    //    an envelope for a read (carrierLines.getAllAdmin,
    //    mobileServiceItems.getAll), which stay enveloped here too. ──

    // Reads — raw (IPC handler returns the service value directly).
    "recharge.getDrawerBalances": async () =>
      (await rest("GET", "/api/recharge/drawer-balances")).balances,
    "partners.getBalance": async ([partnerId]) =>
      (await rest("GET", `/api/partners/${partnerId}/balance`)).balance,
    // IPC throws while profits are locked (requireProfitsGate) — reject the
    // same way instead of unwrapping an envelope to undefined.
    "profits.summary": async ([from, to]) => {
      const r = await rest("GET", "/api/profits/summary" + qs({ from, to }));
      if (r?.success === false || r?.data === undefined)
        throw new Error(r?.error ?? "profits.summary refused");
      return r.data;
    },
    "suppliers.getLedger": async ([supplierId, limit]) =>
      (await rest("GET", `/api/suppliers/${supplierId}/ledger` + qs({ limit })))
        .ledger ?? [],
    "suppliers.getUnsettledTransactions": async ([provider]) =>
      (await rest("GET", "/api/suppliers/unsettled" + qs({ provider })))
        .transactions ?? [],
    "closing.getSystemExpectedBalancesDynamic": async () =>
      (await rest("GET", "/api/closing/system-expected-balances-dynamic"))
        .balances,

    // Reads — enveloped (the IPC handler returns { success, data }).
    // GET /api/carrier-lines is the admin listing (includes archived), the
    // same getAllIncludingInactive() the IPC get-all-admin channel calls.
    "carrierLines.getAllAdmin": async () => rest("GET", "/api/carrier-lines"),
    "mobileServiceItems.getAll": async () =>
      rest("GET", "/api/mobile-service-items"),

    // Writes — envelope passthrough. userId/actor is injected server-side
    // from the JWT on every one of these routes (never sent by the client).
    "omt.addTransaction": async ([payload]) =>
      rest("POST", "/api/services/transactions", payload),
    "partners.create": async ([data]) => rest("POST", "/api/partners", data),
    "recharge.process": async ([payload]) =>
      rest("POST", "/api/recharge/process", payload),
    "loto.sell": async ([data]) => rest("POST", "/api/loto/sell", data),
    "sales.process": async ([payload]) =>
      rest("POST", "/api/sales/process", payload),
    "transactions.void": async ([id]) =>
      rest("POST", `/api/transactions/${id}/void`),
    // IPC is positional (id, refundLegs, unitExtras, exchangeRate,
    // keptChange); REST takes them in the body, with unitExtras renamed to
    // `refundUnitExtras` — same translation backendApi.refundTransaction
    // does. Null/undefined args are dropped (the route validates any key
    // that is present, and a literal null would fail that check).
    "transactions.refund": async ([
      id,
      refundLegs,
      unitExtras,
      exchangeRate,
      keptChange,
    ]) => {
      const body: Record<string, unknown> = {};
      if (refundLegs != null) body.refundLegs = refundLegs;
      if (unitExtras != null) body.refundUnitExtras = unitExtras;
      if (exchangeRate != null) body.exchangeRate = exchangeRate;
      if (keptChange != null) body.keptChange = keptChange;
      return rest(
        "POST",
        `/api/transactions/${id}/refund`,
        Object.keys(body).length ? body : undefined,
      );
    },

    // ── Database reset (LIRA-165) — unlike most reads in this table, both
    //    the IPC preload binding AND the REST route already return the full
    //    `{ success, data?, error? }` envelope verbatim (see
    //    electron-app/preload.ts's `resetPreview`/`reset` and
    //    backend/src/api/databaseReset.ts) — so both map straight through
    //    with no unwrap/rewrap, unlike e.g. `debt.getDebtors` above. ──
    "database.resetPreview": async () =>
      rest("GET", "/api/database/reset/preview"),
    "database.reset": async ([data]) =>
      rest("POST", "/api/database/reset", data),
    // ── LIRA-297 batch B1 — BEGIN (edit only inside your own block) ──
    // Sessions/POS specs. Paths are backendApi.ts's own REST branches.
    // Reads — raw (the IPC handler returns the service value directly).
    "clients.getAll": async ([search]) => {
      // createSuccessResponse wraps it: { success, data: { clients } }.
      const res = await rest("GET", "/api/clients" + qs({ search }));
      return (res.data ?? res).clients ?? [];
    },
    "partners.getAll": async ([includeInactive]) =>
      (
        await rest(
          "GET",
          "/api/partners" + qs({ includeInactive: Boolean(includeInactive) }),
        )
      ).partners,
    "sales.get": async ([saleId]) =>
      (await rest("GET", `/api/sales/${saleId}`)).sale,
    "transactions.getById": async ([id]) =>
      (await rest("GET", `/api/transactions/${id}`)).transaction ?? null,
    "recharge.getHistory": async ([provider]) =>
      (await rest("GET", "/api/recharge/history" + qs({ provider }))).history,
    "omt.getHistory": async ([provider]) =>
      (await rest("GET", "/api/services/history" + qs({ provider }))).history,
    // Read — enveloped: the IPC session:cart:get handler itself returns
    // { success, items }, and so does the REST route.
    "session.cartGet": async ([sessionId]) =>
      rest("GET", `/api/sessions/${sessionId}/cart`),
    // Writes — envelope passthrough (actor injected from the JWT).
    "session.linkTransaction": async ([data]) =>
      rest("POST", "/api/sessions/link-transaction", data),
    "exchange.addTransaction": async ([payload]) =>
      rest("POST", "/api/exchange/transactions", payload),
    "vouchers.create": async ([data]) => rest("POST", "/api/vouchers", data),
    // ── LIRA-297 batch B1 — END ──
    // ── LIRA-297 batch B2 — BEGIN (edit only inside your own block) ──
    // Suppliers / settlement / OMT open-credit account. Paths are the
    // REST branches of backendApi.ts; reads unwrap to the IPC handler's raw
    // return, writes pass the envelope through (userId comes from the JWT).
    "suppliers.getAccountBalances": async () =>
      (await rest("GET", "/api/suppliers/account-balances")).balances ?? [],
    "suppliers.getAccountLedger": async ([accountSupplierId, limit]) =>
      (
        await rest(
          "GET",
          `/api/suppliers/${accountSupplierId}/account-ledger` + qs({ limit }),
        )
      ).ledger ?? [],
    "suppliers.getAccountUnsettled": async ([accountSupplierId]) =>
      (
        await rest(
          "GET",
          `/api/suppliers/${accountSupplierId}/account-unsettled`,
        )
      ).transactions ?? [],
    "suppliers.getUnsettledSummary": async () =>
      (await rest("GET", "/api/suppliers/unsettled-summary")).summary ?? [],
    "suppliers.create": async ([data]) => rest("POST", "/api/suppliers", data),
    // IPC carries supplier_id in the payload; REST also wants it in the URL
    // (backendApi sends it in both places — the route overwrites from :id).
    "suppliers.recordCashflow": async ([data]) =>
      rest(
        "POST",
        `/api/suppliers/${(data as { supplier_id: number }).supplier_id}/cashflow`,
        data,
      ),
    "suppliers.settleTransactions": async ([data]) =>
      rest(
        "POST",
        `/api/suppliers/${(data as { supplier_id: number }).supplier_id}/settle`,
        data,
      ),
    "recharge.topUpFromSupplier": async ([payload]) =>
      rest("POST", "/api/recharge/top-up-from-supplier", payload),
    "recharge.cashoutToSupplier": async ([payload]) =>
      rest("POST", "/api/recharge/cashout-to-supplier", payload),
    // IPC returns the statement raw; REST wraps it as { statement }.
    "partners.getLedger": async ([partnerId, filters]) =>
      (
        await rest(
          "GET",
          `/api/partners/${partnerId}/ledger` +
            qs((filters ?? {}) as Record<string, unknown>),
        )
      ).statement,
    // ── LIRA-297 batch B2 — END ──
    // ── LIRA-297 batch B3 — BEGIN (edit only inside your own block) ──
    // Financial services / recharge / loto. Paths = backendApi.ts REST branches.
    // Reads — raw (IPC handler returns the record/array directly).
    "omt.getById": async ([id]) =>
      (await rest("GET", `/api/services/${id}`)).record ?? null,
    "transactions.getCustomerLegs": async ([id]) =>
      (await rest("GET", `/api/transactions/${id}/customer-legs`)).legs ?? [],
    "transactions.getCashFlowByDate": async ([from, to]) =>
      (
        await rest(
          "GET",
          "/api/transactions/cash-flow-by-date" + qs({ from, to }),
        )
      ).cashFlow ?? [],
    // Enveloped — IPC returns { success, ticket } / { success, reportData },
    // and the REST routes answer the identical top-level shape.
    "loto.get": async ([id]) => rest("GET", `/api/loto/${id}`),
    "loto.report": async ([from, to]) =>
      rest("GET", "/api/loto/report" + qs({ from, to })),
    // Nested namespaces — envelope passthrough; the IPC handlers answer
    // { success, checkpoint } / { success, id, … } and REST the same shape.
    "loto.cashPrize.create": async ([data]) =>
      rest("POST", "/api/loto/cash-prizes", data),
    "loto.checkpoint.create": async ([data]) =>
      rest("POST", "/api/loto/checkpoints", data),
    "loto.checkpoint.get": async ([id]) =>
      rest("GET", `/api/loto/checkpoints/${id}`),
    "loto.checkpoint.settle": async ([data]) =>
      rest("POST", `/api/loto/checkpoints/${data.id}/settle`, data),
    // Write — envelope passthrough ({ success, id, amountOut } on both).
    "walletExchange.create": async ([data]) =>
      rest("POST", "/api/wallet-exchange", data),
    // ── LIRA-297 batch B3 — END ──
    // ── LIRA-297 batch B4 — BEGIN (edit only inside your own block) ──
    // Partners / profits / keep-change / custom services. Paths = the
    // backendApi.ts REST branches. Reused from other blocks (not redefined):
    // partners.getLedger (B2), sales.getItems / transactions.getById /
    // expenses.getToday (B3), suppliers.create (B1), debt.addAccountEntry /
    // paymentMethods.list / auth.createUser / auth.login (B5),
    // profits.passwordStatus / setPassword / unlock (B6).
    // Reads — raw (IPC handler returns the service value directly).
    "profits.byUser": async ([from, to]) =>
      (await rest("GET", "/api/profits/by-user" + qs({ from, to }))).data ?? [],
    "settings.getAll": async () =>
      (await rest("GET", "/api/settings")).settings ?? [],
    // Writes — envelope passthrough (actor injected from the JWT server-side).
    "profits.lock": async () => rest("POST", "/api/profits/lock"),
    "drawerTopUp.create": async ([data]) =>
      rest("POST", "/api/drawer-topup", data),
    "recharge.topUpFromPartner": async ([payload]) =>
      rest("POST", "/api/recharge/top-up-from-partner", payload),
    "recharge.topUpFromClient": async ([payload]) =>
      rest("POST", "/api/recharge/top-up-from-client", payload),
    "customServices.add": async ([data]) =>
      rest("POST", "/api/custom-services", data),
    "customServices.delete": async ([id]) =>
      rest("DELETE", `/api/custom-services/${id}`),
    "partners.recordTransaction": async ([payload]) =>
      rest("POST", "/api/partners/transactions", payload),
    "partners.settle": async ([payload]) =>
      rest("POST", "/api/partners/settle", payload),
    "transactions.voidCheckoutGroup": async ([groupId]) =>
      rest(
        "POST",
        `/api/transactions/checkout-group/${encodeURIComponent(String(groupId))}/void`,
      ),
    // IPC is positional (saleId, saleItemId, refundQuantity, refundLegs,
    // unitExtras, exchangeRate, keptChange); REST takes the rest in the body
    // (same as backendApi.refundSaleItem). Null/undefined optionals dropped.
    "sales.refundItem": async ([
      saleId,
      saleItemId,
      refundQuantity,
      refundLegs,
      unitExtras,
      exchangeRate,
      keptChange,
    ]) => {
      const body: Record<string, unknown> = { saleItemId, refundQuantity };
      if (refundLegs != null) body.refundLegs = refundLegs;
      if (unitExtras != null) body.unitExtras = unitExtras;
      if (exchangeRate != null) body.exchangeRate = exchangeRate;
      if (keptChange != null) body.keptChange = keptChange;
      return rest("POST", `/api/sales/${saleId}/refund-item`, body);
    },
    // ── LIRA-297 batch B4 — END ──
    // ── LIRA-297 batch B5 — BEGIN (edit only inside your own block) ──
    // Debt / closing / exchange / hold money. Paths are backendApi.ts's REST
    // branches. Reads unwrap to the IPC handler's RAW return; reads whose
    // IPC handler itself answers an envelope (holdMoney.*, exchangeLots.*,
    // drawerTopUp.getHistory, closing.getLastCheckpointPerDrawer /
    // getCheckpointTimeline) pass the REST envelope through. Writes pass the
    // envelope through; the actor always comes from the JWT.
    "holdMoney.active": async () => rest("GET", "/api/hold-money/active"),
    "holdMoney.pickups": async ([holdMoneyId]) =>
      rest("GET", `/api/hold-money/${holdMoneyId}/pickups`),
    "holdMoney.create": async ([data]) => rest("POST", "/api/hold-money", data),
    "holdMoney.collect": async ([data]) =>
      rest(
        "POST",
        `/api/hold-money/${(data as { id: number }).id}/collect`,
        data,
      ),
    "holdMoney.voidPickup": async ([pickupId]) =>
      rest("POST", `/api/hold-money/pickups/${pickupId}/void`),

    // IPC takes the bare array and answers { success, result }; REST takes
    // { clients } and answers { success, data: { result } }.
    "clients.importDebts": async ([clients]) => {
      const res = await rest("POST", "/api/clients/import-debts", { clients });
      const result = res.data?.result ?? res.result;
      if (res.success) return { success: true, result };
      const err = res.error;
      return {
        success: false,
        error: typeof err === "string" ? err : (err?.message ?? String(err)),
      };
    },
    "debt.addAccountEntry": async ([payload]) =>
      rest("POST", "/api/debts/account-entry", payload),

    // Closing. createCheckpoint: user_id is IPC-legacy (ignored there too —
    // the actor is the session user); REST takes it from the JWT, so drop it.
    "closing.createCheckpoint": async ([data]) => {
      const { user_id: _u, ...body } = (data ?? {}) as Record<string, unknown>;
      return rest("POST", "/api/closing/checkpoint", body);
    },
    "closing.getCheckpointTimeline": async ([filters]) =>
      rest(
        "GET",
        "/api/closing/checkpoint-timeline" +
          qs((filters ?? {}) as Record<string, unknown>),
      ),
    "closing.getLastCheckpointPerDrawer": async () =>
      rest("GET", "/api/closing/last-checkpoint-per-drawer"),
    // IPC returns the stats object raw (and throws on failure).
    "closing.getDailyStatsSnapshot": async ([input]) => {
      const res = await rest(
        "GET",
        "/api/closing/daily-stats-snapshot" +
          qs({ day: (input as { day?: string } | undefined)?.day }),
      );
      if (!res.success || !res.stats)
        throw new Error(res.error ?? "Failed to get daily stats");
      return res.stats;
    },

    // Expenses — writes.
    "expenses.add": async ([payload]) => rest("POST", "/api/expenses", payload),
    "expenses.delete": async ([id]) => rest("DELETE", `/api/expenses/${id}`),

    // Payment methods — list reads are raw arrays over IPC.
    "paymentMethods.list": async () =>
      (await rest("GET", "/api/payment-methods")).methods,
    "paymentMethods.listActive": async () =>
      (await rest("GET", "/api/payment-methods/active")).methods,
    "paymentMethods.update": async ([id, data]) =>
      rest("PUT", `/api/payment-methods/${id}`, data),

    // Currencies / rates.
    "currencies.list": async () =>
      (await rest("GET", "/api/currencies")).currencies ?? [],
    "currencies.countableDrawerCurrencies": async () =>
      (await rest("GET", "/api/currencies/countable-drawer-currencies"))
        .drawerCurrencies,
    // IPC takes { id, ...fields }; REST puts the id in the URL.
    "currencies.update": async ([data]) => {
      const { id, ...body } = (data ?? {}) as Record<string, unknown>;
      return rest("PUT", `/api/currencies/${id}`, body);
    },
    "rates.set": async ([data]) => rest("POST", "/api/rates", data),

    // Exchange + lots. getHistory is raw over IPC (no limit arg there).
    "exchange.getHistory": async () =>
      (await rest("GET", "/api/exchange/history")).history,
    "exchangeLots.getPositions": async () =>
      rest("GET", "/api/exchange-lots/positions"),
    "exchangeLots.getBreakdown": async ([exchangeId]) =>
      rest("GET", `/api/exchange-lots/breakdown/${exchangeId}`),
    "exchangeLots.adjust": async ([data]) =>
      rest("POST", "/api/exchange-lots/adjust", data),
    "drawerTopUp.getHistory": async ([limit]) =>
      rest("GET", "/api/drawer-topup/history" + qs({ limit })),

    // Users / auth (lira-165 guard). createUser is positional over IPC.
    "auth.createUser": async ([username, password, role]) =>
      rest("POST", "/api/users", { username, password, role }),
    // Deliberately does NOT store the token: the spec decides whether to
    // swap the shared page's `liratek.jwt`. Returns the IPC shape plus the
    // web credential (`token` = the JWT the web app persists); the REST
    // login wraps its payload in `data` and answers a 401 with an
    // `{ code, message }` error object — normalized to the IPC string.
    "auth.login": async ([username, password, rememberMe]) => {
      const res = await fetch(backendUrl() + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, rememberMe }),
      })
        .then((r) => r.json())
        .catch(() => ({ success: false, error: "non-JSON login response" }));
      const p = res.data ?? res;
      if (!res.success) {
        const err = res.error;
        return {
          success: false,
          error: typeof err === "string" ? err : (err?.message ?? String(err)),
        };
      }
      return {
        success: true,
        user: p.user,
        token: p.token,
        sessionToken: p.sessionToken ?? null,
      };
    },
    // mobileServiceItems.create: already mapped in batch B6.
    // ── LIRA-297 batch B5 — END ──
    // ── LIRA-297 batch B6 — BEGIN (edit only inside your own block) ──
    // Inventory / IMEI units / sales reads / telecom. Paths are the REST
    // branches of backendApi.ts. Reads unwrap to the IPC handler's RAW
    // return; writes (and the reads whose IPC handler itself answers an
    // envelope — productUnits.*, mobileServiceItems.*, carrierLines.*)
    // pass the REST envelope through.
    "inventory.getStockAdjustments": async ([productId]) => {
      const res = await rest(
        "GET",
        "/api/inventory/stock-adjustments" + qs({ productId }),
      );
      return (res.data ?? res).adjustments ?? [];
    },
    // getProducts(search, filters): categories/suppliers repeat as
    // `category`/`supplier` query keys — same encoding backendApi uses.
    "inventory.getProducts": async ([search, filters]) => {
      const p = new URLSearchParams();
      if (search) p.set("search", String(search));
      const f = (filters ?? {}) as Record<string, unknown>;
      for (const c of (f.categories as string[] | undefined) ?? [])
        if (c) p.append("category", c);
      for (const s of (f.suppliers as string[] | undefined) ?? [])
        if (s) p.append("supplier", s);
      for (const [k, v] of Object.entries(f)) {
        if (k === "categories" || k === "suppliers") continue;
        if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
      }
      const res = await rest("GET", "/api/inventory/products?" + p.toString());
      if (res.success === false)
        throw new Error(res.error ?? "Failed to load products");
      return (res.data ?? res).products ?? [];
    },
    "inventory.getProductFilterOptions": async () => {
      const res = await rest("GET", "/api/inventory/product-filter-options");
      const d = res.data ?? res;
      return { categories: d.categories ?? [], suppliers: d.suppliers ?? [] };
    },
    "inventory.getCategoriesFull": async () =>
      (await rest("GET", "/api/inventory/categories-full")).data ?? [],
    "inventory.createCategory": async ([name]) =>
      rest("POST", "/api/inventory/categories", { name }),
    "inventory.updateCategory": async ([id, data]) =>
      rest("PUT", `/api/inventory/categories/${id}`, data),

    "productUnits.register": async ([data]) =>
      rest("POST", "/api/product-units/register", data),
    "productUnits.getForProduct": async ([productId, status]) =>
      rest(
        "GET",
        `/api/product-units/for-product/${productId}` + qs({ status }),
      ),
    "productUnits.getStory": async ([imei]) =>
      rest("GET", "/api/product-units/story" + qs({ imei })),

    // sales.get / transactions.getById: already mapped in batch B1.
    "sales.getItems": async ([saleId]) =>
      (await rest("GET", `/api/sales/${saleId}/items`)).items,
    "sales.getTodaysSales": async ([date]) =>
      (await rest("GET", "/api/dashboard/todays-sales" + qs({ date }))).sales,
    // editedBy comes from the JWT on REST (IPC resolves it from the session).
    "sales.updateMetadata": async ([data]) =>
      rest("POST", "/api/sales/update-metadata", data),

    "customServices.list": async ([filter]) =>
      (
        await rest(
          "GET",
          "/api/custom-services" +
            qs((filter ?? {}) as Record<string, unknown>),
        )
      ).services ?? [],
    "expenses.getToday": async () =>
      (await rest("GET", "/api/expenses/today")).expenses,
    "profits.byModule": async ([from, to]) =>
      (await rest("GET", "/api/profits/by-module" + qs({ from, to }))).data ??
      [],

    "mobileServiceItems.getAllAdmin": async () =>
      rest("GET", "/api/mobile-service-items/admin"),
    "mobileServiceItems.count": async () =>
      rest("GET", "/api/mobile-service-items/count"),
    "mobileServiceItems.create": async ([data]) =>
      rest("POST", "/api/mobile-service-items", data),
    "mobileServiceItems.update": async ([id, data]) =>
      rest("PUT", `/api/mobile-service-items/${id}`, data),
    // No REST twin for the IPC get-by-provider-category channel. Its repo
    // query is the active-only getAll() narrowed to provider+category, and
    // getAll()'s ORDER BY (provider, category, subcategory, sort_order,
    // label) reduces to the same order within one provider+category — so
    // filtering GET /api/mobile-service-items returns the identical rows.
    "mobileServiceItems.getByProviderCategory": async ([
      provider,
      category,
    ]) => {
      const res = await rest("GET", "/api/mobile-service-items");
      if (!res.success) return res;
      return {
        success: true,
        data: ((res.data ?? []) as Array<Record<string, unknown>>).filter(
          (i) => i.provider === provider && i.category === category,
        ),
      };
    },

    // Carrier lines — money writes (carrier drawer moves); actor from JWT.
    "carrierLines.create": async ([data]) =>
      rest("POST", "/api/carrier-lines", data),
    "carrierLines.getPrimary": async ([carrier]) =>
      rest("GET", `/api/carrier-lines/primary/${carrier}`),
    "carrierLines.setPrimary": async ([id]) =>
      rest("PUT", `/api/carrier-lines/${id}/set-primary`),
    "carrierLines.recordUsage": async ([data]) =>
      rest("POST", "/api/carrier-lines/record-usage", data),
    "financial.selfChargeTelecomItem": async ([data]) =>
      rest("POST", "/api/services/self-charge", data),
    // Profits gate (fixtures' ensureProfitsUnlocked). passwordStatus is a
    // read: IPC returns the raw { isSet }, REST wraps it in { data }.
    "profits.passwordStatus": async () =>
      (await rest("GET", "/api/profits/password-status")).data,
    "profits.setPassword": async ([password]) =>
      rest("PUT", "/api/profits/password", { password }),
    "profits.unlock": async ([password]) =>
      rest("POST", "/api/profits/unlock", { password }),
    // ── LIRA-297 batch B6 — END ──
  };

  const RESERVED = new Set(["then", "catch", "finally"]);

  // A callable proxy for one dotted key ("ns.method", "ns.sub.method", …):
  // calling it runs the route; reading a property returns the next level
  // (loto.cashPrize.create, loto.checkpoint.settle, …). Function.prototype
  // members (call/apply/bind/length/name) keep their normal meaning.
  const callable = (key: string, last: string): any =>
    new Proxy(function () {}, {
      apply(_t, _this, args: any[]) {
        // Event-subscription methods (onSessionExpired, onUpdateAvailable, …)
        // return an unsubscribe fn SYNCHRONOUSLY in the Electron preload, and
        // callers use the result as a useEffect cleanup. A Promise there makes
        // React call it as destroy() → crash. In web mode these events never
        // fire, so hand back a synchronous no-op unsubscribe.
        if (/^on[A-Z]/.test(last)) return () => {};
        const fn = routes[key];
        if (!fn) return Promise.reject(new Error("web-api-shim miss: " + key));
        return fn(args);
      },
      get(t, prop: string | symbol) {
        // Guard thenable/symbol probes so `await window.api.<ns>` and
        // structuredClone-style introspection don't trigger a bogus call.
        if (typeof prop !== "string" || RESERVED.has(prop)) return undefined;
        if (prop in Function.prototype) return (t as any)[prop];
        return callable(key + "." + prop, prop);
      },
    });

  const nsProxy = (ns: string) =>
    new Proxy(
      {},
      {
        get(_t, method: string | symbol) {
          if (typeof method !== "string" || RESERVED.has(method))
            return undefined;
          return callable(ns + "." + method, method);
        },
      },
    );

  // Marker so the app's isElectron() treats this as web, NOT a real preload
  // bridge — app code keeps using HTTP; only the specs' direct window.api.*
  // calls resolve to this shim.
  g.__LIRATEK_WEB_API_SHIM = true;

  g.api = new Proxy(
    {},
    {
      get(_t, ns: string | symbol) {
        if (typeof ns !== "string" || RESERVED.has(ns)) return undefined;
        return nsProxy(ns);
      },
    },
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
