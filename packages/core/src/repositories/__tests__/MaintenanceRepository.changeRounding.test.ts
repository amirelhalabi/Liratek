/**
 * Owner decision 2026-10-16 — the LBP change the payment box rounds UP to the
 * next 5,000 note is booked as a small books-only expense (Maintenance uses
 * the same CheckoutModal as POS, smart-split change).
 *
 * USD job $13.37 paid with $20 at 89,500: change due $6.63 → the box hands
 * $6 + 60,000 LBP (0.63 × 89,500 = 56,385, rounded up to the next note).
 * The extra 3,615 LBP is the rounding: one auto EXPENSE linked to the job,
 * no second drawer movement, reversed with the job's transaction.
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { MaintenanceRepository } from "../MaintenanceRepository.js";
import {
  MaintenanceService,
  type SaveJobParams,
} from "../../services/MaintenanceService.js";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import { resetStockBatchRepository } from "../StockBatchRepository.js";
import { resetExpenseRepository } from "../ExpenseRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";
import {
  saveMaintenanceJobSchema,
  type SaveMaintenanceJobPayload,
} from "../../validators/maintenance.js";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
} from "../testHelpers/postingAssert.js";

const SCHEMA = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "electron-app",
    "create_db.sql",
  ),
  "utf-8",
);
const RATE = 89_500;
const USER_ID = 1;

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetTransactionRepository();
  resetStockBatchRepository();
  resetExpenseRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTransactionRepository();
  resetStockBatchRepository();
  resetExpenseRepository();
  db.close();
});

const t1 = <T>(fn: () => T): T => runWithTenant(1, fn);
const svc = () => new MaintenanceService(new MaintenanceRepository());

function save(
  payload: SaveMaintenanceJobPayload,
  extra: Partial<SaveJobParams> = {},
) {
  const parsed = saveMaintenanceJobSchema.parse(payload) as SaveJobParams;
  return t1(() => svc().saveJob({ ...parsed, ...extra }, USER_ID));
}

/** USD job: $13.37 labour, $5 cost, paid on delivery. */
function usdCheckout(
  extra: Partial<SaveMaintenanceJobPayload>,
): SaveMaintenanceJobPayload {
  return {
    device_name: "Phone",
    issue_description: "screen",
    currency: "USD",
    cost_usd: 5,
    price_usd: 13.37,
    final_amount_usd: 13.37,
    status: "Delivered_Paid",
    exchange_rate: RATE,
    ...extra,
  };
}

function addProduct(cost: number, price: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', ?, ?, 10)`,
      )
      .run(`Part-${Math.random()}`, cost, price).lastInsertRowid,
  );
}

function jobTxn(jobId: number) {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp FROM transactions
        WHERE source_table = 'maintenance' AND source_id = ? AND type = 'MAINTENANCE' AND reverses_id IS NULL`,
    )
    .get(jobId) as
    | { id: number; profit_usd: number; profit_lbp: number }
    | undefined;
}

function count(table: "transactions" | "maintenance" | "payments"): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
  ).c;
}

function activeProfit(): { usd: number; lbp: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp
         FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
  return {
    usd: Math.round(row.usd * 1e6) / 1e6,
    lbp: Math.round(row.lbp * 1e6) / 1e6,
  };
}

function expenses() {
  return db
    .prepare(
      `SELECT id, category, amount_usd, amount_lbp, source_ref_table, source_ref_id,
              status, COALESCE(is_refunded, 0) AS is_refunded FROM expenses`,
    )
    .all() as Array<Record<string, unknown>>;
}

const smartSplit = () =>
  usdCheckout({
    payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
    change_given_usd: 6,
    change_given_lbp: 60_000,
  });

describe("Maintenance checkout — LBP change rounding expense", () => {
  it("books 3,615 LBP as an auto expense linked to the job; drawers move once", () => {
    const before = snapshotLedgers(db);
    const res = save(smartSplit());
    expect(res.success).toBe(true);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 14, "General|LBP": -60_000 },
    });
    const rows = expenses();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: "Change rounding",
      amount_usd: 0,
      amount_lbp: 3615,
      source_ref_table: "maintenance",
      source_ref_id: res.id,
    });
    // The job's own profit stamp is unchanged.
    expect(jobTxn(res.id!)!.profit_usd).toBeCloseTo(13.37 - 5, 6);
  });

  it("void of the job's transaction voids the rounding expense — nets to 0", () => {
    const before = snapshotLedgers(db);
    const res = save(smartSplit());
    const txn = jobTxn(res.id!)!;
    t1(() => getTransactionRepository().voidTransaction(txn.id, USER_ID));
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(activeProfit()).toEqual({ usd: 0, lbp: 0 });
    expect(expenses()[0]).toMatchObject({ is_refunded: 1 });
  });

  it("exact change books no expense", () => {
    save(
      usdCheckout({
        payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
        change_given_usd: 6.63,
      }),
    );
    expect(expenses()).toHaveLength(0);
  });

  it("a session-basket checkout books none (the basket owns the change)", () => {
    save(smartSplit(), { deferPayment: true });
    expect(expenses()).toHaveLength(0);
  });
});
