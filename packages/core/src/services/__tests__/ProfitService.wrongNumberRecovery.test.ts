/**
 * LIRA-312 (T019, quickstart W10) — credits recovered from a wrong-number
 * card reduce its loss on the Profits page. Owner decision 2026-10-12: the
 * recovered credit is valued at the resold-credit price (100,000 LBP per $1),
 * so a 770,000 LBP card with $6.68 back leaves a 102,000 LBP loss:
 *   - the expense (770,000 LBP) lowers net profit, as every expense does;
 *   - ONE "Wrong-number credits recovered" line adds 668,000 LBP to gross;
 *   - By Date and By Cashier agree with the Overview;
 *   - its drill-down lists the entry;
 *   - voiding the entry drops it from every view.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { ProfitRepository } from "../../repositories/ProfitRepository";
import { getTransactionRepository } from "../../repositories/TransactionRepository";
import {
  recordWrongNumberSchema,
  wrongNumberCreditsSchema,
} from "../../validators/wrongNumber";
import { WrongNumberService } from "../WrongNumberService";
import { ProfitService } from "../ProfitService";
import {
  USER_ID,
  buildDb,
  resetAll,
  seed,
  type WrongNumberFixture,
} from "../../repositories/testHelpers/wrongNumberDb";

const FROM = "2020-01-01";
const TO = "2099-12-31";
const DAY = new Date().toISOString().slice(0, 10);

describe("Wrong-number credits recovered in Profits (LIRA-312)", () => {
  let db: Database.Database;
  let f: WrongNumberFixture;
  let profits: ProfitService;
  let service: WrongNumberService;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    f = seed(db);
    // The fixture's sale row is not a real financial_services sale; drop it
    // so the views reconcile on the wrong-number rows alone.
    db.prepare(`DELETE FROM transactions WHERE type = 'FINANCIAL_SERVICE'`).run();
    profits = new ProfitService(new ProfitRepository());
    service = new WrongNumberService();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function recordWithCredits(amountUsd: number): { recordId: number; creditsTxn: number } {
    const rec = service.recordWrongNumber(
      recordWrongNumberSchema.parse({
        provider: "iPick",
        mobile_service_item_id: f.alfaCardId,
        wrong_number: "03111111",
        expense_date: DAY,
      }),
      USER_ID,
    );
    if (!rec.success) throw new Error(rec.error);
    const cr = service.recordCreditsReceived(
      wrongNumberCreditsSchema.parse({
        wrong_number_card_id: rec.data.id,
        amount_usd: amountUsd,
        carrier_line_id: f.shopLineId,
      }),
      USER_ID,
    );
    if (!cr.success) throw new Error(cr.error);
    return { recordId: rec.data.id, creditsTxn: cr.data.transaction_id };
  }

  const recoveryRow = () =>
    profits.getByModule(FROM, TO).find((m) => m.module === "WRONG_NUMBER");

  it("By Module shows ONE 'Wrong-number credits recovered' row", () => {
    recordWithCredits(6.68);
    expect(recoveryRow()).toMatchObject({
      module: "WRONG_NUMBER",
      label: "Wrong-number credits recovered",
      revenue_usd: 0,
      revenue_lbp: 0,
      profit_usd: 0,
      profit_lbp: 668000,
      count: 1,
    });
  });

  it("Overview: the loss nets to 102,000 LBP; By Date and By Cashier agree", () => {
    recordWithCredits(6.68);
    const summary = profits.getSummary(FROM, TO);
    expect(summary.wrong_number_recovery).toEqual({
      profit_usd: 0,
      profit_lbp: 668000,
      count: 1,
    });
    expect(summary.totals.gross_profit_lbp).toBe(668000);
    expect(summary.totals.net_profit_lbp).toBe(668000 - 770000);

    const byDate = profits.getByDate(FROM, TO);
    expect(byDate.reduce((s, d) => s + d.profit_lbp, 0)).toBe(
      summary.totals.gross_profit_lbp,
    );
    expect(byDate.reduce((s, d) => s + d.net_profit_lbp, 0)).toBe(
      summary.totals.net_profit_lbp,
    );
    const byUser = profits.getByUser(FROM, TO);
    expect(byUser.reduce((s, u) => s + u.profit_lbp, 0)).toBe(
      summary.totals.gross_profit_lbp,
    );
  });

  it("the entry is not revenue anywhere: By Cashier / By Client / By Payment Method agree with the Overview", () => {
    recordWithCredits(6.68);
    const summary = profits.getSummary(FROM, TO);
    expect(summary.totals.gross_revenue_usd).toBe(0);
    expect(summary.totals.gross_revenue_lbp).toBe(0);
    const sum = <T,>(rows: T[], k: keyof T) =>
      rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    const byUser = profits.getByUser(FROM, TO);
    expect(sum(byUser, "revenue_usd")).toBe(0);
    expect(sum(byUser, "revenue_lbp")).toBe(0);
    expect(sum(byUser, "recognized_transaction_count")).toBe(1);
    const byClient = profits.getByClient(FROM, TO);
    expect(sum(byClient, "revenue_usd")).toBe(0);
    expect(sum(byClient, "revenue_lbp")).toBe(0);
    expect(sum(byClient, "profit_lbp")).toBe(668000);
    const byMethod = profits.getByPaymentMethod(FROM, TO);
    expect(JSON.stringify(byMethod)).not.toMatch(/Alfa/);
  });

  it("the drill-down lists the entry", () => {
    recordWithCredits(6.68);
    const detail = profits.getModuleDetail("WRONG_NUMBER", FROM, TO);
    expect(detail.module).toBe("WRONG_NUMBER");
    expect(detail.counted.map((r) => r.profit_lbp)).toEqual([668000]);
    expect(detail.counted_total_profit_lbp).toBe(668000);
  });

  it("voiding the entry drops it from every view", () => {
    const { creditsTxn } = recordWithCredits(6.68);
    getTransactionRepository().voidTransaction(creditsTxn, USER_ID);
    expect(recoveryRow()?.profit_lbp ?? 0).toBe(0);
    expect(recoveryRow()?.count ?? 0).toBe(0);
    const summary = profits.getSummary(FROM, TO);
    expect(summary.totals.gross_profit_lbp).toBe(0);
    expect(summary.totals.net_profit_lbp).toBe(-770000);
    expect(
      profits.getByDate(FROM, TO).reduce((s, d) => s + d.profit_lbp, 0),
    ).toBe(0);
  });

  it("refunding the entry (instead of voiding) nets every view to 0 too", () => {
    const { creditsTxn } = recordWithCredits(6.68);
    getTransactionRepository().refundTransaction(creditsTxn, USER_ID);
    expect(recoveryRow()?.profit_lbp ?? 0).toBe(0);
    const summary = profits.getSummary(FROM, TO);
    expect(summary.totals.gross_profit_lbp).toBe(0);
    expect(
      profits.getByDate(FROM, TO).reduce((s, d) => s + d.profit_lbp, 0),
    ).toBe(0);
    expect(
      profits.getByUser(FROM, TO).reduce((s, u) => s + u.profit_lbp, 0),
    ).toBe(0);
  });
});
