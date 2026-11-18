/**
 * LIRA-400 — payment-method fee on a wallet payment line (phase 1 guards).
 *
 * Money contract (specs/400-payment-method-fee/spec.md):
 *  - the fee goes into the line method's own drawer (amount + fee), never
 *    General; the price (sale total, recharge price, debt reduction) is
 *    unchanged;
 *  - it is profit in the line's currency, on the Payment Method Fees line
 *    (PM_FEE), outside the module's own margin;
 *  - VOID (the transaction never happened) nets every drawer and the fee
 *    profit to 0, per currency;
 *  - REFUND (full or one item) gives back the price only: the wallet drawer
 *    and the profit each stay up by exactly the fee;
 *  - the server refuses a fee on cash-family / customer-account / gift-card
 *    lines, on change (OUT) lines, above the line amount, or negative.
 *
 * Every payload is a plain JSON object parsed by the REAL core schema (the
 * one both transports use — rule 24: the field names are the schema's own
 * keys) and handed to the REAL service. Real production schema:
 * create_db.sql + migrations.
 *
 * Rule 17: written and run BEFORE the feature existed. Recorded failures are
 * in current_sprint.md › LIRA-400 (the schemas stripped the fee key, so the
 * drawer moved by the price only, profit showed no fee, and every refusal
 * was accepted).
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
import { saleProcessSchema } from "../../validators/sale";
import { createRechargeSchema } from "../../validators/recharge";
import { addRepaymentSchema } from "../../validators/debt";
import { getSalesService, resetSalesService } from "../../services/SalesService";
import {
  getRechargeService,
  resetRechargeService,
} from "../../services/RechargeService";
import { getDebtService, resetDebtService } from "../../services/DebtService";
import { ProfitService } from "../../services/ProfitService";
import { ProfitRepository, resetProfitRepository } from "../ProfitRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { getSalesRepository, resetSalesRepository } from "../SalesRepository";
import { resetRechargeRepository } from "../RechargeRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetRateRepository } from "../RateRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetCarrierLineRepository } from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";

const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "../../../../../electron-app/create_db.sql",
);
const OWNER = 1;
const RATE = 90_000;
const FROM = "2000-01-01";
const TO = "2100-01-01";

let db: Database.Database;

function resetAll(): void {
  resetSalesService();
  resetRechargeService();
  resetDebtService();
  resetProfitRepository();
  resetTransactionRepository();
  resetSalesRepository();
  resetRechargeRepository();
  resetDebtRepository();
  resetPaymentMethodRepository();
  resetSettingsRepository();
  resetRateRepository();
  resetClientRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetVoucherRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetCarrierLineService();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  db.pragma("foreign_keys = OFF");
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  // A second cash-family method (posts to General) — never fee-eligible.
  db.prepare(
    `INSERT OR IGNORE INTO payment_methods (tenant_id, code, label, drawer_name, affects_drawer, sort_order, is_system, is_active)
     VALUES (1, 'CASH_SAFE', 'Cash (safe)', 'General', 1, 9, 0, 1)`,
  ).run();
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["MTC", "USD", 1000],
    ["Alfa", "USD", 1000],
    ["General", "USD", 5000],
    ["General", "LBP", 500_000_000],
  ] as const) {
    seed.run(d, c, b);
  }
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

// ─── helpers ───────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function drawer(name: string, currency: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = ? AND currency_code = ?`,
    )
    .get(name, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

const DRAWERS: Array<[string, string]> = [
  ["General", "USD"],
  ["General", "LBP"],
  ["Whish_App", "USD"],
  ["Whish_App", "LBP"],
  ["OMT_App", "USD"],
  ["OMT_App", "LBP"],
  ["Binance", "USDT"],
  ["MTC", "USD"],
];

function snapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [d, c] of DRAWERS) out[`${d}/${c}`] = drawer(d, c);
  return out;
}

function delta(before: Record<string, number>): Record<string, number> {
  const after = snapshot();
  const out: Record<string, number> = {};
  for (const k of Object.keys(after)) {
    const v = Math.round((after[k]! - before[k]!) * 100) / 100;
    if (v !== 0) out[k] = v;
  }
  return out;
}

function pmFee(): { usd: number; lbp: number } {
  const s = new ProfitService(new ProfitRepository()).getSummary(FROM, TO);
  return {
    usd: Math.round(s.financial_services.pm_fee_usd * 100) / 100,
    lbp: Math.round(s.financial_services.pm_fee_lbp),
  };
}

function grossProfit(): { usd: number; lbp: number } {
  const s = new ProfitService(new ProfitRepository()).getSummary(FROM, TO);
  return {
    usd: Math.round(s.totals.gross_profit_usd * 100) / 100,
    lbp: Math.round(s.totals.gross_profit_lbp),
  };
}

function addProduct(price: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, 'Charger', 'Product', 6, ?, 50)`,
      )
      .run(price).lastInsertRowid,
  );
}

function addClient(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Maya', '03111222')`,
      )
      .run().lastInsertRowid,
  );
}

/** A POS walk-in sale as the checkout sends it, through the real schema. */
function pos(
  payments: Json[],
  opts: { price?: number; qty?: number; changeUsd?: number; changeLbp?: number } = {},
): { success: boolean; error?: string; saleId?: number; txnId?: number } {
  const price = opts.price ?? 10;
  const qty = opts.qty ?? 1;
  const productId = addProduct(price);
  const raw: Json = {
    client_id: null,
    items: [{ product_id: productId, quantity: qty, price }],
    total_amount: price * qty,
    discount: 0,
    final_amount: price * qty,
    payment_usd: 0,
    payment_lbp: 0,
    change_given_usd: opts.changeUsd ?? 0,
    change_given_lbp: opts.changeLbp ?? 0,
    exchange_rate: RATE,
    status: "completed",
    payments,
  };
  const parsed = saleProcessSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message };
  }
  const r = getSalesService().processSale(
    parsed.data as Parameters<ReturnType<typeof getSalesService>["processSale"]>[0],
    OWNER,
  );
  if (!r.success) return { success: false, error: r.error };
  const saleId = (r as { id?: number }).id;
  const txnId = saleId
    ? getTransactionRepository().getActiveSaleTransactionId(saleId) ?? undefined
    : undefined;
  return { success: true, saleId, txnId };
}

/** A telecom recharge as the Recharge page sends it, through the schema. */
function recharge(payments: Json[]): {
  success: boolean;
  error?: string;
  txnId?: number;
} {
  const raw: Json = {
    provider: "MTC",
    type: "CREDIT_TRANSFER",
    amount: 10,
    cost: 9,
    price: 10,
    currency: "USD",
    phoneNumber: "03999001",
    payments,
    tender_exchange_rate: RATE,
  };
  const parsed = createRechargeSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message };
  }
  const r = getRechargeService().processRecharge({
    ...(parsed.data as Parameters<
      ReturnType<typeof getRechargeService>["processRecharge"]
    >[0]),
    userId: OWNER,
  });
  if (!r.success) return { success: false, error: r.error };
  return { success: true, txnId: lastTxnId("RECHARGE") };
}

/** A debt repayment as the Debts page sends it, through the schema. */
function repay(
  clientId: number,
  amountUSD: number,
  payments: Json[],
): { success: boolean; error?: string; txnId?: number } {
  const raw: Json = { clientId, amountUSD, amountLBP: 0, payments };
  const parsed = addRepaymentSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message };
  }
  const r = getDebtService().addRepayment({
    ...(parsed.data as Parameters<
      ReturnType<typeof getDebtService>["addRepayment"]
    >[0]),
    userId: OWNER,
  });
  if (!r.success) return { success: false, error: r.error };
  return { success: true, txnId: lastTxnId("DEBT_REPAYMENT") };
}

function lastTxnId(type: string): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE type = ? AND reverses_id IS NULL ORDER BY id DESC LIMIT 1`,
      )
      .get(type) as { id: number }
  ).id;
}

function chargeDebt(clientId: number, usd: number): void {
  db.prepare(
    `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, note, created_by)
     VALUES (1, ?, 'Sale Debt', ?, 0, 'seed', 1)`,
  ).run(clientId, usd);
}

function clientDebtUsd(clientId: number): number {
  return Math.round(
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount_usd), 0) AS d FROM debt_ledger WHERE tenant_id = 1 AND client_id = ?`,
        )
        .get(clientId) as { d: number }
    ).d * 100,
  ) / 100;
}

// ─── POS ───────────────────────────────────────────────────────────────────

describe("LIRA-400 — POS sale with a payment-method fee", () => {
  it("Whish $10 + $1 fee: Whish +11, General untouched, fee line $1, sale margin unchanged", () => {
    const before = snapshot();
    const r = pos([
      { method: "WHISH", currency_code: "USD", amount: 10, fee_amount: 1 },
    ]);
    expect(r).toMatchObject({ success: true });
    expect(delta(before)).toEqual({ "Whish_App/USD": 11 });
    expect(pmFee()).toEqual({ usd: 1, lbp: 0 });
    const t = db
      .prepare(`SELECT amount_usd, profit_usd FROM transactions WHERE id = ?`)
      .get(r.txnId) as { amount_usd: number; profit_usd: number };
    expect(t).toEqual({ amount_usd: 10, profit_usd: 4 });
    // Gross = sale margin 4 + fee 1.
    expect(grossProfit()).toEqual({ usd: 5, lbp: 0 });
  });

  it("void nets every drawer and the fee profit to 0, per currency", () => {
    const before = snapshot();
    const r = pos([
      { method: "WHISH", currency_code: "USD", amount: 5, fee_amount: 0.5 },
      { method: "OMT", currency_code: "LBP", amount: 450_000, fee_amount: 45_000 },
    ]);
    expect(r).toMatchObject({ success: true });
    expect(delta(before)).toEqual({
      "Whish_App/USD": 5.5,
      "OMT_App/LBP": 495_000,
    });
    expect(pmFee()).toEqual({ usd: 0.5, lbp: 45_000 });
    getTransactionRepository().voidTransaction(r.txnId!, OWNER);
    expect(delta(before)).toEqual({});
    expect(pmFee()).toEqual({ usd: 0, lbp: 0 });
    expect(grossProfit()).toEqual({ usd: 0, lbp: 0 });
  });

  it("full refund gives back the price only: Whish and profit stay up by the fee", () => {
    const before = snapshot();
    const r = pos([
      { method: "WHISH", currency_code: "USD", amount: 10, fee_amount: 1 },
    ]);
    getTransactionRepository().refundTransaction(r.txnId!, OWNER);
    expect(delta(before)).toEqual({ "Whish_App/USD": 1 });
    expect(pmFee()).toEqual({ usd: 1, lbp: 0 });
    expect(grossProfit()).toEqual({ usd: 1, lbp: 0 });
  });

  it("refund with a chosen return method validates against the price, not price + fee", () => {
    const before = snapshot();
    const r = pos([
      { method: "WHISH", currency_code: "USD", amount: 10, fee_amount: 1 },
    ]);
    getTransactionRepository().refundTransaction(r.txnId!, OWNER, {
      refundLegs: [{ method: "WHISH", currencyCode: "USD", amount: 10 }],
    });
    expect(delta(before)).toEqual({ "Whish_App/USD": 1 });
    expect(pmFee()).toEqual({ usd: 1, lbp: 0 });
  });

  it("one-item refund gives back that item's price share only, the fee stays", () => {
    const before = snapshot();
    const r = pos(
      [{ method: "WHISH", currency_code: "USD", amount: 20, fee_amount: 2 }],
      { price: 10, qty: 2 },
    );
    const item = db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
      .get(r.saleId) as { id: number };
    getSalesRepository().refundSaleItem({
      saleId: r.saleId!,
      saleItemId: item.id,
      refundQuantity: 1,
      userId: OWNER,
    });
    expect(delta(before)).toEqual({ "Whish_App/USD": 12 });
    expect(pmFee()).toEqual({ usd: 2, lbp: 0 });
  });

  it.each([
    ["cash", { method: "CASH", currency_code: "USD", amount: 10, fee_amount: 1 }],
    ["cash-family (General drawer)", { method: "CASH_SAFE", currency_code: "USD", amount: 10, fee_amount: 1 }],
    ["fee above the line amount", { method: "WHISH", currency_code: "USD", amount: 10, fee_amount: 11 }],
    ["negative fee", { method: "WHISH", currency_code: "USD", amount: 10, fee_amount: -1 }],
  ])("refuses a fee on %s — nothing moves", (_label, leg) => {
    const before = snapshot();
    const r = pos([leg]);
    expect(r.success).toBe(false);
    expect(delta(before)).toEqual({});
    expect(pmFee()).toEqual({ usd: 0, lbp: 0 });
  });

  it("refuses a fee on a customer-account line", () => {
    const before = snapshot();
    const productId = addProduct(10);
    const clientId = addClient();
    const parsed = saleProcessSchema.safeParse({
      client_id: clientId,
      client_name: "Maya",
      client_phone: "03111222",
      items: [{ product_id: productId, quantity: 1, price: 10 }],
      total_amount: 10,
      discount: 0,
      final_amount: 10,
      payment_usd: 0,
      payment_lbp: 0,
      exchange_rate: RATE,
      status: "completed",
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10, fee_amount: 1 },
      ],
    });
    const accepted =
      parsed.success &&
      getSalesService().processSale(
        parsed.data as Parameters<ReturnType<typeof getSalesService>["processSale"]>[0],
        OWNER,
      ).success;
    expect(accepted).toBe(false);
    expect(delta(before)).toEqual({});
  });
});

// ─── Recharge ──────────────────────────────────────────────────────────────

describe("LIRA-400 — telecom recharge with a payment-method fee", () => {
  it("Whish $10 + $1 fee: Whish +11, General untouched, fee line $1; void nets to 0", () => {
    const before = snapshot();
    const r = recharge([
      { method: "WHISH", currencyCode: "USD", amount: 10, feeAmount: 1 },
    ]);
    expect(r).toMatchObject({ success: true });
    const d = delta(before);
    // The MTC drawer moves by the credit sent (the recharge's own rule,
    // untouched by the fee); the customer side is Whish only.
    expect(d["Whish_App/USD"]).toBe(11);
    expect(d["General/USD"]).toBeUndefined();
    expect(pmFee()).toEqual({ usd: 1, lbp: 0 });
    getTransactionRepository().voidTransaction(r.txnId!, OWNER);
    expect(delta(before)).toEqual({});
    expect(pmFee()).toEqual({ usd: 0, lbp: 0 });
  });

  it("refund keeps the fee in Whish and in profit", () => {
    const before = snapshot();
    const r = recharge([
      { method: "WHISH", currencyCode: "USD", amount: 10, feeAmount: 1 },
    ]);
    getTransactionRepository().refundTransaction(r.txnId!, OWNER);
    expect(delta(before)["Whish_App/USD"]).toBe(1);
    expect(pmFee()).toEqual({ usd: 1, lbp: 0 });
  });

  it.each([
    ["cash", { method: "CASH", currencyCode: "USD", amount: 10, feeAmount: 1 }],
    ["a change (OUT) line", null],
  ])("refuses a fee on %s", (_label, leg) => {
    const before = snapshot();
    const r = recharge(
      leg
        ? [leg]
        : [
            { method: "WHISH", currencyCode: "USD", amount: 11 },
            { method: "WHISH", currencyCode: "USD", amount: 1, direction: "OUT", feeAmount: 0.5 },
          ],
    );
    expect(r.success).toBe(false);
    expect(delta(before)).toEqual({});
  });
});

// ─── Debt repayment ────────────────────────────────────────────────────────

describe("LIRA-400 — debt repayment with a payment-method fee", () => {
  it("Whish $50 + $1 fee: debt −50 only, Whish +51, fee line $1; void restores all", () => {
    const clientId = addClient();
    chargeDebt(clientId, 80);
    const before = snapshot();
    const r = repay(clientId, 50, [
      { method: "WHISH", currencyCode: "USD", amount: 50, feeAmount: 1 },
    ]);
    expect(r).toMatchObject({ success: true });
    expect(clientDebtUsd(clientId)).toBe(30);
    expect(delta(before)).toEqual({ "Whish_App/USD": 51 });
    expect(pmFee()).toEqual({ usd: 1, lbp: 0 });
    getTransactionRepository().voidTransaction(r.txnId!, OWNER);
    expect(clientDebtUsd(clientId)).toBe(80);
    expect(delta(before)).toEqual({});
    expect(pmFee()).toEqual({ usd: 0, lbp: 0 });
  });

  it("refuses a fee on a cash repayment line", () => {
    const clientId = addClient();
    chargeDebt(clientId, 80);
    const before = snapshot();
    const r = repay(clientId, 50, [
      { method: "CASH", currencyCode: "USD", amount: 50, feeAmount: 1 },
    ]);
    expect(r.success).toBe(false);
    expect(delta(before)).toEqual({});
    expect(clientDebtUsd(clientId)).toBe(80);
  });
});

// ─── Profits views agree ───────────────────────────────────────────────────

describe("LIRA-400 — every Profits view carries the fee once", () => {
  it("Summary gross = Σ By Module = Σ By Date = Σ By User, PM_FEE row = fees", () => {
    pos([{ method: "WHISH", currency_code: "USD", amount: 10, fee_amount: 1 }]);
    pos([{ method: "OMT", currency_code: "LBP", amount: 900_000, fee_amount: 90_000 }]);
    recharge([{ method: "BINANCE", currencyCode: "USD", amount: 10, feeAmount: 0.25 }]);
    const svc = new ProfitService(new ProfitRepository());
    const s = svc.getSummary(FROM, TO);
    const byModule = svc.getByModule(FROM, TO);
    const byDate = svc.getByDate(FROM, TO);
    const byUser = svc.getByUser(FROM, TO);
    const sum = <T,>(rows: T[], f: (r: T) => number) =>
      rows.reduce((a, r) => a + (f(r) ?? 0), 0);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const pm = byModule.find((m) => m.module === "PM_FEE");
    expect(pm && [r2(pm.profit_usd), Math.round(pm.profit_lbp)]).toEqual([
      1.25, 90_000,
    ]);
    const usd = r2(s.totals.gross_profit_usd);
    const lbp = Math.round(s.totals.gross_profit_lbp);
    expect([
      r2(sum(byModule, (m) => m.profit_usd)),
      r2(sum(byDate, (d) => d.profit_usd)),
      r2(sum(byUser, (u) => u.profit_usd)),
    ]).toEqual([usd, usd, usd]);
    expect([
      Math.round(sum(byModule, (m) => m.profit_lbp)),
      Math.round(sum(byDate, (d) => d.profit_lbp)),
      Math.round(sum(byUser, (u) => u.profit_lbp)),
    ]).toEqual([lbp, lbp, lbp]);
  });

  it("By Client and the drill-down carry the fee rows; the card has them by method", () => {
    pos([{ method: "WHISH", currency_code: "USD", amount: 10, fee_amount: 1 }]);
    recharge([{ method: "WHISH", currencyCode: "USD", amount: 10, feeAmount: 0.5 }]);
    const svc = new ProfitService(new ProfitRepository());
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const s = svc.getSummary(FROM, TO);
    const byClient = svc.getByClient(FROM, TO, 100);
    expect(r2(byClient.reduce((a, c) => a + c.profit_usd, 0))).toBe(
      r2(s.totals.gross_profit_usd),
    );
    expect(s.financial_services.pm_fee_by_method).toEqual([
      expect.objectContaining({ method: "WHISH", currency_code: "USD", total: 1.5, count: 2 }),
    ]);
    const detail = svc.getModuleDetail("PM_FEE", FROM, TO);
    expect(
      r2(detail.counted.reduce((a, r) => a + r.counted_profit_usd, 0)),
    ).toBe(1.5);
    expect(new Set(detail.counted.map((r) => r.source))).toEqual(
      new Set(["pm_fee_leg"]),
    );
  });
});

// ─── Variant tests (rule 28d) ──────────────────────────────────────────────
// Each phase-1 form, every payment shape the screen can send: the legs are
// built the way the screen builds them (POS: snake_case legs + cash change in
// change_given_*; Recharge / Debts: camelCase legs + change as OUT legs), run
// through the real schema and service, amounts asserted per drawer.

type Variant = {
  name: string;
  legs: Json[];
  changeLbp?: number;
  drawers: Record<string, number>;
  fee: { usd: number; lbp: number };
};

const POS_VARIANTS: Variant[] = [
  {
    name: "cash only",
    legs: [{ method: "CASH", currency_code: "USD", amount: 10 }],
    drawers: { "General/USD": 10 },
    fee: { usd: 0, lbp: 0 },
  },
  {
    name: "Whish with a fee",
    legs: [{ method: "WHISH", currency_code: "USD", amount: 10, fee_amount: 1 }],
    drawers: { "Whish_App/USD": 11 },
    fee: { usd: 1, lbp: 0 },
  },
  {
    name: "split USD + LBP lines with fees",
    legs: [
      { method: "WHISH", currency_code: "USD", amount: 5, fee_amount: 0.5 },
      { method: "OMT", currency_code: "LBP", amount: 450_000, fee_amount: 45_000 },
    ],
    drawers: { "Whish_App/USD": 5.5, "OMT_App/LBP": 495_000 },
    fee: { usd: 0.5, lbp: 45_000 },
  },
  {
    name: "Whish with a fee plus change in LBP",
    legs: [{ method: "WHISH", currency_code: "USD", amount: 15, fee_amount: 1 }],
    changeLbp: 450_000,
    drawers: { "Whish_App/USD": 16, "General/LBP": -450_000 },
    fee: { usd: 1, lbp: 0 },
  },
];

describe("LIRA-400 variants — POS checkout", () => {
  it.each(POS_VARIANTS.map((v) => [v.name, v] as const))("%s", (_n, v) => {
    const before = snapshot();
    const r = pos(v.legs, { changeLbp: v.changeLbp });
    expect(r).toMatchObject({ success: true });
    expect(delta(before)).toEqual(v.drawers);
    expect(pmFee()).toEqual(v.fee);
    const t = db
      .prepare(`SELECT amount_usd FROM transactions WHERE id = ?`)
      .get(r.txnId) as { amount_usd: number };
    expect(t.amount_usd).toBe(10);
  });
});

const RECHARGE_VARIANTS: Variant[] = [
  {
    name: "cash only",
    legs: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
    drawers: { "General/USD": 10 },
    fee: { usd: 0, lbp: 0 },
  },
  {
    name: "Whish with a fee",
    legs: [{ method: "WHISH", currencyCode: "USD", amount: 10, feeAmount: 1 }],
    drawers: { "Whish_App/USD": 11 },
    fee: { usd: 1, lbp: 0 },
  },
  {
    name: "split USD + LBP lines with fees",
    legs: [
      { method: "WHISH", currencyCode: "USD", amount: 5, feeAmount: 0.5 },
      { method: "OMT", currencyCode: "LBP", amount: 450_000, feeAmount: 45_000 },
    ],
    drawers: { "Whish_App/USD": 5.5, "OMT_App/LBP": 495_000 },
    fee: { usd: 0.5, lbp: 45_000 },
  },
  {
    name: "Whish with a fee plus change in LBP",
    legs: [
      { method: "WHISH", currencyCode: "USD", amount: 15, feeAmount: 1 },
      { method: "CASH", currencyCode: "LBP", amount: 450_000, direction: "OUT" },
    ],
    drawers: { "Whish_App/USD": 16, "General/LBP": -450_000 },
    fee: { usd: 1, lbp: 0 },
  },
];

describe("LIRA-400 variants — telecom recharge", () => {
  it.each(RECHARGE_VARIANTS.map((v) => [v.name, v] as const))("%s", (_n, v) => {
    const before = snapshot();
    const r = recharge(v.legs);
    expect(r).toMatchObject({ success: true });
    const d = delta(before);
    delete d["MTC/USD"]; // the credit sent — the recharge's own rule
    expect(d).toEqual(v.drawers);
    expect(pmFee()).toEqual(v.fee);
  });
});

const DEBT_VARIANTS: Variant[] = [
  {
    name: "cash only",
    legs: [{ method: "CASH", currencyCode: "USD", amount: 50 }],
    drawers: { "General/USD": 50 },
    fee: { usd: 0, lbp: 0 },
  },
  {
    name: "Whish with a fee",
    legs: [{ method: "WHISH", currencyCode: "USD", amount: 50, feeAmount: 1 }],
    drawers: { "Whish_App/USD": 51 },
    fee: { usd: 1, lbp: 0 },
  },
  {
    name: "split USD + LBP lines with fees",
    legs: [
      { method: "WHISH", currencyCode: "USD", amount: 45, feeAmount: 0.5 },
      { method: "OMT", currencyCode: "LBP", amount: 450_000, feeAmount: 45_000 },
    ],
    drawers: { "Whish_App/USD": 45.5, "OMT_App/LBP": 495_000 },
    fee: { usd: 0.5, lbp: 45_000 },
  },
  {
    name: "Whish with a fee plus change in LBP",
    legs: [
      { method: "WHISH", currencyCode: "USD", amount: 55, feeAmount: 1 },
      { method: "CASH", currencyCode: "LBP", amount: 450_000, direction: "OUT" },
    ],
    drawers: { "Whish_App/USD": 56, "General/LBP": -450_000 },
    fee: { usd: 1, lbp: 0 },
  },
];

describe("LIRA-400 variants — debt repayment", () => {
  it.each(DEBT_VARIANTS.map((v) => [v.name, v] as const))("%s", (_n, v) => {
    const clientId = addClient();
    chargeDebt(clientId, 80);
    const before = snapshot();
    const r = repay(clientId, 50, v.legs);
    expect(r).toMatchObject({ success: true });
    expect(delta(before)).toEqual(v.drawers);
    expect(clientDebtUsd(clientId)).toBe(30);
    expect(pmFee()).toEqual(v.fee);
  });
});
