/**
 * LIRA-334 — payout round-up (owner decision 2026-10-18).
 *
 * The cashier hands the customer a little MORE than owed because the drawer
 * has no coins or small notes (owed $102.90, handed $103). The client claims
 * the difference (`rounding_given_usd` / `rounding_given_lbp`, in the payout's
 * own currency). The server verifies it (`resolveRoundingGiven`), lets the
 * payout legs take the FULL handed amount from the drawer, and books the
 * difference as ONE books-only "Change rounding" expense linked to the
 * payout (`bookPayoutRoundingExpense`), so the parent's profit stamp stays
 * the exact payout's and the payout's reversal voids the expense (rule 20).
 *
 * Per flow, every accepted case checks:
 *   - the round-up within the cap saves;
 *   - the paid-out drawer moves by the FULL handed amount;
 *   - exactly one active "Change rounding" expense, with the right
 *     amount_usd / amount_lbp, linked to the parent;
 *   - the expense's unified row has metadata_json.is_auto === true and no
 *     payments row (books-only);
 *   - the parent's profit stamp equals the exact payout's;
 *   - the flow's reversal nets drawers, active expenses and profit to 0, per
 *     currency, and the expense is voided.
 * Plus refusals: over the cap, an overpay with no claim (still refused), a
 * partner (FOR) payout, a claim with kept change, a session basket item, a
 * payout credited to the customer account, a two-currency Hold Money pickup.
 *
 * Flows: OMT/Whish system RECEIVE (CASH), wallet RECEIVE (Binance, Whish
 * App), Exchange payout (USD out, LBP out), credit buy-back, Whish App
 * top-up from a client, Hold Money one-currency pickup.
 *
 * Every payload is parsed through the real core schema first (rules 24,
 * 28d), then handed to the real repository entry point the services forward
 * to unchanged.
 *
 * Rule 17 — run on 2026-10-18 against the code BEFORE the flows learned the
 * round-up (only the schema fields, `resolveRoundingGiven`,
 * `bookPayoutRoundingExpense`, `postPayoutLegs`' `roundingGiven` input and
 * `voidLinkedExpenses` existed): 20 of 26 cases failed, the 6 "overpay with
 * no claim" cases passed (as they must). How they failed:
 *   - every accepted case (OMT USD/LBP, Binance, Whish App, Exchange USD/LBP
 *     out, buy-back, top-up, Hold Money) was refused by the plain reconcile:
 *     "The payment is more than the total." — the claim was never read;
 *   - over the cap: the generic overpay message, not the round-up cap;
 *   - claim + kept change: refused by kept change ("There is no change to
 *     keep"), not by the round-up rule;
 *   - FOR partner, session basket, CUSTOMER_ACCOUNT cashout, Binance to the
 *     account, OMT SEND, BOB RECEIVE, ordinary MTC sale: saved without a
 *     word (claim silently dropped — rule 23);
 *   - FOR-partner exchange: the partner "no payout legs" message;
 *   - two-currency Hold Money pickup: the generic overpay message.
 * Added AFTER the fix (rule 28d currency variants — NOT proven failing-first,
 * and nothing was re-broken to prove them, rule 17): buy-back USD, top-up
 * LBP, Hold Money LBP-only pickup.
 * (A first run also failed the Hold Money accepted case for a test bug —
 * the drop-offs ran inside the snapshot window; they were moved out before
 * the run recorded above.)
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
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, 'Round Client', '70111222')`,
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
  profit_usd: number;
  profit_lbp: number;
  source_table: string;
  source_id: number;
}

function txnById(id: number): ParentTxn {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp, source_table, source_id FROM transactions WHERE id = ?`,
    )
    .get(id) as ParentTxn;
}

function parentOf(sourceTable: string, sourceId: number): ParentTxn {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp, source_table, source_id FROM transactions
        WHERE source_table = ? AND source_id = ? AND reverses_id IS NULL
        ORDER BY id ASC LIMIT 1`,
    )
    .get(sourceTable, sourceId) as ParentTxn;
}

function lastOfType(type: string): ParentTxn {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp, source_table, source_id FROM transactions
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

/** Σ over ACTIVE (not voided) expenses, per currency. */
function activeExpenseTotals(): { usd: number; lbp: number } {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd),0) AS usd, COALESCE(SUM(amount_lbp),0) AS lbp
         FROM expenses WHERE COALESCE(is_refunded, 0) = 0`,
    )
    .get() as { usd: number; lbp: number };
  return { usd: r2(r.usd), lbp: Math.round(r.lbp) };
}

interface RoundingExpense {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  is_refunded: number | null;
}

function roundingExpensesFor(table: string, id: number): RoundingExpense[] {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, is_refunded FROM expenses
        WHERE category = ? AND source_ref_table = ? AND source_ref_id = ?`,
    )
    .all(CHANGE_ROUNDING_EXPENSE_CATEGORY, table, id) as RoundingExpense[];
}

function countRows(table: "transactions" | "expenses"): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  ).n;
}

interface AcceptArgs {
  /** The same payout handed out exactly; returns its parent row. */
  control: () => ParentTxn;
  /** The rounded payout; returns its parent row. */
  rounded: () => ParentTxn;
  /** The flow's own reversal (generic void/refund, or voidPickup). */
  reverse: (t: ParentTxn) => void;
  /** Where the expense links (default: the parent's source_table/source_id). */
  link?: (t: ParentTxn) => { table: string; id: number };
  /** "drawer|currency" → its expected delta (the full handed amount). */
  paidDrawer: string;
  paidDelta: number;
  roundingUsd: number;
  roundingLbp: number;
}

function expectRoundUpAccepted(a: AcceptArgs): void {
  // Control (exact payout) in its own window — its stamp is the baseline.
  const c0 = snapshotLedgers(db);
  const control = a.control();
  a.reverse(control);
  expectPostings(c0, snapshotLedgers(db), {});

  const before = snapshotLedgers(db);
  const p0 = profitSum();
  const e0 = activeExpenseTotals();
  const t = a.rounded();
  expect(t).toBeDefined();

  // Drawer: the FULL handed amount left it.
  const d = ledgerDeltas(before, snapshotLedgers(db)).drawers;
  const delta = d[a.paidDrawer] ?? 0;
  expect(a.paidDrawer.endsWith("|LBP") ? Math.round(delta) : r2(delta)).toBe(
    a.paidDelta,
  );

  // Exactly one "Change rounding" expense, right amount, linked to the parent.
  const link = a.link
    ? a.link(t)
    : { table: t.source_table, id: t.source_id };
  const exps = roundingExpensesFor(link.table, link.id);
  expect(exps).toHaveLength(1);
  const exp = exps[0]!;
  expect(r2(exp.amount_usd)).toBe(a.roundingUsd);
  expect(Math.round(exp.amount_lbp)).toBe(a.roundingLbp);
  const e1 = activeExpenseTotals();
  expect(r2(e1.usd - e0.usd)).toBe(a.roundingUsd);
  expect(e1.lbp - e0.lbp).toBe(a.roundingLbp);

  // Its unified row: auto (hidden by default) and books-only (no payments).
  const expTxn = db
    .prepare(
      `SELECT id, metadata_json FROM transactions WHERE source_table = 'expenses' AND source_id = ?`,
    )
    .get(exp.id) as { id: number; metadata_json: string | null };
  expect(JSON.parse(expTxn.metadata_json ?? "{}").is_auto).toBe(true);
  expect(
    (
      db
        .prepare(`SELECT COUNT(*) AS n FROM payments WHERE transaction_id = ?`)
        .get(expTxn.id) as { n: number }
    ).n,
  ).toBe(0);

  // The parent's profit stamp is the exact payout's.
  expect(r2(t.profit_usd)).toBe(r2(control.profit_usd));
  expect(Math.round(t.profit_lbp)).toBe(Math.round(control.profit_lbp));

  // Rule 20: the reversal nets drawers, expenses and profit to 0.
  a.reverse(t);
  expectPostings(before, snapshotLedgers(db), {});
  expect(activeExpenseTotals()).toEqual(e0);
  expect(profitSum()).toEqual(p0);
  expect(roundingExpensesFor(link.table, link.id)[0]!.is_refunded).toBe(1);
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

/** Repositories that answer `{ success, error }` instead of throwing. */
function orThrow(res: { success: boolean; error?: string }): void {
  if (!res.success) throw new Error(res.error ?? "failed");
}

const NO_CLAIM_OVERPAY = /more than the total/i;
const OVER_CAP = /round a payout up by \$5/i;
const NOT_ALLOWED = /Rounding up isn't available/i;
const WITH_KEPT = /keep change and round up/i;

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
const voidTxn = (t: ParentTxn) =>
  getTransactionRepository().voidTransaction(t.id, 1);

const omtReceive = (
  amount: number,
  currency: "USD" | "LBP",
  legs: Array<{ currencyCode: string; amount: number }>,
  extra: FsPayload = {},
): FsPayload => ({
  provider: "OMT",
  serviceType: "RECEIVE",
  amount,
  currency,
  omtServiceType: "INTRA",
  cashoutMethod: "CASH",
  payments: legs.map((l) => ({ method: "CASH", ...l })),
  ...extra,
});

describe("LIRA-334 (a) — OMT system RECEIVE, CASH cashout", () => {
  it("USD: owed $102.90, hands $103 → saves, drawer −103, one $0.10 expense, void nets 0", () => {
    expectRoundUpAccepted({
      control: () =>
        fsParent(
          fsCreate(
            omtReceive(102.9, "USD", [{ currencyCode: "USD", amount: 102.9 }]),
          ),
        ),
      rounded: () =>
        fsParent(
          fsCreate(
            omtReceive(102.9, "USD", [{ currencyCode: "USD", amount: 103 }], {
              rounding_given_usd: 0.1,
            }),
          ),
        ),
      reverse: voidTxn,
      paidDrawer: "OMT_System|USD",
      paidDelta: -103,
      roundingUsd: 0.1,
      roundingLbp: 0,
    });
  });

  it("LBP: owed 1,345,000, hands 1,350,000 → one 5,000 LBP expense, void nets 0", () => {
    expectRoundUpAccepted({
      control: () =>
        fsParent(
          fsCreate(
            omtReceive(1_345_000, "LBP", [
              { currencyCode: "LBP", amount: 1_345_000 },
            ]),
          ),
        ),
      rounded: () =>
        fsParent(
          fsCreate(
            omtReceive(
              1_345_000,
              "LBP",
              [{ currencyCode: "LBP", amount: 1_350_000 }],
              { rounding_given_lbp: 5_000 },
            ),
          ),
        ),
      reverse: voidTxn,
      paidDrawer: "OMT_System|LBP",
      paidDelta: -1_350_000,
      roundingUsd: 0,
      roundingLbp: 5_000,
    });
  });

  it("a round-up of $6 (over the cap) is refused", () => {
    expectRefused(
      () =>
        fsCreate(
          omtReceive(100, "USD", [{ currencyCode: "USD", amount: 106 }], {
            rounding_given_usd: 6,
          }),
        ),
      OVER_CAP,
    );
  });

  it("an overpay with no claim is still refused", () => {
    expectRefused(
      () =>
        fsCreate(
          omtReceive(102.9, "USD", [{ currencyCode: "USD", amount: 103 }]),
        ),
      NO_CLAIM_OVERPAY,
    );
  });

  it("a round-up together with kept change is refused", () => {
    expectRefused(
      () =>
        fsCreate(
          omtReceive(102.9, "USD", [{ currencyCode: "USD", amount: 103 }], {
            rounding_given_usd: 0.1,
            kept_change_usd: 0.1,
          }),
        ),
      WITH_KEPT,
    );
  });

  it("a FOR-partner RECEIVE with a round-up is refused", () => {
    const partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name, is_active) VALUES (1, 'Round Partner', 1)`,
        )
        .run().lastInsertRowid,
    );
    expectRefused(
      () =>
        fsCreate({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 102.9,
          currency: "USD",
          omtServiceType: "INTRA",
          partnerId,
          partnerMode: "FOR",
          payments: [],
          rounding_given_usd: 0.1,
        }),
      NOT_ALLOWED,
    );
  });

  it("a session basket item (deferPayment) with a round-up is refused", () => {
    expectRefused(
      () =>
        fsCreate(
          {
            provider: "OMT",
            serviceType: "RECEIVE",
            amount: 102.9,
            currency: "USD",
            omtServiceType: "INTRA",
            rounding_given_usd: 0.1,
          },
          { deferPayment: true },
        ),
      NOT_ALLOWED,
    );
  });

  it("a CUSTOMER_ACCOUNT cashout with a round-up is refused", () => {
    expectRefused(
      () =>
        fsCreate({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 102.9,
          currency: "USD",
          omtServiceType: "INTRA",
          clientId: CLIENT_ID,
          cashoutMethod: "CUSTOMER_ACCOUNT",
          payments: [
            { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 103 },
          ],
          rounding_given_usd: 0.1,
        }),
      NOT_ALLOWED,
    );
  });
});

describe("LIRA-334 — a claim on a flow that is not a payout is refused (rule 23)", () => {
  it("an OMT SEND carrying a round-up is refused", () => {
    expectRefused(
      () =>
        fsCreate({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          omtServiceType: "INTRA",
          payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
          rounding_given_usd: 0.1,
        }),
      NOT_ALLOWED,
    );
  });

  it("a RECEIVE on a provider with no payout branch (BOB) refuses a round-up", () => {
    expectRefused(
      () =>
        fsCreate({
          provider: "BOB",
          serviceType: "RECEIVE",
          amount: 100,
          currency: "USD",
          rounding_given_usd: 0.1,
        }),
      NOT_ALLOWED,
    );
  });

  it("an ordinary MTC recharge sale (not a buy-back) refuses a round-up", () => {
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
        rounding_given_usd: 0.1,
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

// ─── (b) wallet RECEIVE: Binance cash-out, Whish App RECEIVE ────────────────

describe("LIRA-334 (b) — wallet RECEIVE", () => {
  it("Binance USD: 100 USDT, $2.10 fee → owes $97.90, hands $98 → one $0.10 expense, void nets 0", () => {
    const base: FsPayload = {
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USDT",
      commission: 2.1,
      clientId: CLIENT_ID,
    };
    expectRoundUpAccepted({
      control: () =>
        fsParent(
          fsCreate({
            ...base,
            payments: [{ method: "CASH", currencyCode: "USD", amount: 97.9 }],
          }),
        ),
      rounded: () =>
        fsParent(
          fsCreate({
            ...base,
            payments: [{ method: "CASH", currencyCode: "USD", amount: 98 }],
            rounding_given_usd: 0.1,
          }),
        ),
      reverse: voidTxn,
      paidDrawer: "General|USD",
      paidDelta: -98,
      roundingUsd: 0.1,
      roundingLbp: 0,
    });
  });

  it("Whish App USD: owes $102.90, hands $103 → one $0.10 expense, void nets 0", () => {
    const base: FsPayload = {
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 102.9,
      currency: "USD",
      commission: 0,
    };
    expectRoundUpAccepted({
      control: () =>
        fsParent(
          fsCreate({
            ...base,
            payments: [{ method: "CASH", currencyCode: "USD", amount: 102.9 }],
          }),
        ),
      rounded: () =>
        fsParent(
          fsCreate({
            ...base,
            payments: [{ method: "CASH", currencyCode: "USD", amount: 103 }],
            rounding_given_usd: 0.1,
          }),
        ),
      reverse: voidTxn,
      paidDrawer: "General|USD",
      paidDelta: -103,
      roundingUsd: 0.1,
      roundingLbp: 0,
    });
  });

  it("an overpay with no claim is still refused (Whish App)", () => {
    expectRefused(
      () =>
        fsCreate({
          provider: "WHISH_APP",
          serviceType: "RECEIVE",
          amount: 102.9,
          currency: "USD",
          commission: 0,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 103 }],
        }),
      NO_CLAIM_OVERPAY,
    );
  });

  it("a Binance cash-out credited to the customer account refuses a round-up", () => {
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
          payments: [
            { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 98 },
          ],
          rounding_given_usd: 0.1,
        }),
      NOT_ALLOWED,
    );
  });
});

// ─── (c) Exchange payout ────────────────────────────────────────────────────

function exchangeCreate(body: Record<string, unknown>): ParentTxn {
  const parsed = exchangeSubmitSchema.parse(body);
  const { id } = new ExchangeRepository().createTransaction(parsed);
  return parentOf("exchange_transactions", id);
}

const refundTxn = (t: ParentTxn) => {
  getTransactionRepository().refundTransaction(t.id, 1);
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

/** $100 → LBP: 8,953,000 LBP owed. */
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

describe("LIRA-334 (c) — Exchange payout", () => {
  it("USD out: owes $101.12, hands $102 → one $0.88 expense, refund nets 0", () => {
    expectRoundUpAccepted({
      control: () =>
        exchangeCreate({
          ...LBP_TO_USD,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 101.12 }],
        }),
      rounded: () =>
        exchangeCreate({
          ...LBP_TO_USD,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 102 }],
          rounding_given_usd: 0.88,
        }),
      reverse: refundTxn,
      paidDrawer: "General|USD",
      paidDelta: -102,
      roundingUsd: 0.88,
      roundingLbp: 0,
    });
  });

  it("LBP out: owes 8,953,000, hands 9,000,000 → one 47,000 LBP expense, refund nets 0", () => {
    expectRoundUpAccepted({
      control: () =>
        exchangeCreate({
          ...USD_TO_LBP,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 8_953_000 }],
        }),
      rounded: () =>
        exchangeCreate({
          ...USD_TO_LBP,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 9_000_000 }],
          rounding_given_lbp: 47_000,
        }),
      reverse: refundTxn,
      paidDrawer: "General|LBP",
      paidDelta: -9_000_000,
      roundingUsd: 0,
      roundingLbp: 47_000,
    });
  });

  it("an overpay with no claim is still refused", () => {
    expectRefused(
      () =>
        exchangeCreate({
          ...LBP_TO_USD,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 102 }],
        }),
      NO_CLAIM_OVERPAY,
    );
  });

  it("a FOR-partner exchange with a round-up is refused", () => {
    const partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name, is_active) VALUES (1, 'Round Partner', 1)`,
        )
        .run().lastInsertRowid,
    );
    expectRefused(
      () =>
        exchangeCreate({
          ...LBP_TO_USD,
          partnerId,
          partnerMode: "FOR",
          payments: [{ method: "CASH", currencyCode: "USD", amount: 102 }],
          rounding_given_usd: 0.88,
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

describe("LIRA-334 (d) — credit buy-back", () => {
  it("USD: owes $8.90, hands $9 → one $0.10 expense, void nets 0", () => {
    expectRoundUpAccepted({
      control: () =>
        buyback({
          currency: "USD",
          price: 8.9,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 8.9 }],
        }),
      rounded: () =>
        buyback({
          currency: "USD",
          price: 8.9,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 9 }],
          rounding_given_usd: 0.1,
        }),
      reverse: voidTxn,
      paidDrawer: "General|USD",
      paidDelta: -9,
      roundingUsd: 0.1,
      roundingLbp: 0,
    });
  });

  it("LBP: owes 745,000, hands 750,000 → one 5,000 LBP expense, void nets 0", () => {
    expectRoundUpAccepted({
      control: () =>
        buyback({
          price: 745_000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 745_000 }],
        }),
      rounded: () =>
        buyback({
          price: 745_000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 750_000 }],
          rounding_given_lbp: 5_000,
        }),
      reverse: voidTxn,
      paidDrawer: "General|LBP",
      paidDelta: -750_000,
      roundingUsd: 0,
      roundingLbp: 5_000,
    });
  });

  it("an overpay with no claim is still refused", () => {
    expectRefused(
      () =>
        buyback({
          price: 745_000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 750_000 }],
        }),
      NO_CLAIM_OVERPAY,
    );
  });
});

describe("LIRA-334 (e) — Whish App top-up from a client", () => {
  it("USD: $100 credits, $1.10 fee → owes $98.90, hands $99 → one $0.10 expense, void nets 0", () => {
    expectRoundUpAccepted({
      control: () =>
        topUp({
          payments: [{ method: "CASH", currencyCode: "USD", amount: 98.9 }],
        }),
      rounded: () =>
        topUp({
          payments: [{ method: "CASH", currencyCode: "USD", amount: 99 }],
          rounding_given_usd: 0.1,
        }),
      reverse: voidTxn,
      paidDrawer: "General|USD",
      paidDelta: -99,
      roundingUsd: 0.1,
      roundingLbp: 0,
    });
  });

  it("LBP: 2,000,000 credits, 105,000 fee → owes 1,895,000, hands 1,900,000 → one 5,000 LBP expense, void nets 0", () => {
    const lbp = { amount: 2_000_000, currency: "LBP", fee: 105_000 };
    expectRoundUpAccepted({
      control: () =>
        topUp({
          ...lbp,
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: 1_895_000 },
          ],
        }),
      rounded: () =>
        topUp({
          ...lbp,
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: 1_900_000 },
          ],
          rounding_given_lbp: 5_000,
        }),
      reverse: voidTxn,
      paidDrawer: "General|LBP",
      paidDelta: -1_900_000,
      roundingUsd: 0,
      roundingLbp: 5_000,
    });
  });

  it("an overpay with no claim is still refused", () => {
    expectRefused(
      () =>
        topUp({
          payments: [{ method: "CASH", currencyCode: "USD", amount: 99 }],
        }),
      NO_CLAIM_OVERPAY,
    );
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

describe("LIRA-334 (f) — Hold Money pickup", () => {
  it("one currency USD: held $50.12, hands $51 → one $0.88 expense on the pickup, voidPickup nets 0", () => {
    // Drop-offs happen before the snapshot windows (they move the drawer).
    const controlHold = hold(50.12);
    const roundedHold = hold(50.12);
    expectRoundUpAccepted({
      control: () =>
        collect({
          id: controlHold,
          payments: [{ method: "CASH", currency_code: "USD", amount: 50.12 }],
        }),
      rounded: () =>
        collect({
          id: roundedHold,
          payments: [{ method: "CASH", currency_code: "USD", amount: 51 }],
          rounding_given_usd: 0.88,
        }),
      reverse: voidPickup,
      link: (t) => ({ table: "hold_money_pickups", id: pickupOf(t) }),
      paidDrawer: "General|USD",
      paidDelta: -51,
      roundingUsd: 0.88,
      roundingLbp: 0,
    });
  });

  it("an overpay with no claim is still refused", () => {
    const id = hold(50.12);
    expectRefused(
      () =>
        collect({
          id,
          payments: [{ method: "CASH", currency_code: "USD", amount: 51 }],
        }),
      NO_CLAIM_OVERPAY,
    );
  });

  it("one currency LBP: held 1,345,000, hands 1,350,000 → one 5,000 LBP expense, voidPickup nets 0", () => {
    const controlHold = hold(0, 1_345_000);
    const roundedHold = hold(0, 1_345_000);
    expectRoundUpAccepted({
      control: () =>
        collect({
          id: controlHold,
          payments: [
            { method: "CASH", currency_code: "LBP", amount: 1_345_000 },
          ],
        }),
      rounded: () =>
        collect({
          id: roundedHold,
          payments: [
            { method: "CASH", currency_code: "LBP", amount: 1_350_000 },
          ],
          rounding_given_lbp: 5_000,
        }),
      reverse: voidPickup,
      link: (t) => ({ table: "hold_money_pickups", id: pickupOf(t) }),
      paidDrawer: "General|LBP",
      paidDelta: -1_350_000,
      roundingUsd: 0,
      roundingLbp: 5_000,
    });
  });

  it("a two-currency pickup with a round-up is refused", () => {
    const id = hold(50, 1_345_000);
    expectRefused(
      () =>
        collect({
          id,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 50 },
            { method: "CASH", currency_code: "LBP", amount: 1_350_000 },
          ],
          rounding_given_lbp: 5_000,
        }),
      NOT_ALLOWED,
    );
  });
});
