/**
 * LIRA-310 (US3, T034) — Waive on a supplier ACCOUNT settlement
 * (`SupplierRepository.settleAccount`).
 *
 *   - PAY: the shop owes the account $203, pays $200, waives $3 → the
 *     account let the shop pay less ("received": DISCOUNT −3, profit +3).
 *   - COLLECT: the account owes the shop $203, pays $200, waives $3 → the
 *     shop let the account pay less ("forgiven": DISCOUNT +3, profit −3).
 * Either way the anchor member's own row books the cash only, the DISCOUNT
 * row carries the gap, the account balance closes to exactly 0, and the
 * account's unsettled list is empty afterwards (the DISCOUNT row is
 * self-stamped with the settlement, so it never shows up as an open row).
 * Void (and refund) of the SUPPLIER_SETTLEMENT nets every ledger, drawer and
 * profit back to 0 per currency (rule 20).
 * Refusals: a waive with an overpayment surplus; a waive above $5.
 *
 * Real production schema (create_db.sql + migrations), real writers.
 * Rule 17: written before the fix and run red — see tasks.md T034.
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

/** An account parent with one open LEDGER row of `amountUsd`
 *  (+ = the shop owes the account, − = the account owes the shop). */
function seedAccount(amountUsd: number): {
  accountId: number;
  rowId: number;
} {
  const accountId = Number(
    db
      .prepare(
        `INSERT INTO suppliers (tenant_id, name, is_active, is_system) VALUES (1, 'Waive Account', 1, 0)`,
      )
      .run().lastInsertRowid,
  );
  const rowId = Number(
    db
      .prepare(
        `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_by)
         VALUES (1, ?, ?, ?, 0, 1)`,
      )
      .run(accountId, amountUsd > 0 ? "TOP_UP" : "PAYMENT", amountUsd)
      .lastInsertRowid,
  );
  return { accountId, rowId };
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

function usdDrawerDelta(d: Record<string, number>): number {
  return Object.entries(d)
    .filter(([k]) => k.endsWith("|USD"))
    .reduce((a, [, v]) => a + v, 0);
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

function settle(
  accountId: number,
  rowId: number,
  direction: "PAY" | "COLLECT",
): number {
  return getSupplierRepository().settleAccount({
    account_supplier_id: accountId,
    direction,
    selections: [{ kind: "LEDGER", id: rowId }],
    amount_usd: 203,
    amount_lbp: 0,
    commission_usd: 0,
    commission_lbp: 0,
    payments: [{ method: "CASH", currency_code: "USD", amount: 200 }],
    discount: { amount_usd: 3, amount_lbp: 0 },
    exchange_rate: RATE,
    created_by: 1,
  }).id;
}

describe("LIRA-310 — supplier account settlement with a waived gap", () => {
  it("PAY: owes $203, pays $200, waives $3 → received, profit +3, balance 0, nothing left unsettled", () => {
    const { accountId, rowId } = seedAccount(203);
    const before = snapshotLedgers(db);
    const profitBefore = profit();

    const anchorId = settle(accountId, rowId, "PAY");

    const anchor = db
      .prepare(`SELECT amount_usd FROM supplier_ledger WHERE id = ?`)
      .get(anchorId) as { amount_usd: number };
    expect(r6(anchor.amount_usd)).toBe(-200);
    const disc = db
      .prepare(
        `SELECT amount_usd, source_ref_id, settlement_id FROM supplier_ledger WHERE entry_type = 'DISCOUNT' AND supplier_id = ?`,
      )
      .get(accountId) as {
      amount_usd: number;
      source_ref_id: number;
      settlement_id: number;
    };
    expect(disc).toBeDefined();
    expect(r6(disc.amount_usd)).toBe(-3);
    expect(disc.source_ref_id).toBe(anchorId);
    expect(disc.settlement_id).toBe(anchorId);

    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.supplier).toEqual({ [`${accountId}|USD`]: -203 });
    expect(r6(usdDrawerDelta(d.drawers))).toBe(-200);
    expect(r6(profit().usd - profitBefore.usd)).toBe(3);
    expect(getSupplierRepository().getSupplierBalance(accountId)).toEqual({
      balance_usd: 0,
      balance_lbp: 0,
    });
    expect(getSupplierRepository().getAccountUnsettled(accountId)).toEqual([]);
  });

  it("COLLECT: account owes $203, pays $200, waives $3 → forgiven, profit −3, balance 0, nothing left unsettled", () => {
    const { accountId, rowId } = seedAccount(-203);
    const before = snapshotLedgers(db);
    const profitBefore = profit();

    const anchorId = settle(accountId, rowId, "COLLECT");

    const anchor = db
      .prepare(`SELECT amount_usd FROM supplier_ledger WHERE id = ?`)
      .get(anchorId) as { amount_usd: number };
    expect(r6(anchor.amount_usd)).toBe(200);
    const disc = db
      .prepare(
        `SELECT amount_usd, settlement_id FROM supplier_ledger WHERE entry_type = 'DISCOUNT' AND supplier_id = ?`,
      )
      .get(accountId) as { amount_usd: number; settlement_id: number };
    expect(disc).toBeDefined();
    expect(r6(disc.amount_usd)).toBe(3);
    expect(disc.settlement_id).toBe(anchorId);

    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.supplier).toEqual({ [`${accountId}|USD`]: 203 });
    expect(r6(usdDrawerDelta(d.drawers))).toBe(200);
    expect(r6(profit().usd - profitBefore.usd)).toBe(-3);
    expect(getSupplierRepository().getSupplierBalance(accountId)).toEqual({
      balance_usd: 0,
      balance_lbp: 0,
    });
    expect(getSupplierRepository().getAccountUnsettled(accountId)).toEqual([]);
  });

  for (const direction of ["PAY", "COLLECT"] as const) {
    for (const reverse of ["void", "refund"] as const) {
      it(`${direction} + ${reverse}: supplier, drawers and profit net back to 0; the row is open again`, () => {
        const { accountId, rowId } = seedAccount(
          direction === "PAY" ? 203 : -203,
        );
        const before = snapshotLedgers(db);
        const profitBefore = profit();

        settle(accountId, rowId, direction);
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
        const open = getSupplierRepository().getAccountUnsettled(accountId);
        expect(open.map((r) => r.id)).toEqual([rowId]);
      });
    }
  }

  it("refuses a waive together with an overpayment surplus", () => {
    const { accountId, rowId } = seedAccount(203);
    const before = snapshotLedgers(db);
    expect(() =>
      getSupplierRepository().settleAccount({
        account_supplier_id: accountId,
        direction: "PAY",
        selections: [{ kind: "LEDGER", id: rowId }],
        amount_usd: 203,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        surplus_usd: 10,
        payments: [{ method: "CASH", currency_code: "USD", amount: 210 }],
        discount: { amount_usd: 3, amount_lbp: 0 },
        created_by: 1,
      }),
    ).toThrow(/waive|discount/i);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("refuses a waive above $5", () => {
    const { accountId, rowId } = seedAccount(205.01);
    const before = snapshotLedgers(db);
    expect(() =>
      getSupplierRepository().settleAccount({
        account_supplier_id: accountId,
        direction: "PAY",
        selections: [{ kind: "LEDGER", id: rowId }],
        amount_usd: 205.01,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 200 }],
        discount: { amount_usd: 5.01, amount_lbp: 0 },
        created_by: 1,
      }),
    ).toThrow(/more than/i);
    expectPostings(before, snapshotLedgers(db), {});
  });
});
