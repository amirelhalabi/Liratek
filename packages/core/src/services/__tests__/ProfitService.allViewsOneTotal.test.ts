/**
 * LIRA-395 — Profits: one total across Summary, By Module, By Date, By User.
 *
 * Owner audit of Cornertech (2026-11-16): the same period showed three
 * different gross profits depending on the tab. Summary `totals.gross_profit_*`
 * is the reference; Σ By Date already matched it, Σ By Module was short by
 * the off-currency kept change (it sat in additive `kept_change_*` fields on
 * the module rows, outside every `profit_*`), and Σ By User was long by the
 * counterparty discounts (`getByUser` never read COUNTERPARTY_DISCOUNT rows).
 *
 * One seeded day with every profit line the Summary knows, then the four-way
 * equality, per currency (± 0.01 USD / ± 1 LBP). Σ By Module deliberately sums
 * `profit_*` ONLY — adding `kept_change_*` back is exactly the hidden TOTAL-line
 * adjustment the spec rules out.
 *
 * Seeding (real production schema: create_db.sql + migrations):
 *  - REAL write paths: POS sale with LBP kept change (SalesRepository
 *    .processSale), USD recharge with LBP kept change (RechargeRepository
 *    .processRecharge), OMT SEND with LBP kept change (FinancialServiceRepository
 *    .createTransaction), loto ticket with USD kept change (LotoService
 *    .sellTicket), exchange payout with kept change (ExchangeRepository
 *    .createTransaction), debt repayment with kept change (DebtRepository
 *    .addRepayment), counterparty discount + its reversal (DebtRepository
 *    .writeOffDebt / addRepayment with a bundled discount, then the
 *    repayment's refund).
 *  - The shared unified-transaction writer (TransactionRepository
 *    .createTransaction) with the stamp each module's writer books, where the
 *    real flow needs far more setup than this reconciliation is about: session
 *    discount (BASKET_DISCOUNT), waived shortfall (WAIVED_SHORTFALL), extra
 *    charge (extra_usd/extra_lbp on a module row), top-up (RECHARGE_TOPUP on a
 *    recharges row), wrong-number credits (WRONG_NUMBER_CREDITS), warranty cost
 *    (WARRANTY_COST), supplier bills commission (SUPPLIER_SETTLEMENT on
 *    supplier_ledger), hold money pickup (HOLD_MONEY_COLLECT), and a settled
 *    legacy OMT commission (commission_model 0, is_settled 1).
 *  - SQL UPDATE: the payment-method fee on the OMT SEND row
 *    (`financial_services.payment_method_fee`, what the FS writer stores).
 *
 * Rule 17: written BEFORE the fix and run against the unfixed code — the two
 * failures recorded in the LIRA-395 report (By User, By Module).
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
  getTransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import {
  FinancialServiceRepository,
  resetFinancialServiceRepository,
} from "../../repositories/FinancialServiceRepository";
import {
  RechargeRepository,
  resetRechargeRepository,
} from "../../repositories/RechargeRepository";
import {
  SalesRepository,
  resetSalesRepository,
} from "../../repositories/SalesRepository";
import { ExchangeRepository } from "../../repositories/ExchangeRepository";
import { LotoService } from "../LotoService";
import {
  getLotoTicketRepository,
  resetLotoTicketRepository,
} from "../../repositories/LotoTicketRepository";
import { getLotoSettingsRepository } from "../../repositories/LotoSettingsRepository";
import { getLotoMonthlyFeeRepository } from "../../repositories/LotoMonthlyFeeRepository";
import { getLotoCheckpointRepository } from "../../repositories/LotoCheckpointRepository";
import { getLotoCashPrizeRepository } from "../../repositories/LotoCashPrizeRepository";
import { resetPartnerRepository } from "../../repositories/PartnerRepository";
import { resetStockBatchRepository } from "../../repositories/StockBatchRepository";
import { resetProductUnitRepository } from "../../repositories/ProductUnitRepository";
import {
  getDebtRepository,
  resetDebtRepository,
} from "../../repositories/DebtRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import { resetPaymentMethodRepository } from "../../repositories/PaymentMethodRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import { resetRateRepository } from "../../repositories/RateRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetCarrierLineRepository } from "../../repositories/CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../../repositories/CarrierLineMovementRepository";
import { resetCarrierLineService } from "../CarrierLineService";
import { resetDebtService } from "../DebtService";
import { resetVoucherRepository } from "../../repositories/VoucherRepository";
import {
  ProfitRepository,
  resetProfitRepository,
} from "../../repositories/ProfitRepository";
import { ProfitService } from "../ProfitService";

const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "../../../../../electron-app/create_db.sql",
);
const OWNER = 1;
const CASHIER = 2;
const RATE = 90_000; // create_db.sql's seeded LBP sell rate
const FROM = "2000-01-01";
const TO = "2100-01-01";

let db: Database.Database;

function resetAll(): void {
  resetTransactionRepository();
  resetFinancialServiceRepository();
  resetRechargeRepository();
  resetSalesRepository();
  resetLotoTicketRepository();
  resetPartnerRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetSupplierRepository();
  resetPaymentMethodRepository();
  resetSettingsRepository();
  resetRateRepository();
  resetClientRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetCarrierLineService();
  resetDebtService();
  resetVoucherRepository();
  resetProfitRepository();
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
  db.prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, username, password_hash, role, is_active)
     VALUES (?, 1, 'cashier2', '', 'staff', 1)`,
  ).run(CASHIER);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["MTC", "USD", 1000],
    ["OMT_System", "USD", 5000],
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

function lastTxnId(type: string): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE type = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(type) as { id: number }
  ).id;
}

function addClient(name: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`,
      )
      .run(name, `03${Math.floor(Math.random() * 1e6)}`).lastInsertRowid,
  );
}

// ─── real write paths ──────────────────────────────────────────────────────

/** POS sale, $10 paid with 905,000 LBP, 5,000 LBP kept. */
function seedSaleWithKeptChange(): void {
  const productId = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, 'Charger', 'Product', 6, 10, 10)`,
      )
      .run().lastInsertRowid,
  );
  const r = new SalesRepository().processSale(
    {
      client_id: null,
      items: [{ product_id: productId, quantity: 1, price: 10 }],
      total_amount: 10,
      discount: 0,
      final_amount: 10,
      payment_usd: 0,
      payment_lbp: 0,
      exchange_rate: RATE,
      status: "completed",
      payments: [{ method: "CASH", currency_code: "LBP", amount: 905_000 }],
      kept_change_lbp: 5_000,
    } as Parameters<SalesRepository["processSale"]>[0],
    OWNER,
  );
  if (!r.success) throw new Error(`processSale failed: ${r.error}`);
}

/** USD MTC recharge, $10 paid with 905,000 LBP, 5,000 LBP kept — the
 *  off-currency kept change By Module used to leave outside profit_lbp. */
function seedUsdRechargeWithLbpKept(): void {
  const res = new RechargeRepository().processRecharge({
    provider: "MTC",
    type: "CREDIT_TRANSFER",
    amount: 10,
    cost: 9,
    price: 10,
    currency: "USD",
    phoneNumber: "03999001",
    payments: [{ method: "CASH", currencyCode: "LBP", amount: 905_000 }],
    kept_change_lbp: 5_000,
    tender_exchange_rate: RATE,
    userId: OWNER,
  } as Parameters<RechargeRepository["processRecharge"]>[0]);
  if (!res.success) throw new Error(`processRecharge failed: ${res.error}`);
}

/** OMT SEND $100 + $5 fee paid with 9,455,000 LBP, 5,000 LBP kept; a $0.50
 *  payment-method fee on the same row. */
function seedOmtSendWithLbpKept(): void {
  new FinancialServiceRepository().createTransaction({
    provider: "OMT",
    serviceType: "SEND",
    amount: 100,
    currency: "USD",
    commission: 1,
    omtFee: 5,
    payments: [{ method: "CASH", currencyCode: "LBP", amount: 9_455_000 }],
    kept_change_lbp: 5_000,
    tender_exchange_rate: RATE,
    userId: OWNER,
  } as Parameters<FinancialServiceRepository["createTransaction"]>[0]);
  const fsId = (
    db
      .prepare(`SELECT id FROM financial_services ORDER BY id DESC LIMIT 1`)
      .get() as { id: number }
  ).id;
  db.prepare(
    `UPDATE financial_services SET payment_method_fee = 0.5 WHERE id = ?`,
  ).run(fsId);
}

/** Loto ticket 500,000 LBP paid with $6 (540,000), $0.44 kept. */
function seedLotoWithUsdKept(): void {
  new LotoService(
    getLotoTicketRepository(),
    getLotoSettingsRepository(),
    getLotoMonthlyFeeRepository(),
    getLotoCheckpointRepository(),
    getLotoCashPrizeRepository(),
  ).sellTicket({
    sale_amount: 500_000,
    userId: OWNER,
    payments: [{ method: "CASH", currencyCode: "USD", amount: 6 }],
    kept_change_usd: 0.44,
  } as Parameters<LotoService["sellTicket"]>[0]);
}

/** Exchange 9,000,000 LBP → $101.12, $101 handed over, $0.12 kept. */
function seedExchangeWithKept(): void {
  const leg1 = 9_000_000 / 89_000 - 9_000_000 / 89_500;
  new ExchangeRepository().createTransaction({
    fromCurrency: "LBP",
    toCurrency: "USD",
    amountIn: 9_000_000,
    amountOut: 101.12,
    leg1Rate: 89_000,
    leg1MarketRate: 89_500,
    leg1ProfitUsd: leg1,
    totalProfitUsd: leg1,
    tender_exchange_rate: 89_000,
    payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
    kept_change_usd: 0.12,
    kept_change_lbp: 0,
  });
}

/** Debt repayment of $10 paid with 905,000 LBP, 5,000 LBP kept, by the
 *  second cashier; plus a forgiven $2 counterparty discount (write-off) by the
 *  same cashier. */
function seedDebtLines(clientId: number): void {
  getDebtRepository().addRepayment({
    client_id: clientId,
    amount_usd: 10,
    amount_lbp: 0,
    created_by: CASHIER,
    payments: [{ method: "CASH", currencyCode: "LBP", amount: 905_000 }],
    kept_change_lbp: 5_000,
    tender_exchange_rate: RATE,
  } as Parameters<ReturnType<typeof getDebtRepository>["addRepayment"]>[0]);
  getDebtRepository().writeOffDebt({
    client_id: clientId,
    amount_usd: 2,
    amount_lbp: 0,
    reason: "goodwill",
    created_by: CASHIER,
  });
}

/** A repayment with a bundled 50,000 LBP discount, then refunded — the
 *  refund writes the negated COUNTERPARTY_DISCOUNT row (rule 20), by the
 *  refunding user, on the refund's day. */
function seedDiscountedRepaymentRefunded(clientId: number): void {
  getDebtRepository().addRepayment({
    client_id: clientId,
    amount_usd: 5,
    amount_lbp: 0,
    created_by: CASHIER,
    payments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
    discount: { amount_usd: 0, amount_lbp: 50_000, reason: "rounding" },
  } as Parameters<ReturnType<typeof getDebtRepository>["addRepayment"]>[0]);
  const repaymentTxn = lastTxnId("DEBT_REPAYMENT");
  getTransactionRepository().refundTransaction(repaymentTxn, OWNER, {
    refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
  });
}

// ─── shared unified-transaction writer, module stamps ─────────────────────

function txn(data: {
  type: string;
  source_table: string;
  source_id: number;
  user_id?: number;
  profit_usd?: number;
  profit_lbp?: number;
  extra_usd?: number;
  extra_lbp?: number;
  amount_usd?: number;
  amount_lbp?: number;
}): number {
  return getTransactionRepository().createTransaction({
    user_id: OWNER,
    amount_usd: 0,
    amount_lbp: 0,
    profit_usd: 0,
    profit_lbp: 0,
    summary: data.type,
    metadata_json: {},
    ...data,
  } as Parameters<
    ReturnType<typeof getTransactionRepository>["createTransaction"]
  >[0]);
}

function seedProfitOnlyLines(): void {
  // Session discount (LIRA-341) and waived shortfall (LIRA-310).
  txn({
    type: "BASKET_DISCOUNT",
    source_table: "customer_sessions",
    source_id: 1,
    profit_usd: -1.5,
  });
  txn({
    type: "WAIVED_SHORTFALL",
    source_table: "customer_sessions",
    source_id: 1,
    profit_lbp: -20_000,
  });
  // Extra charge (LIRA-319) on a custom-service row, LBP.
  txn({
    type: "CUSTOM_SERVICE",
    source_table: "custom_services",
    source_id: 999,
    amount_lbp: 550_000,
    extra_lbp: 50_000,
  });
  // Top-up fee on a recharges row (PA-2.3).
  const rechargeId = Number(
    db
      .prepare(
        `INSERT INTO recharges (tenant_id, carrier, recharge_type, amount, cost, price, currency_code)
         VALUES (1, 'MTC', 'TOP_UP', 20, 20, 20, 'USD')`,
      )
      .run().lastInsertRowid,
  );
  txn({
    type: "RECHARGE_TOPUP",
    source_table: "recharges",
    source_id: rechargeId,
    profit_usd: 0.75,
  });
  // Wrong-number credits recovered (LIRA-312), warranty cost (LIRA-296),
  // hold-money pickup kept change.
  txn({
    type: "WRONG_NUMBER_CREDITS",
    source_table: "recharges",
    source_id: rechargeId,
    profit_lbp: 45_000,
  });
  txn({
    type: "WARRANTY_COST",
    source_table: "warranty_claims",
    source_id: 1,
    profit_usd: -3,
  });
  txn({
    type: "HOLD_MONEY_COLLECT",
    source_table: "hold_money",
    source_id: 1,
    profit_lbp: 10_000,
  });
  // Supplier bills commission (bills-only SUPPLIER_SETTLEMENT).
  const ledgerId = Number(
    db
      .prepare(
        `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp)
         VALUES (1, 1, 'PAYMENT', 0, 0)`,
      )
      .run().lastInsertRowid,
  );
  txn({
    type: "SUPPLIER_SETTLEMENT",
    source_table: "supplier_ledger",
    source_id: ledgerId,
    profit_usd: 4,
  });
  // A settled legacy OMT commission (commission_model 0, is_settled 1).
  const fsId = Number(
    db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, commission, commission_model, is_settled)
         VALUES (1, 'OMT', 'RECEIVE', 200, 'USD', 2, 0, 1)`,
      )
      .run().lastInsertRowid,
  );
  txn({
    type: "FINANCIAL_SERVICE",
    source_table: "financial_services",
    source_id: fsId,
    amount_usd: 200,
    profit_usd: 2,
  });
}

function seedEverything(): void {
  const debtor = addClient("Debtor");
  const other = addClient("Other");
  seedSaleWithKeptChange();
  seedUsdRechargeWithLbpKept();
  seedOmtSendWithLbpKept();
  seedLotoWithUsdKept();
  seedExchangeWithKept();
  seedDebtLines(debtor);
  seedDiscountedRepaymentRefunded(other);
  seedProfitOnlyLines();
}

// ─── the four views ────────────────────────────────────────────────────────

interface Totals {
  usd: number;
  lbp: number;
}

function fourViews(from: string, to: string) {
  const svc = new ProfitService(new ProfitRepository());
  const summary = svc.getSummary(from, to);
  const sum = <T>(rows: T[], f: (r: T) => number): number =>
    rows.reduce((s, r) => s + (f(r) ?? 0), 0);
  const byModule = svc.getByModule(from, to);
  const byDate = svc.getByDate(from, to);
  const byUser = svc.getByUser(from, to);
  return {
    summary: {
      usd: summary.totals.gross_profit_usd,
      lbp: summary.totals.gross_profit_lbp,
    } as Totals,
    byModule: {
      usd: sum(byModule, (m) => m.profit_usd),
      lbp: sum(byModule, (m) => m.profit_lbp),
    } as Totals,
    byDate: {
      usd: sum(byDate, (d) => d.profit_usd),
      lbp: sum(byDate, (d) => d.profit_lbp),
    } as Totals,
    byUser: {
      usd: sum(byUser, (u) => u.profit_usd),
      lbp: sum(byUser, (u) => u.profit_lbp),
    } as Totals,
    keptChangeSection: summary.kept_change,
    byModuleRows: byModule,
    svc,
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r0 = (n: number) => Math.round(n);

describe("LIRA-395 — every Profits tab shows the same gross profit", () => {
  it("the seed reaches every profit line the Summary knows (non-vacuous)", () => {
    seedEverything();
    const s = new ProfitService(new ProfitRepository()).getSummary(FROM, TO);
    expect(r2(s.sales.profit_usd)).not.toBe(0);
    expect(s.sales.profit_lbp).not.toBe(0);
    expect(s.kept_change.lbp).not.toBe(0); // off-currency kept change
    expect(s.kept_change.usd).not.toBe(0);
    expect(s.debt_repayments.profit_lbp).not.toBe(0);
    expect(s.discounts.usd).not.toBe(0);
    expect(s.session_discounts.profit_usd).not.toBe(0);
    expect(s.waived.profit_lbp).not.toBe(0);
    expect(s.extra_charges.lbp).not.toBe(0);
    expect(s.financial_services.pm_fee_usd).not.toBe(0);
    expect(s.topups_buybacks.profit_usd).not.toBe(0);
    expect(s.wrong_number_recovery.profit_lbp).not.toBe(0);
    expect(s.warranty.profit_usd).not.toBe(0);
    expect(s.supplier_commission.profit_usd).not.toBe(0);
    expect(s.hold_money.profit_lbp).not.toBe(0);
    expect(s.loto.profit_lbp).not.toBe(0);
    expect(s.exchange.profit_usd).not.toBe(0);
    expect(s.financial_services.commission_usd).not.toBe(0);
  });

  it("Σ By Module = Σ By Date = Σ By User = Summary gross profit, per currency", () => {
    seedEverything();
    const v = fourViews(FROM, TO);
    const usd = {
      summary: r2(v.summary.usd),
      byModule: r2(v.byModule.usd),
      byDate: r2(v.byDate.usd),
      byUser: r2(v.byUser.usd),
    };
    const lbp = {
      summary: r0(v.summary.lbp),
      byModule: r0(v.byModule.lbp),
      byDate: r0(v.byDate.lbp),
      byUser: r0(v.byUser.lbp),
    };
    expect({ usd, lbp }).toEqual({
      usd: {
        summary: usd.summary,
        byModule: usd.summary,
        byDate: usd.summary,
        byUser: usd.summary,
      },
      lbp: {
        summary: lbp.summary,
        byModule: lbp.summary,
        byDate: lbp.summary,
        byUser: lbp.summary,
      },
    });
  });

  it("the moved kept change sits in the Kept Change row, its drill-down adds up to it, and no module row carries a side figure", () => {
    seedEverything();
    const v = fourViews(FROM, TO);
    const kept = v.byModuleRows.find((r) => r.module === "KEPT_CHANGE");
    expect(kept).toBeDefined();
    // Summary's Kept Change card is a subset of that row (the row also holds
    // debt-repayment kept change, the Summary's separate debt_repayments).
    const s = v.svc.getSummary(FROM, TO);
    expect(r2(kept!.profit_usd)).toBe(
      r2(s.kept_change.usd + s.debt_repayments.profit_usd),
    );
    expect(r0(kept!.profit_lbp)).toBe(
      r0(s.kept_change.lbp + s.debt_repayments.profit_lbp),
    );
    const detail = v.svc.getModuleDetail("KEPT_CHANGE", FROM, TO);
    expect(r2(detail.counted_total_profit_usd)).toBe(r2(kept!.profit_usd));
    expect(r0(detail.counted_total_profit_lbp)).toBe(r0(kept!.profit_lbp));
    const listed = detail.counted.reduce(
      (a, r) => ({
        usd: a.usd + r.counted_profit_usd,
        lbp: a.lbp + r.counted_profit_lbp,
      }),
      { usd: 0, lbp: 0 },
    );
    expect(r2(listed.usd)).toBe(r2(kept!.profit_usd));
    expect(r0(listed.lbp)).toBe(r0(kept!.profit_lbp));
    for (const row of v.byModuleRows) {
      expect([
        row.module,
        row.kept_change_usd ?? 0,
        row.kept_change_lbp ?? 0,
      ]).toEqual([row.module, 0, 0]);
    }
  });

  it("the discount and its reversal land on By Cashier the way By Date has them", () => {
    seedEverything();
    const svc = new ProfitService(new ProfitRepository());
    const s = svc.getSummary(FROM, TO);
    const byUser = svc.getByUser(FROM, TO);
    const discounts = db
      .prepare(
        `SELECT user_id, SUM(profit_usd) AS usd, SUM(profit_lbp) AS lbp
           FROM transactions WHERE type = 'COUNTERPARTY_DISCOUNT' AND status = 'ACTIVE'
          GROUP BY user_id`,
      )
      .all() as { user_id: number; usd: number; lbp: number }[];
    // Non-vacuous: the write-off, the bundled discount and its reversal.
    expect(discounts.length).toBeGreaterThan(0);
    const reversals = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM transactions
            WHERE type = 'COUNTERPARTY_DISCOUNT' AND status = 'ACTIVE' AND reverses_id IS NOT NULL`,
        )
        .get() as { n: number }
    ).n;
    expect(reversals).toBe(1);
    // By Cashier carries every discount row, per user, exactly as booked.
    for (const d of discounts) {
      const u = byUser.find((row) => row.user_id === d.user_id);
      expect(u).toBeDefined();
    }
    expect(r2(discounts.reduce((a, d) => a + d.usd, 0))).toBe(
      r2(s.discounts.usd),
    );
    expect(r0(discounts.reduce((a, d) => a + d.lbp, 0))).toBe(
      r0(s.discounts.lbp),
    );
    expect(byUser.length).toBeGreaterThan(0);
  });

  it("a discount booked yesterday and reversed today: today's By Cashier has the reversal on the refunding user, like By Date", () => {
    const day = (offset: number): string =>
      (
        db
          .prepare(`SELECT date('now','localtime', ? || ' days') AS d`)
          .get(String(offset)) as { d: string }
      ).d;
    const clientId = addClient("Yesterday");
    getDebtRepository().addRepayment({
      client_id: clientId,
      amount_usd: 5,
      amount_lbp: 0,
      created_by: CASHIER,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
      discount: { amount_usd: 0, amount_lbp: 50_000, reason: "rounding" },
      transaction_time: `${day(-1)} 12:00:00`,
    } as Parameters<ReturnType<typeof getDebtRepository>["addRepayment"]>[0]);
    getTransactionRepository().refundTransaction(
      lastTxnId("DEBT_REPAYMENT"),
      OWNER,
      { refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 5 }] },
    );
    const reversal = db
      .prepare(
        `SELECT user_id, profit_lbp, date(created_at, 'localtime') AS d FROM transactions
          WHERE type = 'COUNTERPARTY_DISCOUNT' AND reverses_id IS NOT NULL`,
      )
      .get() as { user_id: number; profit_lbp: number; d: string };
    expect([reversal.user_id, reversal.profit_lbp, reversal.d]).toEqual([
      OWNER,
      50_000,
      day(0),
    ]);
    const v = fourViews(day(0), day(0));
    expect(r0(v.summary.lbp)).toBe(50_000);
    expect([r0(v.byModule.lbp), r0(v.byDate.lbp), r0(v.byUser.lbp)]).toEqual([
      50_000, 50_000, 50_000,
    ]);
    const owner = v.svc
      .getByUser(day(0), day(0))
      .find((u) => u.user_id === OWNER);
    expect(r0(owner?.profit_lbp ?? 0)).toBe(50_000);
  });

  it("an empty range: all four totals are 0", () => {
    seedEverything();
    const v = fourViews("1999-01-01", "1999-01-02");
    for (const t of [v.summary, v.byModule, v.byDate, v.byUser]) {
      expect([r2(t.usd), r0(t.lbp)]).toEqual([0, 0]);
    }
  });
});
