/**
 * LIRA-329 T038 — a void, a refund and an undone refund say which
 * transaction they reverse (`reversal` details: `originalTransactionId`,
 * and the returned phones' flags as `refundUnits`), and keep the ORIGINAL
 * transaction's client name and phone on their own row.
 *
 * Covers the two direct INSERTs (void, whole refund) and the
 * `createTransaction` writers of an item refund and its undo. A reversal is
 * not a payment: no `payment_snapshot` (its legs are written by
 * `_reversePayments` after the row exists).
 *
 * Money: each reversal's amount and profit are asserted at today's values
 * first (FR-008). Expected details go through the kind's own schema
 * (rule 24). Rule 17: run before the change and seen failing.
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
import {
  SalesRepository,
  resetSalesRepository,
  type SaleRequest,
} from "../SalesRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getStockBatchRepository,
  resetStockBatchRepository,
} from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import { saleProcessSchema } from "../../validators/sale";
import { reversalDetailsSchema } from "../../validators/transactionDetails";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const USER_ID = 1;
const RATE = 90_000;
let db: Database.Database;

interface TxnRow {
  id: number;
  type: string;
  amount_usd: number;
  profit_usd: number;
  client_name: string | null;
  client_phone: string | null;
  metadata_json: string | null;
}

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetPartnerRepository();
  resetVoucherRepository();
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
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

function addProduct(
  name: string,
  stock: number,
  cost: number,
  price: number,
): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', 'Phones', ?, ?, ?)`,
      )
      .run(name, cost, price, stock).lastInsertRowid,
  );
  getStockBatchRepository().createBatch({
    product_id: id,
    supplier_id: null,
    quantity: stock,
    unit_cost_usd: cost,
    books_debt: false,
    created_by: USER_ID,
  });
  return id;
}

function addUnit(productId: number, imei: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO product_units (tenant_id, product_id, imei, status) VALUES (1, ?, ?, 'IN_STOCK')`,
      )
      .run(productId, imei).lastInsertRowid,
  );
}

const COLS =
  "id, type, amount_usd, profit_usd, client_name, client_phone, metadata_json";

function txn(id: number): TxnRow {
  return db
    .prepare(`SELECT ${COLS} FROM transactions WHERE id = ?`)
    .get(id) as TxnRow;
}

/** Sell through the shared schema (both transports validate with it). */
function sell(payload: Record<string, unknown>): {
  saleId: number;
  row: TxnRow;
} {
  const sale = saleProcessSchema.parse({
    exchange_rate: RATE,
    status: "completed",
    client_day: "2026-10-16",
    discount: 0,
    payment_lbp: 0,
    ...payload,
  }) as SaleRequest;
  const r = new SalesRepository().processSale(sale, USER_ID);
  expect(r).toMatchObject({ success: true });
  const row = db
    .prepare(
      `SELECT ${COLS} FROM transactions WHERE type = 'SALE' AND source_table = 'sales' AND source_id = ?`,
    )
    .get(r.id) as TxnRow;
  return { saleId: r.id as number, row };
}

function details(row: TxnRow): unknown {
  return row.metadata_json
    ? (JSON.parse(row.metadata_json) as Record<string, unknown>).details
    : undefined;
}

function snapshot(row: TxnRow): unknown {
  return row.metadata_json
    ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
        .payment_snapshot
    : undefined;
}

function expectReversal(row: TxnRow, expected: Record<string, unknown>): void {
  expect(reversalDetailsSchema.parse(expected)).toEqual(expected);
  expect(details(row)).toEqual(expected);
  expect(snapshot(row)).toBeUndefined();
}

describe("LIRA-329 — reversal details and the original's client on voids and refunds", () => {
  it("a void names the voided transaction and keeps the picked client's name and phone", () => {
    const p = addProduct("Charger", 5, 6, 15);
    const { row: sale } = sell({
      client_id: 7,
      items: [{ product_id: p, quantity: 1, price: 15 }],
      total_amount: 15,
      final_amount: 15,
      payment_usd: 15,
      payments: [{ method: "CASH", currency_code: "USD", amount: 15 }],
    });
    expect(sale.client_name).toBe("Rami Haddad");

    const voidId = getTransactionRepository().voidTransaction(sale.id, USER_ID);
    const v = txn(voidId);
    // FR-008 — today's reversal amount.
    expect(v.amount_usd).toBe(-15);
    expect(v.client_name).toBe("Rami Haddad");
    expect(v.client_phone).toBe("71123456");
    expectReversal(v, {
      v: 1,
      kind: "reversal",
      originalTransactionId: sale.id,
    });
  });

  it("a whole refund names the original, lists the returned phone's flags, and keeps a typed walk-in's name and phone", () => {
    const p = addProduct("iPhone 12", 1, 300, 400);
    const unitId = addUnit(p, "356000000000077");
    const { row: sale } = sell({
      client_id: null,
      client_name: "Ali",
      client_phone: "70999888",
      items: [
        { product_id: p, quantity: 1, price: 400, product_unit_id: unitId },
      ],
      total_amount: 400,
      final_amount: 400,
      payment_usd: 400,
      payments: [{ method: "CASH", currency_code: "USD", amount: 400 }],
    });
    expect(sale.client_name).toBe("Ali");

    const refundId = getTransactionRepository().refundTransaction(
      sale.id,
      USER_ID,
      {
        refundUnitExtras: [
          {
            unit_id: unitId,
            is_defective: true,
            warranty_override_until: "2027-01-31",
          },
        ],
      },
    );
    const r = txn(refundId);
    expect(r.type).toBe("REFUND");
    // FR-008 — today's reversal amount and profit.
    expect(r.amount_usd).toBe(-400);
    expect(r.profit_usd).toBe(-100);
    expect(r.client_name).toBe("Ali");
    expect(r.client_phone).toBe("70999888");
    expectReversal(r, {
      v: 1,
      kind: "reversal",
      originalTransactionId: sale.id,
      refundUnits: [
        { unitId, flags: ["DEFECTIVE", "WARRANTY_UNTIL:2027-01-31"] },
      ],
    });
  });

  it("an item refund and its undo each name what they reverse and keep the client", () => {
    const p = addProduct("Galaxy A15", 2, 120, 180);
    const unitId = addUnit(p, "356000000000099");
    const { saleId, row: sale } = sell({
      client_id: 7,
      items: [
        { product_id: p, quantity: 1, price: 180, product_unit_id: unitId },
      ],
      total_amount: 180,
      final_amount: 180,
      payment_usd: 180,
      payments: [{ method: "CASH", currency_code: "USD", amount: 180 }],
    });
    const saleItemId = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(saleId) as {
        id: number;
      }
    ).id;

    const refundId = new SalesRepository().refundSaleItem({
      saleId,
      saleItemId,
      refundQuantity: 1,
      userId: USER_ID,
      unitExtras: [
        { unit_id: unitId, is_defective: false, warranty_override_until: null },
      ],
    });
    const r = txn(refundId);
    expect(r.type).toBe("REFUND");
    // FR-008 — today's item refund.
    expect(r.amount_usd).toBe(-180);
    expect(r.profit_usd).toBe(-60);
    expect(r.client_name).toBe("Rami Haddad");
    expect(r.client_phone).toBe("71123456");
    expectReversal(r, {
      v: 1,
      kind: "reversal",
      originalTransactionId: sale.id,
      refundUnits: [
        { unitId, flags: ["NOT_DEFECTIVE", "WARRANTY_OVERRIDE_CLEARED"] },
      ],
    });

    const undoId = new SalesRepository().undoSaleItemRefund({
      refundTransactionId: refundId,
      userId: USER_ID,
    });
    const u = txn(undoId);
    expect(u.type).toBe("REFUND_UNDO");
    expect(u.amount_usd).toBe(180);
    expect(u.profit_usd).toBe(60);
    expect(u.client_name).toBe("Rami Haddad");
    expect(u.client_phone).toBe("71123456");
    expectReversal(u, {
      v: 1,
      kind: "reversal",
      originalTransactionId: refundId,
    });
  });
});
