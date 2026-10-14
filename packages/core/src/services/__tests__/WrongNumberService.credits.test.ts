/**
 * LIRA-312 US2 / US4 — credits sent back for a wrong-number card
 * (quickstart W4–W7, W9).
 *
 * Owner rules (2026-10-12): the owner types what arrived on the chosen shop
 * line; the line and the MTC/Alfa drawer go up by that amount; the loss falls
 * by amount × the resold-credit price (`telecom_credit_sell_price_lbp`,
 * 100,000 per $1). Entries add up to at most the card's credit. Each entry is
 * undone by the generic void and nets to 0 on every ledger, per currency.
 *
 * NOT proven failing-first (rule 17): WrongNumberService was written before
 * this file.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { getTransactionRepository } from "../../repositories/TransactionRepository";
import {
  expectPostingsMatchRule,
  snapshotLedgers,
} from "../../repositories/testHelpers/postingAssert";
import { POSTING_RULES } from "../../constants/postingRules";
import {
  recordWrongNumberSchema,
  wrongNumberCreditsSchema,
} from "../../validators/wrongNumber";
import { WrongNumberService } from "../WrongNumberService";
import {
  USER_ID,
  activeProfitLbp,
  buildDb,
  drawer,
  lineCredits,
  resetAll,
  seed,
  type WrongNumberFixture,
} from "../../repositories/testHelpers/wrongNumberDb";

const DAY = "2026-10-14";

describe("WrongNumberService.recordCreditsReceived (LIRA-312)", () => {
  let db: Database.Database;
  let f: WrongNumberFixture;
  let service: WrongNumberService;
  let recordId: number;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    f = seed(db);
    service = new WrongNumberService();
    const r = service.recordWrongNumber(
      recordWrongNumberSchema.parse({
        provider: "iPick",
        mobile_service_item_id: f.alfaCardId,
        wrong_number: "03111111",
        right_number: "03222333",
        sale_transaction_id: f.saleId,
        expense_date: DAY,
      }),
      USER_ID,
    );
    if (!r.success) throw new Error(r.error);
    recordId = r.data.id;
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const credits = (amount_usd: number, carrier_line_id = f.shopLineId) =>
    service.recordCreditsReceived(
      wrongNumberCreditsSchema.parse({
        wrong_number_card_id: recordId,
        amount_usd,
        carrier_line_id,
        client_day: DAY,
      }),
      USER_ID,
    );

  it("W4 — $6.68 on the Alfa line: line +6.68, Alfa drawer +6.68, profit +668,000 LBP, loss 102,000", () => {
    const before = snapshotLedgers(db);
    const lineBefore = lineCredits(db, f.shopLineId);
    const profitBefore = activeProfitLbp(db);

    const result = credits(6.68);
    expect(result).toEqual({
      success: true,
      data: {
        transaction_id: expect.any(Number),
        total_recovered_usd: 6.68,
        remaining_loss_lbp: 102000,
        status: "PARTLY_RECOVERED",
      },
    });
    if (!result.success) return;

    expect(lineCredits(db, f.shopLineId) - lineBefore).toBeCloseTo(6.68, 6);
    expectPostingsMatchRule(
      POSTING_RULES["WRONG_NUMBER_CREDITS/line"],
      before,
      snapshotLedgers(db),
      { x: 6.68, f: 0, c: 0, currency: "USD", carrierUsd: 6.68 },
      { drawers: { carrier: "Alfa" } },
    );
    expect(activeProfitLbp(db) - profitBefore).toBe(668000);

    const txn = db
      .prepare(`SELECT type, source_table, source_id, amount_usd, profit_usd, profit_lbp, metadata_json FROM transactions WHERE id = ?`)
      .get(result.data.transaction_id) as Record<string, unknown> & { metadata_json: string };
    expect(txn).toMatchObject({
      type: "WRONG_NUMBER_CREDITS",
      source_table: "wrong_number_cards",
      source_id: recordId,
      amount_usd: 6.68,
      profit_usd: 0,
      profit_lbp: 668000,
    });
    expect(JSON.parse(txn.metadata_json)).toMatchObject({
      carrier: "alfa",
      carrier_line_id: f.shopLineId,
      credit_rate_lbp: 100000,
    });
  });

  it("uses the shop's own resold-credit price and keeps it on the row", () => {
    db.prepare(
      `INSERT INTO system_settings (tenant_id, key_name, value) VALUES (1, 'telecom_credit_sell_price_lbp', '90000')
       ON CONFLICT DO UPDATE SET value = '90000'`,
    ).run();
    const result = credits(2);
    expect(result).toMatchObject({ success: true, data: { remaining_loss_lbp: 590000 } });
  });

  it("W5 — credits in parts, up to the card's credit", () => {
    expect(credits(3)).toMatchObject({ success: true, data: { status: "PARTLY_RECOVERED" } });
    expect(credits(4.58)).toMatchObject({
      success: true,
      data: { total_recovered_usd: 7.58, status: "RECOVERED", remaining_loss_lbp: 12000 },
    });
    expect(service.list({ id: recordId })[0].credits).toHaveLength(2);
  });

  it("W6 — refuses more credit than the card carried, cumulatively", () => {
    expect(credits(5)).toMatchObject({ success: true });
    const before = snapshotLedgers(db);
    expect(credits(2.59)).toEqual({
      success: false,
      error: "That is more credit than the card carried ($7.58).",
    });
    expect(snapshotLedgers(db)).toEqual(before);
  });

  it("W7 — refuses a line of the other carrier or an inactive line", () => {
    const before = snapshotLedgers(db);
    expect(credits(1, f.mtcShopLineId)).toEqual({
      success: false,
      error: "Pick an active Alfa shop line.",
    });
    expect(credits(1, f.inactiveAlfaLineId)).toEqual({
      success: false,
      error: "Pick an active Alfa shop line.",
    });
    expect(snapshotLedgers(db)).toEqual(before);
  });

  it("W9 — void of an entry nets line, drawer and profit to 0 (per currency)", () => {
    const before = snapshotLedgers(db);
    const lineBefore = lineCredits(db, f.shopLineId);
    const profitBefore = activeProfitLbp(db);

    const r = credits(6.68);
    if (!r.success) throw new Error(r.error);
    getTransactionRepository().voidTransaction(r.data.transaction_id, USER_ID);

    expect(snapshotLedgers(db)).toEqual(before);
    expect(lineCredits(db, f.shopLineId)).toBeCloseTo(lineBefore, 6);
    expect(activeProfitLbp(db)).toBe(profitBefore);
    expect(service.list({ id: recordId })[0]).toMatchObject({
      status: "WAITING",
      total_recovered_usd: 0,
      remaining_loss_lbp: 770000,
    });
    // The voided entry no longer counts against the cap.
    expect(credits(7.58)).toMatchObject({ success: true, data: { status: "RECOVERED" } });
  });

  it("W9 — a refund of an entry (instead of a void) nets line and drawer to 0 too", () => {
    const before = snapshotLedgers(db);
    const lineBefore = lineCredits(db, f.shopLineId);
    const r = credits(6.68);
    if (!r.success) throw new Error(r.error);
    getTransactionRepository().refundTransaction(r.data.transaction_id, USER_ID);
    expect(snapshotLedgers(db)).toEqual(before);
    expect(lineCredits(db, f.shopLineId)).toBeCloseTo(lineBefore, 6);
    expect(service.list({ id: recordId })[0]).toMatchObject({
      status: "WAITING",
      total_recovered_usd: 0,
    });
  });

  it("a drifted Alfa drawer gets its own correction leg, never folded into the credits", () => {
    db.prepare(`UPDATE drawer_balances SET balance = 18 WHERE drawer_name = 'Alfa' AND currency_code = 'USD'`).run();
    const r = credits(2);
    if (!r.success) throw new Error(r.error);
    const legs = db
      .prepare(`SELECT method, amount FROM payments WHERE transaction_id = ? ORDER BY id`)
      .all(r.data.transaction_id);
    expect(legs).toEqual([
      { method: "Alfa", amount: 2 },
      { method: "Alfa_LINE_DRIFT", amount: 2 },
    ]);
    expect(drawer(db, "Alfa", "USD")).toBeCloseTo(lineCredits(db, f.shopLineId), 6);
  });

  it("refuses credits once the wrong-number expense is undone", () => {
    const rec = service.list({ id: recordId })[0];
    getTransactionRepository().voidTransaction(rec.expense_transaction_id, USER_ID);
    expect(credits(1)).toEqual({
      success: false,
      error: "This wrong-number record has been undone.",
    });
  });
});
