/**
 * LIRA-344 — "Remove credit": an open OMT account credit that OMT will never
 * accept is closed and booked as a shop expense, with no drawer movement,
 * and the normal transaction void undoes all of it (rule 20).
 *
 * Every case asserts DELTAS (rule 15): drawers, the member's ledger
 * balance, what the open queue still owes, active expenses and the profit
 * stamp. Create + void nets to 0 on every ledger, per currency.
 *
 * Rule 17: written before `SupplierRepository.removeAccountCredit` and the
 * expense lock existed; the failing run is recorded in the LIRA-344 report.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SupplierRepository } from "../SupplierRepository";
import { getTransactionRepository } from "../TransactionRepository";
import {
  getExpenseRepository,
  resetExpenseRepository,
} from "../ExpenseRepository";
import {
  OMT_CREDIT_REMOVED_EXPENSE_CATEGORY,
  OMT_CREDIT_REMOVED_EXPENSE_LOCKED_MESSAGE,
} from "../../constants/accountCreditWriteOff";
import { removeAccountCreditSchema } from "../../validators/supplier";
import {
  buildDb,
  coverageRows,
  drawerTotals,
  fundDrawer,
  memberBalance,
  omtAccount,
  profitTotals,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
  type CurrencyPair,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

describe("LIRA-344 — remove an OMT account credit", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;

  beforeEach(() => {
    resetAll();
    resetExpenseRepository();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new SupplierRepository();
    acc = omtAccount(db);
    for (const d of ["OMT_System", "General"]) {
      fundDrawer(db, d, "USD", 10000);
      fundDrawer(db, d, "LBP", 100_000_000);
    }
    // A day debt next to the credits, so the queue is not only credits.
    seedOmtSend(db, acc.omtId, {
      amount: 120,
      created_at: "2026-10-01 09:00:00",
    });
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  /** A manual Pay row (no source): an ACCOUNT credit, OMT owes the shop. */
  const seedCredit = (usd: number, lbp = 0, supplier = acc.omtId): number =>
    seedLedgerRow(db, supplier, {
      entry_type: "PAYMENT",
      amount_usd: -usd,
      amount_lbp: -lbp,
    });

  function openRow(id: number) {
    return repo
      .getAccountUnsettled(acc.omtId)
      .find((r) => r.kind === "LEDGER" && r.id === id);
  }

  function owed(): CurrencyPair {
    const q = repo.getAccountUnsettled(acc.omtId);
    return {
      usd: q.reduce((s, r) => s + r.remaining_usd, 0),
      lbp: q.reduce((s, r) => s + r.remaining_lbp, 0),
    };
  }

  function activeExpenses(): CurrencyPair & { n: number } {
    return db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
           FROM expenses
          WHERE tenant_id = 1 AND COALESCE(status, 'active') = 'active'
            AND COALESCE(is_refunded, 0) = 0`,
      )
      .get() as CurrencyPair & { n: number };
  }

  function snapshot() {
    return {
      drawers: drawerTotals(db),
      omt: memberBalance(db, acc.omtId),
      app: memberBalance(db, acc.appId),
      owed: owed(),
      expenses: activeExpenses(),
      profit: profitTotals(db),
      activeCoverage: coverageRows(db).filter((c) => c.is_reversed === 0)
        .length,
    };
  }

  const remove = (
    id: number,
    expected: CurrencyPair,
    reason = "OMT says it was a miscalculation",
  ) =>
    repo.removeAccountCredit({
      account_supplier_id: acc.omtId,
      ledger_row_id: id,
      reason,
      expected_remaining: expected,
      client_day: "2026-10-26",
      created_by: 1,
    });

  it("closes a USD credit, books it as an expense, moves no drawer", () => {
    const creditId = seedCredit(40);
    expect(openRow(creditId)?.row_scope).toBe("ACCOUNT");
    const before = snapshot();

    const res = remove(creditId, { usd: -40, lbp: 0 });

    const after = snapshot();
    // Balance moves by the credit, on the credit's own member.
    expect(after.omt.usd - before.omt.usd).toBeCloseTo(40, 6);
    expect(after.omt.lbp - before.omt.lbp).toBeCloseTo(0, 6);
    expect(after.app.usd).toBeCloseTo(before.app.usd, 6);
    // The open queue loses exactly the credit (balance == open owed holds).
    expect(after.owed.usd - before.owed.usd).toBeCloseTo(40, 6);
    expect(openRow(creditId)).toBeUndefined();
    // No drawer moves.
    expect(after.drawers.usd).toBeCloseTo(before.drawers.usd, 6);
    expect(after.drawers.lbp).toBeCloseTo(before.drawers.lbp, 6);
    // One expense of the credit, in the right category, books-only.
    expect(after.expenses.n - before.expenses.n).toBe(1);
    expect(after.expenses.usd - before.expenses.usd).toBeCloseTo(40, 6);
    const exp = db
      .prepare(`SELECT * FROM expenses WHERE id = ?`)
      .get(res.expense_id) as {
      category: string;
      expense_date: string;
      source_ref_table: string;
      source_ref_id: number;
    };
    expect(exp.category).toBe(OMT_CREDIT_REMOVED_EXPENSE_CATEGORY);
    expect(exp.expense_date).toBe("2026-10-26");
    expect(exp.source_ref_table).toBe("supplier_ledger");
    expect(exp.source_ref_id).toBe(res.id);
    const expTxn = getTransactionRepository().getBySourceId(
      "expenses",
      res.expense_id,
    )!;
    expect(JSON.parse(expTxn.metadata_json as unknown as string).is_auto).toBe(
      true,
    );
    const paymentsOf = (txnId: number) =>
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM payments WHERE transaction_id = ?`,
          )
          .get(txnId) as {
          n: number;
        }
      ).n;
    expect(paymentsOf(expTxn.id)).toBe(0);
    expect(paymentsOf(res.transaction_id)).toBe(0);
    // The owning transaction: a settlement with no money and no profit.
    const txn = db
      .prepare(
        `SELECT type, amount_usd, profit_usd, metadata_json FROM transactions WHERE id = ?`,
      )
      .get(res.transaction_id) as {
      type: string;
      amount_usd: number;
      profit_usd: number;
      metadata_json: string;
    };
    expect(txn.type).toBe("SUPPLIER_SETTLEMENT");
    expect(txn.amount_usd).toBe(0);
    expect(txn.profit_usd).toBe(0);
    expect(JSON.parse(txn.metadata_json).reason).toBe(
      "OMT says it was a miscalculation",
    );
    expect(after.profit.usd).toBeCloseTo(before.profit.usd, 6);
    // Coverage WAIVE closes the row.
    const cov = coverageRows(db).filter(
      (c) => c.transaction_id === res.transaction_id,
    );
    expect(cov).toEqual([
      expect.objectContaining({
        row_kind: "LEDGER",
        row_id: creditId,
        currency: "USD",
        amount: 40,
        source: "WAIVE",
        closes_row: 1,
        is_reversed: 0,
      }),
    ]);
  });

  it("void undoes everything: credit open again, expense gone, nets 0 per ledger per currency", () => {
    const usdCredit = seedCredit(40);
    const lbpCredit = seedCredit(0, 450000, acc.appId);
    const before = snapshot();

    const a = remove(usdCredit, { usd: -40, lbp: 0 });
    const b = remove(lbpCredit, { usd: 0, lbp: -450000 });
    const mid = snapshot();
    expect(mid.app.lbp - before.app.lbp).toBeCloseTo(450000, 6);
    expect(mid.expenses.lbp - before.expenses.lbp).toBeCloseTo(450000, 6);
    expect(mid.drawers.lbp).toBeCloseTo(before.drawers.lbp, 6);

    getTransactionRepository().voidTransaction(a.transaction_id, 1);
    getTransactionRepository().voidTransaction(b.transaction_id, 1);

    const after = snapshot();
    for (const key of [
      "drawers",
      "omt",
      "app",
      "owed",
      "expenses",
      "profit",
    ] as const) {
      expect(after[key].usd).toBeCloseTo(before[key].usd, 6);
      expect(after[key].lbp).toBeCloseTo(before[key].lbp, 6);
    }
    expect(after.expenses.n).toBe(before.expenses.n);
    expect(after.activeCoverage).toBe(before.activeCoverage);
    expect(openRow(usdCredit)?.remaining_usd).toBeCloseTo(-40, 6);
    expect(openRow(lbpCredit)?.remaining_lbp).toBeCloseTo(-450000, 6);
  });

  it("removes only what is left of a part-used credit", () => {
    const creditId = seedCredit(40);
    // An earlier settlement used $25 of it (its own coverage on the row).
    const txnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd, amount_lbp, status, created_at)
           VALUES (1, 'SUPPLIER_SETTLEMENT', 'supplier_ledger', ?, 1, 0, 0, 'ACTIVE', datetime('now'))`,
        )
        .run(creditId).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO supplier_settlement_coverage
         (tenant_id, transaction_id, anchor_ledger_id, row_kind, row_id, member_supplier_id, currency, amount, source, closes_row)
       VALUES (1, ?, ?, 'LEDGER', ?, ?, 'USD', 25, 'NETTING', 0)`,
    ).run(txnId, creditId, creditId, acc.omtId);
    expect(openRow(creditId)?.remaining_usd).toBeCloseTo(-15, 6);
    const before = snapshot();

    remove(creditId, { usd: -15, lbp: 0 });

    const after = snapshot();
    expect(after.omt.usd - before.omt.usd).toBeCloseTo(15, 6);
    expect(after.expenses.usd - before.expenses.usd).toBeCloseTo(15, 6);
    expect(openRow(creditId)).toBeUndefined();
  });

  /** data-model.md invariant 1: per member and currency, the ledger sum
   *  equals Σ remaining of that member's open queue rows. */
  function expectBalanceInvariant(): void {
    const q = repo.getAccountUnsettled(acc.omtId);
    for (const member of [acc.omtId, acc.appId, acc.ipickId]) {
      const bal = memberBalance(db, member);
      const rows = q.filter((r) => r.supplier_id === member);
      expect(Math.round(bal.usd * 100)).toBe(
        Math.round(rows.reduce((s, r) => s + r.remaining_usd, 0) * 100),
      );
      expect(Math.round(bal.lbp)).toBe(
        Math.round(rows.reduce((s, r) => s + r.remaining_lbp, 0)),
      );
    }
  }

  it("R12 order: remove a settlement's overpay credit, undo that settlement, then undo the removal — invariant holds, nets 0", () => {
    const before = snapshot();
    expectBalanceInvariant();
    // Settlement A pays $150 on the $120 transfer: $30 extra = an account credit.
    const anchorA = repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
        },
      },
      expected_owed: owed(),
      created_by: 1,
    }).id;
    const txnA = (
      db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'supplier_ledger' AND source_id = ? AND reverses_id IS NULL`,
        )
        .get(anchorA) as { id: number }
    ).id;
    const credit = repo
      .getAccountUnsettled(acc.omtId)
      .find((r) => r.row_scope === "ACCOUNT" && r.remaining_usd < 0)!;
    expect(credit.remaining_usd).toBeCloseTo(-30, 6);
    expectBalanceInvariant();

    const res = remove(credit.id, { usd: -30, lbp: 0 });
    expectBalanceInvariant();

    getTransactionRepository().voidTransaction(txnA, 1);
    expectBalanceInvariant();

    getTransactionRepository().voidTransaction(res.transaction_id, 1);
    expectBalanceInvariant();

    const after = snapshot();
    for (const key of [
      "drawers",
      "omt",
      "app",
      "owed",
      "expenses",
      "profit",
    ] as const) {
      expect(after[key].usd).toBeCloseTo(before[key].usd, 6);
      expect(after[key].lbp).toBeCloseTo(before[key].lbp, 6);
    }
  });

  describe("refusals (nothing written)", () => {
    const counts = () =>
      [
        "supplier_ledger",
        "transactions",
        "expenses",
        "supplier_settlement_coverage",
      ].map(
        (t) =>
          (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number })
            .n,
      );

    it("refuses a day row (a transfer's ledger sibling with a source)", () => {
      const dayCredit = Number(
        db
          .prepare(
            `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, source_ref_table, source_ref_id, created_by, created_at)
             VALUES (1, ?, 'PAYMENT', -30, 0, 'recharges', 999, 1, '2026-10-02 10:00:00')`,
          )
          .run(acc.appId).lastInsertRowid,
      );
      expect(openRow(dayCredit)?.row_scope).toBe("DAY");
      const c = counts();
      expect(() => remove(dayCredit, { usd: -30, lbp: 0 })).toThrow(
        /Only a credit on the OMT account/,
      );
      expect(counts()).toEqual(c);
    });

    it("refuses a debt (an account row the shop owes)", () => {
      const debt = seedLedgerRow(db, acc.omtId, {
        entry_type: "SUPPLIER_PAYS_US",
        amount_usd: 20,
      });
      expect(openRow(debt)?.row_scope).toBe("ACCOUNT");
      const c = counts();
      expect(() => remove(debt, { usd: 20, lbp: 0 })).toThrow(
        /Only a credit \(OMT owes the shop\)/,
      );
      expect(counts()).toEqual(c);
    });

    it("refuses an already-removed credit", () => {
      const creditId = seedCredit(40);
      remove(creditId, { usd: -40, lbp: 0 });
      const c = counts();
      expect(() => remove(creditId, { usd: -40, lbp: 0 })).toThrow(
        /no longer open/,
      );
      expect(counts()).toEqual(c);
    });

    it("refuses a stale amount", () => {
      const creditId = seedCredit(40);
      const c = counts();
      expect(() => remove(creditId, { usd: -50, lbp: 0 })).toThrow(
        /OMT's balance changed/,
      );
      expect(counts()).toEqual(c);
    });

    it("refuses an empty or too-short reason (repository and schema)", () => {
      const creditId = seedCredit(40);
      const c = counts();
      expect(() => remove(creditId, { usd: -40, lbp: 0 }, "  ")).toThrow(
        /Enter a reason/,
      );
      expect(counts()).toEqual(c);
      const base = {
        account_supplier_id: acc.omtId,
        ledger_row_id: creditId,
        expected_remaining: { usd: -40, lbp: 0 },
      };
      expect(
        removeAccountCreditSchema.safeParse({ ...base, reason: "ab" }).success,
      ).toBe(false);
      expect(
        removeAccountCreditSchema.safeParse({
          ...base,
          reason: "x".repeat(201),
        }).success,
      ).toBe(false);
      expect(
        removeAccountCreditSchema.safeParse({ ...base, reason: "  ok!  " })
          .success,
      ).toBe(true);
    });
  });

  describe("the expense belongs to the removal (rule 20)", () => {
    it("refuses voiding or deleting the expense on its own; the removal's void still removes it", () => {
      const creditId = seedCredit(40);
      const res = remove(creditId, { usd: -40, lbp: 0 });
      const expTxn = getTransactionRepository().getBySourceId(
        "expenses",
        res.expense_id,
      )!;

      expect(() =>
        getTransactionRepository().voidTransaction(expTxn.id, 1),
      ).toThrow(OMT_CREDIT_REMOVED_EXPENSE_LOCKED_MESSAGE);
      expect(() =>
        getExpenseRepository().deleteExpense(res.expense_id, 1),
      ).toThrow(OMT_CREDIT_REMOVED_EXPENSE_LOCKED_MESSAGE);
      expect(() =>
        getExpenseRepository().updateMetadata(
          res.expense_id,
          { category: "Other" },
          "admin",
        ),
      ).toThrow(OMT_CREDIT_REMOVED_EXPENSE_LOCKED_MESSAGE);
      expect(openRow(creditId)).toBeUndefined();

      getTransactionRepository().voidTransaction(res.transaction_id, 1);
      expect(activeExpenses().n).toBe(0);
      expect(openRow(creditId)?.remaining_usd).toBeCloseTo(-40, 6);
    });
  });
});
