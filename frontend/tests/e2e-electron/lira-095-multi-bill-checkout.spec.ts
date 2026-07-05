/**
 * LIRA-095 — Multi-bill checkout (Katsh + iPick), normal + session mode.
 *
 * Several bills staged in the BILL card check out through ONE PaymentSheet
 * payment. Each bill books its OWN FINANCIAL_SERVICE BILL transaction
 * (per-bill supplier commission + its own audit row), but the customer inflow
 * books exactly ONCE: the first bill carries the sheet's legs, the rest are
 * sent with deferPayment (cost + commission only).
 *
 * Rule 17 (fails on the pre-change code): with `deferPayment` absent from
 * FinancialServiceSchema, Zod strips it and every bill after the first
 * re-books its amount through the paidByMethod fallback — the General drawer
 * delta reads sum(bills) + sum(bills[1..]) and the +total assertions below
 * fail. Rule 15: shared accumulating DB → all money assertions are DELTAS
 * snapshotted around the action; rows are matched by IDENTITY (unique client
 * name / session_id), never by position.
 *
 * Session mode: bills defer into the basket (lira-094 flow); the basket books
 * ONE pooled payment and every session row carries the session client
 * (rule 11).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";
import { closeAllActiveSessions } from "./helpers/nav";

test.describe.configure({ retries: 0 });

type TxnRow = {
  id: number;
  type: string;
  client_name?: string | null;
  session_id?: number | null;
  summary?: string | null;
  payments?: Array<{
    method: string;
    currency_code: string;
    amount: number;
    signed_amount?: number;
    direction?: string;
  }>;
};

type DrawerRow = { name: string; usdBalance: number; lbpBalance: number };

type Api = {
  api: {
    mobileServiceItems: {
      getAll: () => Promise<{
        data?: Array<{
          provider: string;
          label: string;
          is_active: number;
          sell_lbp: number;
          cost_lbp: number;
        }>;
      }>;
    };
    recharge: { getDrawerBalances: () => Promise<DrawerRow[]> };
    transactions: { getRecent: (n: number) => Promise<TxnRow[]> };
    suppliers: {
      list: (
        q: string,
        includeInactive: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getBalances: (
        includeInactive: boolean,
      ) => Promise<Array<{ supplier_id: number; total_lbp: number }>>;
    };
    session: {
      start: (d: {
        customer_name: string;
        customer_phone?: string;
        started_by: string;
      }) => Promise<{ success?: boolean; sessionId?: number }>;
      getActive: () => Promise<{ session?: { id: number } }>;
      cartGet: (sessionId: number) => Promise<{
        items: Array<{
          item_id: number;
          module: string;
          label: string;
          amount: number;
          currency: string;
          form_data: string;
          ipc_channel: string;
        }>;
      }>;
      checkout: (d: {
        sessionId: number;
        cartItems: Array<{
          id: number;
          module: string;
          label: string;
          amount: number;
          currency: string;
          formData: Record<string, unknown>;
          ipcChannel: string;
        }>;
        paidByMethod: string;
        payments: Array<{
          method: string;
          currency_code: string;
          amount: number;
          direction: string;
        }>;
        exchangeRate: number;
        userId: number;
      }) => Promise<{ success?: boolean; error?: string }>;
    };
  };
};

let dialogs: string[] = [];

/** Drawer LBP balance by name (recharge API: all drawers, name-keyed). */
async function drawerLbp(page: Page, name: string): Promise<number> {
  return page.evaluate(async (n) => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === n)?.lbpBalance ?? 0;
  }, name);
}

/** Drawer USD balance by name. */
async function drawerUsd(page: Page, name: string): Promise<number> {
  return page.evaluate(async (n) => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === n)?.usdBalance ?? 0;
  }, name);
}

/** Katsh/iPick supplier LBP balance (0 when the supplier doesn't exist yet). */
async function supplierLbp(page: Page, provider: string): Promise<number> {
  return page.evaluate(async (p) => {
    const w = window as unknown as Api;
    const suppliers = await w.api.suppliers.list("", true);
    const supplier = suppliers.find((s) => s.provider === p);
    if (!supplier) return 0;
    const balances = await w.api.suppliers.getBalances(true);
    return balances.find((b) => b.supplier_id === supplier.id)?.total_lbp ?? 0;
  }, provider);
}

const PROVIDER_MARKERS: Record<string, string> = {
  MTC: "#telecom-amount",
  Alfa: "#telecom-amount",
  Katsh: "Search Katsh items",
  iPick: "Search iPick items",
  // Whish App keeps inner-tab state (Transfer/Bills) across navigations —
  // the reliable "provider active" signal is its inner tab row, not the
  // transfer amount input (hidden while Bills mode is selected).
  "Whish App": "btn:Transfer",
  "OMT App": "#transfer-amount",
  Binance: "#crypto-amount",
};

/** Click a recharge provider tab and VERIFY its form rendered. Toasts from a
 *  previous action can sit OVER the tab row and swallow force-clicks (events
 *  go to the element at the coordinates), so wait them out before clicking. */
async function providerTab(page: Page, label: string) {
  const marker = PROVIDER_MARKERS[label];
  for (let attempt = 0; attempt < 4; attempt++) {
    await page
      .locator('[role="alert"]')
      .first()
      .waitFor({ state: "hidden", timeout: 6_000 })
      .catch(() => {});
    const tab = page
      .locator("button")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .first();
    if (attempt === 0) {
      await tab.click({ force: true });
    } else {
      // Retry path: something (session hover popup / toast) is covering the
      // tab's pixels — park the mouse away to dismiss hover overlays, then
      // dispatch a DOM-level click that no overlay can intercept.
      await page.mouse.move(5, 400);
      await tab.evaluate((el) => (el as HTMLButtonElement).click());
    }
    if (!marker) return;
    const target = marker.startsWith("#")
      ? page.locator(marker).first()
      : marker.startsWith("btn:")
        ? page
            .locator("button")
            .filter({ hasText: new RegExp(`^${marker.slice(4)}$`) })
            .first()
        : page.getByPlaceholder(new RegExp(marker, "i")).first();
    // startTransition can take several seconds to commit under full-suite
    // CPU load — escalate the wait instead of assuming the click missed.
    const waitMs = [2_500, 5_000, 10_000, 10_000][attempt] ?? 10_000;
    const ok = await target
      .waitFor({ state: "visible", timeout: waitMs })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  const visibleButtons = await page
    .locator("button:visible")
    .allTextContents()
    .catch(() => [] as string[]);
  const overlay = await page
    .locator("div.fixed.inset-0")
    .first()
    .isVisible({ timeout: 200 })
    .catch(() => false);
  const placeholders = await page
    .locator("input:visible")
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).placeholder))
    .catch(() => [] as string[]);
  throw new Error(
    `Provider tab "${label}" did not activate after 3 clicks. overlay=${overlay} placeholders=${JSON.stringify(placeholders)} buttons=${JSON.stringify(visibleButtons.slice(0, 40))}`,
  );
}

/** The inline BILL card (renders only while the search box is empty). */
function billCard(page: Page) {
  return page
    .locator("div.bg-slate-800")
    .filter({ has: page.getByText("BILL", { exact: true }) })
    .last();
}

/** Stage one bill in normal mode ("Add Bill") and wait for its pending chip. */
async function addBill(
  page: Page,
  provider: string,
  amount: number,
  currency: "USD" | "LBP" = "LBP",
) {
  await page
    .getByPlaceholder(new RegExp(`Search ${provider} items`, "i"))
    .fill("");
  const card = billCard(page);
  // Toggling the currency clears the amount input — switch first, then fill.
  await card
    .getByRole("button", { name: new RegExp(`^${currency}$`) })
    .click();
  await card.locator("input").last().fill(String(amount));
  await card.getByRole("button", { name: /^Add Bill$/ }).click();
  const chip =
    currency === "LBP"
      ? `Pending: ${amount.toLocaleString()} LBP`
      : `Pending: $${amount.toFixed(2)}`;
  await expect(page.getByText(chip)).toBeVisible();
}

/**
 * Open the PaymentSheet, attach a NEW client (name + phone), force the leg
 * back to CASH (both client paths auto-promote to CUSTOMER_ACCOUNT, which the
 * financial-services prepaid-credit gate would reject for a fresh client),
 * and confirm.
 */
async function payCashWithClient(page: Page, name: string, phone: string) {
  await page.getByRole("button", { name: /Proceed to Pay/i }).click();
  await page.getByPlaceholder(/Client name \(optional\)/i).fill(name);
  await page.keyboard.press("Escape"); // dismiss autocomplete dropdown if any
  await page.getByPlaceholder(/Phone number/i).fill(phone);
  // New-client info auto-promotes the payment method to CUSTOMER_ACCOUNT and
  // remounts MultiPaymentInput — wait for it, then switch back to CASH.
  const methodSelect = page.locator('[data-testid^="payment-method-"]').first();
  await expect(methodSelect).toBeVisible();
  await methodSelect.selectOption("CASH");
  await page.getByRole("button", { name: /^Pay / }).click();
}

/** This run's FINANCIAL_SERVICE rows, matched by identity. */
async function fsRows(
  page: Page,
  match: { clientName?: string; sessionId?: number },
): Promise<TxnRow[]> {
  return page.evaluate(async (m) => {
    const w = window as unknown as Api;
    const rows = await w.api.transactions.getRecent(100);
    return rows.filter(
      (r) =>
        r.type === "FINANCIAL_SERVICE" &&
        (m.clientName ? r.client_name === m.clientName : true) &&
        (m.sessionId ? r.session_id === m.sessionId : true),
    );
  }, match);
}

test.describe("LIRA-095 — multi-bill checkout", () => {
  test.beforeEach(({ appPage }) => {
    dialogs = [];
    appPage.on("dialog", (d) => dialogs.push(d.message()));
  });

  test.afterEach(async ({ appPage }) => {
    // Session-leak hygiene: never leave an open session for later specs.
    await closeAllActiveSessions(appPage).catch(() => {});
  });

  test("normal mode: two Katsh bills, one CASH payment, client on both rows", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L095 Katsh ${ts}`;
    const PHONE = `76${String(ts).slice(-6)}`;
    const BILLS = [130_000, 220_000];
    const TOTAL = 350_000;

    await closeAllActiveSessions(appPage);
    await navigateTo(appPage, "/recharge");
    await providerTab(appPage, "Katsh");
    await expect(
      billCard(appPage).getByRole("button", { name: /^Add Bill$/ }),
    ).toBeVisible({ timeout: 20_000 });

    const generalBefore = await drawerLbp(appPage, "General");
    const katshBefore = await drawerLbp(appPage, "Katsh");
    const supplierBefore = await supplierLbp(appPage, "Katsh");

    for (const amount of BILLS) await addBill(appPage, "Katsh", amount);
    await payCashWithClient(appPage, CLIENT, PHONE);

    // Both pending chips clear on success (submit is async after sheet close).
    await expect(appPage.getByText(/^Pending: /)).toHaveCount(0, {
      timeout: 15_000,
    });
    expect(dialogs, "unexpected alerts during checkout").toEqual([]);

    // Customer inflow booked exactly ONCE (the deferPayment guard): +350,000,
    // not +570,000 (pre-change: bill #2 re-booked its 220,000 via fallback).
    expect((await drawerLbp(appPage, "General")) - generalBefore).toBe(TOTAL);
    // Cost outflow books per bill: Katsh drawer down by the full total.
    expect((await drawerLbp(appPage, "Katsh")) - katshBefore).toBe(-TOTAL);
    // Per-bill supplier commission: two SUPPLIER_PAYS_US entries of −20,000
    // (a batched single BILL transaction would book only one and fail here).
    expect((await supplierLbp(appPage, "Katsh")) - supplierBefore).toBe(
      -40_000,
    );

    // Two BILL rows, matched by the unique client (rule 11 propagation).
    const rows = await fsRows(appPage, { clientName: CLIENT });
    expect(rows).toHaveLength(2);
    // BILL summaries carry raw digits: "Katsh BILL: <client> — 130000 LBP".
    const summaries = rows.map((r) => r.summary ?? "").join(" | ");
    for (const amount of BILLS) {
      expect(summaries).toContain(`${amount} LBP`);
    }
    // Customer-facing IN legs across BOTH rows sum to the total, once.
    const inLegs = rows.flatMap((r) =>
      (r.payments ?? []).filter(
        (p) => (p.signed_amount ?? p.amount) > 0 && p.currency_code === "LBP",
      ),
    );
    expect(inLegs.reduce((s, p) => s + Math.abs(p.amount), 0)).toBe(TOTAL);

    // Transactions table renders both amounts and the client (UI-level; the
    // summary column carries the client name and the raw amount).
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");
    const myRows = appPage.locator("tbody tr").filter({ hasText: CLIENT });
    await expect(myRows).toHaveCount(2, { timeout: 15_000 });
    for (const amount of BILLS) {
      await expect(
        myRows.filter({ hasText: `${amount} LBP` }),
      ).toHaveCount(1);
    }
  });

  test("normal mode: two iPick bills, one CASH payment", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L095 iPick ${ts}`;
    const PHONE = `76${String(ts + 1).slice(-6)}`;
    const BILLS = [140_000, 160_000];
    const TOTAL = 300_000;

    await closeAllActiveSessions(appPage);
    await navigateTo(appPage, "/recharge");
    await providerTab(appPage, "iPick");
    await expect(
      billCard(appPage).getByRole("button", { name: /^Add Bill$/ }),
    ).toBeVisible({ timeout: 20_000 });

    const generalBefore = await drawerLbp(appPage, "General");
    const ipickBefore = await drawerLbp(appPage, "iPick");

    for (const amount of BILLS) await addBill(appPage, "iPick", amount);
    await payCashWithClient(appPage, CLIENT, PHONE);

    await expect(appPage.getByText(/^Pending: /)).toHaveCount(0, {
      timeout: 15_000,
    });
    expect(dialogs, "unexpected alerts during checkout").toEqual([]);

    expect((await drawerLbp(appPage, "General")) - generalBefore).toBe(TOTAL);
    expect((await drawerLbp(appPage, "iPick")) - ipickBefore).toBe(-TOTAL);

    const rows = await fsRows(appPage, { clientName: CLIENT });
    expect(rows).toHaveLength(2);
    const summaries = rows.map((r) => r.summary ?? "").join(" | ");
    for (const amount of BILLS) {
      expect(summaries).toContain(`${amount} LBP`);
    }
  });

  test("normal mode: mixed-currency bills (USD + LBP) in one payment", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L095 Mixed ${ts}`;
    const PHONE = `76${String(ts + 3).slice(-6)}`;
    const USD_BILL = 10;
    const LBP_BILL = 300_000;

    await closeAllActiveSessions(appPage);
    await navigateTo(appPage, "/recharge");
    await providerTab(appPage, "Katsh");
    await expect(
      billCard(appPage).getByRole("button", { name: /^Add Bill$/ }),
    ).toBeVisible({ timeout: 20_000 });

    const generalUsdBefore = await drawerUsd(appPage, "General");
    const generalLbpBefore = await drawerLbp(appPage, "General");
    const katshUsdBefore = await drawerUsd(appPage, "Katsh");
    const katshLbpBefore = await drawerLbp(appPage, "Katsh");
    const supplierBefore = await supplierLbp(appPage, "Katsh");

    await addBill(appPage, "Katsh", USD_BILL, "USD");
    await addBill(appPage, "Katsh", LBP_BILL, "LBP");
    await payCashWithClient(appPage, CLIENT, PHONE);

    await expect(appPage.getByText(/^Pending: /)).toHaveCount(0, {
      timeout: 15_000,
    });
    expect(dialogs, "unexpected alerts during checkout").toEqual([]);

    // Each bill's COST books in its own currency regardless of how the
    // customer paid (the sheet total is LBP, USD bill converted at the rate).
    expect((await drawerUsd(appPage, "Katsh")) - katshUsdBefore).toBeCloseTo(
      -USD_BILL,
      2,
    );
    expect((await drawerLbp(appPage, "Katsh")) - katshLbpBefore).toBe(
      -LBP_BILL,
    );
    // Per-bill supplier commission, fixed in LBP regardless of bill currency.
    expect((await supplierLbp(appPage, "Katsh")) - supplierBefore).toBe(
      -40_000,
    );

    const rows = await fsRows(appPage, { clientName: CLIENT });
    expect(rows).toHaveLength(2);
    const summaries = rows.map((r) => r.summary ?? "").join(" | ");
    expect(summaries).toContain(`${USD_BILL} USD`);
    expect(summaries).toContain(`${LBP_BILL} LBP`);

    // Customer inflow booked exactly ONCE: legs live on exactly one row, and
    // the General drawer moved by exactly the customer-facing IN legs, per
    // currency (rate-independent — legs are read back from the rows).
    const rowsWithLegs = rows.filter((r) => (r.payments ?? []).length > 0);
    expect(rowsWithLegs).toHaveLength(1);
    const legs = rows.flatMap((r) => r.payments ?? []);
    const inByCurrency = (code: string) =>
      legs
        .filter(
          (p) => (p.signed_amount ?? p.amount) > 0 && p.currency_code === code,
        )
        .reduce((s, p) => s + Math.abs(p.amount), 0);
    const inLbp = inByCurrency("LBP");
    // The single LBP CASH leg covers both bills, so it exceeds the LBP bill.
    expect(inLbp).toBeGreaterThan(LBP_BILL);
    expect((await drawerLbp(appPage, "General")) - generalLbpBefore).toBe(
      inLbp,
    );
    expect((await drawerUsd(appPage, "General")) - generalUsdBefore).toBeCloseTo(
      inByCurrency("USD"),
      2,
    );
  });

  test("normal mode: catalog item + two bills in ONE payment (items SEND carries the legs)", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L095 ItemBill ${ts}`;
    const PHONE = `76${String(ts + 4).slice(-6)}`;
    const BILLS = [120_000, 180_000];

    await closeAllActiveSessions(appPage);
    await navigateTo(appPage, "/recharge");
    await providerTab(appPage, "Katsh");
    await expect(
      billCard(appPage).getByRole("button", { name: /^Add Bill$/ }),
    ).toBeVisible({ timeout: 20_000 });

    // A cost/price catalog item (cost > 0 keeps the C5 prepaid-units flow:
    // drawer draw-down only, NO per-sale supplier entry).
    const item = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const all = await w.api.mobileServiceItems.getAll();
      return (
        (all.data ?? []).find(
          (i) =>
            i.provider === "Katsh" &&
            i.is_active === 1 &&
            i.sell_lbp > 0 &&
            i.cost_lbp > 0,
        ) ?? null
      );
    });
    expect(item, "no active Katsh cost/price catalog item").not.toBeNull();
    const TOTAL = item!.sell_lbp + BILLS[0] + BILLS[1];

    const generalBefore = await drawerLbp(appPage, "General");
    const katshBefore = await drawerLbp(appPage, "Katsh");
    const supplierBefore = await supplierLbp(appPage, "Katsh");

    // Add the catalog item (search → card click), then the two bills (the
    // addBill helper clears the search so the BILL card renders again).
    await appPage
      .getByPlaceholder(/Search Katsh items/i)
      .fill(item!.label);
    await appPage
      .locator("div.cursor-pointer")
      .filter({ hasText: item!.label })
      .first()
      .click();
    for (const amount of BILLS) await addBill(appPage, "Katsh", amount);
    await payCashWithClient(appPage, CLIENT, PHONE);

    await expect(appPage.getByText(/^Pending: /)).toHaveCount(0, {
      timeout: 15_000,
    });
    expect(dialogs, "unexpected alerts during checkout").toEqual([]);

    // ONE payment for the whole checkout: the items SEND carries the legs and
    // every bill defers — General moves by exactly item price + both bills.
    expect((await drawerLbp(appPage, "General")) - generalBefore).toBe(TOTAL);
    // Provider drawer: item COST + both bill amounts.
    expect((await drawerLbp(appPage, "Katsh")) - katshBefore).toBe(
      -(item!.cost_lbp + BILLS[0] + BILLS[1]),
    );
    // Supplier: ONLY the two per-bill commissions — the cost/price item sale
    // books no per-sale supplier entry (C5 prepaid-units model).
    expect((await supplierLbp(appPage, "Katsh")) - supplierBefore).toBe(
      -40_000,
    );

    // 3 rows (1 SEND + 2 BILL), all carrying the client; legs live on exactly
    // one row — the SEND — and sum to the full checkout total.
    const rows = await fsRows(appPage, { clientName: CLIENT });
    expect(rows).toHaveLength(3);
    const summaries = rows.map((r) => r.summary ?? "").join(" | ");
    for (const amount of BILLS) {
      expect(summaries).toContain(`${amount} LBP`);
    }
    const rowsWithLegs = rows.filter((r) => (r.payments ?? []).length > 0);
    expect(rowsWithLegs).toHaveLength(1);
    expect(rowsWithLegs[0].summary ?? "").toContain("SEND");
    const inLbp = rowsWithLegs[0]
      .payments!.filter(
        (p) => (p.signed_amount ?? p.amount) > 0 && p.currency_code === "LBP",
      )
      .reduce((s, p) => s + Math.abs(p.amount), 0);
    expect(inLbp).toBe(TOTAL);
  });

  test("session mode: Katsh + iPick bills defer to the basket, one pooled payment, client on every row", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CUSTOMER = `L095 Session ${ts}`;
    const PHONE = `76${String(ts + 2).slice(-6)}`;
    const KATSH_BILLS = [111_000, 222_000];
    const IPICK_BILL = 250_000;
    const TOTAL = 583_000;

    await closeAllActiveSessions(appPage);
    const sessionId = await appPage.evaluate(
      async ({ name, phone }) => {
        const w = window as unknown as Api;
        const started = await w.api.session.start({
          customer_name: name,
          customer_phone: phone,
          started_by: "admin",
        });
        return (
          started.sessionId ?? (await w.api.session.getActive()).session?.id
        );
      },
      { name: CUSTOMER, phone: PHONE },
    );
    expect(sessionId).toBeTruthy();

    // Add bills through the real page UI so each page's session branch writes
    // the basket formData (that is what checkout replays verbatim).
    await navigateTo(appPage, "/recharge");
    await providerTab(appPage, "Katsh");
    const sessionAddBill = async (provider: string, amount: number) => {
      await appPage
        .getByPlaceholder(new RegExp(`Search ${provider} items`, "i"))
        .fill("");
      const card = billCard(appPage);
      await expect(
        card.getByRole("button", { name: /Add Bill to Cart/i }),
      ).toBeVisible({ timeout: 20_000 }); // session picked up by the UI
      await card.locator("input").last().fill(String(amount));
      await card.getByRole("button", { name: /Add Bill to Cart/i }).click();
    };
    await sessionAddBill("Katsh", KATSH_BILLS[0]);
    await sessionAddBill("Katsh", KATSH_BILLS[1]);
    await providerTab(appPage, "iPick");
    await sessionAddBill("iPick", IPICK_BILL);

    // Cart-count barrier via IPC (3 basket items).
    await expect
      .poll(
        async () =>
          appPage.evaluate(async (sid) => {
            const w = window as unknown as Api;
            return (await w.api.session.cartGet(sid)).items.length;
          }, sessionId as number),
        { timeout: 15_000 },
      )
      .toBe(3);

    const generalBefore = await drawerLbp(appPage, "General");
    const katshBefore = await drawerLbp(appPage, "Katsh");
    const ipickBefore = await drawerLbp(appPage, "iPick");

    // Checkout the basket through the session IPC (ONE pooled CASH payment).
    const checkout = await appPage.evaluate(
      async ({ sid, total }) => {
        const w = window as unknown as Api;
        const cart = await w.api.session.cartGet(sid);
        return w.api.session.checkout({
          sessionId: sid,
          cartItems: cart.items.map((i) => ({
            id: i.item_id,
            module: i.module,
            label: i.label,
            amount: i.amount,
            currency: i.currency,
            formData: JSON.parse(i.form_data) as Record<string, unknown>,
            ipcChannel: i.ipc_channel,
          })),
          paidByMethod: "CASH",
          payments: [
            {
              method: "CASH",
              currency_code: "LBP",
              amount: total,
              direction: "IN",
            },
          ],
          exchangeRate: 90_000,
          userId: 1,
        });
      },
      { sid: sessionId as number, total: TOTAL },
    );
    expect(checkout?.success, checkout?.error).toBe(true);

    // ONE pooled payment posted once; cost outflows book per provider.
    expect((await drawerLbp(appPage, "General")) - generalBefore).toBe(TOTAL);
    expect((await drawerLbp(appPage, "Katsh")) - katshBefore).toBe(
      -(KATSH_BILLS[0] + KATSH_BILLS[1]),
    );
    expect((await drawerLbp(appPage, "iPick")) - ipickBefore).toBe(-IPICK_BILL);

    // Every session bill row carries the session client (rule 11) and its own
    // amount (identity = this run's session_id, never row position).
    const rows = await fsRows(appPage, { sessionId: sessionId as number });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.client_name).toBe(CUSTOMER);
    }
    const summaries = rows.map((r) => r.summary ?? "").join(" | ");
    for (const amount of [...KATSH_BILLS, IPICK_BILL]) {
      expect(summaries).toContain(`${amount} LBP`);
    }

    // Transactions table: all three amounts + the customer render (UI-level).
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");
    const myRows = appPage.locator("tbody tr").filter({ hasText: CUSTOMER });
    await expect(myRows).toHaveCount(3, { timeout: 15_000 });
    for (const amount of [...KATSH_BILLS, IPICK_BILL]) {
      await expect(
        myRows.filter({ hasText: `${amount} LBP` }),
      ).toHaveCount(1);
    }
  });

  test("single USD bill, NO client: row books with null client and the bill in the summary", async ({
    appPage,
  }) => {
    const USD_BILL = 13.57; // unique amount = this run's row identity

    await navigateTo(appPage, "/recharge");
    await providerTab(appPage, "Katsh");
    await addBill(appPage, "Katsh", USD_BILL, "USD");

    // Pay with the sheet defaults — no client typed anywhere. Wait for the
    // sheet's payment line to mount before confirming (clicking Pay during
    // the slide-in animation lands nowhere).
    await appPage.getByRole("button", { name: /Proceed to Pay/i }).click();
    const method = appPage.locator('[data-testid^="payment-method-"]').first();
    await expect(method).toBeVisible({ timeout: 5_000 });
    // The sheet REMEMBERS the previous payment's method (can be
    // CUSTOMER_ACCOUNT from an earlier client sale) — a clientless payer
    // switches to CASH, exactly like a real operator.
    await method.selectOption("CASH");
    await appPage.getByRole("button", { name: /^Pay / }).click();
    try {
      await expect(appPage.getByText(/^Pending: /)).toHaveCount(0, {
        timeout: 10_000,
      });
    } catch (e) {
      expect(dialogs, "alerts during clientless bill checkout").toEqual([]);
      throw e;
    }

    // The row books clientless (renders "—" in the table) with the bill amount
    // in its summary — and still carries payment legs.
    const row = await appPage.evaluate(async (amt) => {
      const w = window as unknown as Api;
      const rows = await w.api.transactions.getRecent(100);
      return (
        rows.find(
          (r) =>
            r.type === "FINANCIAL_SERVICE" &&
            (r.summary ?? "").includes(String(amt)),
        ) ?? null
      );
    }, USD_BILL);
    expect(row).not.toBeNull();
    expect(row!.client_name ?? null).toBeNull();
    expect(row!.summary ?? "").toMatch(/BILL/i);
    expect(
      (row!.payments ?? []).filter((p) => p.direction === "in").length,
    ).toBeGreaterThan(0);
  });

  test("single LBP bill + client, paid in USD with overpayment change (MultiPaymentInput features)", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L095 Change ${ts}`;
    const PHONE = `76${String(ts + 4).slice(-6)}`;
    const LBP_BILL = 313_000; // unique identity

    await navigateTo(appPage, "/recharge");
    await providerTab(appPage, "Katsh");
    await addBill(appPage, "Katsh", LBP_BILL, "LBP");

    await appPage.getByRole("button", { name: /Proceed to Pay/i }).click();
    await appPage.getByPlaceholder(/Client name \(optional\)/i).fill(CLIENT);
    await appPage.keyboard.press("Escape");
    await appPage.getByPlaceholder(/Phone number/i).fill(PHONE);

    // Exercise the payment form: switch the leg back to CASH (client info
    // auto-promotes to CUSTOMER_ACCOUNT), pay in USD instead of LBP, and
    // OVERPAY — the sheet must produce a change (OUT) leg.
    const sheet = appPage.locator('[data-testid="multi-payment-input"]').last();
    const methodSelect = sheet
      .locator('[data-testid^="payment-method-"]')
      .first();
    await expect(methodSelect).toBeVisible();
    await methodSelect.selectOption("CASH");
    await sheet
      .locator('select:not([data-testid^="payment-method-"])')
      .first()
      .selectOption("USD");
    await sheet.locator('[data-testid^="payment-amount-"]').first().fill("5");
    await expect(sheet.locator('[data-testid="return-change"]')).toBeVisible({
      timeout: 5_000,
    });
    await appPage.getByRole("button", { name: /^Pay / }).click();
    await expect(appPage.getByText(/^Pending: /)).toHaveCount(0, {
      timeout: 10_000,
    });
    expect(dialogs, "unexpected alerts during checkout").toEqual([]);

    // The row: client attached, bill in the summary, an IN leg (the $5) AND an
    // OUT change leg both recorded.
    const rows = await fsRows(appPage, { clientName: CLIENT });
    expect(rows).toHaveLength(1);
    expect(rows[0].summary ?? "").toContain(`${LBP_BILL} LBP`);
    const legs = rows[0].payments ?? [];
    expect(legs.filter((p) => p.direction === "in").length).toBeGreaterThan(0);
    expect(legs.filter((p) => p.direction === "out").length).toBeGreaterThan(
      0,
    );
  });
});
