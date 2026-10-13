/**
 * LIRA-319 (owner decision 2026-10-14) — a POS sale saved as a DRAFT keeps
 * its extra and restores it on resume; completing the draft books exactly
 * what a direct sale with the same extra books.
 *
 * A draft writes no transactions row, so before v213 the extra had nowhere
 * to live: it was dropped on save and the resumed draft came back without
 * it. Payloads are parsed through `saleProcessSchema` (rule 24).
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
import { resetTransactionRepository } from "../TransactionRepository";
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

describe("a draft keeps its extra (failing-first)", () => {
  it("save a $6 draft with a $1 extra → findDrafts returns extra_usd 1; no money moves", () => {
    const before = snapshotLedgers(db);
    const res = repo.processSale(sale({ status: "draft", extra_usd: 1 }), USER_ID);
    expect(res.success).toBe(true);
    const draft = repo.findDrafts().find((d) => d.id === res.id);
    expect(draft?.extra_usd).toBe(1);
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE source_id = ?`).get(res.id),
    ).toEqual({ c: 0 });
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("an autosave re-save without the extra clears it (the payload is the truth)", () => {
    const res = repo.processSale(sale({ status: "draft", extra_usd: 1 }), USER_ID);
    repo.processSale(sale({ status: "draft", id: res.id }), USER_ID);
    expect(repo.findDrafts().find((d) => d.id === res.id)?.extra_usd).toBe(0);
  });

  it("resume → complete: SALE amount 7, extra 1, General +7; the sale row keeps extra 1", () => {
    const draftRes = repo.processSale(sale({ status: "draft", extra_usd: 1 }), USER_ID);
    const draft = repo.findDrafts().find((d) => d.id === draftRes.id)!;
    const before = snapshotLedgers(db);
    // The resumed checkout sends back what the draft restored.
    const res = repo.processSale(
      sale({
        id: draft.id,
        status: "completed",
        extra_usd: draft.extra_usd,
        payments: [{ method: "CASH", currency_code: "USD", amount: 7 }],
      }),
      USER_ID,
    );
    expect(res).toEqual({ success: true, id: draft.id });
    const txn = saleTxn(draft.id);
    expect(txn.amount_usd).toBeCloseTo(7, 6);
    expect(txn.extra_usd).toBeCloseTo(1, 6);
    expect(txn.profit_usd).toBeCloseTo(1, 6);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 7 },
    });
    expect(
      db.prepare(`SELECT extra_usd, final_amount_usd FROM sales WHERE id = ?`).get(draft.id),
    ).toEqual({ extra_usd: 1, final_amount_usd: 6 });
  });
});
