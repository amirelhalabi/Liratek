/**
 * POS sale — kept change is checked on the server (POSTING_MAP G42, owner
 * decisions 2026-10-07, docs/FEATURE_GUIDE.md §4.1 "Kept change").
 *
 * The POS checkout (CheckoutModal, payer = customer) sends the customer's
 * tender as IN legs, the cash handed back as `change_given_usd/lbp`, and
 * whatever the cashier did not hand back as `kept_change_usd/lbp`. Before
 * this fix `processSale` added the claimed kept straight into the profit
 * stamp without checking it against the legs. It now runs
 * `resolveKeptChange` (customer kind: IN − change − kept = final amount,
 * kept ≤ real excess) and stamps the RESOLVED amount.
 *
 * Real production schema (create_db.sql + migrations); nothing is mocked.
 * Field names come from `saleProcessSchema` — every fixture is typed as the
 * schema's input and parsed through it before reaching the repository
 * (rule 24).
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
  ledgerDeltas,
  expectPostings,
} from "../testHelpers/postingAssert";

type SalePayload = z.input<typeof saleProcessSchema>;

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const RATE = 89_500;
const PRICE = 13.37;
const COST = 5;

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
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

let db: Database.Database;
let repo: SalesRepository;

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

function addPartner(): number {
  return Number(
    db
      .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, ?)`)
      .run(`Partner ${Math.random()}`).lastInsertRowid,
  );
}

/** A one-item $13.37 sale (cost $5) — the CheckoutModal payload shape. */
function sale(extra: Partial<SalePayload>): SaleRequest {
  const payload: SalePayload = {
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
  return saleProcessSchema.parse(payload) as SaleRequest;
}

function saleTxn(saleId: number) {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp, status FROM transactions
        WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE' AND reverses_id IS NULL`,
    )
    .get(saleId) as
    | { id: number; profit_usd: number; profit_lbp: number; status: string }
    | undefined;
}

function txnCount(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM transactions`).get() as { c: number }
  ).c;
}

/** Profit as every profit query reads it: ACTIVE rows only. */
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

describe("POS sale — accepted kept change (regression guards: passed before the fix too)", () => {
  it("cross-currency partial keep: $20 paid, 520,000 LBP back, $0.82 kept — profit stamp includes it, void nets to 0", () => {
    // Excess = 20 − 13.37 = $6.63; 520,000 LBP at 89,500 = $5.81006 back;
    // what is left = $0.81994, which MultiPaymentInput reports rounded to
    // cents in the TENDER currency (USD) → $0.82 (rounded UP by $0.00006 —
    // the helper's strict "kept ≤ real excess" check must allow that).
    const before = snapshotLedgers(db);
    const res = repo.processSale(
      sale({
        payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
        change_given_usd: 0,
        change_given_lbp: 520_000,
        kept_change_usd: 0.82,
        kept_change_lbp: 0,
      }),
      USER_ID,
    );
    expect(res).toEqual({ success: true, id: expect.any(Number) });
    const txn = saleTxn(res.id!)!;
    expect(txn.profit_usd).toBeCloseTo(PRICE - COST + 0.82, 6);
    expect(txn.profit_lbp).toBe(0);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 20, "General|LBP": -520_000 },
    });

    getTransactionRepository().voidTransaction(txn.id, USER_ID);
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(activeProfit()).toEqual({ usd: 0, lbp: 0 });
  });

  it("same-currency partial keep: $20 paid, $6 back, $0.63 kept", () => {
    const before = snapshotLedgers(db);
    const res = repo.processSale(
      sale({
        payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
        change_given_usd: 6,
        kept_change_usd: 0.63,
      }),
      USER_ID,
    );
    expect(res.success).toBe(true);
    expect(saleTxn(res.id!)!.profit_usd).toBeCloseTo(PRICE - COST + 0.63, 6);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 14 },
    });
  });

  it("LBP keep from an LBP tender: 1,250,000 LBP paid, 50,000 back, 3,385 LBP kept → profit_lbp", () => {
    // 1,250,000 LBP = $13.96648; due $13.37 = 1,196,615 LBP; excess
    // 53,385 LBP; 50,000 back → 3,385 LBP kept (whole LBP, tender currency).
    const res = repo.processSale(
      sale({
        payments: [{ method: "CASH", currency_code: "LBP", amount: 1_250_000 }],
        change_given_lbp: 50_000,
        kept_change_lbp: 3_385,
      }),
      USER_ID,
    );
    expect(res.success).toBe(true);
    const txn = saleTxn(res.id!)!;
    expect(txn.profit_usd).toBeCloseTo(PRICE - COST, 6);
    expect(txn.profit_lbp).toBe(3_385);
  });

  it("no kept claim: a partial payment still books the remainder as Sale Debt (unchanged)", () => {
    const clientId = addClient();
    const before = snapshotLedgers(db);
    const res = repo.processSale(
      sale({
        client_id: clientId,
        payments: [{ method: "CASH", currency_code: "USD", amount: 5 }],
      }),
      USER_ID,
    );
    expect(res.success).toBe(true);
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.drawers).toEqual({ "General|USD": 5 });
    expect(d.debt[`${clientId}|USD`]).toBeCloseTo(PRICE - 5, 6);
  });
});

describe("POS sale — kept change the legs do not support is refused (failing-first)", () => {
  function expectRefused(payload: SaleRequest, message: RegExp): void {
    const before = snapshotLedgers(db);
    const txnsBefore = txnCount();
    const res = repo.processSale(payload, USER_ID);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(message);
    expectPostings(before, snapshotLedgers(db), {});
    expect(txnCount()).toBe(txnsBefore);
  }

  it("a tampered kept far above the real change", () => {
    expectRefused(
      sale({
        payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
        change_given_usd: 6,
        kept_change_usd: 5,
      }),
      /do not reconcile/,
    );
  });

  it("kept plus change handed back exceeds what the customer overpaid", () => {
    expectRefused(
      sale({
        payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
        change_given_usd: 6.63,
        kept_change_usd: 0.5,
      }),
      /do not reconcile/,
    );
  });

  it("a phantom kept on an exact payment, small enough to slip inside the $0.05 reconcile epsilon", () => {
    expectRefused(
      sale({
        payments: [{ method: "CASH", currency_code: "USD", amount: PRICE }],
        kept_change_usd: 0.04,
      }),
      /more than the change actually due/,
    );
  });

  it("cross-currency: a kept LBP claim on top of a full LBP change", () => {
    // $20 paid, the whole $6.63 handed back as 593,385 LBP — nothing left to
    // keep, yet 3,000 LBP (≈ $0.034, inside the epsilon) is claimed.
    expectRefused(
      sale({
        payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
        change_given_lbp: 593_385,
        kept_change_lbp: 3_000,
      }),
      /more than the change actually due/,
    );
  });

  it("a kept claim on a for-partner sale (exact amount required)", () => {
    expectRefused(
      sale({
        partnerId: addPartner(),
        partnerMode: "FOR",
        payments: [],
        kept_change_usd: 1,
      }),
      /partner/i,
    );
  });

  it("a kept claim on a session-basket (deferred) sale, whose payment the basket owns", () => {
    const payload = sale({ kept_change_usd: 1 });
    expectRefused({ ...payload, deferPayment: true }, /session/i);
  });
});
