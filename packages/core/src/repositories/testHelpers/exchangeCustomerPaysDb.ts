/**
 * LIRA-321 — shared fixture for the Exchange "Customer pays" tests: a full
 * database (create_db.sql + migrations), one client, seeded USD/LBP/EUR rates
 * and General drawer balances, plus the ledger snapshot helpers every case
 * asserts deltas with (rule 15 — deltas, never absolute totals).
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
import type { CreateExchangeData } from "../ExchangeRepository";
import { resetExchangeRepository } from "../ExchangeRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetRateRepository } from "../RateRepository";
import { resetExchangeLotRepository } from "../ExchangeLotRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetDebtService } from "../../services/DebtService";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

export const CLIENT_ID = 1;
export const PARTNER_ID = 1;
export const USER_ID = 1;

export function resetAll(): void {
  resetExchangeRepository();
  resetTransactionRepository();
  resetDebtRepository();
  resetDebtService();
  resetClientRepository();
  resetPartnerRepository();
  resetRateRepository();
  resetExchangeLotRepository();
  resetPaymentMethodRepository();
}

/** Build the full schema, register it as the test DB, seed client/rates/drawers. */
export function setupExchangeDb(): Database.Database {
  resetAll();
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);

  /* tenant-exempt: test-only helper — single-tenant in-memory test database */
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, 'Exchange Client', '70123456')`,
  ).run(CLIENT_ID);
  /* tenant-exempt: test-only helper — single-tenant in-memory test database */
  db.prepare(
    `INSERT OR IGNORE INTO partners (id, tenant_id, name) VALUES (?, 1, 'Partner P')`,
  ).run(PARTNER_ID);
  const rate = db.prepare(
    /* tenant-exempt: test-only helper — single-tenant in-memory test database */
    `INSERT OR REPLACE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES (1, ?, ?, ?, ?, ?)`,
  );
  rate.run("LBP", 89_500, 89_000, 90_000, 1);
  rate.run("EUR", 1.18, 1.16, 1.2, -1);
  const seed = db.prepare(
    /* tenant-exempt: test-only helper — single-tenant in-memory test database */
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["General", "USD", 100_000],
    ["General", "LBP", 9_000_000_000],
    ["General", "EUR", 10_000],
  ] as const) {
    seed.run(d, c, b);
  }
  return db;
}

export function teardownExchangeDb(db: Database.Database): void {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
}

export interface LedgerSnapshot {
  generalUsd: number;
  generalLbp: number;
  generalEur: number;
  /** Client's Exchange Debt charges net of their reversals, per currency. */
  debtUsd: number;
  debtLbp: number;
  /** Client's whole debt_ledger balance, per currency. */
  balanceUsd: number;
  balanceLbp: number;
  /** Σ profit over ACTIVE transactions, per currency. */
  profitUsd: number;
  profitLbp: number;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function snapshot(db: Database.Database): LedgerSnapshot {
  const drawer = (c: string): number =>
    (
      db
        .prepare(
          /* tenant-exempt: test-only helper — single-tenant in-memory test database */
          `SELECT COALESCE(SUM(balance), 0) AS b FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = ?`,
        )
        .get(c) as { b: number }
    ).b;
  const debt = db
    .prepare(
      /* tenant-exempt: test-only helper — single-tenant in-memory test database */
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
         FROM debt_ledger
        WHERE client_id = ?
          AND (transaction_type = 'Exchange Debt'
               OR (transaction_type = 'Refund Reversal'
                   AND transaction_id IN (SELECT transaction_id FROM debt_ledger WHERE transaction_type = 'Exchange Debt')))`,
    )
    .get(CLIENT_ID) as { usd: number; lbp: number };
  const balance = db
    .prepare(
      /* tenant-exempt: test-only helper — single-tenant in-memory test database */
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp FROM debt_ledger WHERE client_id = ?`,
    )
    .get(CLIENT_ID) as { usd: number; lbp: number };
  const profit = db
    .prepare(
      /* tenant-exempt: test-only helper — single-tenant in-memory test database */
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
  return {
    generalUsd: r6(drawer("USD")),
    generalLbp: r6(drawer("LBP")),
    generalEur: r6(drawer("EUR")),
    debtUsd: r6(debt.usd),
    debtLbp: r6(debt.lbp),
    balanceUsd: r6(balance.usd),
    balanceLbp: r6(balance.lbp),
    profitUsd: r6(profit.usd),
    profitLbp: r6(profit.lbp),
  };
}

export function delta(a: LedgerSnapshot, b: LedgerSnapshot): LedgerSnapshot {
  const out = {} as LedgerSnapshot;
  for (const k of Object.keys(a) as (keyof LedgerSnapshot)[]) {
    out[k] = r6(b[k] - a[k]);
  }
  return out;
}

/** The unified EXCHANGE transaction row for an exchange_transactions id. */
export function unifiedExchangeTxnId(
  db: Database.Database,
  exchangeId: number,
): number {
  const row = db
    .prepare(
      /* tenant-exempt: test-only helper — single-tenant in-memory test database */
      `SELECT id FROM transactions
        WHERE source_table = 'exchange_transactions' AND source_id = ?
          AND type = 'EXCHANGE' AND reverses_id IS NULL`,
    )
    .get(exchangeId) as { id: number } | undefined;
  if (!row) throw new Error(`no EXCHANGE row for exchange #${exchangeId}`);
  return row.id;
}

// ─── Payloads (spec US1) ─────────────────────────────────────────────────────

/** $1,000 at 89,500: the customer owes 89,500,000 LBP. Margin vs the
 *  89,000 market = 89,500,000 / 89,000 − 1,000. */
export const US1_MARGIN = 89_500_000 / 89_000 - 1_000;

export const US1_BASE: CreateExchangeData = {
  fromCurrency: "LBP",
  toCurrency: "USD",
  amountIn: 89_500_000,
  amountOut: 1_000,
  leg1Rate: 89_500,
  leg1MarketRate: 89_000,
  leg1ProfitUsd: US1_MARGIN,
  totalProfitUsd: US1_MARGIN,
};

/** US1.1: 87,600,000 cash + 1,900,000 on the client's account. */
export const US1_PART_ON_ACCOUNT: CreateExchangeData = {
  ...US1_BASE,
  clientId: CLIENT_ID,
  customerPayments: [
    { method: "CASH", currencyCode: "LBP", amount: 87_600_000 },
    { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 1_900_000 },
  ],
};

/** US1.4: no client, 89,200,000 cash, 300,000 forgiven. */
export const US1_FORGIVE: CreateExchangeData = {
  ...US1_BASE,
  customerPayments: [
    { method: "CASH", currencyCode: "LBP", amount: 89_200_000 },
  ],
  customer_waived_amount: 300_000,
};
