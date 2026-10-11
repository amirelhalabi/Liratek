/**
 * LIRA-310 (US3, T033) — Waive on a supplier BATCH settlement
 * (`SupplierRepository.settleTransactions`).
 *
 * The shop owes a supplier $503 for a settled batch, hands over $500 and the
 * supplier accepts it (Waive $3). Money invariants (data-model.md
 * "Settlement discount closes the balance", "Reversal"):
 *   - the SETTLEMENT ledger row books the cash actually paid (−500);
 *   - a DISCOUNT ledger row carries the gap (−3, "received"), linked to the
 *     SETTLEMENT row (`source_ref_id`) and self-stamped with its
 *     `settlement_id`, so the supplier balance closes by exactly −503;
 *   - COUNTERPARTY_DISCOUNT profit +3;
 *   - void AND refund of the SUPPLIER_SETTLEMENT net supplier, drawers and
 *     profit back to 0 per currency (rule 20: the settlement's own reversal
 *     owns its bundled discount).
 * Refusals: discount above $5, a bills-only batch, an Other-payment
 * commission, legs that do not add up to `amount − discount`.
 *
 * Real production schema (create_db.sql + migrations), real writers.
 * Rule 17: written before the fix and run red — see tasks.md T033.
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
import { resetFinancialServiceRepository } from "../FinancialServiceRepository";
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
const PROVIDER = "LIRA310PROV";

let db: Database.Database;

function resetAll(): void {
  resetSupplierRepository();
  resetTransactionRepository();
  resetPaymentMethodRepository();
  resetSettingsRepository();
  resetSettingsService();
  resetRateRepository();
  resetProfitRepository();
  resetFinancialServiceRepository();
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

/** A supplier owed `owedUsd` with one open (legacy, model-0) transfer row. */
function seedBatch(
  owedUsd: number,
  opts: { serviceType?: "SEND" | "BILL"; commissionModel?: 0 | 1 } = {},
): { supplierId: number; fsId: number } {
  db.prepare(
    `INSERT OR IGNORE INTO service_providers (tenant_id, code, label, drawer_name) VALUES (1, ?, 'Waive Provider', 'General')`,
  ).run(PROVIDER);
  const supplierId = Number(
    db
      .prepare(
        `INSERT INTO suppliers (tenant_id, name, provider, is_active, is_system) VALUES (1, 'Waive Supplier', ?, 1, 0)`,
      )
      .run(PROVIDER).lastInsertRowid,
  );
  if (owedUsd) {
    db.prepare(
      `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_by)
       VALUES (1, ?, 'TOP_UP', ?, 0, 1)`,
    ).run(supplierId, owedUsd);
  }
  const fsId = Number(
    db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, commission, commission_model, is_settled)
         VALUES (1, ?, ?, ?, 'USD', 0, ?, 0)`,
      )
      .run(
        PROVIDER,
        opts.serviceType ?? "SEND",
        owedUsd || 10,
        opts.commissionModel ?? 0,
      ).lastInsertRowid,
  );
  return { supplierId, fsId };
}

function profit(): { usd: number; lbp: number } {
  const s = new ProfitService().getSummary("2000-01-01", "2100-01-01");
  return { usd: s.totals.gross_profit_usd, lbp: s.totals.gross_profit_lbp };
}

function settlementTxnId(): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { id: number }
  ).id;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

function settleWithWaive(supplierId: number, fsId: number): number {
  return getSupplierRepository().settleTransactions({
    supplier_id: supplierId,
    financial_service_ids: [fsId],
    amount_usd: 503,
    amount_lbp: 0,
    commission_usd: 0,
    commission_lbp: 0,
    payments: [{ method: "CASH", currency_code: "USD", amount: 500 }],
    discount: { amount_usd: 3, amount_lbp: 0 },
    exchange_rate: RATE,
    created_by: 1,
  }).id;
}

describe("LIRA-310 — supplier batch settlement with a waived gap", () => {
  it("owes $503, pays $500, waives $3 → SETTLEMENT −500, DISCOUNT −3 linked + stamped, balance −503, profit +3", () => {
    const { supplierId, fsId } = seedBatch(503);
    const before = snapshotLedgers(db);
    const profitBefore = profit();

    const settlementLedgerId = settleWithWaive(supplierId, fsId);

    const settlementRow = db
      .prepare(`SELECT amount_usd FROM supplier_ledger WHERE id = ?`)
      .get(settlementLedgerId) as { amount_usd: number };
    expect(r6(settlementRow.amount_usd)).toBe(-500);

    const discountRow = db
      .prepare(
        `SELECT amount_usd, amount_lbp, source_ref_table, source_ref_id, settlement_id, is_auto, transaction_id
           FROM supplier_ledger WHERE entry_type = 'DISCOUNT' AND supplier_id = ?`,
      )
      .get(supplierId) as {
      amount_usd: number;
      amount_lbp: number;
      source_ref_table: string;
      source_ref_id: number;
      settlement_id: number;
      is_auto: number;
      transaction_id: number;
    };
    expect(discountRow).toBeDefined();
    expect(r6(discountRow.amount_usd)).toBe(-3);
    expect(discountRow.amount_lbp).toBe(0);
    expect(discountRow.source_ref_table).toBe("supplier_ledger");
    expect(discountRow.source_ref_id).toBe(settlementLedgerId);
    expect(discountRow.settlement_id).toBe(settlementLedgerId);
    expect(discountRow.is_auto).toBe(0);

    const discountTxn = db
      .prepare(`SELECT type, amount_usd, profit_usd FROM transactions WHERE id = ?`)
      .get(discountRow.transaction_id) as {
      type: string;
      amount_usd: number;
      profit_usd: number;
    };
    expect(discountTxn.type).toBe("COUNTERPARTY_DISCOUNT");
    expect(discountTxn.amount_usd).toBe(0);
    expect(r6(discountTxn.profit_usd)).toBe(3);

    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.supplier).toEqual({ [`${supplierId}|USD`]: -503 });
    // Only $500 cash left a drawer.
    const drawerTotal = Object.entries(d.drawers)
      .filter(([k]) => k.endsWith("|USD"))
      .reduce((a, [, v]) => a + v, 0);
    expect(r6(drawerTotal)).toBe(-500);
    expect(r6(profit().usd - profitBefore.usd)).toBe(3);
    expect(getSupplierRepository().getSupplierBalance(supplierId)).toEqual({
      balance_usd: 0,
      balance_lbp: 0,
    });
  });

  for (const reverse of ["void", "refund"] as const) {
    it(`${reverse} of the settlement removes the waived discount too — supplier, drawers, profit back to 0`, () => {
      const { supplierId, fsId } = seedBatch(503);
      const before = snapshotLedgers(db);
      const profitBefore = profit();

      settleWithWaive(supplierId, fsId);
      const txnId = settlementTxnId();
      if (reverse === "void") {
        getTransactionRepository().voidTransaction(txnId, 1);
      } else {
        getTransactionRepository().refundTransaction(txnId, 1);
      }

      expectPostings(before, snapshotLedgers(db), {});
      const after = profit();
      expect(r6(after.usd)).toBe(r6(profitBefore.usd));
      expect(r6(after.lbp)).toBe(r6(profitBefore.lbp));
    });
  }

  it("refuses a waive above $5", () => {
    const { supplierId, fsId } = seedBatch(505.01);
    const before = snapshotLedgers(db);
    expect(() =>
      getSupplierRepository().settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [fsId],
        amount_usd: 505.01,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 500 }],
        discount: { amount_usd: 5.01, amount_lbp: 0 },
        created_by: 1,
      }),
    ).toThrow(/more than/i);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("refuses a waive on a bills-only batch", () => {
    const { supplierId, fsId } = seedBatch(0, {
      serviceType: "BILL",
      commissionModel: 1,
    });
    const before = snapshotLedgers(db);
    expect(() =>
      getSupplierRepository().settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [fsId],
        amount_usd: 0,
        amount_lbp: 0,
        commission_usd: 2,
        commission_lbp: 0,
        discount: { amount_usd: 1, amount_lbp: 0 },
        created_by: 1,
      }),
    ).toThrow(/bills/i);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("refuses a waive with an Other-payment commission collection", () => {
    const { supplierId, fsId } = seedBatch(0, {
      serviceType: "BILL",
      commissionModel: 1,
    });
    const before = snapshotLedgers(db);
    expect(() =>
      getSupplierRepository().settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [fsId],
        amount_usd: 0,
        amount_lbp: 0,
        commission_usd: 2,
        commission_lbp: 0,
        commission_collection_mode: "OTHER_PAYMENT",
        payments: [{ method: "CASH", currency_code: "USD", amount: 2 }],
        discount: { amount_usd: 1, amount_lbp: 0 },
        created_by: 1,
      }),
    ).toThrow(/waive|discount/i);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("refuses legs that do not add up to the owed amount minus the waive", () => {
    const { supplierId, fsId } = seedBatch(503);
    const before = snapshotLedgers(db);
    expect(() =>
      getSupplierRepository().settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [fsId],
        amount_usd: 503,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 499 }],
        discount: { amount_usd: 3, amount_lbp: 0 },
        created_by: 1,
      }),
    ).toThrow(/do not reconcile/);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("no waive: a plain settlement is unchanged (no DISCOUNT row)", () => {
    const { supplierId, fsId } = seedBatch(503);
    const before = snapshotLedgers(db);
    getSupplierRepository().settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [fsId],
      amount_usd: 503,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      payments: [{ method: "CASH", currency_code: "USD", amount: 503 }],
      created_by: 1,
    });
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.supplier).toEqual({ [`${supplierId}|USD`]: -503 });
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM supplier_ledger WHERE entry_type = 'DISCOUNT'`,
        )
        .get(),
    ).toEqual({ n: 0 });
  });
});
