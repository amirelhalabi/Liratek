/**
 * LIRA-319 US3 (T031/T032) — voiding or fully refunding a POS sale that
 * carried an extra nets every ledger to 0 per currency, and the extra leaves
 * the "Extra charges" figure (Σ extra_* over ACTIVE rows, research R3).
 *
 * Void: the original goes VOIDED (leaves every ACTIVE-gated query) and
 * `_reversePayments` returns the money — no new code expected, so that case
 * is NOT proven failing-first (it passed before T032). Full refund: the
 * REFUND row is a raw INSERT in `_createRefundRow`, which had no extra
 * columns — failing-first.
 *
 * Real production schema; payloads parsed through `saleProcessSchema`.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { z } from "zod";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  SalesRepository,
  resetSalesRepository,
  type SaleRequest,
} from "../SalesRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { saleProcessSchema } from "../../validators/sale";
import {
  snapshotLedgers,
  expectPostings,
} from "../testHelpers/postingAssert";

type SalePayload = z.input<typeof saleProcessSchema>;

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const RATE = 89_500;
const PRICE = 6;
const COST = 5;

let db: Database.Database;
let repo: SalesRepository;

function buildDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(d);
  runMigrations(d);
  return d;
}

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetPartnerRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetDebtService();
}

function addProduct(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', ?, ?, 10)`,
      )
      .run(`P-${Math.random()}`, COST, PRICE).lastInsertRowid,
  );
}

function addClient(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`,
      )
      .run(`Client ${Math.random()}`, `03${Math.floor(Math.random() * 1e6)}`)
      .lastInsertRowid,
  );
}

/** A one-item $6 sale (cost $5) as CheckoutModal sends it. */
function payload(extra: Partial<SalePayload>): SalePayload {
  return {
    client_id: null,
    items: [{ product_id: addProduct(), quantity: 1, price: PRICE }],
    total_amount: PRICE,
    discount: 0,
    final_amount: PRICE,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    ...extra,
  };
}

function sale(extra: Partial<SalePayload>): SaleRequest {
  return saleProcessSchema.parse(payload(extra)) as SaleRequest;
}

interface SaleTxnRow {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  extra_usd: number;
  extra_lbp: number;
  metadata_json: string | null;
}

function saleTxn(saleId: number): SaleTxnRow {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, extra_usd, extra_lbp, metadata_json
         FROM transactions
        WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
    )
    .get(saleId) as SaleTxnRow;
}

function txnCount(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM transactions`).get() as { c: number }
  ).c;
}

beforeEach(() => {
  resetAll();
  db = buildDb();
  initFixedTenantContext(1);
  repo = new SalesRepository();
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

/** Σ extra over the rows every profit query reads (ACTIVE, REFUND included). */
function activeExtra(): { usd: number; lbp: number } {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(extra_usd), 0) AS usd, COALESCE(SUM(extra_lbp), 0) AS lbp
         FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
  return { usd: Math.round(r.usd * 1e6) / 1e6, lbp: Math.round(r.lbp * 1e6) / 1e6 };
}

/** Σ profit over ACTIVE rows (item margin only — the extra is never in it). */
function activeProfitUsd(): number {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number };
  return Math.round(r.usd * 1e6) / 1e6;
}

function sellWithExtra(): { saleId: number; txnId: number } {
  const res = repo.processSale(
    sale({
      extra_usd: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 7 }],
    }),
    USER_ID,
  );
  expect(res.success).toBe(true);
  return { saleId: res.id!, txnId: saleTxn(res.id!).id };
}

describe("void (not proven failing-first — the generic void needed no change)", () => {
  it("$6 + $1 extra cash → void: drawer −7, extra and item profit back to 0", () => {
    const before = snapshotLedgers(db);
    const { txnId } = sellWithExtra();
    const afterSale = snapshotLedgers(db);
    expect(activeExtra()).toEqual({ usd: 1, lbp: 0 });
    getTransactionRepository().voidTransaction(txnId, USER_ID);
    expectPostings(afterSale, snapshotLedgers(db), {
      drawers: { "General|USD": -7 },
    });
    expectPostings(before, snapshotLedgers(db), {});
    expect(activeExtra()).toEqual({ usd: 0, lbp: 0 });
    expect(activeProfitUsd()).toBe(0);
  });
});

describe("full refund (failing-first)", () => {
  it("REFUND row: amount −7, extra −1, profit −1; every ledger nets to 0", () => {
    const before = snapshotLedgers(db);
    const { saleId, txnId } = sellWithExtra();
    const refundId = getTransactionRepository().refundBySaleId(saleId, USER_ID);
    const row = db
      .prepare(
        `SELECT type, reverses_id, amount_usd, amount_lbp, profit_usd, extra_usd, extra_lbp
           FROM transactions WHERE id = ?`,
      )
      .get(refundId) as Record<string, unknown>;
    expect(row).toEqual({
      type: "REFUND",
      reverses_id: txnId,
      amount_usd: -7,
      amount_lbp: 0,
      profit_usd: -1,
      extra_usd: -1,
      extra_lbp: 0,
    });
    expectPostings(before, snapshotLedgers(db), {});
    expect(activeExtra()).toEqual({ usd: 0, lbp: 0 });
    expect(activeProfitUsd()).toBe(0);
  });
});
