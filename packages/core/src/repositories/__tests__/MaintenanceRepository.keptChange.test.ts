/**
 * Maintenance checkout — kept change is checked on the server (POSTING_MAP
 * G42, owner decisions 2026-10-07, docs/FEATURE_GUIDE.md §4.1).
 *
 * The Maintenance page renders the same CheckoutModal as POS (payer =
 * customer): IN legs, cash change as `change_given_usd/lbp`, and the part
 * of the change the cashier kept as `kept_change_usd/lbp`. Before this fix
 * `MaintenanceRepository.processPayments` added the claimed kept straight to
 * the profit stamp. It now runs `resolveKeptChange` (customer kind: what the
 * customer owes = labour in the job currency + parts in USD) before the
 * first write and stamps the RESOLVED amount.
 *
 * Real writers (`MaintenanceService.saveJob` → `processPayments`) against
 * the real `electron-app/create_db.sql` schema. Fixtures are typed as the
 * save schema's input and parsed through it (rule 24).
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
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTransactionRepository();
  resetStockBatchRepository();
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

describe("Maintenance checkout — accepted kept change (regression guards: passed before the fix too)", () => {
  it("USD job, cross-currency partial keep: $20 paid, 520,000 LBP back, $0.82 kept; void nets to 0", () => {
    const before = snapshotLedgers(db);
    const res = save(
      usdCheckout({
        payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
        change_given_lbp: 520_000,
        kept_change_usd: 0.82,
      }),
    );
    expect(res).toEqual({ success: true, id: expect.any(Number) });
    const txn = jobTxn(res.id!)!;
    expect(txn.profit_usd).toBeCloseTo(13.37 - 5 + 0.82, 6);
    expect(txn.profit_lbp).toBe(0);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 20, "General|LBP": -520_000 },
    });

    t1(() => getTransactionRepository().voidTransaction(txn.id, USER_ID));
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(activeProfit()).toEqual({ usd: 0, lbp: 0 });
  });

  it("LBP job with a USD part: the owed total includes the part — 440,000 LBP back from $20, $0.06 kept", () => {
    // Owed = 450,000 LBP labour + $10 part = $15.02793 at 89,500. $20 paid
    // → excess $4.97207 = 445,000 LBP; 440,000 back → 5,000 LBP ($0.05587)
    // left, reported in the tender currency rounded to cents: $0.06.
    const partId = addProduct(6, 10);
    const before = snapshotLedgers(db);
    const res = save({
      device_name: "Phone",
      currency: "LBP",
      cost_lbp: 300_000,
      price_usd: 1,
      price_lbp: 450_000,
      final_amount_lbp: 450_000,
      status: "Delivered_Paid",
      exchange_rate: RATE,
      parts: [{ product_id: partId, quantity: 1, unit_price_usd: 10 }],
      payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
      change_given_lbp: 440_000,
      kept_change_usd: 0.06,
    });
    expect(res.success).toBe(true);
    const txn = jobTxn(res.id!)!;
    expect(txn.profit_usd).toBeCloseTo(10 - 6 + 0.06, 6);
    expect(txn.profit_lbp).toBe(150_000);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 20, "General|LBP": -440_000 },
    });
  });

  it("no kept claim: a partial payment still books Maintenance Debt (unchanged)", () => {
    const clientId = Number(
      db
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Debt Client', '03111222')`,
        )
        .run().lastInsertRowid,
    );
    const before = snapshotLedgers(db);
    const res = save(
      usdCheckout({
        client_id: clientId,
        payments: [{ method: "CASH", currency_code: "USD", amount: 5 }],
      }),
    );
    expect(res.success).toBe(true);
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.drawers).toEqual({ "General|USD": 5 });
    expect(d.debt[`${clientId}|USD`]).toBeCloseTo(8.37, 6);
  });
});

describe("Maintenance checkout — session basket (deferred): the job's kept claim is dropped (written after the fix — NOT proven failing-first)", () => {
  it("books no kept profit — the basket owns the payment and its own kept change", () => {
    // The Maintenance page carries the job's checkout fields (kept included)
    // into the session cart item; the session checkout replays it with
    // deferPayment. Refusing would fail the whole basket checkout, so the
    // claim is dropped instead.
    const before = snapshotLedgers(db);
    const res = save(
      usdCheckout({
        payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
        change_given_usd: 6,
        kept_change_usd: 0.63,
      }),
      { deferPayment: true },
    );
    expect(res.success).toBe(true);
    expect(jobTxn(res.id!)!.profit_usd).toBeCloseTo(13.37 - 5, 6);
    expectPostings(before, snapshotLedgers(db), {});
  });
});

describe("Maintenance checkout — kept change the legs do not support is refused (failing-first)", () => {
  function expectRefused(
    run: () => { success: boolean; error?: string },
    message: RegExp,
  ): void {
    const before = snapshotLedgers(db);
    const counts = [
      count("transactions"),
      count("maintenance"),
      count("payments"),
    ];
    const res = run();
    expect(res.success).toBe(false);
    expect(res.error).toMatch(message);
    expectPostings(before, snapshotLedgers(db), {});
    expect([
      count("transactions"),
      count("maintenance"),
      count("payments"),
    ]).toEqual(counts);
  }

  it("a tampered kept far above the real change", () => {
    expectRefused(
      () =>
        save(
          usdCheckout({
            payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
            change_given_usd: 6,
            kept_change_usd: 5,
          }),
        ),
      /do not reconcile/,
    );
  });

  it("a phantom kept on an exact payment, inside the $0.05 reconcile epsilon", () => {
    expectRefused(
      () =>
        save(
          usdCheckout({
            payments: [{ method: "CASH", currency_code: "USD", amount: 13.37 }],
            kept_change_usd: 0.04,
          }),
        ),
      /more than the change actually due/,
    );
  });

  it("checking out an existing job with a tampered kept leaves the job exactly as it was", () => {
    const created = save(usdCheckout({ status: "Received" }));
    expect(created.success).toBe(true);
    const statusOf = () =>
      (
        db
          .prepare(`SELECT status FROM maintenance WHERE id = ?`)
          .get(created.id) as { status: string }
      ).status;
    expect(statusOf()).toBe("Received");

    expectRefused(
      () =>
        save(
          usdCheckout({
            id: created.id!,
            payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
            change_given_usd: 6,
            kept_change_usd: 5,
          }),
        ),
      /do not reconcile/,
    );
    expect(statusOf()).toBe("Received");
  });
});
