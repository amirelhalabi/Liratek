/**
 * Payout kept change on the two Recharge payouts (owner decisions
 * 2026-10-07, docs/FEATURE_GUIDE.md §4.1 "Kept change"):
 *
 *   - TELECOM_CREDIT_BUYBACK (`processCreditBuyback`): the shop buys credits
 *     back from a customer and pays them out.
 *   - RECHARGE_TOPUP from a client (`topUpFromClient`, TopUpModal "From
 *     Client"): the client transfers Whish App credits, the shop pays out
 *     amount − fee from its drawers.
 *
 * Kept change on a payout = the shop hands out a round figure a little SHORT
 * of what it owes (under PAYOUT_KEEP_CHANGE_MAX, payout currency only); the
 * leftover is profit inside the transaction's own stamp, so the generic void
 * negates it (rule 20). Failing-first (rule 17); real schema per test.
 * Payload field names come from the core schemas (rule 24).
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { RechargeRepository, type RechargeData } from "../RechargeRepository";
import { resetCarrierLineRepository } from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineOwedDeliveryRepository } from "../CarrierLineOwedDeliveryRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetMobileServiceItemRepository } from "../MobileServiceItemRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import type {
  CreateRechargePayload,
  TopUpFromClientInput,
} from "../../validators/recharge";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
} from "../testHelpers/postingAssert";

const SCHEMA = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "..", "electron-app", "create_db.sql"),
  "utf-8",
);

type G = { __LIRATEK_TEST_DB__?: Database.Database };
let db: Database.Database;
let TODAY = "";
const CLIENT_ID = 1;
const SHOP_MTC = "03123456";
const LINE_CREDITS = 500;
const RATE = 89_500;

function resetSingletons(): void {
  resetTransactionRepository();
  resetDebtRepository();
  resetDebtService();
  resetExpenseRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetVoucherRepository();
  resetPaymentMethodRepository();
  resetMobileServiceItemRepository();
  resetClientRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetCarrierLineOwedDeliveryRepository();
  resetCarrierLineService();
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  (globalThis as G).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  resetSingletons();
  TODAY = (
    db.prepare(`SELECT date('now','localtime') AS d`).get() as { d: string }
  ).d;
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["MTC", "USD", LINE_CREDITS],
    ["General", "USD", 5000],
    ["General", "LBP", 500_000_000],
    ["Whish_App", "USD", 1000],
  ] as const)
    seed.run(d, c, b);
  db.prepare(
    `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, label, credits, validity_expires_at, is_active, is_primary)
     VALUES (1, 'mtc', ?, 'Shop MTC', ?, '2099-01-01', 1, 1)`,
  ).run(SHOP_MTC, LINE_CREDITS);
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, 'Kept Client', '70111222')`,
  ).run(CLIENT_ID);
});

afterEach(() => {
  resetTenantContext();
  resetSingletons();
  delete (globalThis as G).__LIRATEK_TEST_DB__;
  db.close();
});

// ─── helpers ────────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;

function profitSum(): { usd: number; lbp: number } {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd),0) AS usd, COALESCE(SUM(profit_lbp),0) AS lbp
         FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
  return { usd: Math.round(r.usd * 1e6) / 1e6, lbp: Math.round(r.lbp) };
}

function lastTxn(type: string): {
  id: number;
  profit_usd: number;
  profit_lbp: number;
  source_id: number;
} {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp, source_id FROM transactions
        WHERE type = ? AND reverses_id IS NULL ORDER BY id DESC LIMIT 1`,
    )
    .get(type) as {
    id: number;
    profit_usd: number;
    profit_lbp: number;
    source_id: number;
  };
}

function lineCredits(): number {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(credits),0) AS s FROM carrier_lines WHERE carrier = 'mtc' AND is_active = 1`,
      )
      .get() as { s: number }
  ).s;
}

function countTxns(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }
  ).n;
}

function buyback(
  p: Partial<CreateRechargePayload>,
): { success: boolean; error?: string } {
  return new RechargeRepository().processRecharge({
    provider: "MTC",
    type: "CREDIT_BUYBACK",
    amount: 10,
    cost: 0,
    currency: "LBP",
    phoneNumber: SHOP_MTC,
    tender_exchange_rate: RATE,
    userId: 1,
    client_day: TODAY,
    ...p,
  } as RechargeData);
}

function topUp(
  p: Partial<TopUpFromClientInput>,
): { success: boolean; error?: string } {
  return new RechargeRepository().topUpFromClient({
    amount: 100,
    currency: "USD",
    fee: 1,
    payments: [],
    clientId: CLIENT_ID,
    userId: 1,
    ...p,
  } as TopUpFromClientInput & { userId: number });
}

function expectRefused(
  run: () => { success: boolean; error?: string },
  message: RegExp,
): void {
  const before = snapshotLedgers(db);
  const n = countTxns();
  const res = run();
  expect(res.success).toBe(false);
  expect(res.error).toMatch(message);
  expect(countTxns()).toBe(n);
  expectPostings(before, snapshotLedgers(db), {});
}

// ─── credit buy-back ────────────────────────────────────────────────────────

describe("TELECOM_CREDIT_BUYBACK — payout kept change", () => {
  it("owes 750,000 LBP, hands out 700,000, keeps 50,000 as profit; void nets ledgers, lines and profit to 0", () => {
    // Control: the exact payout's stamp, voided straight away.
    const c0 = snapshotLedgers(db);
    expect(
      buyback({
        price: 750_000,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 750_000 }],
      }).success,
    ).toBe(true);
    const control = lastTxn("TELECOM_CREDIT_BUYBACK");
    getTransactionRepository().voidTransaction(control.id, 1);
    expectPostings(c0, snapshotLedgers(db), {});

    const before = snapshotLedgers(db);
    const p0 = profitSum();
    const lines0 = lineCredits();
    const res = buyback({
      price: 750_000,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 700_000 }],
      kept_change_lbp: 50_000,
    });
    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);
    const t = lastTxn("TELECOM_CREDIT_BUYBACK");
    // Profit = credits − owed (USD, unchanged) + the kept 50,000 LBP —
    // never re-derived from what was actually paid AND kept added on top.
    expect(r2(t.profit_usd)).toBe(r2(control.profit_usd));
    expect(Math.round(t.profit_lbp - control.profit_lbp)).toBe(50_000);
    const d = ledgerDeltas(before, snapshotLedgers(db)).drawers;
    expect(d["General|LBP"]).toBe(-700_000);
    expect(lineCredits() - lines0).toBe(10);

    getTransactionRepository().voidTransaction(t.id, 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(profitSum()).toEqual(p0);
    expect(lineCredits()).toBe(lines0);
  });

  it("refuses a phantom kept on an exact payout", () => {
    expectRefused(
      () =>
        buyback({
          price: 750_000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 750_000 }],
          kept_change_lbp: 40_000,
        }),
      /keep change/i,
    );
  });

  it("refuses kept in the other currency than the payout", () => {
    expectRefused(
      () =>
        buyback({
          price: 750_000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 700_000 }],
          kept_change_usd: 0.55,
        }),
      /payout currency/i,
    );
  });

  it("refuses kept at the 100,000 LBP cap", () => {
    expectRefused(
      () =>
        buyback({
          price: 800_000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 700_000 }],
          kept_change_lbp: 100_000,
        }),
      /small leftover/i,
    );
  });
});

// ─── top-up from client ─────────────────────────────────────────────────────

describe("RECHARGE_TOPUP from a client — payout kept change", () => {
  it("$100 credits, $1 fee → owes $99, hands out $98.50, keeps $0.50; profit = fee + kept; void nets to 0", () => {
    const before = snapshotLedgers(db);
    const p0 = profitSum();
    const res = topUp({
      payments: [{ method: "CASH", currencyCode: "USD", amount: 98.5 }],
      kept_change_usd: 0.5,
    });
    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);
    const t = lastTxn("RECHARGE_TOPUP");
    expect(r2(t.profit_usd)).toBe(1.5);
    expect(t.profit_lbp).toBe(0);
    const d = ledgerDeltas(before, snapshotLedgers(db)).drawers;
    expect(d["General|USD"]).toBe(-98.5);
    expect(d["Whish_App|USD"]).toBe(100);
    // What actually left the drawer, not the target.
    const rc = db
      .prepare(`SELECT cost FROM recharges WHERE id = ?`)
      .get(t.source_id) as { cost: number };
    expect(rc.cost).toBe(98.5);

    getTransactionRepository().voidTransaction(t.id, 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(profitSum()).toEqual(p0);
  });

  it("refuses a phantom kept on an exact payout", () => {
    expectRefused(
      () =>
        topUp({
          payments: [{ method: "CASH", currencyCode: "USD", amount: 99 }],
          kept_change_usd: 0.04,
        }),
      /keep change/i,
    );
  });

  it("refuses kept in the other currency than the payout", () => {
    expectRefused(
      () =>
        topUp({
          payments: [{ method: "CASH", currencyCode: "USD", amount: 98.5 }],
          kept_change_lbp: 44_750,
        }),
      /payout currency/i,
    );
  });

  it("refuses kept at the $1 cap", () => {
    expectRefused(
      () =>
        topUp({
          fee: 0,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 99 }],
          kept_change_usd: 1,
        }),
      /small leftover/i,
    );
  });
});
