/**
 * Owner decision 2026-10-16 — Whish App top-up from a client: "Fee included
 * in amount" follows the usual RECEIVE rule.
 *
 *   ticked   → credits in = $100, payout = $99, profit = the $1 fee
 *   unticked → credits in = $101, payout = $100, profit = the $1 fee
 *
 * The modal folds the choice into the API's `amount` with
 * `walletReceiveInflow` and pays out by `walletReceiveAmounts` — the same
 * rule `topUpFromClient` reconciles the payout legs against. This drives
 * the server with exactly that payload and checks the drawers per currency,
 * the fee profit, the details and that a void nets every ledger to 0.
 *
 * NOT failing-first: the server's meaning of `amount` (credits in) is
 * unchanged — the failing-first proof is the modal's
 * (TopUpModal.feeIncludedPayout.test.tsx).
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetClientRepository } from "../ClientRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import type { TopUpFromClientInput } from "../../validators/recharge";
import {
  walletReceiveAmounts,
  walletReceiveInflow,
} from "../../utils/walletReceivePayout";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
} from "../testHelpers/postingAssert";

const SCHEMA = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "electron-app",
    "create_db.sql",
  ),
  "utf-8",
);

type G = { __LIRATEK_TEST_DB__?: Database.Database };
let db: Database.Database;

function resetSingletons(): void {
  resetTransactionRepository();
  resetExpenseRepository();
  resetPaymentMethodRepository();
  resetClientRepository();
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  (globalThis as G).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  resetSingletons();
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  seed.run("General", "USD", 5000);
  seed.run("Whish_App", "USD", 1000);
});

afterEach(() => {
  resetTenantContext();
  resetSingletons();
  delete (globalThis as G).__LIRATEK_TEST_DB__;
  db.close();
});

function topUp(feeIncluded: boolean) {
  const typed = 100;
  const fee = 1; // the modal's 1% auto fee on $100
  const amount = walletReceiveInflow({ typedAmount: typed, fee, feeIncluded });
  const payout = walletReceiveAmounts({ walletInflow: amount, fee }).payout;
  const payload: TopUpFromClientInput = {
    amount,
    currency: "USD",
    fee,
    includingFees: feeIncluded,
    payments: [{ method: "CASH", currencyCode: "USD", amount: payout }],
  };
  return new RechargeRepository().topUpFromClient({ ...payload, userId: 1 });
}

function lastTopUp() {
  return db
    .prepare(
      `SELECT id, amount_usd, profit_usd, profit_lbp, metadata_json FROM transactions
        WHERE type = 'RECHARGE_TOPUP' ORDER BY id DESC LIMIT 1`,
    )
    .get() as {
    id: number;
    amount_usd: number;
    profit_usd: number;
    profit_lbp: number;
    metadata_json: string;
  };
}

describe("Whish App top-up from a client — fee included or not", () => {
  it.each([
    [false, 101, 100],
    [true, 100, 99],
  ])(
    "includingFees=%s: Whish_App +%s, General −%s, profit = the $1 fee; void nets to 0",
    (feeIncluded, creditsIn, payout) => {
      const before = snapshotLedgers(db);
      expect(topUp(feeIncluded)).toEqual({ success: true });

      expectPostings(before, snapshotLedgers(db), {
        drawers: { "Whish_App|USD": creditsIn, "General|USD": -payout },
      });
      const txn = lastTopUp();
      expect(txn.amount_usd).toBe(creditsIn);
      expect(txn.profit_usd).toBe(1);
      expect(txn.profit_lbp).toBe(0);
      const meta = JSON.parse(txn.metadata_json);
      expect(meta.cashPaid).toBe(payout);
      expect(meta.details).toMatchObject({
        kind: "wallet_topup",
        includingFees: feeIncluded,
        fee: 1,
        amount: creditsIn,
      });

      getTransactionRepository().voidTransaction(txn.id, 1);
      expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
        drawers: {},
        supplier: {},
        partner: {},
        debt: {},
      });
    },
  );
});
