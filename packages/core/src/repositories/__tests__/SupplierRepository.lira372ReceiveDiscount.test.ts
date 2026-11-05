/**
 * LIRA-372 (T015) — a supplier Receive may bundle a discount (the shop
 * accepts a little less): ledger +x, profit −x ("Supplier discount given"),
 * no FIFO purchase coverage. Its void/refund (rule 20,
 * `_reverseSupplierBundledDiscount`) must NOT give back coverage that was
 * never applied. Room check both ways: discount ≤ owed − cash.
 *
 * Real production schema (create_db.sql + migrations), real writers.
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
import { supplierCashflowSchema } from "../../validators/supplier";
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

function seedSupplier(balanceUsd: number): {
  supplierId: number;
  purchaseId: number;
} {
  const supplierId = Number(
    db
      .prepare(
        `INSERT INTO suppliers (tenant_id, name, is_active, is_system) VALUES (1, 'Receive Supplier', 1, 0)`,
      )
      .run().lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_by)
     VALUES (1, ?, 'ADJUSTMENT', ?, 0, 1)`,
  ).run(supplierId, balanceUsd);
  // A fully paid purchase: any FIFO give-back would wrongly lower paid_usd.
  const purchaseId = Number(
    db
      .prepare(
        `INSERT INTO supplier_purchases (tenant_id, supplier_id, total_usd, paid_usd, created_by) VALUES (1, ?, 100, 100, 1)`,
      )
      .run(supplierId).lastInsertRowid,
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

function profit(): { usd: number; lbp: number } {
  const s = new ProfitService().getSummary("2000-01-01", "2100-01-01");
  return { usd: s.totals.gross_profit_usd, lbp: s.totals.gross_profit_lbp };
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

const receive = (supplierId: number, cash: number, discountUsd: number) =>
  getSupplierRepository().recordSupplierCashflow({
    supplier_id: supplierId,
    direction: "RECEIVE",
    payments: [{ method: "CASH", currency_code: "USD", amount: cash }],
    discount: { amount_usd: discountUsd, amount_lbp: 0, reason: "rounded" },
    exchange_rate: RATE,
    created_by: 1,
  });

describe("LIRA-372 — supplier Receive takes a discount (booked as given)", () => {
  for (const reverse of ["void", "refund"] as const) {
    it(`supplier owes $500, receive $495 + $5 discount, then ${reverse} → nets to 0`, () => {
      const { supplierId, purchaseId } = seedSupplier(-500);
      const before = snapshotLedgers(db);
      const profitBefore = profit();

      receive(supplierId, 495, 5);

      const mid = ledgerDeltas(before, snapshotLedgers(db));
      expect(mid.supplier[`${supplierId}|USD`]).toBeCloseTo(500, 6);
      expect(mid.drawers["General|USD"]).toBeCloseTo(495, 6);
      expect(r6(profit().usd - profitBefore.usd)).toBe(-5);
      const disc = db
        .prepare(
          `SELECT summary FROM transactions WHERE type = 'COUNTERPARTY_DISCOUNT' ORDER BY id DESC LIMIT 1`,
        )
        .get() as { summary: string };
      expect(disc.summary).toMatch(/^Supplier discount given/);
      const discRow = db
        .prepare(
          `SELECT amount_usd, note FROM supplier_ledger WHERE entry_type = 'DISCOUNT' AND supplier_id = ?`,
        )
        .get(supplierId) as { amount_usd: number; note: string | null };
      expect(discRow.amount_usd).toBeCloseTo(5, 6);
      expect(paidUsd(purchaseId)).toBeCloseTo(100, 6);

      const txnId = paymentTxnId();
      if (reverse === "void") {
        getTransactionRepository().voidTransaction(txnId, 1);
      } else {
        getTransactionRepository().refundTransaction(txnId, 1);
      }

      expectPostings(before, snapshotLedgers(db), {});
      expect(paidUsd(purchaseId)).toBeCloseTo(100, 6);
      expect(r6(profit().usd)).toBe(r6(profitBefore.usd));
      expect(r6(profit().lbp)).toBe(r6(profitBefore.lbp));
    });
  }

  it("the schema refuses a $6 discount on Receive", () => {
    expect(
      supplierCashflowSchema.safeParse({
        supplier_id: 1,
        direction: "RECEIVE",
        payments: [{ method: "CASH", currency_code: "USD", amount: 495 }],
        discount: { amount_usd: 6, amount_lbp: 0 },
      }).success,
    ).toBe(false);
  });

  it("refuses Receive $498 + $5 discount when the supplier owes $500", () => {
    const { supplierId } = seedSupplier(-500);
    expect(() => receive(supplierId, 498, 5)).toThrow();
  });

  it("refuses Pay $410 + $5 discount when the shop owes $412.50", () => {
    const { supplierId } = seedSupplier(412.5);
    expect(() =>
      getSupplierRepository().recordSupplierCashflow({
        supplier_id: supplierId,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 410 }],
        discount: { amount_usd: 5, amount_lbp: 0 },
        exchange_rate: RATE,
        created_by: 1,
      }),
    ).toThrow();
  });
});
