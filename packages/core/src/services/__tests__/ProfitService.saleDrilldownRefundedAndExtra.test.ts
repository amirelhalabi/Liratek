/**
 * LIRA-394 — Profits > By module > Sales > "Show transactions".
 *
 * Owner audit of Cornertech (2026-11-16):
 *  - a fully refunded sale that had been put on the client's account showed
 *    under "not counted yet" as "Customer still owes — paid $265.00 of
 *    $1135.00." (sale #557). Nobody owes anything on a refunded sale;
 *  - fully refunded sales with nothing left to count were listed as
 *    counted rows of 0 / 0 / 0 with no detail (sale #542 and ten others);
 *  - a $18 sale with a $2 extra, all on the account, read "paid $-2.00 of
 *    $18.00." (sale #565) — the customer owes $20 and has paid $0.
 *
 * Real schema (`create_db.sql` + `runMigrations`) and the real writers:
 * `SalesRepository.processSale` / `refundSaleItem`,
 * `TransactionRepository.refundBySaleId`, `DebtRepository.addRepayment`.
 *
 * Rule 17: written first and seen failing on the unfixed code.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { ProfitRepository } from "../../repositories/ProfitRepository";
import { ProfitService } from "../ProfitService";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import {
  DebtRepository,
  resetDebtRepository,
} from "../../repositories/DebtRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import {
  SalesRepository,
  resetSalesRepository,
  type SaleRequest,
} from "../../repositories/SalesRepository";
import { resetVoucherRepository } from "../../repositories/VoucherRepository";
import { saleProcessSchema } from "../../validators/sale";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const RATE = 90_000;

let db: Database.Database;
let clientId: number;

function resetAll(): void {
  resetTransactionRepository();
  resetClientRepository();
  resetDebtRepository();
  resetSettingsRepository();
  resetSalesRepository();
  resetVoucherRepository();
}

function wideRange(): { from: string; to: string } {
  const now = Date.now();
  const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: d(now - 3 * 86_400_000), to: d(now + 3 * 86_400_000) };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(
    fs.readFileSync(path.join(REPO_ROOT, "electron-app/create_db.sql"), "utf8"),
  );
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  resetAll();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username) VALUES (1, 'owner')`,
  ).run();
  clientId = Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Account Client', '70111222')`,
      )
      .run().lastInsertRowid,
  );
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetAll();
  resetTenantContext();
  db.close();
});

let productSeq = 0;
function addProduct(name: string, cost: number, price: number): number {
  productSeq += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Accessory', ?, ?, 10)`,
      )
      .run(`${name} ${productSeq}`, cost, price).lastInsertRowid,
  );
}

type Leg = { method: string; currency_code: string; amount: number };

/** One-line POS sale as CheckoutModal sends it. */
function posSale(opts: {
  price: number;
  cost: number;
  extraUsd?: number;
  payments: Leg[];
  quantity?: number;
}): number {
  const quantity = opts.quantity ?? 1;
  const total = opts.price * quantity;
  const request = saleProcessSchema.parse({
    client_id: clientId,
    items: [
      {
        product_id: addProduct("Phone", opts.cost, opts.price),
        quantity,
        price: opts.price,
      },
    ],
    total_amount: total,
    discount: 0,
    final_amount: total,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    ...(opts.extraUsd ? { extra_usd: opts.extraUsd } : {}),
    payments: opts.payments,
  }) as SaleRequest;
  const res = new SalesRepository().processSale(request, 1);
  expect(res.success).toBe(true);
  return res.id!;
}

function repay(amountUsd: number): void {
  new DebtRepository().addRepayment({
    client_id: clientId,
    amount_usd: amountUsd,
    amount_lbp: 0,
    created_by: 1,
  });
}

function saleDetail() {
  const { from, to } = wideRange();
  return new ProfitService(new ProfitRepository()).getModuleDetail(
    "SALE",
    from,
    to,
  );
}

function rowsFor(saleId: number) {
  const d = saleDetail();
  return [...d.counted, ...d.not_counted].filter((r) => r.id === saleId);
}

describe("US1 — a refunded sale never claims the customer still owes", () => {
  it("a cash-paid sale refunded whole (POS 'Refund Sale') is not listed at all", () => {
    const saleId = posSale({
      price: 100,
      cost: 60,
      payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
    });
    new TransactionRepository().refundBySaleId(saleId, 1);
    expect(rowsFor(saleId)).toEqual([]);
  });

  it("a sale on the account refunded whole is not listed at all (Cornertech #557)", () => {
    const saleId = posSale({
      price: 1135,
      cost: 900,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 265 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 870 },
      ],
    });
    new TransactionRepository().refundBySaleId(saleId, 1);
    expect(rowsFor(saleId)).toEqual([]);
  });

  it("a sale on the account refunded line by line until nothing is left is not listed at all", () => {
    const saleId = posSale({
      price: 50,
      cost: 30,
      quantity: 2,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 100 },
      ],
    });
    const item = db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
      .get(saleId) as { id: number };
    const sales = new SalesRepository();
    sales.refundSaleItem({
      saleId,
      saleItemId: item.id,
      refundQuantity: 1,
      userId: 1,
    });
    sales.refundSaleItem({
      saleId,
      saleItemId: item.id,
      refundQuantity: 1,
      userId: 1,
    });
    const status = db
      .prepare(`SELECT status FROM sales WHERE id = ?`)
      .get(saleId) as { status: string };
    expect(status.status).toBe("refunded");
    expect(rowsFor(saleId)).toEqual([]);
  });

  it("no sale row in the drill-down ever has a null detail or a negative paid figure", () => {
    posSale({
      price: 18,
      cost: 10,
      extraUsd: 2,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 20 },
      ],
    });
    const refunded = posSale({
      price: 40,
      cost: 20,
      payments: [{ method: "CASH", currency_code: "USD", amount: 40 }],
    });
    new TransactionRepository().refundBySaleId(refunded, 1);
    const d = saleDetail();
    for (const r of [...d.counted, ...d.not_counted]) {
      expect(r.detail).not.toBeNull();
      expect(r.reason ?? "").not.toMatch(/\$-/);
    }
  });
});

describe("US2 — paid / owed include the extra and are never negative", () => {
  it("$18 + $2 extra, all on the account, nothing paid → 'paid $0.00 of $20.00.' (Cornertech #565)", () => {
    const saleId = posSale({
      price: 18,
      cost: 10,
      extraUsd: 2,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 20 },
      ],
    });
    const [row] = rowsFor(saleId);
    expect(row.reason).toBe("Customer still owes — paid $0.00 of $20.00.");
    expect(row.counted_pct).toBe(0);
  });

  it("after a $10 repayment → 'paid $10.00 of $20.00.', counted % unchanged (no recognition change)", () => {
    const saleId = posSale({
      price: 18,
      cost: 10,
      extraUsd: 2,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 20 },
      ],
    });
    repay(10);
    const [row] = rowsFor(saleId);
    expect(row.reason).toBe("Customer still owes — paid $10.00 of $20.00.");
    expect(row.counted_pct).toBe(0);
  });

  it("paid in LBP only → paid is the USD equivalent at the sale's rate", () => {
    const saleId = posSale({
      price: 100,
      cost: 60,
      payments: [
        { method: "CASH", currency_code: "LBP", amount: 45 * RATE },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 55 },
      ],
    });
    const [row] = rowsFor(saleId);
    expect(row.reason).toBe("Customer still owes — paid $45.00 of $100.00.");
  });
});

describe("US1.2 — a refunded sale that still carries a residual stays listed", () => {
  // No real writer leaves a residual on a whole refund today (the REFUND row
  // negates the SALE stamp exactly), so the residual is simulated on the
  // REFUND row the real refund wrote — the same shape
  // `seedRefundedSaleWithResidualProfit` pins in the reconciliation suite.
  function refundWithResidual(saleId: number, residualUsd: number): void {
    new TransactionRepository().refundBySaleId(saleId, 1);
    db.prepare(
      `UPDATE transactions SET profit_usd = profit_usd + ?
        WHERE source_table = 'sales' AND source_id = ? AND type = 'REFUND'`,
    ).run(residualUsd, saleId);
  }

  it("paid sale: counted 100 %, detail names the refunded lines, no reason", () => {
    const saleId = posSale({
      price: 40,
      cost: 20,
      payments: [{ method: "CASH", currency_code: "USD", amount: 40 }],
    });
    refundWithResidual(saleId, 5);
    const rows = rowsFor(saleId);
    expect(rows).toHaveLength(1);
    expect(rows[0].counted_pct).toBe(100);
    expect(rows[0].counted_profit_usd).toBeCloseTo(5, 6);
    expect(rows[0].detail).toMatch(/^Refunded: Phone \d+ x1$/);
    expect(rows[0].reason).toBeNull();
  });

  it("sale that was on the account: reason starts 'Refunded — ' and never says the customer still owes", () => {
    const saleId = posSale({
      price: 40,
      cost: 20,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 40 },
      ],
    });
    refundWithResidual(saleId, 5);
    const [row] = rowsFor(saleId);
    expect(row.counted_pct).toBe(0);
    expect(row.reason).toBe(
      "Refunded — not counted: the sale was not paid in full.",
    );
    expect(row.reason).not.toMatch(/still owes/);
  });
});
