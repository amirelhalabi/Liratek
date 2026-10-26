/**
 * LIRA-343 T034 (US5, FR-018 / FR-020, research R12) — any OMT-account
 * settlement can be undone, in any order, with no exception.
 *
 * Later settlements never change. What they relied on from the undone
 * settlement (its credit they netted, or its part-payment on a transfer
 * they then closed) becomes ONE open account row per member and currency
 * ("you owe OMT $X"), owned by the undo transaction. Because the account
 * balance already moves by exactly the undone money, that row is paired
 * with a hidden, self-stamped carry row of the opposite sign, so the pair
 * is balance-neutral and only the open queue changes.
 *
 * After every step, per member and currency: ledger balance == Σ open
 * remaining (DAY + ACCOUNT rows). The undo's drawer delta equals the money
 * the undone settlement moved, reversed.
 *
 * Rule 17: written and run before the change; the refusals it met are
 * recorded in the report of this change.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  SupplierRepository,
  type SettleAccountRequest,
} from "../SupplierRepository";
import { getTransactionRepository } from "../TransactionRepository";
import {
  buildDb,
  coverageRows,
  drawerTotals,
  fundDrawer,
  memberBalance,
  omtAccount,
  resetAll,
  settlementTxn,
  type CurrencyPair,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";
import { seedOmtSendWithTxns } from "../testHelpers/omtTransferTxns";

type Selection = NonNullable<SettleAccountRequest["selections"]>[number];

describe("LIRA-343 — undo any OMT-account settlement (US5)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new SupplierRepository();
    acc = omtAccount(db);
    for (const d of ["OMT_System", "General"]) {
      fundDrawer(db, d, "USD", 10000);
      fundDrawer(db, d, "LBP", 100_000_000);
    }
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

  function owedOf(selections: Selection[]): CurrencyPair {
    const keys = new Set(selections.map((s) => `${s.kind}:${s.id}`));
    const q = repo
      .getAccountUnsettled(acc.omtId)
      .filter((r) => keys.has(`${r.kind}:${r.id}`));
    return {
      usd: r2(q.reduce((s, r) => s + r.remaining_usd, 0)),
      lbp: q.reduce((s, r) => s + r.remaining_lbp, 0),
    };
  }

  /** Settle the ticked rows paying `amount` USD cash; returns the txn id. */
  function settleUsd(selections: Selection[], amount: number): number {
    const anchor = repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount }],
        },
      },
      expected_owed: owedOf(selections),
      selections,
      created_by: 1,
    }).id;
    return settlementTxn(db, anchor).id;
  }

  const fs = (id: number): Selection => ({ kind: "FINANCIAL_SERVICE", id });
  const ledger = (id: number): Selection => ({ kind: "LEDGER", id });

  /** Invariant: per member and currency, balance == Σ open remaining. */
  function expectBalanceEqualsOpen(): void {
    const q = repo.getAccountUnsettled(acc.omtId);
    for (const m of [acc.omtId, acc.appId, acc.ipickId]) {
      const bal = memberBalance(db, m);
      const rows = q.filter((r) => r.supplier_id === m);
      expect({ m, usd: r2(bal.usd) }).toEqual({
        m,
        usd: r2(rows.reduce((s, r) => s + r.remaining_usd, 0)),
      });
      expect({ m, lbp: Math.round(bal.lbp) + 0 }).toEqual({
        m,
        lbp: Math.round(rows.reduce((s, r) => s + r.remaining_lbp, 0)) + 0,
      });
    }
  }

  function settlementState(txnId: number) {
    return {
      status: (
        db.prepare(`SELECT status FROM transactions WHERE id = ?`).get(txnId) as {
          status: string;
        }
      ).status,
      coverage: coverageRows(db).filter((c) => c.transaction_id === txnId),
      ledger: db
        .prepare(
          `SELECT id, amount_usd, amount_lbp, is_refunded, settlement_id
             FROM supplier_ledger WHERE transaction_id = ? ORDER BY id`,
        )
        .all(txnId),
    };
  }

  function reversalOf(txnId: number): number {
    return (
      db
        .prepare(`SELECT id FROM transactions WHERE reverses_id = ? ORDER BY id DESC LIMIT 1`)
        .get(txnId) as { id: number }
    ).id;
  }

  /** The OPEN account rows an undo/void wrote (transaction_id = reversal). */
  function openRowsOf(reversalId: number) {
    return repo
      .getAccountUnsettled(acc.omtId)
      .filter((r) => r.kind === "LEDGER" && r.transaction_id === reversalId);
  }

  function fsClosed(id: number): boolean {
    return repo.getAccountUnsettled(acc.omtId).every(
      (r) => !(r.kind === "FINANCIAL_SERVICE" && r.id === id),
    );
  }

  function fsRemaining(id: number): number {
    const row = repo
      .getAccountUnsettled(acc.omtId)
      .find((r) => r.kind === "FINANCIAL_SERVICE" && r.id === id);
    return row ? r2(row.remaining_usd) : 0;
  }

  function overpayCreditOf(txnId: number): number {
    const row = db
      .prepare(
        `SELECT id FROM supplier_ledger
          WHERE transaction_id = ? AND settlement_id IS NULL AND amount_usd < 0`,
      )
      .get(txnId) as { id: number } | undefined;
    if (!row) throw new Error(`settlement #${txnId} left no open credit`);
    return row.id;
  }

  // ── (a) #A left $8.70 credit, #B used it ──────────────────────────────
  function creditChain() {
    const d21 = seedOmtSendWithTxns(db, acc.omtId, {
      amount: 100,
      created_at: "2026-10-21 09:00:00",
    });
    const d22 = seedOmtSendWithTxns(db, acc.omtId, {
      amount: 50,
      created_at: "2026-10-22 09:00:00",
    });
    const a = settleUsd([fs(d21.fsId)], 108.7);
    const credit = overpayCreditOf(a);
    expectBalanceEqualsOpen();
    const b = settleUsd([fs(d22.fsId), ledger(credit)], 41.3);
    expectBalanceEqualsOpen();
    expect(fsClosed(d22.fsId)).toBe(true);
    return { d21, d22, a, b, credit };
  }

  it("(a) undo #A after #B used its credit: allowed; #A's day reopens, #B unchanged, account owes OMT $8.70", () => {
    const { d21, d22, a, b } = creditChain();
    const bBefore = settlementState(b);
    const drawers0 = drawerTotals(db);

    getTransactionRepository().voidTransaction(a, 1);

    // #A's money came back to the drawer, exactly.
    expect(r2(drawerTotals(db).usd - drawers0.usd)).toBe(108.7);
    // #A's day reopens; #B and its day stay settled.
    expect(fsRemaining(d21.fsId)).toBe(100);
    expect(fsClosed(d22.fsId)).toBe(true);
    expect(settlementState(b)).toEqual(bBefore);
    // One open ACCOUNT row of +$8.70, owned by the undo transaction.
    const undo = reversalOf(a);
    const open = openRowsOf(undo);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      row_scope: "ACCOUNT",
      supplier_id: acc.omtId,
      amount_usd: 8.7,
      remaining_usd: 8.7,
      entry_type: "SUPPLIER_PAYS_US",
    });
    expectBalanceEqualsOpen();
  });

  it("(a2) the same with a REFUND of #A", () => {
    const { a, b } = creditChain();
    const bBefore = settlementState(b);
    const drawers0 = drawerTotals(db);
    getTransactionRepository().refundTransaction(a, 1);
    expect(r2(drawerTotals(db).usd - drawers0.usd)).toBe(108.7);
    expect(settlementState(b)).toEqual(bBefore);
    const open = openRowsOf(reversalOf(a));
    expect(open.map((r) => r2(r.remaining_usd))).toEqual([8.7]);
    expectBalanceEqualsOpen();
  });

  it("(a3) then undo #B too: every ledger back to the start, per currency", () => {
    const balance0 = memberBalance(db, acc.omtId);
    const drawers0 = drawerTotals(db);
    const { a, b } = creditChain();
    getTransactionRepository().voidTransaction(a, 1);
    getTransactionRepository().voidTransaction(b, 1);
    expectBalanceEqualsOpen();
    // Both settlements' money is back; the transfers are owed in full.
    expect(r2(drawerTotals(db).usd - drawers0.usd)).toBe(0);
    const q = repo.getAccountUnsettled(acc.omtId);
    expect(r2(q.reduce((s, r) => s + r.remaining_usd, 0))).toBe(150);
    expect(r2(memberBalance(db, acc.omtId).usd - balance0.usd)).toBe(150);
  });

  // ── (b) #A part-paid a transfer that #B finished ─────────────────────
  function partChain() {
    const d20 = seedOmtSendWithTxns(db, acc.omtId, {
      amount: 20,
      created_at: "2026-10-20 09:00:00",
    });
    const d21 = seedOmtSendWithTxns(db, acc.omtId, {
      amount: 100,
      created_at: "2026-10-21 09:00:00",
    });
    // #A: closes 20 Oct, part-pays $30 of 21 Oct.
    const a = settleUsd([fs(d20.fsId), fs(d21.fsId)], 50);
    expect(fsRemaining(d21.fsId)).toBe(70);
    // #B: finishes 21 Oct.
    const b = settleUsd([fs(d21.fsId)], 70);
    expect(fsClosed(d21.fsId)).toBe(true);
    expectBalanceEqualsOpen();
    return { d20, d21, a, b };
  }

  it("(b) undo #A after #B finished its part-paid transfer: allowed; #B unchanged, account owes OMT $30", () => {
    const { d20, d21, a, b } = partChain();
    const bBefore = settlementState(b);
    const drawers0 = drawerTotals(db);

    getTransactionRepository().voidTransaction(a, 1);

    expect(r2(drawerTotals(db).usd - drawers0.usd)).toBe(50);
    expect(fsRemaining(d20.fsId)).toBe(20); // #A's own day reopens
    expect(fsClosed(d21.fsId)).toBe(true); // #B's day stays settled
    expect(settlementState(b)).toEqual(bBefore);
    // #A's $30 on 21 Oct stays applied (the row is #B's closed row)...
    const keptA = coverageRows(db).filter(
      (c) => c.transaction_id === a && c.is_reversed === 0,
    );
    expect(keptA.map((c) => [c.row_id, c.amount])).toEqual([[d21.fsId, 30]]);
    // ...and the account shows it as owed to OMT, on no day.
    const open = openRowsOf(reversalOf(a));
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ row_scope: "ACCOUNT", amount_usd: 30, remaining_usd: 30 });
    expectBalanceEqualsOpen();
  });

  it("(b2) then undo #B: the transfer is owed in full again, nothing double-counted", () => {
    const { d21, a, b } = partChain();
    getTransactionRepository().voidTransaction(a, 1);
    getTransactionRepository().voidTransaction(b, 1);
    expectBalanceEqualsOpen();
    const q = repo.getAccountUnsettled(acc.omtId);
    // 20 + 100 owed in total: 20 Oct, 21 Oct's $70, and #A's $30 account row.
    expect(r2(q.reduce((s, r) => s + r.remaining_usd, 0))).toBe(120);
    expect(fsRemaining(d21.fsId)).toBe(70);
  });

  it("(c) an undo with nothing relied on writes no account row (unchanged LIRA-322 behaviour)", () => {
    const d21 = seedOmtSendWithTxns(db, acc.omtId, { amount: 100 });
    const before = memberBalance(db, acc.omtId);
    const a = settleUsd([fs(d21.fsId)], 40);
    getTransactionRepository().voidTransaction(a, 1);
    expect(openRowsOf(reversalOf(a))).toEqual([]);
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM supplier_ledger WHERE transaction_id = ?`).get(
        reversalOf(a),
      ),
    ).toEqual({ n: 0 });
    expect(memberBalance(db, acc.omtId)).toEqual(before);
    expectBalanceEqualsOpen();
  });
});
