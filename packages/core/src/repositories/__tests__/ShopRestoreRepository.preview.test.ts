/**
 * LIRA-377 T019 — `ShopRestoreRepository.previewCandidate` (FR-008, FR-010).
 *
 * Two real shop files from the real schema: the candidate is the shop at an
 * earlier moment; the current file is that SAME file after more work (it is
 * built by copying the candidate and adding rows, so ids continue exactly as
 * in production's AUTOINCREMENT tables).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { closeDatabase, initDatabase } from "../../db/connection.js";
import { runMigrations } from "../../db/migrations/index.js";
import { TRANSACTION_TYPES } from "../../constants/transactionTypes.js";
import { ShopRestoreRepository } from "../ShopRestoreRepository.js";

const CREATE_DB_SQL_PATH = path.join(__dirname, "../../../../../electron-app/create_db.sql");

let tmp: string;
let template: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-restore-preview-"));
  template = path.join(tmp, "template.db");
  const db = new Database(template);
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  closeDatabase();
  db.close();
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** `amount` is `final_amount_usd`; `extra` the LIRA-319 extra on top. */
function sale(db: Database.Database, amount: number, status: string, at: string, clientId: number | null, extra = 0): number {
  return db
    .prepare(
      `INSERT INTO sales (tenant_id, client_id, total_amount_usd, final_amount_usd, extra_usd, status, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(clientId, amount, amount, extra, status, at, at).lastInsertRowid as number;
}

function txn(db: Database.Database, type: string): void {
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, created_at) VALUES (1, ?, 'x', 1, 1, '2026-11-10 12:00:00')`,
  ).run(type);
}

function checkpoint(db: Database.Database, day: string, drawer: string): void {
  db.prepare(`INSERT INTO daily_closings (tenant_id, closing_date, drawer_name) VALUES (1, ?, ?)`).run(day, drawer);
}

function payment(db: Database.Database, method: string, currency: string, amount: number, note: string | null = null): void {
  db.prepare(
    `INSERT INTO payments (tenant_id, method, drawer_name, currency_code, amount, note, created_by, created_at)
     VALUES (1, ?, 'General', ?, ?, ?, 1, '2026-11-10 12:00:00')`,
  ).run(method, currency, amount, note);
}

describe("ShopRestoreRepository.previewCandidate (LIRA-377 T019)", () => {
  let candidatePath: string;
  let currentPath: string;
  let newAdminId: number;
  const repo = new ShopRestoreRepository();

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(tmp, "case-"));
    candidatePath = path.join(dir, "candidate.db");
    currentPath = path.join(dir, "current.db");
    fs.copyFileSync(template, candidatePath);

    // The shop at 12:00: Rami's sale is the last recorded one; a later draft
    // (higher id) is parked and must not be shown as the last sale.
    const c = new Database(candidatePath);
    const rami = c.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Rami', '701')`).run()
      .lastInsertRowid as number;
    sale(c, 12.5, "completed", "2026-11-10 11:58:41", rami, 1.5);
    payment(c, "CASH", "USD", 14);
    txn(c, TRANSACTION_TYPES.SUPPLIER_SETTLEMENT);
    checkpoint(c, "2026-11-09", "General");
    sale(c, 99, "draft", "2026-11-10 11:59:00", null);
    c.prepare(
      `INSERT INTO expenses (tenant_id, description, amount_usd, amount_lbp) VALUES (1, 'Old expense', 3, 0)`,
    ).run();
    c.close();

    // The same file after 12:00.
    fs.copyFileSync(candidatePath, currentPath);
    const k = new Database(currentPath);
    newAdminId = k
      .prepare(`INSERT INTO users (tenant_id, username, password_hash, role) VALUES (1, 'new_admin', 'scrypt$x', 'admin')`)
      .run().lastInsertRowid as number;
    // The owner's example (option A, 2026-11-10): sales $20 + $18 + $12 paid
    // cash, one $9 payout. The $20 one is backdated (created_at BEFORE the
    // copy's last sale) but recorded later; the $18 one is $16 + a $2 extra.
    sale(k, 20, "completed", "2026-11-10 09:00:00", null);
    sale(k, 16, "completed", "2026-11-10 12:05:00", null, 2);
    sale(k, 12, "refunded", "2026-11-10 12:10:00", null);
    sale(k, 5, "draft", "2026-11-10 12:11:00", null); // parked: not a sale
    sale(k, 7, "cancelled", "2026-11-10 12:12:00", null); // voided: not a sale
    payment(k, "CASH", "USD", 20);
    payment(k, "CASH", "USD", 18);
    payment(k, "CASH", "USD", 12);
    payment(k, "CASH", "USD", -9, "Payout");
    payment(k, "CASH", "LBP", 900000);
    payment(k, "COMMISSION", "USD", 4); // internal leg: neither counted nor summed
    k.prepare(`INSERT INTO expenses (tenant_id, description, amount_usd, amount_lbp) VALUES (1, 'New expense', 2, 0)`).run();
    checkpoint(k, "2026-11-10", "General");
    checkpoint(k, "2026-11-10", "OMT_System");
    txn(k, TRANSACTION_TYPES.SALE);
    txn(k, TRANSACTION_TYPES.SUPPLIER_SETTLEMENT);
    txn(k, TRANSACTION_TYPES.SUPPLIER_SETTLEMENT);
    txn(k, TRANSACTION_TYPES.PARTNER_SETTLEMENT);
    k.close();
  });

  it("shows the copy's last recorded sale with its client", () => {
    const p = repo.previewCandidate({ candidatePath, currentPath, tenantId: 1, userId: 1 });
    // What the customer was charged: final $12.50 + the $1.50 extra.
    expect(p.lastSaleInCopy).toEqual({ at: "2026-11-10T11:58:41Z", amount: 14, currency: "USD", client: "Rami" });
  });

  it("counts what the live file holds beyond the copy, by id (a backdated sale still counts)", () => {
    const p = repo.previewCandidate({ candidatePath, currentPath, tenantId: 1, userId: 1 });
    expect(p.lost).toEqual({
      sales: { count: 3, totalUsd: 50 },
      payments: 5,
      expenses: 1,
      dayClosings: 1,
      checkpoints: 2,
      settlements: { suppliers: 2, partners: 1, loto: 0 },
      // Gross, per currency: neither list nets the other.
      moneyIn: [
        { currency: "LBP", amount: 900000 },
        { currency: "USD", amount: 50 },
      ],
      moneyOut: [{ currency: "USD", amount: 9 }],
    });
  });

  it("youAreMissing only when the asking admin is absent from the copy", () => {
    expect(repo.previewCandidate({ candidatePath, currentPath, tenantId: 1, userId: 1 }).youAreMissing).toBe(false);
    expect(repo.previewCandidate({ candidatePath, currentPath, tenantId: 1, userId: newAdminId }).youAreMissing).toBe(true);
  });

  it("nothing is lost and no sale is shown when the copy equals an empty shop", () => {
    fs.copyFileSync(template, candidatePath);
    fs.copyFileSync(template, currentPath);
    const p = repo.previewCandidate({ candidatePath, currentPath, tenantId: 1, userId: 1 });
    expect(p).toEqual({
      lastSaleInCopy: null,
      lost: {
        sales: { count: 0, totalUsd: 0 },
        payments: 0,
        expenses: 0,
        dayClosings: 0,
        checkpoints: 0,
        settlements: { suppliers: 0, partners: 0, loto: 0 },
        moneyIn: [],
        moneyOut: [],
      },
      youAreMissing: false,
    });
  });

  it("never writes the live file", () => {
    const before = fs.readFileSync(currentPath);
    repo.previewCandidate({ candidatePath, currentPath, tenantId: 1, userId: 1 });
    expect(fs.readFileSync(currentPath).equals(before)).toBe(true);
  });
});
