/**
 * Expenses — bill amount + cash handed + change back (payer = "shop",
 * owner decision 2026-10-07; docs/FEATURE_GUIDE.md "Kept change").
 *
 * The operator types the BILL (the cost) and the cash HANDED (payment
 * lines). When the cash handed is more than the bill, the vendor's change
 * comes back INTO the drawer (OUT-direction "returned" legs), and change
 * NOT returned is ADDED TO THE COST — never profit, never a KEPT_CHANGE row.
 *
 *   bill $18.50, hand $20, get $1 back → expense $19.00, drawer net −$19.00
 *
 * The stored `expenses.amount_usd/amount_lbp` is what Profits and closing
 * sum, so it must be the REAL cost (handed − returned). Server checks the
 * client's "not returned" claim with `resolveKeptChange` (shop kind) —
 * a tampered claim is refused and nothing is written.
 *
 * Rule 20: void, refund and the Expenses-page delete each net every ledger
 * to 0 per currency (the +$1 inflow leg included).
 *
 * Real production schema (create_db.sql + migrations); nothing is mocked.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  ExpenseRepository,
  resetExpenseRepository,
  type CreateExpenseData,
} from "../ExpenseRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { expectPostings, snapshotLedgers } from "../testHelpers/postingAssert";
import { createExpenseSchema } from "../../validators/expense";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const DAY = "2026-10-07T09:00:00.000Z";
const RATE = 89500;

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function resetAll(): void {
  resetExpenseRepository();
  resetTransactionRepository();
  resetPaymentMethodRepository();
  resetDebtRepository();
  resetPartnerRepository();
}

type Leg = {
  method: string;
  currencyCode: string;
  amount: number;
  direction?: "IN" | "OUT";
};

/**
 * Build the payload through the SHARED core schema (rule 24 — field names
 * come from the schema, not from this test). Before the change the schema
 * strips the leg/kept keys, so we merge the raw extras back on top: the
 * test then runs to its ASSERTIONS on the unchanged repository (rule 28a —
 * a compile/setup failure would prove nothing).
 */
function payload(
  bill: { usd?: number; lbp?: number },
  extra: {
    payments?: Leg[];
    kept_change_usd?: number;
    kept_change_lbp?: number;
    tender_exchange_rate?: number;
    paid_by_method?: string;
  } = {},
): CreateExpenseData {
  const parsed = createExpenseSchema.parse({
    category: "Shop_Supply",
    description: "Printer ink",
    amount_usd: bill.usd ?? 0,
    amount_lbp: bill.lbp ?? 0,
    paid_by_method: extra.paid_by_method ?? "CASH",
    expense_date: DAY,
    ...extra,
  });
  return {
    ...parsed,
    ...extra,
    description: parsed.description ?? "",
  } as unknown as CreateExpenseData;
}

function activeExpenseTotals(db: Database.Database): {
  usd: number;
  lbp: number;
} {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM expenses WHERE status = 'active' AND COALESCE(is_refunded, 0) = 0`,
    )
    .get() as { usd: number; lbp: number };
}

function expenseRow(
  db: Database.Database,
  id: number,
): { amount_usd: number; amount_lbp: number } {
  return db
    .prepare(`SELECT amount_usd, amount_lbp FROM expenses WHERE id = ?`)
    .get(id) as { amount_usd: number; amount_lbp: number };
}

function expenseTxn(
  db: Database.Database,
  expenseId: number,
): {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number | null;
  profit_lbp: number | null;
} {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp
       FROM transactions
       WHERE source_table = 'expenses' AND source_id = ? AND reverses_id IS NULL`,
    )
    .get(expenseId) as ReturnType<typeof expenseTxn>;
}

function paymentsOf(
  db: Database.Database,
  txnId: number,
): { drawer_name: string; currency_code: string; amount: number }[] {
  return db
    .prepare(
      `SELECT drawer_name, currency_code, amount FROM payments
       WHERE transaction_id = ? ORDER BY id`,
    )
    .all(txnId) as {
    drawer_name: string;
    currency_code: string;
    amount: number;
  }[];
}

function countRows(db: Database.Database, sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}

/** The owner's example: bill $18.50, hand $20, get $1 back, $0.50 kept. */
function ownerExample(): CreateExpenseData {
  return payload(
    { usd: 18.5 },
    {
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 20 },
        { method: "CASH", currencyCode: "USD", amount: 1, direction: "OUT" },
      ],
      kept_change_usd: 0.5,
      tender_exchange_rate: RATE,
    },
  );
}

describe("ExpenseRepository — bill amount + change back (payer = shop)", () => {
  let db: Database.Database;
  let repo: ExpenseRepository;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new ExpenseRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("owner example: change not returned is added to the cost; returned change comes back into the drawer", () => {
    const before = snapshotLedgers(db);
    const id = repo.createExpense(ownerExample(), USER_ID);

    // Cost = handed − returned = $19.00 (bill $18.50 + $0.50 not returned).
    expect(expenseRow(db, id)).toEqual({ amount_usd: 19, amount_lbp: 0 });
    const txn = expenseTxn(db, id);
    expect(txn.amount_usd).toBe(-19);
    expect(txn.amount_lbp).toBe(0);
    // Never profit.
    expect(txn.profit_usd ?? 0).toBe(0);
    expect(txn.profit_lbp ?? 0).toBe(0);
    expect(
      countRows(
        db,
        `SELECT COUNT(*) AS n FROM transactions WHERE type = 'KEPT_CHANGE'`,
      ),
    ).toBe(0);
    // Gross legs on the SAME transaction: $20 out, $1 back in.
    expect(paymentsOf(db, txn.id)).toEqual([
      { drawer_name: "General", currency_code: "USD", amount: -20 },
      { drawer_name: "General", currency_code: "USD", amount: 1 },
    ]);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": -19 },
    });
  });

  it("paying exactly works as today (legs sent, no change)", () => {
    const before = snapshotLedgers(db);
    const id = repo.createExpense(
      payload(
        { usd: 18.5 },
        {
          payments: [{ method: "CASH", currencyCode: "USD", amount: 18.5 }],
          tender_exchange_rate: RATE,
        },
      ),
      USER_ID,
    );
    expect(expenseRow(db, id)).toEqual({ amount_usd: 18.5, amount_lbp: 0 });
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": -18.5 },
    });
  });

  it("a caller that sends no legs is unchanged (amount = what left the drawer)", () => {
    const before = snapshotLedgers(db);
    const id = repo.createExpense(payload({ usd: 0, lbp: 900000 }), USER_ID);
    expect(expenseRow(db, id)).toEqual({ amount_usd: 0, amount_lbp: 900000 });
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|LBP": -900000 },
    });
  });

  it("change returned in the OTHER currency stores no negative amount — folded into the bill currency", () => {
    // $20 handed for an $18.50 bill; the vendor returns 100,000 LBP
    // ($1.117 at 89,500) and keeps the rest ($0.38).
    const before = snapshotLedgers(db);
    const id = repo.createExpense(
      payload(
        { usd: 18.5 },
        {
          payments: [
            { method: "CASH", currencyCode: "USD", amount: 20 },
            {
              method: "CASH",
              currencyCode: "LBP",
              amount: 100000,
              direction: "OUT",
            },
          ],
          kept_change_usd: 0.38,
          tender_exchange_rate: RATE,
        },
      ),
      USER_ID,
    );
    // 20 − 100,000 / 89,500 = 18.8827 → $18.88, nothing negative.
    expect(expenseRow(db, id)).toEqual({ amount_usd: 18.88, amount_lbp: 0 });
    const txn = expenseTxn(db, id);
    expect(txn.amount_usd).toBe(-18.88);
    expect(txn.amount_lbp).toBe(0);
    // The drawers still move per physical currency.
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": -20, "General|LBP": 100000 },
    });
  });

  it.each([
    [
      "not-returned claim above the real excess (inside the $0.05 reconcile epsilon)",
      /change not returned is more than the change actually due/,
      payload(
        { usd: 18.5 },
        {
          payments: [
            { method: "CASH", currencyCode: "USD", amount: 20 },
            {
              method: "CASH",
              currencyCode: "USD",
              amount: 1,
              direction: "OUT",
            },
          ],
          kept_change_usd: 0.54,
          tender_exchange_rate: RATE,
        },
      ),
    ],
    [
      "phantom not-returned claim on an exact payment",
      /change not returned is more than the change actually due/,
      payload(
        { usd: 18.5 },
        {
          payments: [{ method: "CASH", currencyCode: "USD", amount: 18.5 }],
          kept_change_usd: 0.04,
          tender_exchange_rate: RATE,
        },
      ),
    ],
    [
      "cash handed less than the bill",
      /payment legs do not reconcile/,
      payload(
        { usd: 18.5 },
        {
          payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
          tender_exchange_rate: RATE,
        },
      ),
    ],
    [
      "change returned on a Binance (USDT wallet) payment",
      /only be recorded for a payment out of a cash drawer/,
      payload(
        { usd: 18.5 },
        {
          paid_by_method: "BINANCE",
          payments: [
            { method: "BINANCE", currencyCode: "USD", amount: 20 },
            {
              method: "CASH",
              currencyCode: "USD",
              amount: 1.5,
              direction: "OUT",
            },
          ],
          tender_exchange_rate: RATE,
        },
      ),
    ],
    [
      "a handed line paid with a different method than the expense",
      /every line must be paid with CASH/,
      payload(
        { usd: 18.5 },
        {
          paid_by_method: "CASH",
          payments: [{ method: "OMT", currencyCode: "USD", amount: 18.5 }],
          tender_exchange_rate: RATE,
        },
      ),
    ],
  ])("refuses %s and writes nothing", (_label, reason, data) => {
    const before = snapshotLedgers(db);
    expect(() => repo.createExpense(data, USER_ID)).toThrow(reason);
    expect(countRows(db, `SELECT COUNT(*) AS n FROM expenses`)).toBe(0);
    expect(
      countRows(
        db,
        `SELECT COUNT(*) AS n FROM transactions WHERE source_table = 'expenses'`,
      ),
    ).toBe(0);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it.each(["void", "refund", "delete"] as const)(
    "%s nets every ledger to 0 per currency (the change-back leg included)",
    (mode) => {
      const before = snapshotLedgers(db);
      const id = repo.createExpense(ownerExample(), USER_ID);
      const txnId = expenseTxn(db, id).id;

      if (mode === "void") {
        getTransactionRepository().voidTransaction(txnId, USER_ID);
      } else if (mode === "refund") {
        getTransactionRepository().refundTransaction(txnId, USER_ID);
      } else {
        repo.deleteExpense(id, USER_ID);
      }

      expectPostings(before, snapshotLedgers(db), {});
      expect(activeExpenseTotals(db)).toEqual({ usd: 0, lbp: 0 });
    },
  );
});
