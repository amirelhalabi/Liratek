/**
 * Phase 5 (POSTING_INTEGRITY_PLAN.md §7) — payouts that keep change, and the
 * manual expense that gets change back, checked against the posting rules
 * table (constants/postingRules.ts).
 *
 * Kept change on a payout (owner decisions 2026-10-07, FEATURE_GUIDE §4.1):
 * the shop owes the customer `owed`, hands out a round figure a little short
 * and keeps the leftover. So the tender drawer moves −(owed − kept) and the
 * transaction's profit stamp grows by +kept, in the payout currency. Every
 * other ledger posts exactly as for the exact payout.
 *
 * Each case drives the REAL writer against the REAL schema
 * (`electron-app/create_db.sql` + migrations, fresh in-memory DB per case):
 *   1. CONTROL — the same payout handed out exactly: its profit stamp is
 *      recorded, then it is reversed and every ledger must be back to start;
 *   2. the kept payout: every ledger moves exactly as its rule says
 *      (`expectPostingsMatchRule`, `kept` passed as an input);
 *   3. the profit stamp grew by exactly the rule's `keptProfit` over the
 *      control's (the rule's own formula, never a hand-typed number —
 *      rule 24);
 *   4. reversal (rule 20): every ledger and the profit sum net to 0, per
 *      currency.
 *
 * Failing-first (rule 17): written before the table learned `kept`, and all
 * 11 cases failed on the old table — the four updated rules had no
 * `keptProfit` (their tender line also still read −owed, while the code
 * posts −(owed − kept): e.g. OMT_System −100 on a $100.73 RECEIVE keeping
 * $0.73), and FS_WALLET/RECEIVE/cash, HOLD_MONEY_COLLECT/payout and
 * EXPENSE/manual did not exist.
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
import { RechargeRepository, type RechargeData } from "../RechargeRepository";
import {
  HoldMoneyRepository,
  resetHoldMoneyRepository,
} from "../HoldMoneyRepository";
import {
  ExpenseRepository,
  resetExpenseRepository,
  type CreateExpenseData,
} from "../ExpenseRepository";
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
import { resetCarrierLineRepository } from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import type { CreateFinancialServiceInput } from "../../validators/financial";
import { holdMoneyCollectSchema } from "../../validators/holdMoney";
import { createExpenseSchema } from "../../validators/expense";
import {
  POSTING_RULES,
  stampAmount,
  type PostingInputs,
  type PostingRule,
  type PostingRuleKey,
} from "../../constants/postingRules";
import {
  snapshotLedgers,
  expectPostings,
  expectPostingsMatchRule,
  type PostingRoleKeys,
} from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL = fs.readFileSync(
  path.join(REPO_ROOT, "electron-app/create_db.sql"),
  "utf-8",
);

const RATE = 89_500;
const CLIENT_ID = 1;
const SHOP_MTC = "03123456";
const LINE_CREDITS = 500;

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
  resetHoldMoneyRepository();
  resetExpenseRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetCarrierLineService();
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
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, 'Kept Client', '70111222')`,
  ).run(CLIENT_ID);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["General", "USD", 10_000],
    ["General", "LBP", 900_000_000],
    ["OMT_System", "USD", 10_000],
    ["OMT_System", "LBP", 900_000_000],
    ["Whish_App", "USD", 10_000],
    ["Whish_App", "LBP", 900_000_000],
    // Carrier drawer EQUALS Σ line credits, so the buy-back's drift
    // correction leg stays 0 (see that rule's note).
    ["MTC", "USD", LINE_CREDITS],
  ] as const)
    seed.run(d, c, b);
  db.prepare(
    `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, label, credits, validity_expires_at, is_active, is_primary)
     VALUES (1, 'mtc', ?, 'Shop MTC', ?, '2099-01-01', 1, 1)`,
  ).run(SHOP_MTC, LINE_CREDITS);
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

// ─── helpers ────────────────────────────────────────────────────────────────

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Σ profit over ACTIVE transactions, per currency (the stamp side). */
function profitSum(): { USD: number; LBP: number } {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp
         FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
  return { USD: r6(r.usd), LBP: r6(r.lbp) };
}

function latestTxn(type: string): number {
  const row = db
    .prepare(
      `SELECT id FROM transactions
        WHERE type = ? AND status = 'ACTIVE' AND reverses_id IS NULL
        ORDER BY id DESC LIMIT 1`,
    )
    .get(type) as { id: number } | undefined;
  if (!row) throw new Error(`no ACTIVE ${type} transaction`);
  return row.id;
}

function supplierId(provider: string): number {
  const row = db
    .prepare(`SELECT id FROM suppliers WHERE provider = ? AND tenant_id = 1`)
    .get(provider) as { id: number } | undefined;
  if (!row) throw new Error(`no supplier for provider ${provider}`);
  return row.id;
}

function ok(res: { success: boolean; error?: string }): void {
  if (!res.success) throw new Error(res.error);
}

function fsCreate(p: Partial<CreateFinancialServiceInput>): void {
  new FinancialServiceRepository().createTransaction({
    exchangeRate: RATE,
    ...p,
  } as Parameters<FinancialServiceRepository["createTransaction"]>[0]);
}

function recharge(data: Partial<RechargeData>): void {
  const res = new RechargeRepository().processRecharge({
    userId: 1,
    ...data,
  } as RechargeData);
  ok(res);
}

const voidTxn = (txnId: number) =>
  getTransactionRepository().voidTransaction(txnId, 1);

// ─── payout cases ───────────────────────────────────────────────────────────

interface PayoutCase {
  name: string;
  rule: PostingRuleKey;
  /** Inputs of the KEPT run (`kept` > 0). The control uses `kept: 0`. */
  inputs: PostingInputs;
  keys: () => PostingRoleKeys;
  /** Runs before each snapshot (e.g. books the hold being picked up). */
  prepare?: () => void;
  /** Hands out `owed − kept` (kept = 0 → the exact control payout). */
  act: (kept: number) => void;
  /** Reversal owner (rule 20) of the row `act` wrote. */
  reverse: (txnId: number) => void;
  /** Extra checks after the kept run. */
  after?: () => void;
}

let holdId = 0;
const hold = () => new HoldMoneyRepository();

const payoutCases: PayoutCase[] = [
  // ── OMT/WHISH system RECEIVE, cash — POSTING_MAP.md §4.1 ──
  ...(
    [
      { currency: "USD", x: 100.73, kept: 0.73 },
      { currency: "LBP", x: 5_050_000, kept: 50_000 },
    ] as const
  ).map(
    ({ currency, x, kept }): PayoutCase => ({
      name: `OMT walk-in RECEIVE, ${currency} cash`,
      rule: "FS_SYSTEM/RECEIVE/walk-in",
      inputs: { x, f: 0, c: 0, currency, kept },
      keys: () => ({
        drawers: { pcd: "OMT_System" },
        providerSupplierId: supplierId("OMT"),
      }),
      act: (k) =>
        fsCreate({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: x,
          currency,
          commission: 0,
          omtServiceType: "INTRA",
          cashoutMethod: "CASH",
          payments: [{ method: "CASH", currencyCode: currency, amount: x - k }],
          ...(k > 0
            ? currency === "LBP"
              ? { kept_change_lbp: k }
              : { kept_change_usd: k }
            : {}),
        }),
      reverse: voidTxn,
    }),
  ),

  // ── wallet RECEIVE (Whish App / OMT App) — POSTING_MAP.md §4.2 ──
  ...(
    [
      { currency: "USD", x: 100, c: 1, kept: 0.5 },
      { currency: "LBP", x: 2_000_000, c: 20_000, kept: 30_000 },
    ] as const
  ).map(
    ({ currency, x, c, kept }): PayoutCase => ({
      name: `Whish App RECEIVE, ${currency} cash`,
      rule: "FS_WALLET/RECEIVE/cash",
      inputs: { x, f: 0, c, currency, kept },
      keys: () => ({ drawers: { tender: "General", wallet: "Whish_App" } }),
      act: (k) =>
        fsCreate({
          provider: "WHISH_APP",
          serviceType: "RECEIVE",
          amount: x,
          currency,
          commission: c,
          payments: [
            { method: "CASH", currencyCode: currency, amount: x - c - k },
          ],
          ...(k > 0
            ? currency === "LBP"
              ? { kept_change_lbp: k }
              : { kept_change_usd: k }
            : {}),
        }),
      reverse: voidTxn,
    }),
  ),

  // ── TELECOM_CREDIT_BUYBACK, cash — POSTING_MAP.md §4.3 ──
  ...(
    [
      { currency: "USD", x: 8.5, kept: 0.5 },
      { currency: "LBP", x: 750_000, kept: 50_000 },
    ] as const
  ).map(
    ({ currency, x, kept }): PayoutCase => ({
      name: `credit buy-back, ${currency} cash payout`,
      rule: "TELECOM_CREDIT_BUYBACK/cash",
      inputs: { x, f: 0, c: 0, currency, carrierUsd: 10, kept },
      keys: () => ({ drawers: { tender: "General", carrier: "MTC" } }),
      act: (k) =>
        recharge({
          provider: "MTC",
          type: "CREDIT_BUYBACK",
          amount: 10,
          cost: 0,
          price: x,
          currency,
          phoneNumber: SHOP_MTC,
          payments: [{ method: "CASH", currencyCode: currency, amount: x - k }],
          ...(k > 0
            ? currency === "LBP"
              ? { kept_change_lbp: k }
              : { kept_change_usd: k }
            : {}),
        }),
      reverse: voidTxn,
    }),
  ),

  // ── RECHARGE_TOPUP from a client, cash ──
  {
    name: "topUpFromClient: Whish App credits bought for cash, USD",
    rule: "RECHARGE_TOPUP/client",
    inputs: { x: 100, f: 5, c: 0, currency: "USD", kept: 0.5 },
    keys: () => ({ drawers: { tender: "General", wallet: "Whish_App" } }),
    act: (k) =>
      ok(
        new RechargeRepository().topUpFromClient({
          amount: 100,
          fee: 5,
          currency: "USD",
          payments: [{ method: "CASH", currencyCode: "USD", amount: 95 - k }],
          clientId: CLIENT_ID,
          userId: 1,
          ...(k > 0 ? { kept_change_usd: k } : {}),
        }),
      ),
    reverse: voidTxn,
  },

  // ── HOLD_MONEY_COLLECT (Hold Money pickup) ──
  ...(
    [
      { currency: "USD", x: 50.12, kept: 0.12 },
      { currency: "LBP", x: 1_050_000, kept: 50_000 },
    ] as const
  ).map(
    ({ currency, x, kept }): PayoutCase => ({
      name: `Hold Money pickup, ${currency} cash`,
      rule: "HOLD_MONEY_COLLECT/payout",
      inputs: { x, f: 0, c: 0, currency, kept },
      keys: () => ({ drawers: { tender: "General" } }),
      prepare: () => {
        const res = hold().createHold(
          {
            client_name: "Rami",
            usd_amount: currency === "USD" ? x : 0,
            lbp_amount: currency === "LBP" ? x : 0,
          },
          1,
        );
        ok(res);
        holdId = res.id!;
      },
      act: (k) =>
        ok(
          hold().collectHold(
            holdMoneyCollectSchema.parse({
              id: holdId,
              payments: [
                { method: "CASH", currency_code: currency, amount: x - k },
              ],
              ...(k > 0
                ? currency === "LBP"
                  ? { kept_change_lbp: k }
                  : { kept_change_usd: k }
                : {}),
            }),
            1,
          ),
        ),
      // Dedicated reversal owner (rule 20): voidPickup, not the generic void.
      reverse: () => {
        const pickupId = hold().getPickups(holdId)[0]!.id;
        ok(hold().voidPickup(pickupId, 1));
      },
      // The held balance clears in full — the kept part included.
      after: () => {
        const h = db
          .prepare(`SELECT status FROM hold_money WHERE id = ?`)
          .get(holdId) as { status: string };
        expect(h.status).toBe("collected");
      },
    }),
  ),
];

describe("Payout kept change — postings match POSTING_RULES", () => {
  for (const c of payoutCases) {
    it(`${c.name}: posts exactly ${c.rule} with kept change; profit +kept; reversal nets to 0`, () => {
      const rule: PostingRule = POSTING_RULES[c.rule];
      expect(rule.keptProfit).toBeDefined();

      // 1. Control: the exact payout.
      c.prepare?.();
      const c0 = snapshotLedgers(db);
      const pc0 = profitSum();
      c.act(0);
      const controlProfit = profitSum();
      const controlTxn = latestTxn(rule.transactionType);
      // The control's own drawers match the rule with kept = 0.
      expectPostingsMatchRule(
        rule,
        c0,
        snapshotLedgers(db),
        { ...c.inputs, kept: 0 },
        c.keys(),
      );
      c.reverse(controlTxn);
      expectPostings(c0, snapshotLedgers(db), {});
      const controlStamp = {
        USD: r6(controlProfit.USD - pc0.USD),
        LBP: r6(controlProfit.LBP - pc0.LBP),
      };

      // 2. The kept payout, from the table.
      c.prepare?.();
      const before = snapshotLedgers(db);
      const p0 = profitSum();
      c.act(c.inputs.kept ?? 0);
      expectPostingsMatchRule(
        rule,
        before,
        snapshotLedgers(db),
        c.inputs,
        c.keys(),
      );
      c.after?.();

      // 3. Profit stamp: control's + the rule's keptProfit, per currency.
      const want = stampAmount(rule.keptProfit!, c.inputs);
      const p1 = profitSum();
      expect({
        USD: r6(p1.USD - p0.USD - controlStamp.USD),
        LBP: r6(p1.LBP - p0.LBP - controlStamp.LBP),
      }).toEqual({ USD: want.USD ?? 0, LBP: want.LBP ?? 0 });

      // 4. Rule 20: reversal nets every ledger and the profit sum to 0.
      c.reverse(latestTxn(rule.transactionType));
      expectPostings(before, snapshotLedgers(db), {});
      expect(profitSum()).toEqual(p0);
    });
  }
});

// ─── manual expense, change back — EXPENSE ──────────────────────────────────

describe("Manual expense with change back — postings match POSTING_RULES", () => {
  /** Field names from the shared core schema (rule 24). */
  function expensePayload(
    bill: number,
    handed: number,
    returned: number,
  ): CreateExpenseData {
    const parsed = createExpenseSchema.parse({
      category: "Shop_Supply",
      description: "Printer ink",
      amount_usd: bill,
      amount_lbp: 0,
      paid_by_method: "CASH",
      expense_date: "2026-10-07T09:00:00.000Z",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: handed },
        ...(returned > 0
          ? [
              {
                method: "CASH",
                currencyCode: "USD",
                amount: returned,
                direction: "OUT" as const,
              },
            ]
          : []),
      ],
      // Change neither returned nor part of the bill is added to the cost.
      kept_change_usd: r6(handed - returned - bill),
      tender_exchange_rate: RATE,
    });
    return {
      ...parsed,
      description: parsed.description ?? "",
    } as unknown as CreateExpenseData;
  }

  it.each([
    // bill $18.50, hand $20, $1 back → cost $19 (owner example)
    { bill: 18.5, handed: 20, returned: 1 },
    // paid exactly — no change leg
    { bill: 18.5, handed: 18.5, returned: 0 },
  ])(
    "bill $$bill, handed $$handed, $$returned back: drawer and expense row match EXPENSE/manual; void nets to 0",
    ({ bill, handed, returned }) => {
      const rule: PostingRule = POSTING_RULES["EXPENSE/manual"];
      const inputs: PostingInputs = {
        x: handed,
        f: 0,
        c: 0,
        currency: "USD",
        returned,
      };
      const before = snapshotLedgers(db);
      const p0 = profitSum();
      const id = new ExpenseRepository().createExpense(
        expensePayload(bill, handed, returned),
        1,
      );

      expectPostingsMatchRule(rule, before, snapshotLedgers(db), inputs, {
        drawers: { tender: "General" },
      });
      const row = db
        .prepare(`SELECT amount_usd, amount_lbp FROM expenses WHERE id = ?`)
        .get(id) as { amount_usd: number; amount_lbp: number };
      const want = stampAmount(rule.expenseAmount!, inputs);
      expect({ USD: row.amount_usd, LBP: row.amount_lbp }).toEqual({
        USD: want.USD ?? 0,
        LBP: want.LBP ?? 0,
      });
      // Never profit.
      expect(profitSum()).toEqual(p0);

      voidTxn(latestTxn(rule.transactionType));
      expectPostings(before, snapshotLedgers(db), {});
    },
  );
});
