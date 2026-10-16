/**
 * LIRA-329 T025 — a paid maintenance job keeps every field the cashier
 * entered on its own transaction: device, the FULL issue text (the summary
 * still cuts it at 60 characters), status, repair cost, price before the
 * discount, the discount as typed (an LBP job's discount was saved nowhere),
 * warranty months and end day, each part with its product, price and cost,
 * the note, and how it was paid.
 *
 * Driven through `MaintenanceService.saveJob` with fixtures parsed by the
 * shared `saveMaintenanceJobSchema` — the real checkout path on both
 * transports. Money columns are asserted FIRST at today's values (FR-008);
 * those passed on the pre-change run. Expected details go through the kind's
 * own schema (rule 24). Rule 17: run before the builder existed and seen
 * failing.
 *
 * Real schema: create_db.sql + migrations; nothing mocked.
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
import { resetTransactionRepository } from "../TransactionRepository";
import {
  getStockBatchRepository,
  resetStockBatchRepository,
} from "../StockBatchRepository";
import { resetWarrantyRepository } from "../WarrantyRepository";
import { resetDebtRepository } from "../DebtRepository";
import { saveMaintenanceJobSchema } from "../../validators/maintenance";
import { MaintenanceService } from "../../services/MaintenanceService";
import { resetWarrantyService } from "../../services/WarrantyService";
import {
  maintenanceJobDetailsSchema,
  paymentSnapshotSchema,
} from "../../validators/transactionDetails";
import { expectEverySnapshotMatchesPayments } from "../testHelpers/paymentSnapshotAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const USER_ID = 1;
let db: Database.Database;
let svc: MaintenanceService;

interface TxnRow {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  client_name: string | null;
  client_phone: string | null;
  summary: string;
  metadata_json: string;
}

function resetAll(): void {
  resetTransactionRepository();
  resetStockBatchRepository();
  resetWarrantyRepository();
  resetWarrantyService();
  resetDebtRepository();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(
    fs.readFileSync(
      path.join(REPO_ROOT, "electron-app/create_db.sql"),
      "utf-8",
    ),
  );
  initDatabase(db);
  runMigrations(db);
  initFixedTenantContext(1);
  db.exec(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami Haddad', '71123456')`,
  );
  svc = new MaintenanceService();
});

// LIRA-329 T036 — every payment snapshot saved by a case above equals
// the payments rows it booked (method, currency, amount, direction).
afterEach(() => {
  expectEverySnapshotMatchesPayments(db);
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

function addPart(name: string, cost: number, price: number): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', 'Parts', ?, ?, 5)`,
      )
      .run(name, cost, price).lastInsertRowid,
  );
  getStockBatchRepository().createBatch({
    product_id: id,
    supplier_id: null,
    quantity: 5,
    unit_cost_usd: cost,
    books_debt: false,
    created_by: USER_ID,
  });
  return id;
}

function save(payload: Record<string, unknown>): number {
  const r = svc.saveJob(
    saveMaintenanceJobSchema.parse(payload) as never,
    USER_ID,
  );
  expect(r).toMatchObject({ success: true });
  return r.id!;
}

function txnFor(jobId: number): TxnRow {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_name,
              client_phone, summary, metadata_json
         FROM transactions
        WHERE type = 'MAINTENANCE' AND source_table = 'maintenance' AND source_id = ?`,
    )
    .get(jobId) as TxnRow;
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

function expectDetails(row: TxnRow, expected: Record<string, unknown>): void {
  expect(maintenanceJobDetailsSchema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

const LONG_ISSUE =
  "Screen cracked in the top left corner after a fall, touch not responding on the right edge, also the battery drains overnight";

describe("LIRA-329 — MaintenanceRepository: maintenance_job details", () => {
  it("a USD job keeps device, full issue, status, cost, gross price, discount, warranty, parts, client and payment lines", () => {
    const screen = addPart("A54 screen", 12, 30);
    // Received first (as at the counter), then delivered and paid.
    const jobId = save({
      device_name: "Samsung A54",
      client_id: 7,
      client_name: "Rami Haddad",
      issue_description: LONG_ISSUE,
      cost_usd: 15,
      price_usd: 60,
      final_amount_usd: 60,
      status: "Received",
    });
    save({
      id: jobId,
      device_name: "Samsung A54",
      client_id: 7,
      client_name: "Rami Haddad",
      issue_description: LONG_ISSUE,
      cost_usd: 15,
      price_usd: 60,
      discount_usd: 10,
      final_amount_usd: 50,
      currency: "USD",
      exchange_rate: 90_000,
      status: "Delivered_Paid",
      note: "customer will pass by Friday",
      warranty_months: 3,
      client_day: "2026-10-10",
      parts: [{ product_id: screen, quantity: 1, unit_price_usd: 30 }],
      payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
      change_given_usd: 20,
    });
    const row = txnFor(jobId);

    // FR-008 — today's money (asserted first; passed on the pre-change run).
    // Amount = labour 50 + part 30; profit = (50 − 15) + (30 − 12).
    expect(row).toMatchObject({
      amount_usd: 80,
      amount_lbp: 0,
      profit_usd: 53,
      profit_lbp: 0,
    });
    expect(row.client_name).toBe("Rami Haddad");
    expect(row.client_phone).toBe("71123456");
    // FR-011 — the summary is untouched (still cut for display).
    expect(row.summary).not.toContain(LONG_ISSUE);

    expectDetails(row, {
      v: 1,
      kind: "maintenance_job",
      jobId,
      device: "Samsung A54",
      issue: LONG_ISSUE,
      status: "Delivered_Paid",
      repairCost: { usd: 15, lbp: 0 },
      price: { usd: 60, lbp: 0 },
      discount: { amount: 10, currency: "USD" },
      warrantyMonths: 3,
      warrantyUntil: "2027-01-10",
      parts: [
        {
          productId: screen,
          name: "A54 screen",
          quantity: 1,
          unitPrice: 30,
          unitCost: 12,
        },
      ],
      note: "customer will pass by Friday",
    });

    const snapshot = paymentSnapshotSchema.parse(meta(row).payment_snapshot);
    expect(snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "USD", amount: 100, direction: "IN" },
        { method: "CASH", currency: "USD", amount: 20, direction: "OUT" },
      ],
      change_returned: [{ method: "CASH", currency: "USD", amount: 20 }],
    });
    const rows = (
      db
        .prepare(
          `SELECT method, currency_code, amount FROM payments WHERE transaction_id = ? ORDER BY id`,
        )
        .all(row.id) as Array<{
        method: string;
        currency_code: string;
        amount: number;
      }>
    ).map((p) => ({
      method: p.method,
      currency: p.currency_code,
      amount: Math.abs(p.amount),
    }));
    expect(rows).toEqual(
      snapshot.lines.map(({ method, currency, amount }) => ({
        method,
        currency,
        amount,
      })),
    );
  });

  it("an LBP job keeps its LBP discount (saved nowhere before) and kept change", () => {
    const jobId = save({
      device_name: "Nokia 3310",
      client_name: "Walk-in Sami",
      issue_description: "Keypad",
      cost_lbp: 100_000,
      price_usd: 0,
      price_lbp: 500_000,
      final_amount_lbp: 450_000,
      currency: "LBP",
      exchange_rate: 90_000,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "LBP", amount: 500_000 }],
      kept_change_lbp: 50_000,
    });
    const row = txnFor(jobId);

    // Labour margin 450,000 − 100,000 plus the kept 50,000 (T3).
    expect(row).toMatchObject({
      amount_usd: 0,
      amount_lbp: 450_000,
      profit_usd: 0,
      profit_lbp: 400_000,
    });
    expect(row.client_name).toBe("Walk-in Sami");

    expectDetails(row, {
      v: 1,
      kind: "maintenance_job",
      jobId,
      device: "Nokia 3310",
      issue: "Keypad",
      status: "Delivered_Paid",
      repairCost: { usd: 0, lbp: 100_000 },
      price: { usd: 0, lbp: 500_000 },
      discount: { amount: 50_000, currency: "LBP" },
    });
    expect(paymentSnapshotSchema.parse(meta(row).payment_snapshot)).toEqual({
      lines: [
        { method: "CASH", currency: "LBP", amount: 500_000, direction: "IN" },
      ],
      kept: { lbp: 50_000 },
    });
  });

  // LIRA-329 T037 — a session-basket job records the session that paid for
  // it (server-injected, like `deferPayment`); the basket owns the money.
  it("a customer-basket job records its session, and no payment lines of its own", () => {
    const r = svc.saveJob(
      {
        ...saveMaintenanceJobSchema.parse({
          client_name: "Basket Guy",
          device_name: "A54",
          issue_description: "battery",
          cost_usd: 10,
          price_usd: 25,
          final_amount_usd: 25,
          currency: "USD",
          status: "Delivered_Paid",
        }),
        deferPayment: true,
        paid_in_session: 9,
      } as never,
      USER_ID,
    );
    expect(r).toMatchObject({ success: true });
    const row = txnFor(r.id!);
    expect(row.amount_usd).toBe(25);
    expect(meta(row).details).toMatchObject({
      kind: "maintenance_job",
      paid_in_session: 9,
    });
    expect(meta(row).payment_snapshot).toEqual({ lines: [], session_id: 9 });
  });
});
