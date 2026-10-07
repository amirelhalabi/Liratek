/**
 * G42 follow-up — owner decision 2026-10-07 (supersedes the earlier "a
 * FOR-partner transaction refuses kept change" rule FOR SESSION BASKETS): a
 * customer basket that contains a FOR-partner item may KEEP change as
 * profit. The basket used to refuse the whole kept claim whenever any item
 * (top level or batch sub-item) had `partnerMode: "FOR"`.
 *
 * What still holds:
 *  - kept change is verified by the ONE helper (`resolveKeptChange`, payer
 *    "customer") against the basket's net charge, and must be funded by
 *    drawer money (cash/wallet) — its funding rule is unchanged;
 *  - the FOR-partner item's own partner-ledger posting is untouched — it
 *    books exactly what it books without kept change;
 *  - voiding the basket nets every ledger to 0 per currency, and the
 *    KEPT_CHANGE profit row is voided with it (rule 20).
 *
 * Rewritten (rule 24 — not deleted) from the pure-seam test that asserted
 * the refusal. RULE 17: run against the code that still had the basket-level
 * FOR gate first and observed RED (see the task report for the output).
 *
 * Real production schema (create_db.sql + migrations); nothing in the money
 * path is mocked.
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
import { SessionCheckoutService } from "../SessionCheckoutService";
import { resetSessionPaymentService } from "../SessionPaymentService";
import { resetDebtService } from "../DebtService";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetCustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../../repositories/SessionPaymentRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import { resetPartnerRepository } from "../../repositories/PartnerRepository";
import { resetCustomServiceRepository } from "../../repositories/CustomServiceRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import {
  snapshotLedgers,
  type LedgerSnapshot,
} from "../../repositories/testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function resetAll(): void {
  resetSessionPaymentService();
  resetDebtService();
  resetDebtRepository();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetClientRepository();
  resetTransactionRepository();
  resetPartnerRepository();
  resetCustomServiceRepository();
  resetSettingsRepository();
}

/** Ledger delta after − before, dropping keys that net to 0. */
function delta(
  before: LedgerSnapshot,
  after: LedgerSnapshot,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const ledger of Object.keys(after) as Array<keyof LedgerSnapshot>) {
    const keys = new Set([
      ...Object.keys(before[ledger]),
      ...Object.keys(after[ledger]),
    ]);
    for (const k of keys) {
      const d = (after[ledger][k] ?? 0) - (before[ledger][k] ?? 0);
      if (Math.abs(d) > 1e-9) {
        out[ledger] = out[ledger] ?? {};
        out[ledger][k] = Math.round(d * 100) / 100;
      }
    }
  }
  return out;
}

describe("G42 — a basket holding a FOR-partner item may keep change (owner decision 2026-10-07)", () => {
  let db: Database.Database;
  let partnerId: number;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name) VALUES (1, 'Partner A')`,
        )
        .run().lastInsertRowid,
    );
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    resetTenantContext();
    resetAll();
    db.close();
  });

  function newSession(): number {
    return Number(
      db
        .prepare(
          `INSERT INTO customer_sessions (tenant_id, customer_name, started_by) VALUES (1, 'Walk-in', 'admin')`,
        )
        .run().lastInsertRowid,
    );
  }

  /** A $20 walk-in service the customer pays for, plus a FOR-partner
   *  service whose full $50 price books to the partner's tab (the customer
   *  pays nothing for it — cart amount 0). */
  function basket() {
    return [
      {
        id: "walk-in",
        module: "custom_service",
        label: "Screen protector",
        amount: 20,
        currency: "USD",
        ipcChannel: "custom-services:add",
        formData: {
          description: "Screen protector",
          price_usd: 20,
          cost_usd: 5,
        },
      },
      {
        id: "for-partner",
        module: "custom_service",
        label: "Partner job",
        amount: 0,
        currency: "USD",
        ipcChannel: "custom-services:add",
        formData: {
          description: "Partner job",
          price_usd: 50,
          cost_usd: 30,
          partnerMode: "FOR",
          partnerId,
        },
      },
    ];
  }

  function checkout(sessionId: number, paidUsd: number, keptUsd: number) {
    return new SessionCheckoutService().checkout(
      {
        sessionId,
        cartItems: basket(),
        payments: [
          {
            method: "CASH",
            currency_code: "USD",
            amount: paidUsd,
            direction: "IN",
          },
        ],
        exchangeRate: 90000,
        userId: 1,
        ...(keptUsd > 0 ? { kept_change_usd: keptUsd } : {}),
      },
      { username: "admin" },
    );
  }

  function keptRows(sessionId: number) {
    return db
      .prepare(
        `SELECT id, status, profit_usd, profit_lbp FROM transactions
          WHERE type = 'KEPT_CHANGE' AND source_id = ?`,
      )
      .all(sessionId) as Array<{
      id: number;
      status: string;
      profit_usd: number;
      profit_lbp: number;
    }>;
  }

  it("accepts the kept change, books it as the KEPT_CHANGE profit, and leaves the partner posting exactly as without kept change", async () => {
    // Control: the same basket paid exactly, no kept change.
    const controlSession = newSession();
    const controlBefore = snapshotLedgers(db);
    const control = await checkout(controlSession, 20, 0);
    expect(control.error).toBeUndefined();
    const controlDelta = delta(controlBefore, snapshotLedgers(db));

    // Kept: $25 paid on $20, $5 kept as profit.
    const sessionId = newSession();
    const before = snapshotLedgers(db);
    const result = await checkout(sessionId, 25, 5);

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const rows = keptRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].profit_usd).toBeCloseTo(5, 6);
    expect(rows[0].profit_lbp).toBe(0);

    const keptDelta = delta(before, snapshotLedgers(db));
    // Partner ledger: identical to the control — the partner still owes the
    // FOR item's full $50 and nothing of the kept change.
    expect(keptDelta.partner).toEqual(controlDelta.partner);
    expect(keptDelta.partner).toEqual({ [`${partnerId}|USD`]: 50 });
    // Drawer: the whole $25 tender, $5 more than the control's $20.
    const sum = (d?: Record<string, number>) =>
      Object.values(d ?? {}).reduce((a, b) => a + b, 0);
    expect(sum(keptDelta.drawers)).toBeCloseTo(25, 6);
    expect(sum(keptDelta.drawers) - sum(controlDelta.drawers)).toBeCloseTo(
      5,
      6,
    );
  });

  it("voiding the basket nets every ledger to 0 per currency and voids the KEPT_CHANGE profit", async () => {
    const sessionId = newSession();
    const before = snapshotLedgers(db);
    const result = await checkout(sessionId, 25, 5);
    expect(result.error).toBeUndefined();

    const [kept] = keptRows(sessionId);

    getTransactionRepository().voidSessionBasket(sessionId, 1);

    expect(delta(before, snapshotLedgers(db))).toEqual({});
    // The original KEPT_CHANGE row is voided (its reversal marker row, if
    // any, carries no profit of its own).
    const original = keptRows(sessionId).find((r) => r.id === kept.id);
    expect(original?.status).toBe("VOIDED");
    const activeProfit = db
      .prepare(
        `SELECT COALESCE(SUM(profit_usd), 0) AS p FROM transactions
          WHERE status = 'ACTIVE' AND type = 'KEPT_CHANGE'`,
      )
      .get() as { p: number };
    expect(activeProfit.p).toBe(0);
  });

  it("kept change must still be funded by drawer money — an on-account overpay cannot be kept", async () => {
    const sessionId = newSession();
    db.prepare(
      `UPDATE customer_sessions SET customer_phone = '03111222' WHERE id = ?`,
    ).run(sessionId);
    const result = await new SessionCheckoutService().checkout(
      {
        sessionId,
        cartItems: basket(),
        payments: [
          {
            method: "CUSTOMER_ACCOUNT",
            currency_code: "USD",
            amount: 25,
            direction: "IN",
          },
        ],
        exchangeRate: 90000,
        userId: 1,
        kept_change_usd: 5,
      },
      { username: "admin" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/only be kept from cash or wallet money/);
    expect(keptRows(sessionId)).toHaveLength(0);
  });
});
