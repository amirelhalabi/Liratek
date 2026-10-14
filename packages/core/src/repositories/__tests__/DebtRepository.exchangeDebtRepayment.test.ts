/**
 * LIRA-321 T018a (FR-015) — an 'Exchange Debt' is an ordinary client debt:
 * it is listed in the client's open debts and the normal repayment path
 * settles it (repayment FIFO coverage stamps `covered_lbp`). Both depend on
 * 'Exchange Debt' being in MODULE_DEBT_TRANSACTION_TYPES, which feeds
 * REPAYMENT_COVERABLE_DEBT_TYPES (T021).
 *
 * The charge row is booked directly with `bookClientDebtCharge` against a
 * real EXCHANGE transaction, so this file isolates the whitelisting from the
 * Exchange writer (T024).
 */
import type Database from "better-sqlite3";
import { ExchangeRepository } from "../ExchangeRepository";
import { DebtRepository } from "../DebtRepository";
import { bookClientDebtCharge } from "../moneyPosting";
import {
  CLIENT_ID,
  USER_ID,
  US1_BASE,
  delta,
  setupExchangeDb,
  snapshot,
  teardownExchangeDb,
  unifiedExchangeTxnId,
} from "../testHelpers/exchangeCustomerPaysDb";

let db: Database.Database;

beforeEach(() => {
  db = setupExchangeDb();
});
afterEach(() => teardownExchangeDb(db));

function bookExchangeDebt(lbp: number): { txnId: number; debtId: number } {
  const { id } = new ExchangeRepository().createTransaction(US1_BASE);
  const txnId = unifiedExchangeTxnId(db, id);
  bookClientDebtCharge(db, {
    clientId: CLIENT_ID,
    transactionType: "Exchange Debt",
    amountUsd: 0,
    amountLbp: lbp,
    transactionId: txnId,
    tenantId: 1,
  });
  const row = db
    .prepare(
      `SELECT id FROM debt_ledger WHERE transaction_type = 'Exchange Debt' AND transaction_id = ?`,
    )
    .get(txnId) as { id: number };
  return { txnId, debtId: row.id };
}

describe("Exchange Debt — listed and repaid through the normal path (FR-015)", () => {
  it("is listed in the client's open debts", () => {
    const { txnId } = bookExchangeDebt(1_900_000);
    const items = new DebtRepository().findOpenDebtItems(CLIENT_ID);
    const exchangeItems = items.filter((i) => i.type === "EXCHANGE");
    expect(exchangeItems).toHaveLength(1);
    expect(JSON.stringify(exchangeItems[0])).toContain(String(txnId));
  });

  it("a 1,900,000 LBP repayment fully settles it (covered, no longer open, drawer +1,900,000)", () => {
    const { debtId } = bookExchangeDebt(1_900_000);
    const before = snapshot(db);
    new DebtRepository().addRepayment({
      client_id: CLIENT_ID,
      amount_usd: 0,
      amount_lbp: 1_900_000,
      created_by: USER_ID,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 1_900_000 }],
    });
    const d = delta(before, snapshot(db));
    expect(d.generalLbp).toBe(1_900_000);
    expect(d.balanceLbp).toBe(-1_900_000);

    const covered = db
      .prepare(`SELECT covered_lbp FROM debt_ledger WHERE id = ?`)
      .get(debtId) as { covered_lbp: number };
    expect(covered.covered_lbp).toBe(1_900_000);

    const open = new DebtRepository()
      .findOpenDebtItems(CLIENT_ID)
      .filter((i) => i.type === "EXCHANGE");
    expect(open).toHaveLength(0);
  });
});
