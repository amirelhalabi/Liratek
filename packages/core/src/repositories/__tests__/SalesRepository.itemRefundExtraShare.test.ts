/**
 * LIRA-319 US3 (T033–T035) — refunding ONE item of a sale with an extra
 * gives back that item's share of the extra, by its share of the sale.
 *
 * Items $10 + $5, extra $3, paid $18 cash. Refunding the $5 item (a third of
 * the sale) hands back $6.00 = $5 + $1 extra share; the REFUND row carries
 * `extra_usd −1`, so "Extra charges" reads $2; undoing the refund brings it
 * back to $3. The share is computed on the server, never sent by the client.
 *
 * The preview and the drawer money-back already scaled the sale's payments
 * (which include the extra) by the line share, so the "preview legs = 6.00"
 * and "drawer −6" assertions are regression guards, NOT failing-first. The
 * REFUND row's amount / extra and the undo's extra are failing-first.
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

/** Two items, $10 and $5 (cost $5 each) — $15 before the extra. */
function payload(extra: Partial<SalePayload>): SalePayload {
  return {
    client_id: null,
    items: [
      { product_id: addProduct(), quantity: 1, price: 10 },
      { product_id: addProduct(), quantity: 1, price: 5 },
    ],
    total_amount: 15,
    discount: 0,
    final_amount: 15,
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

function sellWithExtra(): { saleId: number; fiveItemId: number } {
  const res = repo.processSale(
    sale({
      extra_usd: 3,
      payments: [{ method: "CASH", currency_code: "USD", amount: 18 }],
    }),
    USER_ID,
  );
  expect(res.success).toBe(true);
  const five = db
    .prepare(`SELECT id FROM sale_items WHERE sale_id = ? AND sold_price_usd = 5`)
    .get(res.id) as { id: number };
  return { saleId: res.id!, fiveItemId: five.id };
}

function refundRow(id: number) {
  return db
    .prepare(`SELECT amount_usd, profit_usd, extra_usd, extra_lbp FROM transactions WHERE id = ?`)
    .get(id) as { amount_usd: number; profit_usd: number; extra_usd: number; extra_lbp: number };
}

describe("item refund returns the item's share of the extra", () => {
  it("preview legs = 6.00 (regression guard — already scaled the payments)", () => {
    const { saleId, fiveItemId } = sellWithExtra();
    const preview = repo.getItemRefundPreview({
      saleId,
      saleItemId: fiveItemId,
      refundQuantity: 1,
    });
    const total = preview.legs.reduce((s, l) => s + l.amount, 0);
    expect(total).toBeCloseTo(6, 6);
  });

  it("refund the $5 item: drawer −6, REFUND amount −6 / extra −1, Extra charges 2 (failing-first)", () => {
    const { saleId, fiveItemId } = sellWithExtra();
    const afterSale = snapshotLedgers(db);
    expect(activeExtra()).toEqual({ usd: 3, lbp: 0 });
    const refundId = repo.refundSaleItem({
      saleId,
      saleItemId: fiveItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    expectPostings(afterSale, snapshotLedgers(db), {
      drawers: { "General|USD": -6 },
    });
    const row = refundRow(refundId);
    expect(row.amount_usd).toBeCloseTo(-6, 6);
    expect(row.profit_usd).toBeCloseTo(0, 6); // $5 item at cost $5: no margin
    expect(row.extra_usd).toBeCloseTo(-1, 6);
    expect(row.extra_lbp).toBe(0);
    expect(activeExtra()).toEqual({ usd: 2, lbp: 0 });
  });

  it("undo the refund: extra back to 3, every ledger as after the sale (failing-first)", () => {
    const { saleId, fiveItemId } = sellWithExtra();
    const afterSale = snapshotLedgers(db);
    const refundId = repo.refundSaleItem({
      saleId,
      saleItemId: fiveItemId,
      refundQuantity: 1,
      userId: USER_ID,
    });
    const undoId = repo.undoSaleItemRefund({
      refundTransactionId: refundId,
      userId: USER_ID,
    });
    const undo = refundRow(undoId);
    expect(undo.amount_usd).toBeCloseTo(6, 6);
    expect(undo.extra_usd).toBeCloseTo(1, 6);
    expect(activeExtra()).toEqual({ usd: 3, lbp: 0 });
    expectPostings(afterSale, snapshotLedgers(db), {});
  });

  it("refund both items one by one: the shares add up to the whole extra, ledgers net to 0", () => {
    const before = snapshotLedgers(db);
    const { saleId, fiveItemId } = sellWithExtra();
    const ten = db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ? AND sold_price_usd = 10`)
      .get(saleId) as { id: number };
    repo.refundSaleItem({ saleId, saleItemId: fiveItemId, refundQuantity: 1, userId: USER_ID });
    repo.refundSaleItem({ saleId, saleItemId: ten.id, refundQuantity: 1, userId: USER_ID });
    expect(activeExtra()).toEqual({ usd: 0, lbp: 0 });
    expectPostings(before, snapshotLedgers(db), {});
  });
});
