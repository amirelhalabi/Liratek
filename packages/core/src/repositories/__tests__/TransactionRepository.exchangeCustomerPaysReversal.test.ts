/**
 * LIRA-321 T029 (US5, rule 20) — undoing an Exchange recorded with a split
 * "Customer pays" side, an account shortfall, or a forgiven leftover.
 *
 * Every ledger the create touched must net to 0, per currency, after a void
 * and after a full refund: General LBP/USD, the client's Exchange Debt
 * (charge + its reversal), the client's whole debt balance, and the profit
 * sum (the exchange margin AND the forgiven part's WAIVED_SHORTFALL row).
 *
 * Reversal owners (rule 20):
 *  - drawer lines (IN cash, payout)  → generic `_reversePayments`;
 *  - Exchange Debt                    → generic `_cancelDebt` (whitelisted, T021);
 *  - exchange margin                  → VOIDED status / negated REFUND stamp;
 *  - WAIVED_SHORTFALL sibling         → the parent's void/refund cascade (T030).
 *
 * US5.3 (partly repaid, then refunded) follows the shop's existing rule for
 * any account-charged transaction: `_cancelDebt` writes ONE 'Refund Reversal'
 * of the WHOLE charge, so what the client already repaid stays with them as
 * account credit and the repayment's cash stays in the drawer.
 */
import type Database from "better-sqlite3";
import { ExchangeRepository } from "../ExchangeRepository";
import { getTransactionRepository } from "../TransactionRepository";
import { DebtRepository } from "../DebtRepository";
import {
  CLIENT_ID,
  USER_ID,
  US1_FORGIVE,
  US1_PART_ON_ACCOUNT,
  delta,
  setupExchangeDb,
  snapshot,
  teardownExchangeDb,
  unifiedExchangeTxnId,
  type LedgerSnapshot,
} from "../testHelpers/exchangeCustomerPaysDb";

let db: Database.Database;

beforeEach(() => {
  db = setupExchangeDb();
});
afterEach(() => teardownExchangeDb(db));

const ZERO: LedgerSnapshot = {
  generalUsd: 0,
  generalLbp: 0,
  generalEur: 0,
  debtUsd: 0,
  debtLbp: 0,
  balanceUsd: 0,
  balanceLbp: 0,
  profitUsd: 0,
  profitLbp: 0,
};

type Undo = "void" | "refund";
function undo(kind: Undo, txnId: number): void {
  const repo = getTransactionRepository();
  if (kind === "void") repo.voidTransaction(txnId, USER_ID);
  else repo.refundTransaction(txnId, USER_ID);
}

describe.each<Undo>(["void", "refund"])("Exchange customer pays — %s nets every ledger to 0", (kind) => {
  it(`US5.1: the US1.1 exchange (1,900,000 LBP on account) — ${kind}`, () => {
    const before = snapshot(db);
    const { id } = new ExchangeRepository().createTransaction(
      US1_PART_ON_ACCOUNT,
    );
    // Sanity: the create really moved money and booked the debt.
    expect(delta(before, snapshot(db)).debtLbp).toBe(1_900_000);
    undo(kind, unifiedExchangeTxnId(db, id));
    expect(delta(before, snapshot(db))).toEqual(ZERO);
  });

  it(`US1.4 forgive (300,000 LBP, WAIVED_SHORTFALL row) — ${kind}`, () => {
    const before = snapshot(db);
    const { id } = new ExchangeRepository().createTransaction(US1_FORGIVE);
    expect(delta(before, snapshot(db)).profitLbp).toBe(-300_000);
    undo(kind, unifiedExchangeTxnId(db, id));
    expect(delta(before, snapshot(db))).toEqual(ZERO);
    const live = db
      .prepare(
        `SELECT COUNT(*) AS n FROM transactions
          WHERE type = 'WAIVED_SHORTFALL' AND status = 'ACTIVE' AND reverses_id IS NULL`,
      )
      .get() as { n: number };
    expect(live.n).toBe(0);
  });
});

describe("Exchange customer pays — reversal edges", () => {
  it("the WAIVED_SHORTFALL sibling cannot be voided on its own (its parent owns it)", () => {
    const { id } = new ExchangeRepository().createTransaction(US1_FORGIVE);
    const waived = db
      .prepare(
        `SELECT id FROM transactions WHERE type = 'WAIVED_SHORTFALL' AND source_id = ?`,
      )
      .get(unifiedExchangeTxnId(db, id)) as { id: number } | undefined;
    expect(waived).toBeDefined();
    expect(() =>
      getTransactionRepository().voidTransaction(waived!.id, USER_ID),
    ).toThrow(/cannot be voided or refunded/);
  });

  it("US5.3: 1,000,000 of the 1,900,000 repaid, then refunded → the existing account-charge rule", () => {
    const before = snapshot(db);
    const { id } = new ExchangeRepository().createTransaction(
      US1_PART_ON_ACCOUNT,
    );
    // Sanity: the debt was really booked (else the case passes vacuously).
    expect(delta(before, snapshot(db)).debtLbp).toBe(1_900_000);
    new DebtRepository().addRepayment({
      client_id: CLIENT_ID,
      amount_usd: 0,
      amount_lbp: 1_000_000,
      created_by: USER_ID,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 1_000_000 }],
    });
    undo("refund", unifiedExchangeTxnId(db, id));
    const d = delta(before, snapshot(db));
    // The exchange itself is fully undone…
    expect(d.generalUsd).toBe(0);
    expect(d.debtLbp).toBe(0);
    expect(d.profitUsd).toBe(0);
    expect(d.profitLbp).toBe(0);
    // …the repayment's cash stays in the drawer, and the client keeps it
    // as account credit (whole charge reversed by one 'Refund Reversal').
    expect(d.generalLbp).toBe(1_000_000);
    expect(d.balanceLbp).toBe(-1_000_000);
  });
});
