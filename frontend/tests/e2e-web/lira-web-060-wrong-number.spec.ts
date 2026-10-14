/**
 * lira-web-060 — LIRA-312 (wrong-number card recharge) over the web
 * transport (rule 19). Quickstart W2, W4, W8, W9:
 *
 *  1. An iPick Alfa card sale (800,000 LBP, cost 770,000) is marked "wrong
 *     number" through POST /api/wrong-numbers: the sale stays as it is, the
 *     iPick balance drops by another 770,000 (the wasted card, a loss), and
 *     the record waits for credits.
 *  2. $6.68 of credits arrive on the Alfa shop line (POST
 *     /api/wrong-numbers/:id/credits): the line and the Alfa drawer go up by
 *     6.68, and the Profits "Wrong-number credits recovered" line by 668,000
 *     LBP (at the resold-credit price, 100,000 per $1).
 *  3. The expense cannot be undone while the credits are active; voiding the
 *     credits, then the expense, brings the line, the Alfa drawer and iPick
 *     back to where they were before step 1 (per currency).
 *
 * Rule 15: the web DB accumulates — rows are matched by identity (a fresh
 * card label, a fresh shop line, the sale's own id) and every money check is
 * a DELTA snapshotted around its action.
 *
 * NOT YET RUN (owner asks before e2e runs).
 */
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

type Auth = { Authorization: string };

const PROFITS_PASSWORD = "1234";
const CARD_COST = 770000;
const CARD_PRICE = 800000;
const CARD_CREDIT = 7.58;
const CREDITS_BACK = 6.68;

async function authOf(page: Page): Promise<Auth> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

async function getJson(page: Page, auth: Auth, path: string) {
  const r = await (await page.request.get(`${BACKEND_URL}${path}`, { headers: auth })).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r;
}

async function postJson(page: Page, auth: Auth, path: string, data?: unknown) {
  return (
    await page.request.post(`${BACKEND_URL}${path}`, { headers: auth, data })
  ).json();
}

async function drawer(page: Page, auth: Auth, name: string, cur: "usd" | "lbp") {
  const r = await getJson(page, auth, "/api/recharge/drawer-balances");
  const row = (r.balances as Array<{ name: string; usdBalance: number; lbpBalance: number }>).find(
    (d) => d.name === name,
  );
  return cur === "usd" ? (row?.usdBalance ?? 0) : (row?.lbpBalance ?? 0);
}

async function lineCredits(page: Page, auth: Auth, lineId: number): Promise<number> {
  const r = await getJson(page, auth, "/api/carrier-lines");
  const line = (r.data as Array<{ id: number; credits: number }>).find((l) => l.id === lineId);
  expect(line, `carrier line ${lineId}`).toBeTruthy();
  return line!.credits;
}

/** Same pattern as lira-web-059: set the profits password if none is set
 *  yet, then unlock (idempotent). */
async function unlockProfits(page: Page, auth: Auth): Promise<void> {
  const status = await getJson(page, auth, "/api/profits/password-status");
  if (!status.isSet) {
    const set = await (
      await page.request.put(`${BACKEND_URL}/api/profits/password`, {
        headers: auth,
        data: { password: PROFITS_PASSWORD },
      })
    ).json();
    expect(set.success, JSON.stringify(set)).toBeTruthy();
  }
  const unlocked = await postJson(page, auth, "/api/profits/unlock", {
    password: PROFITS_PASSWORD,
  });
  expect(unlocked.success, JSON.stringify(unlocked)).toBeTruthy();
}

function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function recoveredLbp(page: Page, auth: Auth): Promise<number> {
  const r = await getJson(
    page,
    auth,
    `/api/profits/by-module?from=${isoDay(-1)}&to=${isoDay(1)}`,
  );
  const row = (r.data as Array<{ module: string; profit_lbp: number }>).find(
    (m) => m.module === "WRONG_NUMBER",
  );
  return row?.profit_lbp ?? 0;
}

test.describe.serial("lira-web-060 wrong-number card recharge", () => {
  test("mark a sale wrong number, enter credits, undo newest first — every ledger nets to 0", async ({
    page,
  }) => {
    const auth = await authOf(page);
    await unlockProfits(page, auth);
    const stamp = Date.now().toString().slice(-6);

    // A fresh iPick Alfa card and a fresh Alfa shop line (identity, rule 15).
    const label = `L060 Alfa ${stamp}`;
    const card = await postJson(page, auth, "/api/mobile-service-items", {
      provider: "iPick",
      category: "alfa",
      subcategory: "Prepaid",
      label,
      cost_lbp: CARD_COST,
      sell_lbp: CARD_PRICE,
      credits: CARD_CREDIT,
      validity_days: 30,
    });
    expect(card.success, JSON.stringify(card)).toBeTruthy();
    const cardId = card.data.id as number;

    const line = await postJson(page, auth, "/api/carrier-lines", {
      carrier: "alfa",
      phone_number: `03${stamp}`,
      credits: 0,
    });
    expect(line.success, JSON.stringify(line)).toBeTruthy();
    const lineId = line.data.id as number;

    // The card sale, as the Mobile Recharge cart books it (one SEND row).
    const sale = await postJson(page, auth, "/api/services/transactions", {
      provider: "iPick",
      serviceType: "SEND",
      amount: CARD_PRICE,
      cost: CARD_COST,
      currency: "LBP",
      commission: CARD_PRICE - CARD_COST,
      paidByMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: CARD_PRICE }],
      checkoutTotal: { usd: 0, lbp: CARD_PRICE },
      note: `alfa: ${label} (Prepaid)`,
    });
    expect(sale.success, JSON.stringify(sale)).toBeTruthy();
    const saleTxn = (
      await getJson(page, auth, `/api/transactions/by-source/financial_services/${sale.id}`)
    ).transaction as { id: number; amount_lbp: number; status: string };
    expect(saleTxn.id).toBeTruthy();

    const before = {
      ipick: await drawer(page, auth, "iPick", "lbp"),
      alfa: await drawer(page, auth, "Alfa", "usd"),
      line: await lineCredits(page, auth, lineId),
      recovered: await recoveredLbp(page, auth),
    };

    // 1 — mark the sale wrong number.
    const recorded = await postJson(page, auth, "/api/wrong-numbers", {
      provider: "iPick",
      mobile_service_item_id: cardId,
      wrong_number: `03 111 ${stamp.slice(-3)}`,
      right_number: `03 222 ${stamp.slice(-3)}`,
      sale_transaction_id: saleTxn.id,
      expense_date: isoDay(0),
    });
    expect(recorded.success, JSON.stringify(recorded)).toBeTruthy();
    expect(recorded.data).toMatchObject({ status: "WAITING", remaining_loss_lbp: CARD_COST });
    const recordId = recorded.data.id as number;
    const expenseTxnId = recorded.data.expense_transaction_id as number;

    expect((await drawer(page, auth, "iPick", "lbp")) - before.ipick).toBe(-CARD_COST);
    const saleAfter = (
      await getJson(page, auth, `/api/transactions/by-source/financial_services/${sale.id}`)
    ).transaction as { id: number; amount_lbp: number; status: string };
    expect(saleAfter).toMatchObject({
      id: saleTxn.id,
      amount_lbp: saleTxn.amount_lbp,
      status: "ACTIVE",
    });

    // 2 — $6.68 of credits on the Alfa shop line.
    const credits = await postJson(page, auth, `/api/wrong-numbers/${recordId}/credits`, {
      wrong_number_card_id: recordId,
      amount_usd: CREDITS_BACK,
      carrier_line_id: lineId,
      client_day: isoDay(0),
    });
    expect(credits.success, JSON.stringify(credits)).toBeTruthy();
    const creditsTxnId = credits.data.transaction_id as number;
    // The shop's resold-credit price is a setting (default 100,000) and the
    // web DB accumulates, so read the rate the entry itself stamped.
    const creditsRow = (
      await getJson(page, auth, `/api/transactions/by-source/wrong_number_cards/${recordId}`)
    ).transaction as { id: number; metadata_json: string };
    expect(creditsRow.id).toBe(creditsTxnId);
    const rate = JSON.parse(creditsRow.metadata_json).credit_rate_lbp as number;
    expect(rate).toBeGreaterThan(0);
    const recovered = Math.round(CREDITS_BACK * rate);
    expect(credits.data).toMatchObject({
      total_recovered_usd: CREDITS_BACK,
      remaining_loss_lbp: CARD_COST - recovered,
      status: "PARTLY_RECOVERED",
    });

    expect((await lineCredits(page, auth, lineId)) - before.line).toBeCloseTo(CREDITS_BACK, 6);
    expect((await recoveredLbp(page, auth)) - before.recovered).toBe(recovered);

    // 3 — undo order: the expense refuses while the credits are active.
    const refused = await postJson(page, auth, `/api/transactions/${expenseTxnId}/void`);
    expect(refused.success).toBe(false);
    expect(String(refused.error)).toContain("Undo the credits received first.");

    const voidCredits = await postJson(page, auth, `/api/transactions/${creditsTxnId}/void`);
    expect(voidCredits.success, JSON.stringify(voidCredits)).toBeTruthy();
    const voidExpense = await postJson(page, auth, `/api/transactions/${expenseTxnId}/void`);
    expect(voidExpense.success, JSON.stringify(voidExpense)).toBeTruthy();

    expect(await drawer(page, auth, "iPick", "lbp")).toBe(before.ipick);
    expect(await drawer(page, auth, "Alfa", "usd")).toBeCloseTo(before.alfa, 6);
    expect(await lineCredits(page, auth, lineId)).toBeCloseTo(before.line, 6);
    expect(await recoveredLbp(page, auth)).toBe(before.recovered);

    const list = await getJson(page, auth, `/api/wrong-numbers?id=${recordId}`);
    expect(list.data[0].status).toBe("VOIDED");
  });
});
