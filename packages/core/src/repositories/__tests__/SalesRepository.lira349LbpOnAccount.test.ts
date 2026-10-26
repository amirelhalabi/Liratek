/**
 * LIRA-349 A1 — a POS sale whose CUSTOMER_ACCOUNT leg is in LBP must be owed
 * in LBP.
 *
 * Found on the test tenant (2026-10-27, tx 13101): a $25 sale put on the
 * account as 2,225,000 LBP booked a 'Sale Debt' row of amount_usd 25 /
 * amount_lbp null, so the client's USD balance rose and the LBP balance did
 * not. Every other module keeps an LBP on-account leg in LBP.
 *
 * Each case runs the REAL `processSale` (payload parsed by the real schema)
 * over the full create_db.sql + migrations schema, then walks the
 * reversal owners (rule 20): void, item refund, undo refund, and a repayment
 * in LBP plus its void — every ledger touched must net to 0 per currency.
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
import { DebtRepository, resetDebtRepository } from "../DebtRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import { resetDebtService } from "../../services/DebtService";
import { saleProcessSchema } from "../../validators/sale";

type SalePayload = z.input<typeof saleProcessSchema>;

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const RATE = 89_000;

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
  resetVoucherRepository();
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

function addProduct(price: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', 1, ?, 10)`,
      )
      .run(`P-${Math.random()}`, price).lastInsertRowid,
  );
}

function addClient(): number {
  return Number(
    db
      .prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (1, ?)`)
      .run(`Client ${Math.random()}`).lastInsertRowid,
  );
}

/** RCP-282's shape: a $19 adapter and a $6 case — $25. */
function sell(
  clientId: number,
  payments: SalePayload["payments"],
): { saleId: number; txnId: number } {
  const req = saleProcessSchema.parse({
    client_id: clientId,
    items: [
      { product_id: addProduct(19), quantity: 1, price: 19 },
      { product_id: addProduct(6), quantity: 1, price: 6 },
    ],
    total_amount: 25,
    discount: 0,
    final_amount: 25,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    payments,
  } satisfies SalePayload) as SaleRequest;
  const res = repo.processSale(req, USER_ID);
  if (!res.success) throw new Error(`sale refused: ${res.error}`);
  const saleId = res.id!;
  const txnId = (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE' ORDER BY id LIMIT 1`,
      )
      .get(saleId) as { id: number }
  ).id;
  return { saleId, txnId };
}

/** The client's ledger balance per currency (the Accounts page figure). */
function balance(clientId: number): { usd: number; lbp: number } {
  const b = new DebtRepository().getClientBalance(clientId);
  return {
    usd: Math.round(b.balance_usd * 100) / 100,
    lbp: Math.round(b.balance_lbp),
  };
}

function saleDebtRows(txnId: number) {
  return db
    .prepare(
      `SELECT COALESCE(amount_usd, 0) AS usd, COALESCE(amount_lbp, 0) AS lbp
         FROM debt_ledger WHERE transaction_id = ? AND transaction_type = 'Sale Debt'`,
    )
    .all(txnId) as Array<{ usd: number; lbp: number }>;
}

function drawers(): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT drawer_name || ':' || currency_code AS k, balance FROM drawer_balances WHERE tenant_id = 1`,
    )
    .all() as Array<{ k: string; balance: number }>;
  return Object.fromEntries(rows.map((r) => [r.k, Math.round(r.balance)]));
}

function salePaid(saleId: number): { usd: number; lbp: number } {
  const s = db
    .prepare(`SELECT paid_usd, paid_lbp FROM sales WHERE id = ?`)
    .get(saleId) as { paid_usd: number; paid_lbp: number };
  return {
    usd: Math.round(s.paid_usd * 100) / 100,
    lbp: Math.round(s.paid_lbp),
  };
}

const ALL_ON_ACCOUNT_LBP = [
  { method: "CUSTOMER_ACCOUNT", currency_code: "LBP", amount: 25 * RATE },
] satisfies SalePayload["payments"];

const CASH_PLUS_ACCOUNT_LBP = [
  { method: "CASH", currency_code: "USD", amount: 10 },
  { method: "CUSTOMER_ACCOUNT", currency_code: "LBP", amount: 15 * RATE },
] satisfies SalePayload["payments"];

describe("LIRA-349 — a POS sale's LBP on-account leg is owed in LBP", () => {
  it("one CUSTOMER_ACCOUNT leg of 2,225,000 LBP books an LBP debt; USD balance unchanged", () => {
    const clientId = addClient();
    const { txnId } = sell(clientId, ALL_ON_ACCOUNT_LBP);

    expect(saleDebtRows(txnId)).toEqual([{ usd: 0, lbp: 2_225_000 }]);
    expect(balance(clientId)).toEqual({ usd: 0, lbp: 2_225_000 });
  });

  it("cash $10 + account leg in LBP → the rest is an LBP debt", () => {
    const clientId = addClient();
    const { txnId } = sell(clientId, CASH_PLUS_ACCOUNT_LBP);

    expect(saleDebtRows(txnId)).toEqual([{ usd: 0, lbp: 1_335_000 }]);
    expect(balance(clientId)).toEqual({ usd: 0, lbp: 1_335_000 });
  });

  it("the open item is the sale, owed in LBP", () => {
    const clientId = addClient();
    const { saleId } = sell(clientId, CASH_PLUS_ACCOUNT_LBP);

    const items = new DebtRepository().findOpenDebtItems(clientId);
    const sale = items.find((i) => i.kind === "sale" && i.id === saleId);
    expect(sale).toBeDefined();
    expect({ usd: sale!.openUsd, lbp: Math.round(sale!.openLbp) }).toEqual({
      usd: 0,
      lbp: 1_335_000,
    });
    // nothing left over as an "Earlier balance" line
    expect(items.filter((i) => i.kind === "balance")).toEqual([]);
  });

  it("void nets to 0 per currency on the ledger and the drawers", () => {
    const clientId = addClient();
    const drawersBefore = drawers();
    const { txnId } = sell(clientId, CASH_PLUS_ACCOUNT_LBP);

    getTransactionRepository().voidTransaction(txnId, USER_ID);

    expect(balance(clientId)).toEqual({ usd: 0, lbp: 0 });
    expect(drawers()).toEqual(drawersBefore);
  });

  it("refunding every item cancels the LBP debt; undo refund restores it", () => {
    const clientId = addClient();
    const { saleId } = sell(clientId, ALL_ON_ACCOUNT_LBP);
    const items = db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id`)
      .all(saleId) as Array<{ id: number }>;

    const refundIds: number[] = [];
    for (const it of items) {
      refundIds.push(
        repo.refundSaleItem({
          saleId,
          saleItemId: it.id,
          refundQuantity: 1,
          userId: USER_ID,
        }),
      );
    }
    expect(balance(clientId)).toEqual({ usd: 0, lbp: 0 });

    repo.undoSaleItemRefund({
      refundTransactionId: refundIds[refundIds.length - 1],
      userId: USER_ID,
    });
    // the $6 case's share is owed again, still in LBP
    expect(balance(clientId)).toEqual({ usd: 0, lbp: 6 * RATE });
  });

  it("an LBP repayment closes the sale; voiding the repayment reopens it", () => {
    const clientId = addClient();
    const { saleId } = sell(clientId, ALL_ON_ACCOUNT_LBP);
    const debts = new DebtRepository();

    const { id: repaymentLedgerId } = debts.addRepayment({
      client_id: clientId,
      amount_usd: 0,
      amount_lbp: 2_225_000,
      created_by: USER_ID,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 2_225_000 }],
    });

    expect(balance(clientId)).toEqual({ usd: 0, lbp: 0 });
    expect(salePaid(saleId)).toEqual({ usd: 0, lbp: 2_225_000 });
    expect(
      debts.findOpenDebtItems(clientId).filter((i) => i.kind === "sale"),
    ).toEqual([]);

    const repayTxnId = (
      db
        .prepare(
          `SELECT id FROM transactions WHERE type = 'DEBT_REPAYMENT' AND source_table = 'debt_ledger' AND source_id = ?`,
        )
        .get(repaymentLedgerId) as { id: number }
    ).id;
    getTransactionRepository().voidTransaction(repayTxnId, USER_ID);

    expect(balance(clientId)).toEqual({ usd: 0, lbp: 2_225_000 });
    expect(salePaid(saleId)).toEqual({ usd: 0, lbp: 0 });
    const open = debts
      .findOpenDebtItems(clientId)
      .find((i) => i.kind === "sale" && i.id === saleId);
    expect(open && Math.round(open.openLbp)).toBe(2_225_000);
  });

  it("the receipt still shows the on-account part as its USD equivalent", () => {
    const clientId = addClient();
    const { saleId } = sell(clientId, CASH_PLUS_ACCOUNT_LBP);
    const s = repo.getSaleWithCustomer(saleId) as unknown as {
      on_account_usd: number;
    };
    expect(Math.round(s.on_account_usd * 100) / 100).toBe(15);
  });

  it("an account leg rounded off the rate keeps its own amount, and repaying it closes everything", () => {
    // $25 at 89,500 is 2,237,500; the cashier told the client 2,240,000.
    const clientId = addClient();
    const req = saleProcessSchema.parse({
      client_id: clientId,
      items: [{ product_id: addProduct(25), quantity: 1, price: 25 }],
      total_amount: 25,
      discount: 0,
      final_amount: 25,
      payment_usd: 0,
      payment_lbp: 0,
      exchange_rate: 89_500,
      status: "completed",
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "LBP", amount: 2_240_000 },
      ],
    } satisfies SalePayload) as SaleRequest;
    const res = repo.processSale(req, USER_ID);
    expect(res.success).toBe(true);
    const saleId = res.id!;

    expect(balance(clientId)).toEqual({ usd: 0, lbp: 2_240_000 });
    const debts = new DebtRepository();
    const before = debts.findOpenDebtItems(clientId);
    expect(before.filter((i) => i.kind === "balance")).toEqual([]);

    debts.addRepayment({
      client_id: clientId,
      amount_usd: 0,
      amount_lbp: 2_240_000,
      created_by: USER_ID,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 2_240_000 }],
    });
    expect(balance(clientId)).toEqual({ usd: 0, lbp: 0 });
    expect(debts.findOpenDebtItems(clientId)).toEqual([]);
    expect(salePaid(saleId).lbp).toBeGreaterThanOrEqual(2_237_500);
  });

  it("a USD account leg is still a USD debt (unchanged)", () => {
    const clientId = addClient();
    const { txnId } = sell(clientId, [
      { method: "CASH", currency_code: "USD", amount: 10 },
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 15 },
    ]);
    expect(saleDebtRows(txnId)).toEqual([{ usd: 15, lbp: 0 }]);
    expect(balance(clientId)).toEqual({ usd: 15, lbp: 0 });
  });
});
