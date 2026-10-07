/**
 * LIRA-268 — Binance profit must reach the Profits page.
 *
 * A Binance row is stored in USDT (`financial_services.currency = 'USDT'`),
 * while its fee is charged in US dollars cash. Owner-reported bug: the
 * Profits page showed neither the Binance fee (commission) nor the kept
 * change on a Binance cash-out, because every Profits query buckets an FS
 * row by an exact `currency = 'USD'` / `'LBP'` match and USDT matched
 * neither. The fee itself is also missing from the row's profit stamp
 * (`FinancialServiceRepository.createTransaction` stamps the commission
 * term only for a USD/LBP row), so it can only be read from the row's own
 * `commission` column (legacy EMBEDDED, `commission_model = 0` — the
 * column IS the settled truth for these rows, see `embeddedCommission`).
 *
 * Valuation: USDT counts 1:1 as US dollars. The codebase defines no USDT
 * exchange rate (`exchange_rates` seeds LBP and EUR only); the drawers and
 * the partner ledger already treat USDT as dollars (a Binance SEND takes
 * $102 cash for 100 USDT + $2 fee; a partner Binance balance is booked in
 * USD).
 *
 * Asserted surfaces: Overview (getSummary — also the day close), By Module
 * (the Binance row and its drill-down), By Date, By Cashier, By Client.
 * Void of both rows nets every one of them back to 0 (rule 20).
 *
 * Real production schema (create_db.sql + migrations), real writers.
 * Rule 17: the first case's profit/count assertions were written before the
 * fix and run against the unfixed code first (Overview, By Module and By
 * Date read $0; By Cashier/By Client read only the $0.50 kept change). Its
 * revenue assertions and the refund / customer-account cases were added
 * after the fix (not proven failing-first).
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
  FinancialServiceRepository,
  resetFinancialServiceRepository,
} from "../../repositories/FinancialServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import { resetPartnerRepository } from "../../repositories/PartnerRepository";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetRateRepository } from "../../repositories/RateRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import { resetProfitRepository } from "../../repositories/ProfitRepository";
import { resetDebtService } from "../DebtService";
import { ProfitService } from "../ProfitService";
import type { CreateFinancialServiceInput } from "../../validators/financial";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL = fs.readFileSync(
  path.join(REPO_ROOT, "electron-app/create_db.sql"),
  "utf-8",
);
const USER_ID = 1;
const CLIENT_ID = 1;
const RATE = 89_500;
const FROM = "2000-01-01";
const TO = "2100-01-01";

type Payload = Partial<CreateFinancialServiceInput>;

let db: Database.Database;

function resetAll(): void {
  resetFinancialServiceRepository();
  resetTransactionRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetDebtRepository();
  resetDebtService();
  resetClientRepository();
  resetRateRepository();
  resetSettingsRepository();
  resetProfitRepository();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, 'Binance Client', '70111222')`,
  ).run(CLIENT_ID);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  seed.run("General", "USD", 10_000);
  seed.run("Binance", "USDT", 10_000);
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

function create(p: Payload): number {
  const fsId = new FinancialServiceRepository().createTransaction({
    exchangeRate: RATE,
    userId: USER_ID,
    ...p,
  } as Parameters<FinancialServiceRepository["createTransaction"]>[0]).id;
  return (
    db
      .prepare(
        `SELECT id FROM transactions
          WHERE source_table = 'financial_services' AND source_id = ? AND reverses_id IS NULL`,
      )
      .get(fsId) as { id: number }
  ).id;
}

/** Binance SEND: customer pays $102 cash, shop sends 100 USDT, $2 fee. */
const send: Payload = {
  provider: "BINANCE",
  serviceType: "SEND",
  amount: 100,
  currency: "USDT",
  commission: 2,
  clientId: CLIENT_ID,
  payments: [{ method: "CASH", currencyCode: "USD", amount: 102 }],
};

/** Binance cash-out: 100 USDT in, $2 fee → owes $98, hands out $97.50 and
 *  keeps $0.50 change. */
const receiveWithKept: Payload = {
  provider: "BINANCE",
  serviceType: "RECEIVE",
  amount: 100,
  currency: "USDT",
  commission: 2,
  clientId: CLIENT_ID,
  payments: [{ method: "CASH", currencyCode: "USD", amount: 97.5 }],
  kept_change_usd: 0.5,
};

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const sum = <T>(rows: T[], pick: (r: T) => number) =>
  r6(rows.reduce((s, r) => s + (pick(r) || 0), 0));

function surfaces() {
  const svc = new ProfitService();
  const summary = svc.getSummary(FROM, TO);
  const byModule = svc.getByModule(FROM, TO);
  const binanceRow = byModule.find((m) => m.module === "FINANCIAL_SERVICE_BINANCE");
  const detail = svc.getModuleDetail("FINANCIAL_SERVICE_BINANCE", FROM, TO);
  return {
    overviewGrossUsd: r6(summary.totals.gross_profit_usd),
    overviewGrossLbp: r6(summary.totals.gross_profit_lbp),
    overviewFsCommissionUsd: r6(summary.financial_services.commission_usd),
    // Revenue (added after the fix, not proven failing-first): with USDT
    // read as USD, a Binance transfer's principal counts as revenue exactly
    // like an OMT/WHISH transfer's — a deliberate, reversible choice.
    overviewRevenueUsd: r6(summary.totals.gross_revenue_usd),
    byModuleBinanceRevenueUsd: r6(binanceRow?.revenue_usd ?? 0),
    byDateRevenueUsd: sum(svc.getByDate(FROM, TO), (r) => r.revenue_usd),
    byUserRevenueUsd: sum(svc.getByUser(FROM, TO), (r) => r.revenue_usd),
    byClientRevenueUsd: sum(svc.getByClient(FROM, TO, 1000), (r) => r.revenue_usd),
    byModuleBinanceProfitUsd: r6(binanceRow?.profit_usd ?? 0),
    byModuleBinanceCount: binanceRow?.count ?? 0,
    byModuleTotalUsd: sum(byModule, (r) => r.profit_usd),
    detailProfitUsd: r6(detail.counted_total_profit_usd),
    detailCountedRows: detail.counted.length,
    byDateUsd: sum(svc.getByDate(FROM, TO), (r) => r.profit_usd),
    byUserUsd: sum(svc.getByUser(FROM, TO), (r) => r.profit_usd),
    byClientUsd: sum(svc.getByClient(FROM, TO, 1000), (r) => r.profit_usd),
  };
}

describe("LIRA-268 — Binance commission and kept change reach every Profits surface", () => {
  it("a Binance SEND ($2 fee) and a cash-out ($2 fee + $0.50 kept) read $4.50 everywhere; void nets to 0", () => {
    const empty = surfaces();
    expect(empty.overviewGrossUsd).toBe(0);

    const sendTxn = create(send);
    const receiveTxn = create(receiveWithKept);

    expect(surfaces()).toEqual({
      overviewGrossUsd: 4.5,
      overviewGrossLbp: 0,
      overviewFsCommissionUsd: 4.5,
      overviewRevenueUsd: 200,
      byModuleBinanceRevenueUsd: 200,
      byDateRevenueUsd: 200,
      byUserRevenueUsd: 200,
      byClientRevenueUsd: 200,
      byModuleBinanceProfitUsd: 4.5,
      byModuleBinanceCount: 2,
      byModuleTotalUsd: 4.5,
      detailProfitUsd: 4.5,
      detailCountedRows: 2,
      byDateUsd: 4.5,
      byUserUsd: 4.5,
      byClientUsd: 4.5,
    });

    const txnRepo = getTransactionRepository();
    txnRepo.voidTransaction(sendTxn, USER_ID);
    txnRepo.voidTransaction(receiveTxn, USER_ID);
    expect(surfaces()).toEqual(empty);
  });

  // Written after the fix (not proven failing-first): the same fee must
  // also net out through a REFUND, and wait outside profit while the
  // customer still owes it.
  it("a refunded Binance SEND nets every surface back to 0", () => {
    const empty = surfaces();
    const sendTxn = create(send);
    expect(surfaces().overviewGrossUsd).toBe(2);
    getTransactionRepository().refundTransaction(sendTxn, USER_ID);
    expect(surfaces()).toEqual(empty);
  });

  it("a Binance SEND charged to the customer's account waits for repayment, outside profit", () => {
    create({
      ...send,
      paidByMethod: "CUSTOMER_ACCOUNT",
      payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 102 }],
    });
    const summary = new ProfitService().getSummary(FROM, TO);
    expect(r6(summary.totals.gross_profit_usd)).toBe(0);
    expect(r6(summary.financial_services.waiting_for_repayment_usd)).toBe(2);
  });
});
