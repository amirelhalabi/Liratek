/**
 * LIRA-369 US5 (T022, FR-016, owner 2026-11-01 option A "all waits") — an
 * exchange's margin counts on the Profits page only once nothing the
 * customer put on their account for it is still owed. While any
 * 'Exchange Debt' linked to the exchange's unified EXCHANGE transaction is
 * open, the WHOLE margin is pending — on the Overview exchange card, the By
 * Module drill-down (`debt_pending = 1`, moved to not-counted), By Date,
 * By Cashier, and it shows in the Pending tab's client-debt bucket instead.
 * Once repaid it counts under the exchange's own day (no new dated event).
 * A payout to the account (CREDIT_DEPOSIT) never makes it pending.
 *
 * Every assertion is a delta against a same-test baseline (rule 15).
 */
import type Database from "better-sqlite3";
import {
  ExchangeRepository,
  type CreateExchangeData,
} from "../ExchangeRepository";
import { ProfitRepository } from "../ProfitRepository";
import { DebtRepository } from "../DebtRepository";
import { TransactionRepository } from "../TransactionRepository";
import { ProfitService } from "../../services/ProfitService";
import {
  CLIENT_ID,
  US1_BASE,
  US1_MARGIN,
  US1_PART_ON_ACCOUNT,
  setupExchangeDb,
  teardownExchangeDb,
  unifiedExchangeTxnId,
} from "../testHelpers/exchangeCustomerPaysDb";

const r4 = (x: number | null | undefined) =>
  Math.round(((x ?? 0) as number) * 10_000) / 10_000;

const CASH_ONLY: CreateExchangeData = {
  ...US1_BASE,
  customerPayments: [{ method: "CASH", currencyCode: "LBP", amount: 89_500_000 }],
};

interface Reading {
  overview: number;
  byDate: number;
  byUser: number;
  drillCounted: number;
  drillPendingRows: number;
  repoDebtPending: number[];
  deferredClientDebt: number;
}

function read(day: string): Reading {
  const ps = new ProfitService(new ProfitRepository());
  const detail = ps.getModuleDetail("EXCHANGE", day, day);
  const repoRows = new ProfitRepository().getExchangeDetail(
    `${day} 00:00:00`,
    `${day} 23:59:59`,
  );
  return {
    overview: r4(ps.getSummary(day, day).exchange.profit_usd),
    byDate: r4(ps.getByDate(day, day).reduce((s, d) => s + d.profit_usd, 0)),
    byUser: r4(ps.getByUser(day, day).reduce((s, u) => s + u.profit_usd, 0)),
    drillCounted: r4(detail.counted_total_profit_usd),
    drillPendingRows: detail.not_counted.length,
    repoDebtPending: repoRows.map(
      (r) => (r as { debt_pending?: number }).debt_pending ?? -1,
    ),
    deferredClientDebt: r4(
      ps.getPendingProfit(day, day).deferred.client_debt_profit_usd,
    ),
  };
}

const today = (db: Database.Database): string =>
  (db.prepare(`SELECT date('now','localtime') AS d`).get() as { d: string }).d;
const yesterday = (db: Database.Database): string =>
  (
    db.prepare(`SELECT date('now','localtime','-1 day') AS d`).get() as {
      d: string;
    }
  ).d;

/** Move one exchange (and its unified row) back by one day. */
function backdate(db: Database.Database, exchangeId: number): void {
  const txnId = unifiedExchangeTxnId(db, exchangeId);
  db.prepare(
    `UPDATE exchange_transactions SET created_at = datetime(created_at, '-1 day') WHERE id = ?`,
  ).run(exchangeId);
  db.prepare(
    `UPDATE transactions SET created_at = datetime(created_at, '-1 day') WHERE id = ?`,
  ).run(txnId);
}

function repay(lbp: number): number {
  const { id } = new DebtRepository().addRepayment({
    client_id: CLIENT_ID,
    amount_usd: 0,
    amount_lbp: lbp,
    created_by: 1,
  });
  return id;
}

function repaymentTxnId(db: Database.Database, ledgerId: number): number {
  return (
    db
      .prepare(`SELECT transaction_id FROM debt_ledger WHERE id = ?`)
      .get(ledgerId) as { transaction_id: number }
  ).transaction_id;
}

const M = r4(US1_MARGIN);

describe("LIRA-369 US5 — an exchange's margin waits while its account part is owed", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = setupExchangeDb();
  });
  afterEach(() => teardownExchangeDb(db));

  it("a cash-only exchange counts its margin at once and is never pending", () => {
    const day = today(db);
    const before = read(day);
    new ExchangeRepository().createTransaction(CASH_ONLY);
    const after = read(day);

    expect(r4(after.overview - before.overview)).toBe(M);
    expect(r4(after.byDate - before.byDate)).toBe(M);
    expect(r4(after.byUser - before.byUser)).toBe(M);
    expect(r4(after.drillCounted - before.drillCounted)).toBe(M);
    expect(after.drillPendingRows - before.drillPendingRows).toBe(0);
    expect(after.repoDebtPending).toEqual([0]);
    expect(r4(after.deferredClientDebt - before.deferredClientDebt)).toBe(0);
  });

  it("LBP→USD with 1,900,000 LBP on account: the whole margin is pending everywhere", () => {
    const day = today(db);
    const before = read(day);
    new ExchangeRepository().createTransaction(US1_PART_ON_ACCOUNT);
    const n = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM debt_ledger WHERE transaction_type = 'Exchange Debt'`,
        )
        .get() as { n: number }
    ).n;
    expect(n).toBe(1); // non-vacuous: the account line really became a debt
    const after = read(day);

    expect(r4(after.overview - before.overview)).toBe(0);
    expect(r4(after.byDate - before.byDate)).toBe(0);
    expect(r4(after.byUser - before.byUser)).toBe(0);
    expect(r4(after.drillCounted - before.drillCounted)).toBe(0);
    expect(after.drillPendingRows - before.drillPendingRows).toBe(1);
    expect(after.repoDebtPending).toEqual([1]);
    // …and it shows where other modules' pending profit shows.
    expect(r4(after.deferredClientDebt - before.deferredClientDebt)).toBe(M);
  });

  it("partial repayment keeps it pending; full repayment counts it on the exchange's own day; voiding the last repayment makes it pending again", () => {
    const exDay = yesterday(db);
    const payDay = today(db);
    const exBefore = read(exDay);
    const payBefore = read(payDay);

    const { id } = new ExchangeRepository().createTransaction(
      US1_PART_ON_ACCOUNT,
    );
    backdate(db, id);
    expect(r4(read(exDay).overview - exBefore.overview)).toBe(0);

    repay(950_000);
    const partial = read(exDay);
    expect(r4(partial.overview - exBefore.overview)).toBe(0);
    expect(partial.repoDebtPending).toEqual([1]);

    const last = repay(950_000);
    const paid = read(exDay);
    expect(r4(paid.overview - exBefore.overview)).toBe(M);
    expect(r4(paid.byDate - exBefore.byDate)).toBe(M);
    expect(r4(paid.byUser - exBefore.byUser)).toBe(M);
    expect(r4(paid.drillCounted - exBefore.drillCounted)).toBe(M);
    expect(paid.repoDebtPending).toEqual([0]);
    expect(r4(paid.deferredClientDebt - exBefore.deferredClientDebt)).toBe(0);
    // No new dated event: the repayment day gains no exchange margin.
    const payAfter = read(payDay);
    expect(r4(payAfter.overview - payBefore.overview)).toBe(0);
    expect(r4(payAfter.drillCounted - payBefore.drillCounted)).toBe(0);

    new TransactionRepository().voidTransaction(repaymentTxnId(db, last), 1);
    const voided = read(exDay);
    expect(r4(voided.overview - exBefore.overview)).toBe(0);
    expect(voided.repoDebtPending).toEqual([1]);
    expect(r4(voided.deferredClientDebt - exBefore.deferredClientDebt)).toBe(M);
  });

  it("a payout to the customer's account (CREDIT_DEPOSIT) does not make the margin pending", () => {
    const day = today(db);
    const before = read(day);
    const { id } = new ExchangeRepository().createTransaction(CASH_ONLY);
    db.prepare(
      `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, created_by)
       VALUES (1, ?, 'CREDIT_DEPOSIT', -50, 0, ?, 1)`,
    ).run(CLIENT_ID, unifiedExchangeTxnId(db, id));
    const after = read(day);

    expect(r4(after.overview - before.overview)).toBe(M);
    expect(after.repoDebtPending).toEqual([0]);
    expect(r4(after.deferredClientDebt - before.deferredClientDebt)).toBe(0);
  });
});
