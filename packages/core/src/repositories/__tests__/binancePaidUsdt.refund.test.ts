/**
 * Cornertech 2026-11-06 (txns 16172 → 16173 → 16174): a Whish App send paid
 * with the Binance method, refunded, then entered again. On the real schema
 * and the real refund/void path: the Binance line lands in Binance as USDT,
 * and refund / void take it back out of USDT, netting every drawer to 0 per
 * currency. A voided checkpoint resolution in Binance USD stays in USD.
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
} from "../FinancialServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetClientRepository } from "../ClientRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { ProfitRepository, resetProfitRepository } from "../ProfitRepository";
import { resetProfitService } from "../../services/ProfitService";
import { snapshotLedgers, expectPostings } from "../testHelpers/postingAssert";
import { BINANCE_REFUND_EXACT_MESSAGE } from "../../utils/payments";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf-8",
);

let db: Database.Database;

function resetAll(): void {
  resetFinancialServiceRepository();
  resetTransactionRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetDebtRepository();
  resetDebtService();
  resetClientRepository();
  resetPaymentMethodRepository();
  resetProfitRepository();
  resetProfitService();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["General", "USD", 10_000],
    ["Whish_App", "USD", 10_000],
    ["Binance", "USDT", 10_000],
  ] as const)
    seed.run(d, c, b);
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

function whishSendPaidByBinance(amount: number): number {
  const r = new FinancialServiceRepository().createTransaction({
    provider: "WHISH_APP",
    serviceType: "SEND",
    amount,
    currency: "USD",
    commission: 0,
    paidByMethod: "BINANCE",
    exchangeRate: 90_000,
    payments: [{ method: "BINANCE", currencyCode: "USD", amount }],
  });
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ? AND reverses_id IS NULL`,
      )
      .get(r.id) as { id: number }
  ).id;
}

describe("Whish App send paid by Binance — real create, refund and void", () => {
  it("create: Binance USDT +301, Whish_App USD −301, no Binance USD", () => {
    const before = snapshotLedgers(db);
    whishSendPaidByBinance(301);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Binance|USDT": 301, "Whish_App|USD": -301 },
    });
  });

  it("refund with no override nets every drawer to 0 per currency", () => {
    const before = snapshotLedgers(db);
    getTransactionRepository().refundTransaction(
      whishSendPaidByBinance(301),
      1,
    );
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("void nets every drawer to 0 per currency", () => {
    const before = snapshotLedgers(db);
    getTransactionRepository().voidTransaction(whishSendPaidByBinance(601), 1);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("voiding a transaction with a Binance USD checkpoint-resolution row reverses it in USD", () => {
    const txnId = whishSendPaidByBinance(301);
    db.prepare(
      `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, tenant_id)
       VALUES (?, 'CHECKPOINT_RESOLUTION', 'Binance', 'USD', -301, 1)`,
    ).run(txnId);
    db.prepare(
      `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Binance', 'USD', -301)`,
    ).run();
    const before = snapshotLedgers(db);
    getTransactionRepository().voidTransaction(txnId, 1);
    expectPostings(before, snapshotLedgers(db), {
      drawers: {
        "Binance|USDT": -301,
        "Binance|USD": 301,
        "Whish_App|USD": 301,
      },
    });
  });

  it("a refund that picks a return method is refused with nothing written (exact reversal only)", () => {
    const txnId = whishSendPaidByBinance(301);
    const before = snapshotLedgers(db);
    expect(() =>
      getTransactionRepository().refundTransaction(txnId, 1, {
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 301 }],
      }),
    ).toThrow(BINANCE_REFUND_EXACT_MESSAGE);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("Profits 'Cash intake by method' counts the Binance line as dollars", () => {
    whishSendPaidByBinance(301);
    const rows = new ProfitRepository().getPaymentMethodRows(
      "2000-01-01 00:00:00",
      "2100-12-31 23:59:59",
    );
    const binance = rows.find((r) => r.method === "BINANCE");
    expect(binance?.total_usd).toBeCloseTo(301, 2);
  });
});
