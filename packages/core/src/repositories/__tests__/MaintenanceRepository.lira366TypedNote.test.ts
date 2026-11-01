/**
 * LIRA-366 (T023) — a repair job's existing note box is its typed note
 * (owner 2026-11-01: Maintenance joins with no new box). The note already
 * reaches the transaction's `details.note`; now:
 *   - the part charged to the customer's account carries it at the end of
 *     its "Maintenance Debt" note (`withTypedNote`);
 *   - editing the note later (History edit, or a resave of the job form)
 *     updates the transaction and that debt row together (rule 31,
 *     `syncTypedNote`).
 *
 * Example: a $40 repair, $30 cash + $10 on account, note "screen ordered".
 * Money as ledger deltas (rule 15); payload parsed by the real schema
 * (rule 24). Rule 17: seen failing before the repository changed.
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
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetWarrantyRepository } from "../WarrantyRepository";
import { resetDebtRepository } from "../DebtRepository";
import { saveMaintenanceJobSchema } from "../../validators/maintenance";
import { MaintenanceService } from "../../services/MaintenanceService";
import { resetWarrantyService } from "../../services/WarrantyService";
import { withTypedNote } from "../../utils/typedNote";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const USER_ID = 1;
let db: Database.Database;
let svc: MaintenanceService;

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

afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

const owedUsd = () =>
  (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_usd),0) AS usd FROM debt_ledger WHERE client_id = 7`,
      )
      .get() as { usd: number }
  ).usd;

function txnOf(jobId: number) {
  return db
    .prepare(
      `SELECT id, metadata_json FROM transactions
        WHERE type = 'MAINTENANCE' AND source_table = 'maintenance' AND source_id = ?
          AND reverses_id IS NULL`,
    )
    .get(jobId) as { id: number; metadata_json: string };
}
const detailsNote = (jobId: number) =>
  (
    JSON.parse(txnOf(jobId).metadata_json) as {
      details: { note?: string };
    }
  ).details.note;
const debtNote = (txnId: number) =>
  (
    db
      .prepare(
        `SELECT note FROM debt_ledger WHERE transaction_id = ? AND transaction_type = 'Maintenance Debt'`,
      )
      .get(txnId) as { note: string }
  ).note;

const PAYLOAD = {
  device_name: "iPhone 12",
  client_id: 7,
  client_name: "Rami Haddad",
  cost_usd: 10,
  price_usd: 40,
  final_amount_usd: 40,
  currency: "USD",
  exchange_rate: 90_000,
  status: "Delivered_Paid",
  note: "screen ordered",
  payments: [
    { method: "CASH", currency_code: "USD", amount: 30 },
    { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 },
  ],
};

function checkout(): number {
  const r = svc.saveJob(
    saveMaintenanceJobSchema.parse(PAYLOAD) as never,
    USER_ID,
  );
  expect(r).toMatchObject({ success: true });
  return r.id!;
}

describe("LIRA-366 — repair note on the debt entry", () => {
  it("$30 cash + $10 on account: the $10 debt carries the note", () => {
    const before = owedUsd();
    const jobId = checkout();
    expect(owedUsd() - before).toBeCloseTo(10, 6);
    expect(detailsNote(jobId)).toBe("screen ordered");
    expect(debtNote(txnOf(jobId).id)).toBe(
      withTypedNote("Balance from Maintenance", "screen ordered"),
    );
  });

  it("History edit of the note updates the transaction and the debt row", () => {
    const jobId = checkout();
    const txnId = txnOf(jobId).id;
    const before = owedUsd();
    svc.updateMaintenanceMetadata(jobId, { note: "screen arrived" }, "admin");
    expect(detailsNote(jobId)).toBe("screen arrived");
    expect(debtNote(txnId)).toBe(
      withTypedNote("Balance from Maintenance", "screen arrived"),
    );
    expect(owedUsd()).toBeCloseTo(before, 6);
  });
});
