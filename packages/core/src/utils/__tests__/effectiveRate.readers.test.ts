/**
 * LIRA-306 T016 — HIGH guard (analyze pass 3, D4).
 *
 * A replayed event converts and stamps money with the rates recorded on the
 * PC (O-new-24, FR-021a). Rates are read in several places, so the context
 * read must sit INSIDE the readers money paths use — `getUsdLbpSellRate()`,
 * `RateRepository` (which `TransactionRepository.snapshotExchangeRate()`
 * uses) and the raw read in `DebtRepository` — not at one call site.
 * Outside a replay every reader returns the server's rate as today.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { getUsdLbpSellRate } from "../exchangeRate";
import { getEffectiveRate } from "../effectiveRate";
import { getRateRepository, resetRateRepository } from "../../repositories/RateRepository";
import {
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
  addClient,
} from "../../repositories/testHelpers/warrantyDb";
import { getExpenseRepository, resetExpenseRepository } from "../../repositories/ExpenseRepository";
import { getTransactionRepository, resetTransactionRepository } from "../../repositories/TransactionRepository";
import { DebtRepository } from "../../repositories/DebtRepository";

const RECORDED = [{ to_code: "LBP", market_rate: 90000, buy_rate: 89500, sell_rate: 90000, is_stronger: 1 as const }];

let db: Database.Database;
beforeEach(() => {
  db = installWarrantyTestDb();
  db.prepare(
    `UPDATE exchange_rates SET market_rate = 89500, buy_rate = 89000, sell_rate = 89500 WHERE tenant_id = 1 AND to_code = 'LBP'`,
  ).run();
  resetRateRepository();
  resetExpenseRepository();
  resetTransactionRepository();
});
afterEach(() => uninstallWarrantyTestDb(db));

const inReplay = <T>(fn: () => T): T => runWithTenant(1, fn, { effectiveRates: RECORDED });

describe("effective rates reach every money-path reader", () => {
  it("getUsdLbpSellRate", () => {
    expect(inReplay(() => getUsdLbpSellRate(db))).toBe(90000);
    expect(runWithTenant(1, () => getUsdLbpSellRate(db))).toBe(89500);
  });

  it("RateRepository + getEffectiveRate", () => {
    expect(inReplay(() => getRateRepository().findByCode("LBP")?.market_rate)).toBe(90000);
    expect(inReplay(() => getEffectiveRate("LBP")?.sell_rate)).toBe(90000);
    expect(runWithTenant(1, () => getEffectiveRate("LBP")?.sell_rate)).toBe(89500);
  });

  it("TransactionRepository.snapshotExchangeRate() stamps the recorded rate", () => {
    const stamp = (): number => {
      const id = getTransactionRepository().createTransaction({
        type: "EXPENSE",
        source_table: "expenses",
        source_id: 1,
        user_id: 1,
        amount_usd: 1,
        amount_lbp: 0,
        summary: "rate probe",
      } as never);
      return (db.prepare(`SELECT exchange_rate FROM transactions WHERE id = ?`).get(id) as { exchange_rate: number })
        .exchange_rate;
    };
    expect(inReplay(stamp)).toBe(90000);
    expect(runWithTenant(1, stamp)).toBe(89500);
  });

  it("an LBP expense converts with the recorded rate", () => {
    const add = (): number => {
      const r = getExpenseRepository().createExpense({
        description: "rate probe",
        category: "General",
        expense_type: "Cash_Out",
        paid_by_method: "CASH",
        amount_usd: 0,
        amount_lbp: 900000,
        expense_date: "2026-10-10",
      } as never, 1);
      const row = db
        .prepare(`SELECT exchange_rate FROM transactions WHERE source_table = 'expenses' AND source_id = ? ORDER BY id DESC LIMIT 1`)
        .get(r) as { exchange_rate: number } | undefined;
      return row?.exchange_rate ?? -1;
    };
    expect(inReplay(add)).toBe(90000);
    expect(runWithTenant(1, add)).toBe(89500);
  });

  it("a debt repayment conversion uses the recorded rate", () => {
    addClient(db, { id: 50, name: "Rate Probe" });
    const r = new DebtRepository() as unknown as { getExchangeRate: () => number };
    expect(inReplay(() => r.getExchangeRate())).toBe(90000);
    expect(runWithTenant(1, () => r.getExchangeRate())).toBe(89500);
  });
});
