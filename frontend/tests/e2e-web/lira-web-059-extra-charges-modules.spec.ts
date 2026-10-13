/**
 * lira-web-059 — LIRA-319 (Extra charges) beyond the POS, over the web
 * transport (rule 19). Quickstart scenarios 7 (Maintenance) and 8 (session
 * basket):
 *
 *  1. Maintenance checkout — POST /api/maintenance/jobs, labour $20 + a $2
 *     extra paid $22 cash: the job's MAINTENANCE row has amount 22 and
 *     extra 2 (recorded once, on the row), the General USD drawer moves +22
 *     and Profits "Extra charges" moves +2.
 *  2. Session basket — two services ($13 + $8) checked out with ONE $2
 *     extra, paid $23 cash: exactly one EXTRA_CHARGE row for the session
 *     (amount 2, extra 2), no item row carries an extra of its own, the
 *     drawer moves +23 and "Extra charges" moves +2.
 *
 * Rule 15: the web DB accumulates — rows are matched by identity (job id,
 * session id), every money check is a DELTA snapshotted around its action.
 */
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

type Auth = { Authorization: string };
type TxnRow = {
  id: number;
  type: string;
  source_table: string | null;
  source_id: number | null;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  extra_usd: number | null;
  extra_lbp: number | null;
};
type ProfitModuleRow = { module: string; profit_usd: number };

const PROFITS_PASSWORD = "1234";

async function authOf(page: Page): Promise<Auth> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

async function generalUsd(page: Page, auth: Auth): Promise<number> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.balances.generalDrawer.usd as number;
}

/** Same pattern as lira-web-036: set the profits password if none is set
 *  yet, then unlock (idempotent). */
async function unlockProfits(page: Page, auth: Auth): Promise<void> {
  const status = await (
    await page.request.get(`${BACKEND_URL}/api/profits/password-status`, {
      headers: auth,
    })
  ).json();
  expect(status.success, JSON.stringify(status)).toBeTruthy();
  if (!status.isSet) {
    const set = await (
      await page.request.put(`${BACKEND_URL}/api/profits/password`, {
        headers: auth,
        data: { password: PROFITS_PASSWORD },
      })
    ).json();
    expect(set.success, JSON.stringify(set)).toBeTruthy();
  }
  const unlocked = await (
    await page.request.post(`${BACKEND_URL}/api/profits/unlock`, {
      headers: auth,
      data: { password: PROFITS_PASSWORD },
    })
  ).json();
  expect(unlocked.success, JSON.stringify(unlocked)).toBeTruthy();
}

function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Profits "Extra charges" (USD) over yesterday..tomorrow (rule 27); the row
 *  is listed only when its count is above 0, so absent = 0. */
async function extraChargesUsd(page: Page, auth: Auth): Promise<number> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/profits/by-module?from=${isoDay(-1)}&to=${isoDay(1)}`,
      { headers: auth },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const row = (r.data as ProfitModuleRow[]).find(
    (m) => m.module === "EXTRA_CHARGE",
  );
  return row?.profit_usd ?? 0;
}

async function activeSessionIds(page: Page, auth: Auth): Promise<number[]> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/sessions/active-list`, {
      headers: auth,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return ((r.sessions ?? []) as Array<{ id: number }>).map((s) => s.id);
}

test.describe.serial("lira-web-059 extra charges on other pages", () => {
  test("Maintenance: $20 labour + $2 extra paid $22 — row amount 22, extra 2; drawer +22; Extra charges +2", async ({
    page,
  }) => {
    const auth = await authOf(page);
    await unlockProfits(page, auth);

    const LABOUR = 20;
    const EXTRA = 2;
    const drawerBefore = await generalUsd(page, auth);
    const extraBefore = await extraChargesUsd(page, auth);

    const saved = await (
      await page.request.post(`${BACKEND_URL}/api/maintenance/jobs`, {
        headers: auth,
        data: {
          device_name: `L-web-059 Phone ${Date.now()}`,
          currency: "USD",
          cost_usd: 8,
          price_usd: LABOUR,
          final_amount_usd: LABOUR,
          status: "Delivered_Paid",
          exchange_rate: 89500,
          payments: [
            { method: "CASH", currency_code: "USD", amount: LABOUR + EXTRA },
          ],
          change_given_usd: 0,
          change_given_lbp: 0,
          extra_usd: EXTRA,
        },
      })
    ).json();
    expect(saved.success, JSON.stringify(saved)).toBeTruthy();
    const jobId = saved.id as number;
    expect(jobId).toBeTruthy();

    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/transactions/by-source/maintenance/${jobId}`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    const txn = r.transaction as TxnRow;
    expect(txn, "maintenance transaction not found").toBeTruthy();
    expect(txn.type).toBe("MAINTENANCE");
    expect(txn.amount_usd).toBeCloseTo(LABOUR + EXTRA, 2);
    expect(txn.extra_usd ?? 0).toBeCloseTo(EXTRA, 2);
    // Labour profit unchanged by the extra.
    expect(txn.profit_usd).toBeCloseTo(LABOUR - 8, 2);

    expect((await generalUsd(page, auth)) - drawerBefore).toBeCloseTo(
      LABOUR + EXTRA,
      2,
    );
    expect((await extraChargesUsd(page, auth)) - extraBefore).toBeCloseTo(
      EXTRA,
      2,
    );
  });

  test("Session basket: two services + ONE $2 extra paid $23 — one EXTRA_CHARGE row, no item carries the extra; drawer +23; Extra charges +2", async ({
    page,
  }) => {
    const auth = await authOf(page);
    await unlockProfits(page, auth);

    const A = 13;
    const B = 8;
    const EXTRA = 2;
    const PAID = A + B + EXTRA;
    const tag = `L059 ${Date.now()}`;

    const started = await (
      await page.request.post(`${BACKEND_URL}/api/sessions/start`, {
        headers: auth,
        data: { customer_name: tag },
      })
    ).json();
    expect(started.success, JSON.stringify(started)).toBeTruthy();
    const sessionId = started.sessionId as number;
    expect(sessionId).toBeTruthy();

    const drawerBefore = await generalUsd(page, auth);
    const extraBefore = await extraChargesUsd(page, auth);

    const service = (key: string, price: number) => ({
      id: `l059-${key}`,
      module: "custom_services",
      label: `${tag} ${key}`,
      amount: price,
      currency: "USD",
      ipcChannel: "custom-services:add",
      formData: {
        description: `${tag} ${key}`,
        price_usd: price,
        cost_usd: 1,
        status: "completed",
      },
    });

    const checkout = await (
      await page.request.post(`${BACKEND_URL}/api/sessions/checkout`, {
        headers: auth,
        data: {
          sessionId,
          cartItems: [service("a", A), service("b", B)],
          payments: [{ method: "CASH", currency_code: "USD", amount: PAID }],
          exchangeRate: 89500,
          extra_usd: EXTRA,
          userId: 1,
        },
      })
    ).json();
    expect(checkout.success, JSON.stringify(checkout)).toBeTruthy();

    // Exactly one EXTRA_CHARGE row for this session.
    const recent = await (
      await page.request.get(
        `${BACKEND_URL}/api/transactions/recent?type=EXTRA_CHARGE&limit=500`,
        { headers: auth },
      )
    ).json();
    expect(recent.success, JSON.stringify(recent)).toBeTruthy();
    const extraRows = (recent.transactions as TxnRow[]).filter(
      (t) =>
        t.type === "EXTRA_CHARGE" &&
        t.source_table === "customer_sessions" &&
        t.source_id === sessionId,
    );
    expect(extraRows, JSON.stringify(extraRows)).toHaveLength(1);
    expect(extraRows[0].amount_usd).toBeCloseTo(EXTRA, 2);
    expect(extraRows[0].extra_usd ?? 0).toBeCloseTo(EXTRA, 2);
    expect(extraRows[0].profit_usd).toBeCloseTo(0, 2);

    // The extra is recorded once — neither item row carries one of its own.
    // Note: a checkout result's `transactionId` is the module row's id
    // (custom_services.id, SessionCheckoutService `result.sourceId`), not a
    // transactions.id — so each item row is resolved by source.
    const itemSourceIds = (
      (checkout.results ?? []) as Array<{
        module: string;
        transactionId: number;
      }>
    ).map((x) => x.transactionId);
    expect(itemSourceIds).toHaveLength(2);
    for (const sourceId of itemSourceIds) {
      const t = await (
        await page.request.get(
          `${BACKEND_URL}/api/transactions/by-source/custom_services/${sourceId}`,
          { headers: auth },
        )
      ).json();
      expect(t.success, JSON.stringify(t)).toBeTruthy();
      const row = t.transaction as TxnRow;
      expect(row, `custom service #${sourceId} row not found`).toBeTruthy();
      expect(row.type).toBe("CUSTOM_SERVICE");
      expect(row.extra_usd ?? 0, JSON.stringify(row)).toBeCloseTo(0, 2);
    }

    expect((await generalUsd(page, auth)) - drawerBefore).toBeCloseTo(PAID, 2);
    expect((await extraChargesUsd(page, auth)) - extraBefore).toBeCloseTo(
      EXTRA,
      2,
    );

    // The successful checkout closed the session — nothing left active for
    // a later spec to trip over.
    expect(await activeSessionIds(page, auth)).not.toContain(sessionId);
  });
});
