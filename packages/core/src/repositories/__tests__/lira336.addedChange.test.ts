/**
 * LIRA-336 — change the customer adds on a payout (owner request 2026-10-18).
 *
 * The shop owes a customer $197 and has no small notes: the cashier asks the
 * customer for $3 (or 268,500 LBP) and hands out $200. The customer's lines
 * travel in `customerPayments` (Whish system receive with the fee paid on
 * top: in `feePayments`), the claim in `added_change_usd/lbp` (payout
 * currency). The server verifies it (`resolveAddedChange`), reconciles the
 * payout lines against owed + added, and writes the customer's lines as
 * positive payment rows of the payout's own transaction.
 *
 * Per flow, every accepted case checks against a CONTROL (the same payout
 * paid out exactly, no added change):
 *   - every drawer moves by the control's movement plus exactly what the
 *     customer added and the extra handed out (USD and LBP variants, rule
 *     28d), i.e. each drawer moves by what really moved;
 *   - no "Change rounding" expense (active expense totals unchanged);
 *   - the transaction's amount and profit stamp equal the control's (FR-005);
 *   - the customer's line is a positive payments row of the payout and an IN
 *     line of its payment snapshot;
 *   - the flow's own reversal nets every drawer and the profit to 0, per
 *     currency (rule 20).
 * Plus refusals: over the cap, a claim not matching the lines, customer lines
 * with no claim, a partner (FOR) payout, a session basket item, a payout to
 * the customer's account, a non-cash system cashout, a two-currency Hold
 * Money pickup, an account line among the customer's lines.
 *
 * Every payload is parsed through the real core schema first (rules 24,
 * 28d), then handed to the real repository entry point the services forward
 * to unchanged.
 *
 * Rule 17 — run on 2026-10-18 against the code BEFORE the flows learned the
 * added change (the schema fields, `measureCustomerLegs` and
 * `resolveAddedChange` already existed; no repository read them): 38 of 43
 * cases failed. The 5 that passed must pass on both sides: "no claim" cases
 * that are refused as today (OMT customer lines, Whish fee lines over the
 * fee, Whish App lines over the total, Exchange lines over amountIn) and the
 * empty `customerPayments` top-up. How the others failed:
 *   - OMT system RECEIVE, every accepted case and the over-cap / mismatch /
 *     account / no-payout-lines / account-cashout / wallet-cashout refusals:
 *     "customerPayments is only for a Whish App, OMT App or Binance
 *     cash-out" — the repository still refused the lines outright;
 *   - Whish fee paid on top (accepted and account line): the fee reconcile,
 *     "The payment is more than the total" ($8 vs the $5 fee);
 *   - Whish App / Binance accepted cases and the Binance account cashout:
 *     "The customer's lines are more than the total" (bookCustomerLegs);
 *   - Exchange accepted cases, no payout lines, outside USD/LBP: the same
 *     customer-lines overpay; FOR partner: "A partner exchange takes no
 *     payout legs";
 *   - buy-back, top-up, Hold Money accepted cases, their "no claim" cases
 *     and the two-currency pickup: the plain payout reconcile, "The payment
 *     is more than the total" — `customerPayments` and the claim were
 *     stripped / never read;
 *   - saved without a word (the claim silently dropped, rule 23): OMT FOR
 *     partner, OMT session item, OMT SEND, an ordinary MTC sale, and a Hold
 *     Money pickup with no payout lines (the CASH fallback paid the portion
 *     and the customer's $3 vanished).
 * Added AFTER the fix (not proven failing-first; nothing was re-broken to
 * prove them, rule 17): the OMT "no claim" case split into a schema case
 * and a repository-without-Zod case, plus "the schema accepts OMT RECEIVE
 * customer lines only with a claim" (the refine was relaxed before the
 * run, so it would have passed then too); the coordinator's 270,000 LBP →
 * $3.02 end-to-end case; the Whish fee-deducted and OMT App variants; and
 * the supplier / partner / debt ledger comparison inside
 * `expectAddedAccepted`.
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
import { ExchangeRepository } from "../ExchangeRepository";
import { RechargeRepository, type RechargeData } from "../RechargeRepository";
import {
  HoldMoneyRepository,
  resetHoldMoneyRepository,
} from "../HoldMoneyRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetClientRepository } from "../ClientRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetCarrierLineRepository } from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import {
  createFinancialServiceSchema,
  type CreateFinancialServiceInput,
} from "../../validators/financial";
import { exchangeSubmitSchema } from "../../validators/exchange";
import {
  createRechargeSchema,
  topUpFromClientSchema,
} from "../../validators/recharge";
import { holdMoneyCollectSchema } from "../../validators/holdMoney";
import { CHANGE_ROUNDING_EXPENSE_CATEGORY } from "../changeRoundingExpense";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
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
let TODAY = "";

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
  TODAY = (
    db.prepare(`SELECT date('now','localtime') AS d`).get() as { d: string }
  ).d;
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, 'Change Client', '70111222')`,
  ).run(CLIENT_ID);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["General", "USD", 10_000],
    ["General", "LBP", 900_000_000],
    ["OMT_System", "USD", 10_000],
    ["OMT_System", "LBP", 900_000_000],
    ["Whish_System", "USD", 10_000],
    ["Whish_System", "LBP", 900_000_000],
    ["Binance", "USDT", 10_000],
    ["Whish_App", "USD", 10_000],
    ["Whish_App", "LBP", 900_000_000],
    ["MTC", "USD", LINE_CREDITS],
  ] as const)
    seed.run(d, c, b);
  db.prepare(
    `INSERT OR REPLACE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES (1, 'LBP', 89500, 89000, 90000, 1)`,
  ).run();
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

// ─── shared helpers ─────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;

interface ParentTxn {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  source_table: string;
  source_id: number;
  metadata_json: string | null;
}

const TXN_COLS = `id, amount_usd, amount_lbp, profit_usd, profit_lbp, source_table, source_id, metadata_json`;

function txnById(id: number): ParentTxn {
  return db
    .prepare(`SELECT ${TXN_COLS} FROM transactions WHERE id = ?`)
    .get(id) as ParentTxn;
}

function parentOf(sourceTable: string, sourceId: number): ParentTxn {
  return db
    .prepare(
      `SELECT ${TXN_COLS} FROM transactions
        WHERE source_table = ? AND source_id = ? AND reverses_id IS NULL
        ORDER BY id ASC LIMIT 1`,
    )
    .get(sourceTable, sourceId) as ParentTxn;
}

function lastOfType(type: string): ParentTxn {
  return db
    .prepare(
      `SELECT ${TXN_COLS} FROM transactions
        WHERE type = ? AND reverses_id IS NULL ORDER BY id DESC LIMIT 1`,
    )
    .get(type) as ParentTxn;
}

function profitSum(): { usd: number; lbp: number } {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd),0) AS usd, COALESCE(SUM(profit_lbp),0) AS lbp
         FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
  return { usd: Math.round(r.usd * 1e6) / 1e6, lbp: Math.round(r.lbp) };
}

function activeExpenseTotals(): { usd: number; lbp: number } {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd),0) AS usd, COALESCE(SUM(amount_lbp),0) AS lbp
         FROM expenses WHERE COALESCE(is_refunded, 0) = 0`,
    )
    .get() as { usd: number; lbp: number };
  return { usd: r2(r.usd), lbp: Math.round(r.lbp) };
}

function roundingExpenseCount(): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM expenses WHERE category = ? AND COALESCE(is_refunded,0) = 0`,
      )
      .get(CHANGE_ROUNDING_EXPENSE_CATEGORY) as { n: number }
  ).n;
}

function countRows(table: "transactions" | "expenses"): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  ).n;
}

const roundKey = (k: string, v: number) =>
  k.endsWith("|LBP") ? Math.round(v) : r2(v);

interface CustomerLine {
  method: string;
  currencyCode: string;
  amount: number;
}

interface AcceptArgs {
  /** The same payout paid out exactly, no added change. */
  control: () => ParentTxn;
  /** The payout with the customer's added change. */
  added: () => ParentTxn;
  /** The flow's own reversal (generic void/refund, or voidPickup). */
  reverse: (t: ParentTxn) => void;
  /** "drawer|currency" → how much MORE it moved than in the control. */
  extraDrawerMoves: Record<string, number>;
  /** The customer's line that must be a positive payments row. */
  customerLine: CustomerLine;
  /** Expected profit difference vs the control (kept change). Default 0. */
  profitDiff?: { usd: number; lbp: number };
  /** Expected change in active expenses (a combined round-up). Default 0. */
  expenseDiff?: { usd: number; lbp: number };
}

function expectAddedAccepted(a: AcceptArgs): void {
  // Control in its own window — its movements and stamp are the baseline.
  const c0 = snapshotLedgers(db);
  const control = a.control();
  const controlDeltas = ledgerDeltas(c0, snapshotLedgers(db));
  const controlDrawers = controlDeltas.drawers;
  a.reverse(control);
  expectPostings(c0, snapshotLedgers(db), {});

  const before = snapshotLedgers(db);
  const p0 = profitSum();
  const e0 = activeExpenseTotals();
  const rounding0 = roundingExpenseCount();
  const t = a.added();
  expect(t).toBeDefined();
  const addedDeltas = ledgerDeltas(before, snapshotLedgers(db));
  const addedDrawers = addedDeltas.drawers;

  // FR-005: what is owed to the supplier / partner and the client's account
  // move exactly as in the control — the added change touches drawers only.
  for (const ledger of ["supplier", "partner", "debt"] as const) {
    const ks = new Set([
      ...Object.keys(controlDeltas[ledger]),
      ...Object.keys(addedDeltas[ledger]),
    ]);
    const off: Record<string, number> = {};
    for (const k of ks) {
      const d = roundKey(
        k,
        (addedDeltas[ledger][k] ?? 0) - (controlDeltas[ledger][k] ?? 0),
      );
      if (d !== 0) off[k] = d;
    }
    expect({ ledger, off }).toEqual({ ledger, off: {} });
  }

  // Every drawer: the control's movement + exactly what the customer added
  // and the extra handed out.
  const keys = new Set([
    ...Object.keys(controlDrawers),
    ...Object.keys(addedDrawers),
    ...Object.keys(a.extraDrawerMoves),
  ]);
  const got: Record<string, number> = {};
  const want: Record<string, number> = {};
  for (const k of keys) {
    const diff = roundKey(k, (addedDrawers[k] ?? 0) - (controlDrawers[k] ?? 0));
    const exp = roundKey(k, a.extraDrawerMoves[k] ?? 0);
    if (diff !== 0 || exp !== 0) {
      got[k] = diff;
      want[k] = exp;
    }
  }
  expect(got).toEqual(want);

  // No rounding expense (unless the case combines a round-up).
  const e1 = activeExpenseTotals();
  const ed = a.expenseDiff ?? { usd: 0, lbp: 0 };
  expect({ usd: r2(e1.usd - e0.usd), lbp: e1.lbp - e0.lbp }).toEqual(ed);
  if (ed.usd === 0 && ed.lbp === 0) {
    expect(roundingExpenseCount()).toBe(rounding0);
  }

  // Amount and profit equal the control's (+ kept change when claimed).
  const pd = a.profitDiff ?? { usd: 0, lbp: 0 };
  expect(r2(t.amount_usd)).toBe(r2(control.amount_usd));
  expect(Math.round(t.amount_lbp)).toBe(Math.round(control.amount_lbp));
  expect(r2(t.profit_usd - control.profit_usd)).toBe(pd.usd);
  expect(Math.round(t.profit_lbp - control.profit_lbp)).toBe(pd.lbp);

  // The customer's line: a positive payments row of the payout…
  const rows = db
    .prepare(
      `SELECT currency_code, amount FROM payments WHERE transaction_id = ? AND amount > 0`,
    )
    .all(t.id) as Array<{ currency_code: string; amount: number }>;
  expect(
    rows.some(
      (r) =>
        r.currency_code === a.customerLine.currencyCode &&
        roundKey(`|${r.currency_code}`, r.amount) ===
          roundKey(`|${a.customerLine.currencyCode}`, a.customerLine.amount),
    ),
  ).toBe(true);
  // …and an IN line of its payment snapshot.
  const snap = JSON.parse(t.metadata_json ?? "{}").payment_snapshot as
    | { lines: Array<{ currency: string; amount: number; direction: string }> }
    | undefined;
  expect(
    snap?.lines.some(
      (l) =>
        l.direction === "IN" &&
        l.currency === a.customerLine.currencyCode &&
        Math.abs(l.amount - a.customerLine.amount) < 0.001,
    ),
  ).toBe(true);

  // Rule 20: the reversal nets every drawer and the profit to 0.
  a.reverse(t);
  expectPostings(before, snapshotLedgers(db), {});
  expect(profitSum()).toEqual(p0);
  expect(activeExpenseTotals()).toEqual(e0);
}

/** A refused payout writes nothing at all. */
function expectRefused(run: () => void, message: RegExp): void {
  const before = snapshotLedgers(db);
  const n = countRows("transactions");
  const ne = countRows("expenses");
  expect(run).toThrow(message);
  expect(countRows("transactions")).toBe(n);
  expect(countRows("expenses")).toBe(ne);
  expectPostings(before, snapshotLedgers(db), {});
}

function orThrow(res: { success: boolean; error?: string }): void {
  if (!res.success) throw new Error(res.error ?? "failed");
}

const OVER_CAP = /add at most \$5 \/ 450,000 LBP/;
const NOT_ALLOWED = /can't add change on this payout/;
const MISMATCH = /doesn't match the customer's lines/;
const ACCOUNT = /can't come from the customer's account/;
const NO_CLAIM_OVERPAY = /more than the total/i;

const voidTxn = (t: ParentTxn) =>
  getTransactionRepository().voidTransaction(t.id, 1);
const refundTxn = (t: ParentTxn) => {
  getTransactionRepository().refundTransaction(t.id, 1);
};

// ─── (a) OMT / Whish system RECEIVE, CASH cashout ───────────────────────────

type FsPayload = Partial<CreateFinancialServiceInput> & Record<string, unknown>;

function fsCreate(p: FsPayload, extra: Record<string, unknown> = {}): number {
  const parsed = createFinancialServiceSchema.parse(p);
  return new FinancialServiceRepository().createTransaction({
    exchangeRate: RATE,
    ...parsed,
    ...extra,
  } as Parameters<FinancialServiceRepository["createTransaction"]>[0]).id;
}

const fsParent = (fsId: number) => parentOf("financial_services", fsId);

const omtReceive = (
  amount: number,
  currency: "USD" | "LBP",
  payout: Array<{ currencyCode: string; amount: number }>,
  extra: FsPayload = {},
): FsPayload => ({
  provider: "OMT",
  serviceType: "RECEIVE",
  amount,
  currency,
  omtServiceType: "INTRA",
  cashoutMethod: "CASH",
  payments: payout.map((l) => ({ method: "CASH", ...l })),
  ...extra,
});

const usd3 = { method: "CASH", currencyCode: "USD", amount: 3 };

describe("LIRA-336 (a) — OMT system RECEIVE, CASH cashout", () => {
  it("$197 owed, customer gives Cash USD 3, shop hands $200 → drawer net −197, no rounding, void nets 0", () => {
    expectAddedAccepted({
      control: () =>
        fsParent(
          fsCreate(
            omtReceive(197, "USD", [{ currencyCode: "USD", amount: 197 }]),
          ),
        ),
      added: () =>
        fsParent(
          fsCreate(
            omtReceive(197, "USD", [{ currencyCode: "USD", amount: 200 }], {
              customerPayments: [usd3],
              added_change_usd: 3,
            }),
          ),
        ),
      reverse: voidTxn,
      extraDrawerMoves: {},
      customerLine: usd3,
    });
  });

  it("customer gives LBP 268,500 at 89,500 → USD −200 and LBP +268,500", () => {
    const lbpLine = { method: "CASH", currencyCode: "LBP", amount: 268_500 };
    expectAddedAccepted({
      control: () =>
        fsParent(
          fsCreate(
            omtReceive(197, "USD", [{ currencyCode: "USD", amount: 197 }]),
          ),
        ),
      added: () =>
        fsParent(
          fsCreate(
            omtReceive(197, "USD", [{ currencyCode: "USD", amount: 200 }], {
              customerPayments: [lbpLine],
              added_change_usd: 3,
              tender_exchange_rate: RATE,
            }),
          ),
        ),
      reverse: voidTxn,
      extraDrawerMoves: { "OMT_System|USD": -3, "OMT_System|LBP": 268_500 },
      customerLine: lbpLine,
    });
  });

  // Added AFTER the fix (coordinator's case, not proven failing-first): the
  // screen's double rounding end to end — 270,000 LBP at 89,500 is $3.0167,
  // sent as 3.02; the $200 handed reconciles against 200.02 within the leg
  // epsilon.
  it("customer gives LBP 270,000 at 89,500, claim $3.02, shop hands $200", () => {
    const lbpLine = { method: "CASH", currencyCode: "LBP", amount: 270_000 };
    expectAddedAccepted({
      control: () =>
        fsParent(
          fsCreate(
            omtReceive(197, "USD", [{ currencyCode: "USD", amount: 197 }]),
          ),
        ),
      added: () =>
        fsParent(
          fsCreate(
            omtReceive(197, "USD", [{ currencyCode: "USD", amount: 200 }], {
              customerPayments: [lbpLine],
              added_change_usd: 3.02,
              tender_exchange_rate: RATE,
            }),
          ),
        ),
      reverse: voidTxn,
      extraDrawerMoves: { "OMT_System|USD": -3, "OMT_System|LBP": 270_000 },
      customerLine: lbpLine,
    });
  });

  it("LBP payout: owed 1,345,000, customer gives 5,000, shop hands 1,350,000", () => {
    const line = { method: "CASH", currencyCode: "LBP", amount: 5_000 };
    expectAddedAccepted({
      control: () =>
        fsParent(
          fsCreate(
            omtReceive(1_345_000, "LBP", [
              { currencyCode: "LBP", amount: 1_345_000 },
            ]),
          ),
        ),
      added: () =>
        fsParent(
          fsCreate(
            omtReceive(
              1_345_000,
              "LBP",
              [{ currencyCode: "LBP", amount: 1_350_000 }],
              { customerPayments: [line], added_change_lbp: 5_000 },
            ),
          ),
        ),
      reverse: voidTxn,
      extraDrawerMoves: {},
      customerLine: line,
    });
  });

  it("with LIRA-334: $201 handed with $3 added → $1 round-up only", () => {
    expectAddedAccepted({
      control: () =>
        fsParent(
          fsCreate(
            omtReceive(197, "USD", [{ currencyCode: "USD", amount: 197 }]),
          ),
        ),
      added: () =>
        fsParent(
          fsCreate(
            omtReceive(197, "USD", [{ currencyCode: "USD", amount: 201 }], {
              customerPayments: [usd3],
              added_change_usd: 3,
              rounding_given_usd: 1,
            }),
          ),
        ),
      reverse: voidTxn,
      extraDrawerMoves: { "OMT_System|USD": -1 },
      customerLine: usd3,
      expenseDiff: { usd: 1, lbp: 0 },
    });
  });

  it("with kept change: $199.90 handed with $3 added → $0.10 kept", () => {
    expectAddedAccepted({
      control: () =>
        fsParent(
          fsCreate(
            omtReceive(197, "USD", [{ currencyCode: "USD", amount: 197 }]),
          ),
        ),
      added: () =>
        fsParent(
          fsCreate(
            omtReceive(197, "USD", [{ currencyCode: "USD", amount: 199.9 }], {
              customerPayments: [usd3],
              added_change_usd: 3,
              kept_change_usd: 0.1,
            }),
          ),
        ),
      reverse: voidTxn,
      extraDrawerMoves: { "OMT_System|USD": 0.1 },
      customerLine: usd3,
      profitDiff: { usd: 0.1, lbp: 0 },
    });
  });

  it("$3 added but only $197 handed → refused (the payout is short)", () => {
    expectRefused(
      () =>
        fsCreate(
          omtReceive(197, "USD", [{ currencyCode: "USD", amount: 197 }], {
            customerPayments: [usd3],
            added_change_usd: 3,
          }),
        ),
      /doesn't add up to the total/,
    );
  });

  it("over the cap ($6 added) → refused", () => {
    expectRefused(
      () =>
        fsCreate(
          omtReceive(197, "USD", [{ currencyCode: "USD", amount: 203 }], {
            customerPayments: [
              { method: "CASH", currencyCode: "USD", amount: 6 },
            ],
            added_change_usd: 6,
          }),
        ),
      OVER_CAP,
    );
  });

  it("a claim that doesn't match the customer's lines → refused", () => {
    expectRefused(
      () =>
        fsCreate(
          omtReceive(197, "USD", [{ currencyCode: "USD", amount: 199 }], {
            customerPayments: [usd3],
            added_change_usd: 2,
          }),
        ),
      MISMATCH,
    );
  });

  it("customer lines with no claim → refused as today (schema)", () => {
    expectRefused(
      () =>
        fsCreate(
          omtReceive(197, "USD", [{ currencyCode: "USD", amount: 200 }], {
            customerPayments: [usd3],
          }),
        ),
      /customerPayments is only for/,
    );
  });

  it("customer lines with no claim → refused as today (repository, no Zod — offline replay / internal callers)", () => {
    expectRefused(
      () =>
        new FinancialServiceRepository().createTransaction({
          exchangeRate: RATE,
          ...omtReceive(197, "USD", [{ currencyCode: "USD", amount: 200 }], {
            customerPayments: [usd3],
          }),
        } as Parameters<FinancialServiceRepository["createTransaction"]>[0]),
      /customerPayments is only for/,
    );
  });

  it("the schema accepts OMT RECEIVE customer lines only with a claim", () => {
    const base = omtReceive(
      197,
      "USD",
      [{ currencyCode: "USD", amount: 200 }],
      {
        customerPayments: [usd3],
      },
    );
    expect(createFinancialServiceSchema.safeParse(base).success).toBe(false);
    expect(
      createFinancialServiceSchema.safeParse({ ...base, added_change_usd: 3 })
        .success,
    ).toBe(true);
  });

  it("an account line among the customer's lines → refused", () => {
    expectRefused(
      () =>
        fsCreate(
          omtReceive(197, "USD", [{ currencyCode: "USD", amount: 200 }], {
            clientId: CLIENT_ID,
            customerPayments: [
              { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 3 },
            ],
            added_change_usd: 3,
          }),
        ),
      ACCOUNT,
    );
  });

  it("a claim with no payout lines (the lump fallback) → refused", () => {
    expectRefused(
      () =>
        fsCreate({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 197,
          currency: "USD",
          omtServiceType: "INTRA",
          cashoutMethod: "CASH",
          customerPayments: [usd3],
          added_change_usd: 3,
        }),
      NOT_ALLOWED,
    );
  });

  it("a FOR-partner RECEIVE with a claim → refused", () => {
    const partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name, is_active) VALUES (1, 'Change Partner', 1)`,
        )
        .run().lastInsertRowid,
    );
    expectRefused(
      () =>
        fsCreate({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 197,
          currency: "USD",
          omtServiceType: "INTRA",
          partnerId,
          partnerMode: "FOR",
          payments: [],
          added_change_usd: 3,
        }),
      NOT_ALLOWED,
    );
  });

  it("a session basket item (deferPayment) with a claim → refused", () => {
    expectRefused(
      () =>
        fsCreate(
          {
            provider: "OMT",
            serviceType: "RECEIVE",
            amount: 197,
            currency: "USD",
            omtServiceType: "INTRA",
            added_change_usd: 3,
          },
          { deferPayment: true },
        ),
      NOT_ALLOWED,
    );
  });

  it("a CUSTOMER_ACCOUNT cashout with a claim → refused", () => {
    expectRefused(
      () =>
        fsCreate({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 197,
          currency: "USD",
          omtServiceType: "INTRA",
          clientId: CLIENT_ID,
          cashoutMethod: "CUSTOMER_ACCOUNT",
          payments: [
            { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 200 },
          ],
          customerPayments: [usd3],
          added_change_usd: 3,
        }),
      NOT_ALLOWED,
    );
  });

  it("a wallet (non-cash) system cashout with a claim → refused", () => {
    expectRefused(
      () =>
        fsCreate({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 197,
          currency: "USD",
          omtServiceType: "INTRA",
          cashoutMethod: "WHISH",
          customerPayments: [usd3],
          added_change_usd: 3,
        }),
      NOT_ALLOWED,
    );
  });

  it("an OMT SEND with a claim → refused", () => {
    expectRefused(
      () =>
        fsCreate({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          omtServiceType: "INTRA",
          payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
          added_change_usd: 3,
        }),
      NOT_ALLOWED,
    );
  });
});

describe("LIRA-336 (a2) — WHISH system RECEIVE, fee paid on top", () => {
  beforeEach(() => {
    const upd = db
      .prepare(
        `UPDATE system_settings SET value = 'WHISH' WHERE key_name = 'shop_base_system'`,
      )
      .run();
    if (upd.changes === 0) {
      db.prepare(
        `INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'WHISH')`,
      ).run();
    }
  });

  const whish = (
    feeLines: Array<{ method: string; currencyCode: string; amount: number }>,
    payout: number,
    extra: FsPayload = {},
  ): FsPayload => ({
    provider: "WHISH",
    serviceType: "RECEIVE",
    amount: 197,
    currency: "USD",
    commission: 0,
    whishFee: 5,
    cashoutMethod: "CASH",
    feePayments: feeLines,
    payments: [{ method: "CASH", currencyCode: "USD", amount: payout }],
    ...extra,
  });

  it("fee $5 + $3 added in the fee lines, shop hands $200 → drawer as for $197 + fee", () => {
    const feeLine = { method: "CASH", currencyCode: "USD", amount: 8 };
    expectAddedAccepted({
      control: () =>
        fsParent(
          fsCreate(
            whish([{ method: "CASH", currencyCode: "USD", amount: 5 }], 197),
          ),
        ),
      added: () =>
        fsParent(fsCreate(whish([feeLine], 200, { added_change_usd: 3 }))),
      reverse: voidTxn,
      extraDrawerMoves: {},
      customerLine: feeLine,
    });
  });

  // Added AFTER the fix (rule 28d variant, not proven failing-first).
  it("fee deducted from the payout (no fee lines): customer gives $3 in customerPayments", () => {
    const base: FsPayload = {
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 200,
      currency: "USD",
      commission: 0,
      whishFee: 3,
      includingFees: true,
      cashoutMethod: "CASH",
    };
    expectAddedAccepted({
      control: () =>
        fsParent(
          fsCreate({
            ...base,
            payments: [{ method: "CASH", currencyCode: "USD", amount: 197 }],
          }),
        ),
      added: () =>
        fsParent(
          fsCreate({
            ...base,
            customerPayments: [usd3],
            payments: [{ method: "CASH", currencyCode: "USD", amount: 200 }],
            added_change_usd: 3,
          }),
        ),
      reverse: voidTxn,
      extraDrawerMoves: {},
      customerLine: usd3,
    });
  });

  it("an account fee line with a claim → refused", () => {
    expectRefused(
      () =>
        fsCreate(
          whish(
            [
              { method: "CASH", currencyCode: "USD", amount: 5 },
              { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 3 },
            ],
            200,
            { clientId: CLIENT_ID, added_change_usd: 3 },
          ),
        ),
      ACCOUNT,
    );
  });

  it("fee lines above the fee with no claim → refused as today", () => {
    expectRefused(
      () =>
        fsCreate(
          whish([{ method: "CASH", currencyCode: "USD", amount: 8 }], 200),
        ),
      NO_CLAIM_OVERPAY,
    );
  });
});

// ─── (b) wallet RECEIVE: Whish App, Binance ─────────────────────────────────

describe("LIRA-336 (b) — wallet RECEIVE", () => {
  const whishApp = (
    lines: Array<{ method: string; currencyCode: string; amount: number }>,
    payout: number,
    extra: FsPayload = {},
  ): FsPayload => ({
    provider: "WHISH_APP",
    serviceType: "RECEIVE",
    amount: 100,
    currency: "USD",
    commission: 3,
    customerPayments: lines,
    payments: [{ method: "CASH", currencyCode: "USD", amount: payout }],
    ...extra,
  });
  const whishLine = { method: "WHISH", currencyCode: "USD", amount: 100 };

  it("Whish App USD: $100 by Whish, owed $97, customer adds Cash USD 3, shop hands $100", () => {
    expectAddedAccepted({
      control: () => fsParent(fsCreate(whishApp([whishLine], 97))),
      added: () =>
        fsParent(
          fsCreate(whishApp([whishLine, usd3], 100, { added_change_usd: 3 })),
        ),
      reverse: voidTxn,
      extraDrawerMoves: {},
      customerLine: usd3,
    });
  });

  it("Whish App, customer adds LBP 268,500 → General USD −3 more, LBP +268,500", () => {
    const lbpLine = { method: "CASH", currencyCode: "LBP", amount: 268_500 };
    expectAddedAccepted({
      control: () => fsParent(fsCreate(whishApp([whishLine], 97))),
      added: () =>
        fsParent(
          fsCreate(
            whishApp([whishLine, lbpLine], 100, {
              added_change_usd: 3,
              tender_exchange_rate: RATE,
            }),
          ),
        ),
      reverse: voidTxn,
      extraDrawerMoves: { "General|USD": -3, "General|LBP": 268_500 },
      customerLine: lbpLine,
    });
  });

  // Added AFTER the fix (rule 28d variant, not proven failing-first).
  it("OMT App: $100 by OMT, customer adds Cash USD 3, shop hands $103", () => {
    const omtLine = { method: "OMT", currencyCode: "USD", amount: 100 };
    const base: FsPayload = {
      provider: "OMT_APP",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
    };
    expectAddedAccepted({
      control: () =>
        fsParent(
          fsCreate({
            ...base,
            customerPayments: [omtLine],
            payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
          }),
        ),
      added: () =>
        fsParent(
          fsCreate({
            ...base,
            customerPayments: [omtLine, usd3],
            payments: [{ method: "CASH", currencyCode: "USD", amount: 103 }],
            added_change_usd: 3,
          }),
        ),
      reverse: voidTxn,
      extraDrawerMoves: {},
      customerLine: usd3,
    });
  });

  it("Whish App: lines above the total with no claim → refused as today", () => {
    expectRefused(
      () => fsCreate(whishApp([whishLine, usd3], 100)),
      NO_CLAIM_OVERPAY,
    );
  });

  it("Binance: 100 USDT, fee $2.10 → owed $97.90; customer adds $3, shop hands $100.90", () => {
    const base: FsPayload = {
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USDT",
      commission: 2.1,
      clientId: CLIENT_ID,
    };
    const binanceLine = {
      method: "BINANCE",
      currencyCode: "USDT",
      amount: 100,
    };
    expectAddedAccepted({
      control: () =>
        fsParent(
          fsCreate({
            ...base,
            customerPayments: [binanceLine],
            payments: [{ method: "CASH", currencyCode: "USD", amount: 97.9 }],
          }),
        ),
      added: () =>
        fsParent(
          fsCreate({
            ...base,
            customerPayments: [binanceLine, usd3],
            payments: [{ method: "CASH", currencyCode: "USD", amount: 100.9 }],
            added_change_usd: 3,
          }),
        ),
      reverse: voidTxn,
      extraDrawerMoves: {},
      customerLine: usd3,
    });
  });

  it("Binance cash-out to the customer account with a claim → refused", () => {
    expectRefused(
      () =>
        fsCreate({
          provider: "BINANCE",
          serviceType: "RECEIVE",
          amount: 100,
          currency: "USDT",
          commission: 2.1,
          clientId: CLIENT_ID,
          cashoutMethod: "CUSTOMER_ACCOUNT",
          customerPayments: [
            { method: "BINANCE", currencyCode: "USDT", amount: 100 },
            usd3,
          ],
          payments: [
            { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 100.9 },
          ],
          added_change_usd: 3,
        }),
      NOT_ALLOWED,
    );
  });
});

// ─── (c) Exchange ───────────────────────────────────────────────────────────

function exchangeCreate(body: Record<string, unknown>): ParentTxn {
  const parsed = exchangeSubmitSchema.parse(body);
  const { id } = new ExchangeRepository().createTransaction(parsed);
  return parentOf("exchange_transactions", id);
}

/** $100 → LBP at 89,530: 8,953,000 LBP owed. */
const USD_TO_LBP = {
  fromCurrency: "USD",
  toCurrency: "LBP",
  amountIn: 100,
  amountOut: 8_953_000,
  leg1Rate: 89_530,
  leg1MarketRate: 89_500,
  leg1ProfitUsd: 0.1,
  totalProfitUsd: 0.1,
  tender_exchange_rate: 89_530,
};

/** 9,000,000 LBP → USD at 89,000: $101.12 owed. */
const LBP_TO_USD = {
  fromCurrency: "LBP",
  toCurrency: "USD",
  amountIn: 9_000_000,
  amountOut: 101.12,
  leg1Rate: 89_000,
  leg1MarketRate: 89_500,
  leg1ProfitUsd: 9_000_000 / 89_000 - 9_000_000 / 89_500,
  totalProfitUsd: 9_000_000 / 89_000 - 9_000_000 / 89_500,
  tender_exchange_rate: 89_000,
};

describe("LIRA-336 (c) — Exchange", () => {
  it("USD → LBP: the customer also gives $1, shop hands 8,953,000 + 89,530 LBP", () => {
    const line = { method: "CASH", currencyCode: "USD", amount: 101 };
    expectAddedAccepted({
      control: () =>
        exchangeCreate({
          ...USD_TO_LBP,
          customerPayments: [
            { method: "CASH", currencyCode: "USD", amount: 100 },
          ],
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: 8_953_000 },
          ],
        }),
      added: () =>
        exchangeCreate({
          ...USD_TO_LBP,
          customerPayments: [line],
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: 9_042_530 },
          ],
          added_change_lbp: 89_530,
        }),
      reverse: refundTxn,
      extraDrawerMoves: { "General|USD": 1, "General|LBP": -89_530 },
      customerLine: line,
    });
  });

  it("LBP → USD: the customer also gives 89,000 LBP, shop hands $102.12", () => {
    const line = { method: "CASH", currencyCode: "LBP", amount: 9_089_000 };
    expectAddedAccepted({
      control: () =>
        exchangeCreate({
          ...LBP_TO_USD,
          customerPayments: [
            { method: "CASH", currencyCode: "LBP", amount: 9_000_000 },
          ],
          payments: [{ method: "CASH", currencyCode: "USD", amount: 101.12 }],
        }),
      added: () =>
        exchangeCreate({
          ...LBP_TO_USD,
          customerPayments: [line],
          payments: [{ method: "CASH", currencyCode: "USD", amount: 102.12 }],
          added_change_usd: 1,
        }),
      reverse: refundTxn,
      extraDrawerMoves: { "General|USD": -1, "General|LBP": 89_000 },
      customerLine: line,
    });
  });

  it("customer lines above amountIn with no claim → refused as today", () => {
    expectRefused(
      () =>
        exchangeCreate({
          ...USD_TO_LBP,
          customerPayments: [
            { method: "CASH", currencyCode: "USD", amount: 101 },
          ],
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: 9_042_530 },
          ],
        }),
      NO_CLAIM_OVERPAY,
    );
  });

  it("a claim with no payout lines (the lump fallback) → refused", () => {
    expectRefused(
      () =>
        exchangeCreate({
          ...USD_TO_LBP,
          customerPayments: [
            { method: "CASH", currencyCode: "USD", amount: 101 },
          ],
          added_change_lbp: 89_530,
        }),
      NOT_ALLOWED,
    );
  });

  it("a FOR-partner exchange with a claim → refused", () => {
    const partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name, is_active) VALUES (1, 'Change Partner', 1)`,
        )
        .run().lastInsertRowid,
    );
    expectRefused(
      () =>
        exchangeCreate({
          ...USD_TO_LBP,
          partnerId,
          partnerMode: "FOR",
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: 9_042_530 },
          ],
          added_change_lbp: 89_530,
        }),
      NOT_ALLOWED,
    );
  });

  it("an exchange outside USD/LBP with a claim → refused", () => {
    expectRefused(
      () =>
        exchangeCreate({
          fromCurrency: "EUR",
          toCurrency: "USD",
          amountIn: 100,
          amountOut: 108,
          leg1Rate: 1.08,
          leg1MarketRate: 1.09,
          leg1ProfitUsd: 1,
          totalProfitUsd: 1,
          customerPayments: [
            { method: "CASH", currencyCode: "EUR", amount: 101 },
          ],
          payments: [{ method: "CASH", currencyCode: "USD", amount: 109 }],
          added_change_usd: 1,
        }),
      NOT_ALLOWED,
    );
  });
});

// ─── (d) credit buy-back, (e) top-up from client ────────────────────────────

function buyback(body: Record<string, unknown>): ParentTxn {
  const parsed = createRechargeSchema.parse({
    provider: "MTC",
    type: "CREDIT_BUYBACK",
    amount: 10,
    cost: 0,
    currency: "LBP",
    phoneNumber: SHOP_MTC,
    tender_exchange_rate: RATE,
    client_day: TODAY,
    ...body,
  });
  orThrow(
    new RechargeRepository().processRecharge({
      ...parsed,
      userId: 1,
    } as RechargeData),
  );
  return lastOfType("TELECOM_CREDIT_BUYBACK");
}

function topUp(body: Record<string, unknown>): ParentTxn {
  const parsed = topUpFromClientSchema.parse({
    amount: 100,
    currency: "USD",
    fee: 1.1,
    clientId: CLIENT_ID,
    ...body,
  });
  orThrow(new RechargeRepository().topUpFromClient({ ...parsed, userId: 1 }));
  return lastOfType("RECHARGE_TOPUP");
}

describe("LIRA-336 (d) — credit buy-back", () => {
  it("LBP: owes 745,000, customer gives 5,000, shop hands 750,000 → net −745,000, void nets 0", () => {
    const line = { method: "CASH", currencyCode: "LBP", amount: 5_000 };
    expectAddedAccepted({
      control: () =>
        buyback({
          price: 745_000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 745_000 }],
        }),
      added: () =>
        buyback({
          price: 745_000,
          customerPayments: [line],
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 750_000 }],
          added_change_lbp: 5_000,
        }),
      reverse: voidTxn,
      extraDrawerMoves: {},
      customerLine: line,
    });
  });

  it("USD: owes $7, customer gives LBP 268,500, shop hands $10", () => {
    const line = { method: "CASH", currencyCode: "LBP", amount: 268_500 };
    expectAddedAccepted({
      control: () =>
        buyback({
          currency: "USD",
          price: 7,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 7 }],
        }),
      added: () =>
        buyback({
          currency: "USD",
          price: 7,
          customerPayments: [line],
          payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
          added_change_usd: 3,
        }),
      reverse: voidTxn,
      extraDrawerMoves: { "General|USD": -3, "General|LBP": 268_500 },
      customerLine: line,
    });
  });

  it("customer lines with no claim → refused", () => {
    expectRefused(
      () =>
        buyback({
          price: 745_000,
          customerPayments: [
            { method: "CASH", currencyCode: "LBP", amount: 5_000 },
          ],
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 750_000 }],
        }),
      MISMATCH,
    );
  });

  it("an ordinary MTC recharge sale (not a buy-back) refuses a claim", () => {
    expectRefused(() => {
      const parsed = createRechargeSchema.parse({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 10,
        cost: 9,
        price: 10,
        currency: "USD",
        phoneNumber: "70999888",
        client_day: TODAY,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
        customerPayments: [usd3],
        added_change_usd: 3,
      });
      orThrow(
        new RechargeRepository().processRecharge({
          ...parsed,
          userId: 1,
        } as RechargeData),
      );
    }, NOT_ALLOWED);
  });
});

describe("LIRA-336 (e) — Whish App top-up from a client", () => {
  it("USD: $100 credits, $1.10 fee → owes $98.90; customer gives $1.10, shop hands $100", () => {
    const line = { method: "CASH", currencyCode: "USD", amount: 1.1 };
    let controlCashPaid = -1;
    expectAddedAccepted({
      control: () => {
        const t = topUp({
          payments: [{ method: "CASH", currencyCode: "USD", amount: 98.9 }],
        });
        controlCashPaid = JSON.parse(t.metadata_json ?? "{}").cashPaid;
        return t;
      },
      added: () => {
        const t = topUp({
          customerPayments: [line],
          payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
          added_change_usd: 1.1,
        });
        // cashPaid / recharges.cost never move (FR-005).
        expect(JSON.parse(t.metadata_json ?? "{}").cashPaid).toBe(
          controlCashPaid,
        );
        return t;
      },
      reverse: voidTxn,
      extraDrawerMoves: {},
      customerLine: line,
    });
  });

  it("LBP: 2,000,000 credits, 105,000 fee; customer gives 105,000, shop hands 2,000,000", () => {
    const lbp = { amount: 2_000_000, currency: "LBP", fee: 105_000 };
    const line = { method: "CASH", currencyCode: "LBP", amount: 105_000 };
    expectAddedAccepted({
      control: () =>
        topUp({
          ...lbp,
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: 1_895_000 },
          ],
        }),
      added: () =>
        topUp({
          ...lbp,
          customerPayments: [line],
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: 2_000_000 },
          ],
          added_change_lbp: 105_000,
        }),
      reverse: voidTxn,
      extraDrawerMoves: {},
      customerLine: line,
    });
  });

  it("customer lines with no claim → refused", () => {
    expectRefused(
      () =>
        topUp({
          customerPayments: [
            { method: "CASH", currencyCode: "USD", amount: 1.1 },
          ],
          payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
        }),
      MISMATCH,
    );
  });

  it("an empty customerPayments with no claim behaves as before", () => {
    const t = topUp({
      customerPayments: [],
      payments: [{ method: "CASH", currencyCode: "USD", amount: 98.9 }],
    });
    expect(t).toBeDefined();
  });
});

// ─── (f) Hold Money pickup ──────────────────────────────────────────────────

function hold(usd: number, lbp = 0): number {
  const res = new HoldMoneyRepository().createHold(
    { client_name: "Rami", usd_amount: usd, lbp_amount: lbp },
    1,
  );
  orThrow(res);
  return res.id!;
}

function collect(body: Record<string, unknown>): ParentTxn {
  const res = new HoldMoneyRepository().collectHold(
    holdMoneyCollectSchema.parse(body),
    1,
  );
  orThrow(res);
  return txnById(res.id!);
}

function pickupOf(t: ParentTxn): number {
  return (
    db
      .prepare(`SELECT id FROM hold_money_pickups WHERE transaction_id = ?`)
      .get(t.id) as { id: number }
  ).id;
}

const voidPickup = (t: ParentTxn) =>
  orThrow(new HoldMoneyRepository().voidPickup(pickupOf(t), 1));

describe("LIRA-336 (f) — Hold Money pickup", () => {
  it("USD: held $47, customer gives $3, shop hands $50 → net −47, voidPickup nets 0", () => {
    // Drop-offs happen before the snapshot windows (they move the drawer).
    const controlHold = hold(47);
    const addedHold = hold(47);
    expectAddedAccepted({
      control: () =>
        collect({
          id: controlHold,
          payments: [{ method: "CASH", currency_code: "USD", amount: 47 }],
        }),
      added: () =>
        collect({
          id: addedHold,
          customerPayments: [usd3],
          payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
          added_change_usd: 3,
        }),
      reverse: voidPickup,
      extraDrawerMoves: {},
      customerLine: usd3,
    });
  });

  it("LBP: held 1,345,000, customer gives $1 at 89,500, shop hands 1,434,500", () => {
    const controlHold = hold(0, 1_345_000);
    const addedHold = hold(0, 1_345_000);
    const line = { method: "CASH", currencyCode: "USD", amount: 1 };
    expectAddedAccepted({
      control: () =>
        collect({
          id: controlHold,
          payments: [
            { method: "CASH", currency_code: "LBP", amount: 1_345_000 },
          ],
        }),
      added: () =>
        collect({
          id: addedHold,
          customerPayments: [line],
          payments: [
            { method: "CASH", currency_code: "LBP", amount: 1_434_500 },
          ],
          added_change_lbp: 89_500,
          exchange_rate: RATE,
        }),
      reverse: voidPickup,
      extraDrawerMoves: { "General|USD": 1, "General|LBP": -89_500 },
      customerLine: line,
    });
  });

  it("a two-currency pickup with a claim → refused", () => {
    const id = hold(50, 1_345_000);
    expectRefused(
      () =>
        collect({
          id,
          customerPayments: [usd3],
          payments: [
            { method: "CASH", currency_code: "USD", amount: 53 },
            { method: "CASH", currency_code: "LBP", amount: 1_345_000 },
          ],
          added_change_usd: 3,
        }),
      NOT_ALLOWED,
    );
  });

  it("customer lines with no claim → refused", () => {
    const id = hold(47);
    expectRefused(
      () =>
        collect({
          id,
          customerPayments: [usd3],
          payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
        }),
      MISMATCH,
    );
  });

  it("a claim with no payout lines (the CASH fallback) → refused", () => {
    const id = hold(47);
    expectRefused(
      () =>
        collect({
          id,
          customerPayments: [usd3],
          added_change_usd: 3,
        }),
      NOT_ALLOWED,
    );
  });
});
