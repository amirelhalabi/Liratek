/**
 * Owner decision 2026-10-16 — the LBP change rounding is booked as a small
 * expense so books = cash.
 *
 * Real numbers (shop day, sale 183): a walk-in sale of $26 paid with
 * 2,400,000 LBP at 89,000. Exact change = 86,000 LBP; the payment box hands
 * back 90,000 (the next 5,000 note). The extra 4,000 LBP must appear as an
 * auto, books-only EXPENSE linked to the sale — the drawer moves ONCE (by
 * the change leg), and voiding/refunding the sale reverses the expense too
 * (rule 20).
 */
import type Database from "better-sqlite3";
import { buildDb } from "../testHelpers/omtAccountDb";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SalesRepository } from "../SalesRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import {
  lbpChangeRounding,
  roundLbpUpToNote,
} from "../../utils/changeRounding";

const RATE = 89000;

interface Drawer {
  currency_code: string;
  balance: number;
}

function general(db: Database.Database): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT currency_code, balance FROM drawer_balances WHERE drawer_name = 'General' AND tenant_id = 1`,
    )
    .all() as Drawer[];
  return Object.fromEntries(rows.map((r) => [r.currency_code, r.balance]));
}

function fund(db: Database.Database, currency: string, amount: number): void {
  db.prepare(
    `INSERT INTO drawer_balances (drawer_name, currency_code, balance, tenant_id)
     VALUES ('General', ?, ?, 1)
     ON CONFLICT(drawer_name, currency_code, tenant_id) DO UPDATE SET balance = balance + excluded.balance`,
  ).run(currency, amount);
}

function activeExpenseLbp(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_lbp), 0) AS lbp FROM expenses
        WHERE tenant_id = 1 AND status = 'active' AND COALESCE(is_refunded, 0) = 0`,
    )
    .get() as { lbp: number };
  return row.lbp;
}

function activeProfit(db: Database.Database): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp
         FROM transactions WHERE tenant_id = 1 AND status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
}

let db: Database.Database;
let repo: SalesRepository;
let p1: number;
let p2: number;

beforeEach(() => {
  resetTransactionRepository();
  resetExpenseRepository();
  db = buildDb();
  initFixedTenantContext(1);
  fund(db, "LBP", 10_000_000);
  fund(db, "USD", 1000);
  p1 = Number(
    db
      .prepare(
        `INSERT INTO products (name, barcode, item_type, cost_price_usd, stock_quantity, tenant_id) VALUES ('Apple 20W','b1','Accessory',10,5,1)`,
      )
      .run().lastInsertRowid,
  );
  p2 = Number(
    db
      .prepare(
        `INSERT INTO products (name, barcode, item_type, cost_price_usd, stock_quantity, tenant_id) VALUES ('USB-C','b2','Accessory',3,5,1)`,
      )
      .run().lastInsertRowid,
  );
  repo = new SalesRepository();
});

afterEach(() => {
  resetTenantContext();
  resetTransactionRepository();
  resetExpenseRepository();
});

function sell(changeLbp: number): number {
  const res = repo.processSale(
    {
      client_id: null,
      client_name: "Karim Saab",
      client_phone: "70112233",
      total_amount: 26,
      discount: 0,
      final_amount: 26,
      payment_usd: 0,
      payment_lbp: 2_400_000,
      payments: [{ method: "CASH", currency_code: "LBP", amount: 2_400_000 }],
      change_given_usd: 0,
      change_given_lbp: changeLbp,
      exchange_rate: RATE,
      status: "completed",
      items: [
        { product_id: p1, quantity: 1, price: 19 },
        { product_id: p2, quantity: 1, price: 7 },
      ],
    } as Parameters<SalesRepository["processSale"]>[0],
    1,
  );
  expect(res.success).toBe(true);
  return res.id as number;
}

function saleTxnId(saleId: number): number {
  const row = db
    .prepare(
      `SELECT id FROM transactions WHERE type = 'SALE' AND source_table = 'sales' AND source_id = ?`,
    )
    .get(saleId) as { id: number };
  return row.id;
}

describe("LBP change rounding — the pure rule", () => {
  it("$26 paid 2,400,000 at 89,000, 90,000 handed back → 4,000 LBP rounding", () => {
    expect(
      lbpChangeRounding({
        due: { usd: 26, lbp: 0 },
        inLegs: [{ method: "CASH", currencyCode: "LBP", amount: 2_400_000 }],
        cashChange: { usd: 0, lbp: 90_000 },
        exchangeRate: RATE,
      }),
    ).toBe(4000);
  });

  it("exact change (86,000) is not rounding", () => {
    expect(
      lbpChangeRounding({
        due: { usd: 26, lbp: 0 },
        inLegs: [{ method: "CASH", currencyCode: "LBP", amount: 2_400_000 }],
        cashChange: { usd: 0, lbp: 86_000 },
        exchangeRate: RATE,
      }),
    ).toBe(0);
  });

  it("a whole extra note (95,000) is an over-return, not rounding", () => {
    expect(
      lbpChangeRounding({
        due: { usd: 26, lbp: 0 },
        inLegs: [{ method: "CASH", currencyCode: "LBP", amount: 2_400_000 }],
        cashChange: { usd: 0, lbp: 95_000 },
        exchangeRate: RATE,
      }),
    ).toBe(0);
  });

  it("smart split: $20 for $15.27 at 90,000 → $4 + 70,000 LBP, rounding 4,300", () => {
    expect(
      lbpChangeRounding({
        due: { usd: 15.27, lbp: 0 },
        inLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
        cashChange: { usd: 4, lbp: 70_000 },
        exchangeRate: 90_000,
      }),
    ).toBe(4300);
  });

  it("note rounding matches the payment box (57,380 → 60,000; 10,000 stays)", () => {
    expect(roundLbpUpToNote(57_380)).toBe(60_000);
    expect(roundLbpUpToNote(10_000.000000000002)).toBe(10_000);
    expect(roundLbpUpToNote(0)).toBe(0);
  });
});

describe("POS sale — change rounding expense", () => {
  it("books 4,000 LBP as an auto, books-only expense linked to the sale", () => {
    const before = general(db);
    const saleId = sell(90_000);
    const after = general(db);

    // The drawer moves ONCE: +2,400,000 in, −90,000 change. No second debit.
    expect(after.LBP - before.LBP).toBe(2_310_000);
    expect(after.USD - before.USD).toBe(0);

    const expenses = db
      .prepare(
        `SELECT id, category, amount_usd, amount_lbp, paid_by_method, source_ref_table, source_ref_id FROM expenses`,
      )
      .all() as Array<Record<string, unknown>>;
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({
      category: "Change rounding",
      amount_usd: 0,
      amount_lbp: 4000,
      source_ref_table: "sales",
      source_ref_id: saleId,
    });

    const expTxn = db
      .prepare(
        `SELECT id, amount_usd, amount_lbp, metadata_json FROM transactions WHERE type = 'EXPENSE' AND source_table = 'expenses' AND source_id = ?`,
      )
      .get(expenses[0].id) as {
      id: number;
      amount_usd: number;
      amount_lbp: number;
      metadata_json: string;
    };
    expect(expTxn.amount_lbp).toBe(-4000);
    const meta = JSON.parse(expTxn.metadata_json);
    expect(meta.is_auto).toBe(true);
    expect(meta.details).toMatchObject({
      kind: "expense",
      category: "Change rounding",
      billAmount: { amount: 4000, currency: "LBP" },
    });
    // Books-only: the expense posts no payments row.
    const legs = db
      .prepare(`SELECT COUNT(*) AS n FROM payments WHERE transaction_id = ?`)
      .get(expTxn.id) as { n: number };
    expect(legs.n).toBe(0);

    // The sale's own profit stamp is unchanged ($26 − $13 cost).
    const sale = db
      .prepare(`SELECT profit_usd, profit_lbp FROM transactions WHERE id = ?`)
      .get(saleTxnId(saleId)) as { profit_usd: number; profit_lbp: number };
    expect(sale).toEqual({ profit_usd: 13, profit_lbp: 0 });
  });

  it("exact change books no expense", () => {
    sell(86_000);
    const n = db.prepare(`SELECT COUNT(*) AS n FROM expenses`).get() as {
      n: number;
    };
    expect(n.n).toBe(0);
  });

  it("an item refund (and its undo) leaves the rounding expense in place — only the whole sale's void/refund removes it", () => {
    const saleId = sell(90_000);
    expect(activeExpenseLbp(db)).toBe(4000);
    const item = db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ? AND product_id = ?`)
      .get(saleId, p2) as { id: number };
    const refundTxnId = repo.refundSaleItem({
      saleId,
      saleItemId: item.id,
      refundQuantity: 1,
      userId: 1,
    });
    // The item refund row carries the sale's own source (sales/<id>) — the
    // cascade must not fire for it: the rounding was really handed over.
    expect(activeExpenseLbp(db)).toBe(4000);
    repo.undoSaleItemRefund({ refundTransactionId: refundTxnId, userId: 1 });
    expect(activeExpenseLbp(db)).toBe(4000);
  });

  it.each([
    ["void", (id: number) => getTransactionRepository().voidTransaction(id, 1)],
    [
      "refund",
      (id: number) => getTransactionRepository().refundTransaction(id, 1),
    ],
  ])(
    "%s of the sale reverses the rounding expense — nets to 0 per ledger, per currency",
    (_label, reverse) => {
      const drawer0 = general(db);
      const exp0 = activeExpenseLbp(db);
      const profit0 = activeProfit(db);

      const saleId = sell(90_000);
      expect(activeExpenseLbp(db) - exp0).toBe(4000);

      reverse(saleTxnId(saleId));

      const drawer1 = general(db);
      expect(drawer1.LBP - drawer0.LBP).toBe(0);
      expect(drawer1.USD - drawer0.USD).toBe(0);
      expect(activeExpenseLbp(db) - exp0).toBe(0);
      const profit1 = activeProfit(db);
      expect(profit1.usd - profit0.usd).toBeCloseTo(0, 9);
      expect(profit1.lbp - profit0.lbp).toBeCloseTo(0, 9);
    },
  );
});
