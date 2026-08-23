/**
 * lira-web-022 — EXCHANGE_LOT_SETTLEMENT.md "Named follow-up" F3, over REST.
 *
 * Proves `POST /api/exchange/transactions` now has FULL parity with the
 * `exchange:add-transaction` IPC handler, closing the three gaps the plan
 * doc named:
 *
 *   1. Role parity: the route was admin-only; the IPC handler has always
 *      allowed staff. Every submit in this file authenticates as staff.
 *   2. Envelope parity: the route returned HTTP 400 on failure; rule 19c
 *      requires HTTP 200 + `{ success: false, error }` always, matching IPC.
 *   3. Payload parity: the route validated against `createExchangeSchema`
 *      (missing leg1Rate, leg1MarketRate, leg1ProfitUsd, leg2 fields,
 *      viaCurrency, totalProfitUsd) and called
 *      `ExchangeService.addTransaction`, which
 *      RECOMPUTES the rate from DB state — an operator's rate override, or
 *      an API-currency trade's already-computed legs, never reached the DB
 *      correctly on web. The route now validates `exchangeSubmitSchema`
 *      (the full contract, unified with the IPC handler's own
 *      `ExchangeTransactionSchema`) and calls
 *      `ExchangeService.addDirectTransaction`, exactly like desktop.
 *
 * Rule 15: every row is matched by the `id` the POST response itself
 * returns (never "newest row") — the DB accumulates across runs. Test (c)
 * additionally uses a currency code unique to this run so its FIFO lot
 * consumption can never be contaminated by a prior run's leftover open
 * lots for a shared code like "EUR".
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
// Same import global-setup.ts already uses — no dual-ABI mock concern here:
// this suite runs under the Node ABI.
import Database from "better-sqlite3";
import { hashPassword } from "@liratek/core";
import { test, expect, BACKEND_URL } from "./fixtures";
import type { Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Mirrors global-setup.ts's own path resolution exactly — same DB file.
const DB_PATH = path.join(
  __dirname,
  "..",
  "..",
  "test-results",
  "e2e-web",
  "phone_shop.web.db",
);

const STAFF_USERNAME = "e2e022staff";
const STAFF_PASSWORD = "E2e022Staff!1";

/**
 * Seed (idempotently) a REAL `staff`-role user directly in the shared test
 * DB — mirrors lira-web-019's own seedStaffUser (see that file's doc for why
 * this can't go over REST: POST /api/users is a placeholder, and
 * authenticateJWT requires a live `sessions` row a self-signed token can't
 * produce).
 */
function seedStaffUser(): void {
  const db = new Database(DB_PATH);
  try {
    db.prepare(
      `INSERT OR IGNORE INTO users (tenant_id, username, password_hash, role, is_active)
       VALUES (1, ?, ?, 'staff', 1)`,
    ).run(STAFF_USERNAME, hashPassword(STAFF_PASSWORD));
    db.prepare(
      `UPDATE users SET password_hash = ?, role = 'staff', is_active = 1 WHERE username = ?`,
    ).run(hashPassword(STAFF_PASSWORD), STAFF_USERNAME);
  } finally {
    db.close();
  }
}

async function loginHeaders(
  page: Page,
  username: string,
  password: string,
): Promise<Record<string, string>> {
  const res = await (
    await page.request.post(`${BACKEND_URL}/api/auth/login`, {
      data: { username, password },
    })
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return { Authorization: `Bearer ${res.data.token as string}` };
}

type ExchangeSubmitResult = {
  success: boolean;
  id?: number;
  error?: string;
  realizedProfitUsd?: number;
  lotCoveredQty?: number;
  lotMarketQty?: number;
};

async function submitExchange(
  page: Page,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<ExchangeSubmitResult> {
  const res = await page.request.post(`${BACKEND_URL}/api/exchange/transactions`, {
    headers,
    data: body,
  });
  return { status: res.status(), ...(await res.json()) } as ExchangeSubmitResult & {
    status: number;
  };
}

async function historyRowById(
  page: Page,
  headers: Record<string, string>,
  id: number,
): Promise<Record<string, unknown>> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/exchange/history?limit=500`, {
      headers,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const row = (r.history as Array<Record<string, unknown>>).find(
    (h) => h.id === id,
  );
  expect(row, `history row id=${id} not found`).toBeTruthy();
  return row as Record<string, unknown>;
}

test.describe("Exchange submit parity over REST (EXCHANGE_LOT_SETTLEMENT.md F3)", () => {
  test("(a) staff can submit, and an operator-overridden leg1Rate is stamped verbatim (not server-recomputed)", async ({
    page,
  }) => {
    seedStaffUser();
    const headers = await loginHeaders(page, STAFF_USERNAME, STAFF_PASSWORD);

    // A deliberately "odd" rate no default/seeded USD->LBP rate would ever
    // produce by coincidence — proves it round-trips verbatim rather than
    // being silently replaced by a server-computed value.
    const OVERRIDE_RATE = 92_345;
    const MARKET_RATE = 89_500;
    const tag = `L022 Override ${Date.now()}`;

    const res = await submitExchange(page, headers, {
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 50,
      amountOut: 50 * OVERRIDE_RATE,
      leg1Rate: OVERRIDE_RATE,
      leg1MarketRate: MARKET_RATE,
      leg1ProfitUsd: 1.23,
      totalProfitUsd: 1.23,
      clientName: tag,
      note: tag,
    });

    // Gap 1 (role parity): staff was previously refused (admin-only route).
    expect(res.success, JSON.stringify(res)).toBe(true);
    expect(typeof res.id).toBe("number");

    // Gap 3 (payload parity): leg1Rate/leg1MarketRate reach the DB
    // untouched — createExchangeSchema (the old validator) didn't even
    // carry these fields, and addTransaction() (the old service call)
    // recomputes `rate` from DB rate rows regardless of what's sent.
    const row = await historyRowById(page, headers, res.id as number);
    expect(row.leg1_rate).toBeCloseTo(OVERRIDE_RATE, 6);
    // `rate` is the backward-compat top-level column — ExchangeRepository
    // stores it as a verbatim copy of leg1Rate.
    expect(row.rate).toBeCloseTo(OVERRIDE_RATE, 6);
    expect(row.leg1_market_rate).toBeCloseTo(MARKET_RATE, 6);
    expect(row.client_name).toBe(tag);
  });

  test("(b) a deliberately-invalid submit (business-logic failure, not a schema error) returns HTTP 200 with success:false (envelope parity)", async ({
    page,
  }) => {
    // Admin, deliberately — isolates gap 2 (envelope) from gap 1 (role): a
    // *schema*-level rejection (e.g. a missing required field) already
    // returns 200 via validateRequest() regardless of this route's own
    // status line, so it wouldn't tell gap 2 apart from a pass. `partnerMode:
    // "FOR"` with no `partnerId` passes schema validation (both fields are
    // independently optional in exchangeSubmitSchema) but fails the
    // repository's own runtime guard (assertPartnerIdRequired) — a genuine
    // business-logic failure, exactly the class of result the OLD route's
    // `res.status(result.success ? 200 : 400)` line answered with 400.
    const admin = await loginHeaders(page, "admin", "admin123");

    const res = await page.request.post(`${BACKEND_URL}/api/exchange/transactions`, {
      headers: admin,
      data: {
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 10,
        amountOut: 900_000,
        // `rate` is unused by exchangeSubmitSchema (stripped) but keeps this
        // payload valid against the OLD createExchangeSchema too, so the
        // pre-fix rerun (rule 17) actually reaches the business-logic guard
        // below instead of failing earlier at schema validation.
        rate: 90_000,
        leg1Rate: 90_000,
        leg1MarketRate: 90_000,
        leg1ProfitUsd: 0,
        totalProfitUsd: 0,
        partnerMode: "FOR",
      },
    });

    // Gap 2 (envelope parity): this used to be a 400. Rule 19c: always 200,
    // the frontend adapter branches on `success`, never on status code.
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error as string).toContain("partnerId is required");
  });

  test("(c) selling an exotic against its own freshly-bought open lot returns a defined, correctly FIFO-priced realizedProfitUsd", async ({
    page,
  }) => {
    seedStaffUser();
    const headers = await loginHeaders(page, STAFF_USERNAME, STAFF_PASSWORD);

    // A currency code unique to THIS run — the DB accumulates across runs,
    // and FIFO lot consumption for a shared code like "EUR" could draw from
    // a prior run's leftover open lot at a different cost, making the
    // realized-profit assertion below non-deterministic (rule 15).
    const EXOTIC = `Z${Date.now().toString().slice(-8)}`;

    // BUY: shop acquires 100 units of EXOTIC at unit cost 1.08 USD (opens a
    // lot — direct exotic->USD acquire, unitCostUsd = amountOut/amountIn).
    const buy = await submitExchange(page, headers, {
      fromCurrency: EXOTIC,
      toCurrency: "USD",
      amountIn: 100,
      amountOut: 108,
      leg1Rate: 1.08,
      leg1MarketRate: 1.08,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
      fromCurrencyName: EXOTIC,
    });
    expect(buy.success, JSON.stringify(buy)).toBe(true);
    // A pure acquire never consumes a lot — no realized profit yet.
    expect(buy.realizedProfitUsd).toBeUndefined();

    // SELL: shop disburses 40 of the 100 open units at unit proceeds 1.20
    // USD (fully covered by the lot just bought: 40 < 100 remaining).
    // Expected realized profit = coveredQty * (proceeds - cost)
    //                          = 40 * (1.20 - 1.08) = 4.80 USD.
    const sell = await submitExchange(page, headers, {
      fromCurrency: "USD",
      toCurrency: EXOTIC,
      amountIn: 48,
      amountOut: 40,
      leg1Rate: 1.2,
      leg1MarketRate: 1.2,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
      toCurrencyName: EXOTIC,
    });
    expect(sell.success, JSON.stringify(sell)).toBe(true);

    // Gap 3's headline proof: the server's lot-adjusted realized profit is
    // present and correct on the REST response — the exact number the
    // frontend's session.linkTransaction must use over its own preview.
    expect(typeof sell.realizedProfitUsd).toBe("number");
    expect(sell.realizedProfitUsd).toBeCloseTo(4.8, 2);
    expect(sell.lotCoveredQty).toBeCloseTo(40, 6);
    expect(sell.lotMarketQty ?? 0).toBeCloseTo(0, 6);
  });

  test("(d) an admin-role JWT is still accepted on /transactions (role parity didn't remove the old caller)", async ({
    page,
  }) => {
    const admin = await loginHeaders(page, "admin", "admin123");
    const res = await submitExchange(page, admin, {
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 5,
      amountOut: 450_000,
      leg1Rate: 90_000,
      leg1MarketRate: 90_000,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
    });
    expect(res.success, JSON.stringify(res)).toBe(true);
  });
});
