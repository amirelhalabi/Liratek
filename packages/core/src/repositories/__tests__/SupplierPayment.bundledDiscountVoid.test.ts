/**
 * Supplier payment void removes its bundled discount (owner decision
 * 2026-10-07, matching the Partners page). The shop owes a supplier $100,
 * pays $60 cash + a $40 discount, then voids (or refunds) the payment: the
 * supplier must be back at $100 owed, the drawer back, the discount's +$40
 * profit gone, and the open purchase's FIFO coverage given back — per
 * currency. Rule 20: the reversal owner is the PAYMENT's void/refund
 * (`TransactionRepository._reverseSupplierBundledDiscount`), found through
 * the link the payment writes at create time (the DISCOUNT supplier_ledger
 * row's `source_ref_table='supplier_ledger'`, `source_ref_id=<payment row>`).
 *
 * Real production schema (create_db.sql + migrations), real writers.
 *
 * Rule 17: the failing-first guard for this fix is the flipped case in
 * DrawersCounterparties.postingRules.test.ts (recorded failing: supplier
 * left at −40). This file adds the profit, FIFO-coverage, LBP, refund-path,
 * settled-row and legacy-row checks; written before the fix and run red
 * (see the change report).
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
  getSupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetRateRepository } from "../RateRepository";
import { resetProfitRepository } from "../ProfitRepository";
import { resetSettingsService } from "../../services/SettingsService";
import { ProfitService } from "../../services/ProfitService";
import {
  expectPostings,
  ledgerDeltas,
  snapshotLedgers,
} from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const RATE = 89500;

let db: Database.Database;

function resetAll(): void {
  resetSupplierRepository();
  resetTransactionRepository();
  resetPaymentMethodRepository();
  resetSettingsRepository();
  resetSettingsService();
  resetRateRepository();
  resetProfitRepository();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

function seedSupplierOwed(totalUsd: number): {
  supplierId: number;
  purchaseId: number;
} {
  const supplierId = Number(
    db
      .prepare(
        `INSERT INTO suppliers (tenant_id, name, is_active, is_system) VALUES (1, 'Discount Supplier', 1, 0)`,
      )
      .run().lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_by)
     VALUES (1, ?, 'ADJUSTMENT', ?, 0, 1)`,
  ).run(supplierId, totalUsd);
  const purchaseId = Number(
    db
      .prepare(
        `INSERT INTO supplier_purchases (tenant_id, supplier_id, total_usd, paid_usd, created_by) VALUES (1, ?, ?, 0, 1)`,
      )
      .run(supplierId, totalUsd).lastInsertRowid,
  );
  return { supplierId, purchaseId };
}

function paidUsd(purchaseId: number): number {
  return (
    db
      .prepare(`SELECT paid_usd FROM supplier_purchases WHERE id = ?`)
      .get(purchaseId) as { paid_usd: number }
  ).paid_usd;
}

function paymentTxnId(): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE type = 'SUPPLIER_PAYMENT' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { id: number }
  ).id;
}

function discountProfit(): { usd: number; lbp: number } {
  const s = new ProfitService().getSummary("2000-01-01", "2100-01-01");
  return { usd: s.totals.gross_profit_usd, lbp: s.totals.gross_profit_lbp };
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

describe("supplier payment void removes its bundled discount", () => {
  for (const reverse of ["void", "refund"] as const) {
    it(`USD: pay $60 + $40 discount, ${reverse} the payment → supplier, drawer, profit, FIFO coverage all back`, () => {
      const { supplierId, purchaseId } = seedSupplierOwed(100);
      const before = snapshotLedgers(db);
      const profitBefore = discountProfit();

      getSupplierRepository().recordSupplierCashflow({
        supplier_id: supplierId,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
        discount: { amount_usd: 40, amount_lbp: 0, reason: "volume" },
        exchange_rate: RATE,
        created_by: 1,
      });
      expect(paidUsd(purchaseId)).toBeCloseTo(100, 6);
      const mid = ledgerDeltas(before, snapshotLedgers(db));
      expect(mid.supplier[`${supplierId}|USD`]).toBeCloseTo(-100, 6);
      expect(r6(discountProfit().usd - profitBefore.usd)).toBe(40);

      const txnId = paymentTxnId();
      if (reverse === "void") {
        getTransactionRepository().voidTransaction(txnId, 1);
      } else {
        getTransactionRepository().refundTransaction(txnId, 1);
      }

      expectPostings(before, snapshotLedgers(db), {});
      expect(paidUsd(purchaseId)).toBeCloseTo(0, 6);
      const profitAfter = discountProfit();
      expect(r6(profitAfter.usd)).toBe(r6(profitBefore.usd));
      expect(r6(profitAfter.lbp)).toBe(r6(profitBefore.lbp));
    });
  }

  it("LBP discount: pay $60 + 3,580,000 LBP discount, void → nets to 0 per currency", () => {
    const { supplierId, purchaseId } = seedSupplierOwed(100);
    const before = snapshotLedgers(db);
    const profitBefore = discountProfit();

    getSupplierRepository().recordSupplierCashflow({
      supplier_id: supplierId,
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
      discount: { amount_usd: 0, amount_lbp: 3_580_000, reason: "rounding" },
      exchange_rate: RATE,
      created_by: 1,
    });
    expect(r6(discountProfit().lbp - profitBefore.lbp)).toBe(3_580_000);

    getTransactionRepository().voidTransaction(paymentTxnId(), 1);

    expectPostings(before, snapshotLedgers(db), {});
    expect(paidUsd(purchaseId)).toBeCloseTo(0, 6);
    const profitAfter = discountProfit();
    expect(r6(profitAfter.usd)).toBe(r6(profitBefore.usd));
    expect(r6(profitAfter.lbp)).toBe(r6(profitBefore.lbp));
  });

  it("a discount row already in a supplier settlement blocks the payment void up front (nothing changes)", () => {
    const { supplierId } = seedSupplierOwed(100);
    getSupplierRepository().recordSupplierCashflow({
      supplier_id: supplierId,
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
      discount: { amount_usd: 40, amount_lbp: 0 },
      exchange_rate: RATE,
      created_by: 1,
    });
    db.prepare(
      `UPDATE supplier_ledger SET settlement_id = 999 WHERE entry_type = 'DISCOUNT'`,
    ).run();
    const before = snapshotLedgers(db);
    const txnId = paymentTxnId();
    expect(() => getTransactionRepository().voidTransaction(txnId, 1)).toThrow(
      /settlement #999/,
    );
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("legacy row (discount written before the link existed): the void leaves it — never guess-linked", () => {
    const { supplierId } = seedSupplierOwed(100);
    const before = snapshotLedgers(db);
    getSupplierRepository().recordSupplierCashflow({
      supplier_id: supplierId,
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
      discount: { amount_usd: 40, amount_lbp: 0 },
      exchange_rate: RATE,
      created_by: 1,
    });
    // What a pre-fix row looks like: no link back to its payment.
    db.prepare(
      `UPDATE supplier_ledger SET source_ref_table = NULL, source_ref_id = NULL WHERE entry_type = 'DISCOUNT'`,
    ).run();

    getTransactionRepository().voidTransaction(paymentTxnId(), 1);

    expectPostings(before, snapshotLedgers(db), {
      supplier: { [`${supplierId}|USD`]: -40 },
    });
  });
});
