/**
 * Phase 5 (POSTING_INTEGRITY_PLAN.md §7) — the drawers & counterparties family
 * (POSTING_MAP.md §4.6 drawer cash-out, §4.7 counterparty operations) checked
 * against the posting rules table (constants/postingRules.ts).
 *
 * Each case drives the REAL writer against the REAL schema
 * (`electron-app/create_db.sql`, fresh in-memory DB per case), then:
 *   1. the action wrote EXACTLY the expected set of new transaction rows,
 *      by type and `is_auto` (rule 15: identity, never "the newest row");
 *   2. every ledger moved exactly as its rule(s) say — a ledger a rule marks
 *      `none` must not move at all. An action that writes two transactions
 *      (a payment with a bundled discount) is asserted against the SUM of
 *      both rules, never a third, invented rule;
 *   3. reversal (rule 20): a reversible type is voided and every ledger nets
 *      back to 0, per currency. A type in NON_REVERSIBLE_TRANSACTION_TYPES
 *      must refuse the void, change nothing, and net to 0 after its
 *      correction entry.
 *
 * CHARACTERIZATION, not failing-first (rule 17): these pin what today's code
 * does against what the map says. No fix is involved, and none was seen
 * failing before it passed. Where the correction entry for a
 * non-reversible type is not a recorded owner decision, the case says so.
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import {
  getDrawerTopUpRepository,
  resetDrawerTopUpRepository,
} from "../DrawerTopUpRepository";
import {
  getDrawerCashoutRepository,
  resetDrawerCashoutRepository,
} from "../DrawerCashoutRepository";
import {
  getClosingRepository,
  resetClosingRepository,
} from "../ClosingRepository";
import {
  getSupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
import {
  getProductRepository,
  resetProductRepository,
} from "../ProductRepository";
import { resetProductSupplierRepository } from "../ProductSupplierRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import {
  FinancialServiceRepository,
  resetFinancialServiceRepository,
} from "../FinancialServiceRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { getDebtRepository, resetDebtRepository } from "../DebtRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetCarrierLineRepository } from "../CarrierLineRepository";
import { resetExchangeLotRepository } from "../ExchangeLotRepository";
import { resetRateRepository } from "../RateRepository";
import {
  getPartnerService,
  resetPartnerService,
} from "../../services/PartnerService";
import { getDebtService, resetDebtService } from "../../services/DebtService";
import { resetSettingsService } from "../../services/SettingsService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { NON_REVERSIBLE_TRANSACTION_TYPES } from "../../constants/transactionTypes";
import {
  POSTING_RULES,
  type PostingInputs,
  type PostingRule,
  type PostingRuleKey,
} from "../../constants/postingRules";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
  expectPostingsMatchRule,
  expectedPostingsForRule,
  type ExpectedPostings,
  type LedgerName,
  type PostingRoleKeys,
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

const CLIENT_ID = 1;
const DAY = "2026-10-07";

function resetSingletons(): void {
  resetTransactionRepository();
  resetDrawerTopUpRepository();
  resetDrawerCashoutRepository();
  resetClosingRepository();
  resetSupplierRepository();
  resetProductRepository();
  resetProductSupplierRepository();
  resetStockBatchRepository();
  resetFinancialServiceRepository();
  resetPartnerRepository();
  resetPartnerService();
  resetDebtRepository();
  resetDebtService();
  resetExpenseRepository();
  resetPaymentMethodRepository();
  resetClientRepository();
  resetSettingsRepository();
  resetSettingsService();
  resetCarrierLineRepository();
  resetExchangeLotRepository();
  resetRateRepository();
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
  for (const [d, c, b] of [
    ["General", "USD", 5000],
    ["General", "LBP", 500_000_000],
    ["OMT_System", "USD", 2000],
    ["OMT_System", "LBP", 100_000_000],
  ] as const)
    seed.run(d, c, b);

  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, 'Posting Client', '70111222')`,
  ).run(CLIENT_ID);
});

afterEach(() => {
  resetTenantContext();
  resetSingletons();
  delete (globalThis as G).__LIRATEK_TEST_DB__;
  db.close();
});

// ─── helpers ────────────────────────────────────────────────────────────────

interface Ctx {
  partnerId: number;
  /** A plain (non-system) supplier the operator created. */
  supplierId: number;
  /** The shop's base-system supplier (`shop_base_system = 'OMT'`). */
  omtId: number;
}

function seedCtx(): Ctx {
  const partnerId = Number(
    db
      .prepare(
        `INSERT INTO partners (tenant_id, name, is_active) VALUES (1, 'Posting Partner', 1)`,
      )
      .run().lastInsertRowid,
  );
  const supplierId = Number(
    db
      .prepare(
        `INSERT INTO suppliers (tenant_id, name, is_active, is_system) VALUES (1, 'Posting Supplier', 1, 0)`,
      )
      .run().lastInsertRowid,
  );
  const omt = db
    .prepare(
      `SELECT id FROM suppliers WHERE provider = 'OMT' AND tenant_id = 1`,
    )
    .get() as { id: number };
  return { partnerId, supplierId, omtId: omt.id };
}

function balance(drawer: string, currency: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function maxTxnId(): number {
  return (
    db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM transactions`).get() as {
      m: number;
    }
  ).m;
}

interface NewRow {
  id: number;
  type: string;
  auto: number;
}

function newRows(sinceId: number): NewRow[] {
  return db
    .prepare(
      `SELECT id, type, COALESCE(json_extract(metadata_json, '$.is_auto'), 0) AS auto
         FROM transactions WHERE id > ? ORDER BY id`,
    )
    .all(sinceId) as NewRow[];
}

/** {"SUPPLIER_SETTLEMENT": 1, "SUPPLIER_PAYMENT(auto)": 1} */
function rowCounts(rows: NewRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = r.auto ? `${r.type}(auto)` : r.type;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Sum of several rules' expectations — one action, several transactions. */
function mergedExpectation(
  parts: { rule: PostingRule; inputs: PostingInputs }[],
  keys: PostingRoleKeys,
): ExpectedPostings {
  const out: ExpectedPostings = {};
  for (const { rule, inputs } of parts) {
    const { expected, unchecked } = expectedPostingsForRule(rule, inputs, keys);
    expect(unchecked).toEqual([]);
    for (const [ledger, lines] of Object.entries(expected) as [
      LedgerName,
      Record<string, number>,
    ][]) {
      const acc = (out[ledger] ??= {});
      for (const [k, v] of Object.entries(lines)) {
        const s = r6((acc[k] ?? 0) + v);
        if (s === 0) delete acc[k];
        else acc[k] = s;
      }
      if (Object.keys(acc).length === 0) delete out[ledger];
    }
  }
  return out;
}

function ok(res: { success: boolean; error?: string }): void {
  if (!res.success) throw new Error(res.error);
}

/** Seeds a partner balance BEFORE the snapshot (> 0 = partner owes the shop). */
function seedPartnerBalance(
  partnerId: number,
  amount: number,
  currency: string,
): void {
  db.prepare(
    `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, amount, currency, direction, user_id)
     VALUES (1, ?, 'FOR_OMT', ?, ?, ?, 1)`,
  ).run(
    partnerId,
    Math.abs(amount),
    currency,
    amount >= 0 ? "DEBIT" : "CREDIT",
  );
}

/** Profit stamp on the one new COUNTERPARTY_DISCOUNT row (POSTING_MAP §4.7 Profit column). */
function discountProfit(txnIds: number[]): { usd: number; lbp: number } {
  const ph = txnIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT profit_usd AS usd, profit_lbp AS lbp FROM transactions
        WHERE id IN (${ph}) AND type = 'COUNTERPARTY_DISCOUNT'`,
    )
    .get(...txnIds) as { usd: number; lbp: number };
}

// ─── cases ──────────────────────────────────────────────────────────────────

type Reverse =
  /** Reversible: void the primary transaction; ledgers then differ from the
   *  pre-action snapshot by `leftover` (default: nothing — nets to 0). */
  | { kind: "void"; leftover?: (ctx: Ctx) => ExpectedPostings }
  /** NON_REVERSIBLE: the void is refused; `correct` is the correction entry. */
  | { kind: "correct"; correct: (ctx: Ctx) => void; documented: boolean };

interface Case {
  name: string;
  /** First entry is the PRIMARY transaction (the one voided). */
  rules: { rule: PostingRuleKey; inputs: PostingInputs }[];
  keys: (ctx: Ctx) => PostingRoleKeys;
  /** Runs before the snapshot (seeding balances, the row to settle …). */
  setup?: (ctx: Ctx) => void;
  act: (ctx: Ctx) => void;
  /** Exact set of new transaction rows the action writes. */
  rows: Record<string, number>;
  reverse: Reverse;
  /** Extra checks after the action. */
  check?: (ctx: Ctx, txnIds: number[]) => void;
}

const usd = (x: number): PostingInputs => ({ x, f: 0, c: 0, currency: "USD" });
const lbp = (x: number): PostingInputs => ({ x, f: 0, c: 0, currency: "LBP" });
const CUR = [
  { currency: "USD" as const, x: 100, inputs: usd },
  { currency: "LBP" as const, x: 2_000_000, inputs: lbp },
];

const amounts = (currency: "USD" | "LBP", x: number) =>
  currency === "USD"
    ? { amount_usd: x, amount_lbp: 0 }
    : { amount_usd: 0, amount_lbp: x };

const cases: Case[] = [
  // ── DRAWER_TRANSFER — §4.7 ──
  ...CUR.map(
    ({ currency, x, inputs }): Case => ({
      name: `transferBetweenDrawers General → OMT_System, ${currency}`,
      rules: [{ rule: "DRAWER_TRANSFER/between-drawers", inputs: inputs(x) }],
      keys: () => ({
        drawers: { source: "General", destination: "OMT_System" },
      }),
      act: () => {
        getDrawerTopUpRepository().transferBetweenDrawers({
          fromDrawer: "General",
          toDrawer: "OMT_System",
          amountUsd: currency === "USD" ? x : 0,
          amountLbp: currency === "LBP" ? x : 0,
          createdBy: 1,
        });
      },
      rows: { DRAWER_TRANSFER: 1 },
      reverse: { kind: "void" },
    }),
  ),
  {
    name: "transferBetweenDrawers OMT_System → General, USD + LBP in one call",
    rules: [
      { rule: "DRAWER_TRANSFER/between-drawers", inputs: usd(40) },
      { rule: "DRAWER_TRANSFER/between-drawers", inputs: lbp(900_000) },
    ],
    keys: () => ({ drawers: { source: "OMT_System", destination: "General" } }),
    act: () => {
      getDrawerTopUpRepository().transferBetweenDrawers({
        fromDrawer: "OMT_System",
        toDrawer: "General",
        amountUsd: 40,
        amountLbp: 900_000,
        createdBy: 1,
      });
    },
    rows: { DRAWER_TRANSFER: 1 },
    reverse: { kind: "void" },
  },

  // ── DRAWER_TOPUP — §4.7 ──
  ...CUR.map(
    ({ currency, x, inputs }): Case => ({
      name: `createTopUp (external cash-in), ${currency}`,
      rules: [{ rule: "DRAWER_TOPUP/external", inputs: inputs(x) }],
      keys: () => ({ drawers: { general: "General" } }),
      act: () => {
        getDrawerTopUpRepository().createTopUp(amounts(currency, x), 1);
      },
      rows: { DRAWER_TOPUP: 1 },
      reverse: {
        kind: "correct",
        documented: true,
        correct: () => {
          getDrawerCashoutRepository().createCashout(
            { ...amounts(currency, x), notes: "correct top-up" },
            1,
          );
        },
      },
    }),
  ),
  ...CUR.map(
    ({ currency, x, inputs }): Case => ({
      name: `createTopUpFromDrawer OMT_System → General, ${currency}`,
      rules: [{ rule: "DRAWER_TOPUP/from-drawer", inputs: inputs(x) }],
      keys: () => ({ drawers: { source: "OMT_System", general: "General" } }),
      act: () => {
        getDrawerTopUpRepository().createTopUpFromDrawer(
          { ...amounts(currency, x), source_drawer: "OMT_System" },
          1,
        );
      },
      rows: { DRAWER_TOPUP: 1 },
      // G9: the source leg has a payments row, so a rebuild keeps it.
      check: (_ctx, [txnId]) => {
        const legs = db
          .prepare(
            `SELECT drawer_name, amount FROM payments WHERE transaction_id = ? ORDER BY id`,
          )
          .all(txnId);
        expect(legs).toEqual([
          { drawer_name: "OMT_System", amount: -x },
          { drawer_name: "General", amount: x },
        ]);
      },
      reverse: {
        kind: "correct",
        documented: false,
        correct: () => {
          getDrawerTopUpRepository().transferBetweenDrawers({
            fromDrawer: "General",
            toDrawer: "OMT_System",
            amountUsd: currency === "USD" ? x : 0,
            amountLbp: currency === "LBP" ? x : 0,
            createdBy: 1,
          });
        },
      },
    }),
  ),

  // ── DRAWER_CASHOUT — §4.6 ──
  ...CUR.map(
    ({ currency, x, inputs }): Case => ({
      name: `createCashout from General, ${currency}`,
      rules: [{ rule: "DRAWER_CASHOUT/general", inputs: inputs(x) }],
      keys: () => ({ drawers: { general: "General" } }),
      act: () => {
        getDrawerCashoutRepository().createCashout(
          { ...amounts(currency, x), notes: "owner draw" },
          1,
        );
      },
      rows: { DRAWER_CASHOUT: 1 },
      reverse: {
        kind: "correct",
        documented: false,
        correct: () => {
          getDrawerTopUpRepository().createTopUp(amounts(currency, x), 1);
        },
      },
    }),
  ),

  // ── CHECKPOINT — §4.7 ──
  ...(
    [
      { currency: "USD" as const, delta: -12.5, inputs: usd },
      { currency: "LBP" as const, delta: 350_000, inputs: lbp },
    ] as const
  ).map(
    ({ currency, delta, inputs }): Case => ({
      name: `createCheckpoint on General, ${currency} count ${delta > 0 ? "over" : "short"}`,
      rules: [{ rule: "CHECKPOINT/count", inputs: inputs(delta) }],
      keys: () => ({ drawers: { counted: "General" } }),
      act: () => {
        const book = balance("General", currency);
        ok(
          getClosingRepository().createCheckpoint({
            user_id: 1,
            drawer_name: "General",
            closing_date: DAY,
            amounts: [
              {
                drawer_name: "General",
                currency_code: currency,
                expected_amount: book,
                physical_amount: book + delta,
              },
            ],
          }),
        );
      },
      rows: { CHECKPOINT: 1 },
      reverse: {
        kind: "correct",
        documented: true,
        // A later checkpoint counting the original book balance.
        correct: () => {
          const book = balance("General", currency);
          ok(
            getClosingRepository().createCheckpoint({
              user_id: 1,
              drawer_name: "General",
              closing_date: DAY,
              amounts: [
                {
                  drawer_name: "General",
                  currency_code: currency,
                  expected_amount: book,
                  physical_amount: book - delta,
                },
              ],
            }),
          );
        },
      },
    }),
  ),

  // ── SUPPLIER_PAYMENT (manual) — §4.7 ──
  ...CUR.map(
    ({ currency, x, inputs }): Case => ({
      name: `recordSupplierCashflow PAY, plain supplier, CASH ${currency} → General`,
      rules: [{ rule: "SUPPLIER_PAYMENT/pay", inputs: inputs(x) }],
      keys: (c) => ({
        drawers: { tender: "General" },
        providerSupplierId: c.supplierId,
      }),
      act: (c) => {
        getSupplierRepository().recordSupplierCashflow({
          supplier_id: c.supplierId,
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: currency, amount: x }],
          created_by: 1,
        });
      },
      rows: { SUPPLIER_PAYMENT: 1 },
      reverse: { kind: "void" },
    }),
  ),
  {
    name: "recordSupplierCashflow PAY, base-system supplier OMT: CASH lands in OMT_System",
    rules: [{ rule: "SUPPLIER_PAYMENT/pay", inputs: usd(75) }],
    keys: (c) => ({
      drawers: { tender: "OMT_System" },
      providerSupplierId: c.omtId,
    }),
    act: (c) => {
      getSupplierRepository().recordSupplierCashflow({
        supplier_id: c.omtId,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 75 }],
        created_by: 1,
      });
    },
    rows: { SUPPLIER_PAYMENT: 1 },
    reverse: { kind: "void" },
  },
  ...CUR.map(
    ({ currency, x, inputs }): Case => ({
      name: `recordSupplierCashflow RECEIVE, plain supplier, CASH ${currency}`,
      rules: [{ rule: "SUPPLIER_PAYMENT/receive", inputs: inputs(x) }],
      keys: (c) => ({
        drawers: { tender: "General" },
        providerSupplierId: c.supplierId,
      }),
      act: (c) => {
        getSupplierRepository().recordSupplierCashflow({
          supplier_id: c.supplierId,
          direction: "RECEIVE",
          payments: [{ method: "CASH", currency_code: currency, amount: x }],
          created_by: 1,
        });
      },
      rows: { SUPPLIER_PAYMENT: 1 },
      reverse: { kind: "void" },
    }),
  ),
  {
    name: "addLedgerEntry PAYMENT with drawer, USD + LBP in one entry (G8: two payments rows)",
    rules: [
      { rule: "SUPPLIER_PAYMENT/manual-drawer", inputs: usd(50) },
      { rule: "SUPPLIER_PAYMENT/manual-drawer", inputs: lbp(1_000_000) },
    ],
    keys: (c) => ({
      drawers: { source: "General" },
      providerSupplierId: c.supplierId,
    }),
    act: (c) => {
      getSupplierRepository().addLedgerEntry({
        supplier_id: c.supplierId,
        entry_type: "PAYMENT",
        amount_usd: 50,
        amount_lbp: 1_000_000,
        drawer_name: "General",
        created_by: 1,
      });
    },
    rows: { SUPPLIER_PAYMENT: 1 },
    check: (_ctx, [txnId]) => {
      const legs = db
        .prepare(
          `SELECT currency_code, amount FROM payments WHERE transaction_id = ? ORDER BY id`,
        )
        .all(txnId);
      expect(legs).toEqual([
        { currency_code: "USD", amount: -50 },
        { currency_code: "LBP", amount: -1_000_000 },
      ]);
    },
    reverse: { kind: "void" },
  },

  // ── SUPPLIER_PAYMENT + bundled COUNTERPARTY_DISCOUNT/supplier ──
  {
    name: "recordSupplierCashflow PAY $60 + bundled $40 discount",
    rules: [
      { rule: "SUPPLIER_PAYMENT/pay", inputs: usd(60) },
      { rule: "COUNTERPARTY_DISCOUNT/supplier", inputs: usd(40) },
    ],
    keys: (c) => ({
      drawers: { tender: "General" },
      providerSupplierId: c.supplierId,
    }),
    act: (c) => {
      getSupplierRepository().recordSupplierCashflow({
        supplier_id: c.supplierId,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
        discount: { amount_usd: 40, amount_lbp: 0, reason: "volume" },
        created_by: 1,
      });
    },
    rows: { SUPPLIER_PAYMENT: 1, COUNTERPARTY_DISCOUNT: 1 },
    // A supplier discount is a gain: profit +d.
    check: (_ctx, ids) =>
      expect(discountProfit(ids)).toEqual({ usd: 40, lbp: 0 }),
    // Owner decision 2026-10-07 (matching the Partners page): voiding the
    // payment also removes its bundled discount — every ledger nets to 0.
    // This case used to pin a −$40 supplier leftover (the DISCOUNT row had
    // no link to the payment); it is the failing-first guard for the fix.
    reverse: { kind: "void" },
  },

  // ── SUPPLIER_ADJUSTMENT — §4.7 ──
  ...(
    [
      { currency: "USD" as const, x: 30, inputs: usd },
      { currency: "LBP" as const, x: -500_000, inputs: lbp },
    ] as const
  ).map(
    ({ currency, x, inputs }): Case => ({
      name: `addLedgerEntry ADJUSTMENT (paper) ${x > 0 ? "credit" : "debit"}, ${currency}`,
      rules: [{ rule: "SUPPLIER_ADJUSTMENT/paper", inputs: inputs(x) }],
      keys: (c) => ({ providerSupplierId: c.supplierId }),
      act: (c) => {
        getSupplierRepository().addLedgerEntry({
          supplier_id: c.supplierId,
          entry_type: "ADJUSTMENT",
          ...amounts(currency, x),
          created_by: 1,
        });
      },
      rows: { SUPPLIER_ADJUSTMENT: 1 },
      reverse: {
        kind: "correct",
        documented: true,
        correct: (c) => {
          getSupplierRepository().addLedgerEntry({
            supplier_id: c.supplierId,
            entry_type: "ADJUSTMENT",
            ...amounts(currency, -x),
            created_by: 1,
          });
        },
      },
    }),
  ),

  // ── SUPPLIER_RECORDED_DEBT — §4.7 ──
  ...CUR.map(
    ({ currency, x, inputs }): Case => ({
      name: `recordDebt (no products), ${currency}`,
      rules: [{ rule: "SUPPLIER_RECORDED_DEBT/open", inputs: inputs(x) }],
      keys: (c) => ({ providerSupplierId: c.supplierId }),
      act: (c) => {
        getSupplierRepository().recordDebt({
          supplier_id: c.supplierId,
          ...amounts(currency, x),
          created_by: 1,
        });
      },
      rows: { SUPPLIER_RECORDED_DEBT: 1 },
      reverse: { kind: "void" },
    }),
  ),

  // ── PARTNER_SETTLEMENT — §4.7 ──
  ...CUR.map(
    ({ currency, x, inputs }): Case => ({
      name: `partner settle, partner owes the shop, CASH ${currency}`,
      rules: [{ rule: "PARTNER_SETTLEMENT/partner-owes", inputs: inputs(x) }],
      keys: (c) => ({ drawers: { tender: "General" }, partnerId: c.partnerId }),
      setup: (c) => seedPartnerBalance(c.partnerId, 3 * x, currency),
      act: (c) => {
        getPartnerService().settle({
          partnerId: c.partnerId,
          amount: x,
          currency,
          settlementMethod: "CASH",
          userId: 1,
        });
      },
      rows: { PARTNER_SETTLEMENT: 1 },
      reverse: { kind: "void" },
    }),
  ),
  ...CUR.map(
    ({ currency, x, inputs }): Case => ({
      name: `partner settle, shop owes the partner, CASH ${currency}`,
      rules: [{ rule: "PARTNER_SETTLEMENT/shop-owes", inputs: inputs(x) }],
      keys: (c) => ({ drawers: { tender: "General" }, partnerId: c.partnerId }),
      setup: (c) => seedPartnerBalance(c.partnerId, -3 * x, currency),
      act: (c) => {
        getPartnerService().settle({
          partnerId: c.partnerId,
          amount: x,
          currency,
          settlementMethod: "CASH",
          userId: 1,
        });
      },
      rows: { PARTNER_SETTLEMENT: 1 },
      reverse: { kind: "void" },
    }),
  ),
  {
    name: "partner settle via CLIENT_ACCOUNT (paper): no drawer moves",
    rules: [{ rule: "PARTNER_SETTLEMENT/client-account", inputs: usd(80) }],
    keys: (c) => ({ partnerId: c.partnerId }),
    setup: (c) => seedPartnerBalance(c.partnerId, 200, "USD"),
    act: (c) => {
      getPartnerService().settle({
        partnerId: c.partnerId,
        amount: 80,
        currency: "USD",
        settlementMethod: "CLIENT_ACCOUNT",
        userId: 1,
      });
    },
    rows: { PARTNER_SETTLEMENT: 1 },
    reverse: { kind: "void" },
  },
  {
    name: "partner settle $150 + bundled $40 discount (partner owed $200)",
    rules: [
      { rule: "PARTNER_SETTLEMENT/partner-owes", inputs: usd(150) },
      { rule: "COUNTERPARTY_DISCOUNT/partner-forgiven", inputs: usd(40) },
    ],
    keys: (c) => ({ drawers: { tender: "General" }, partnerId: c.partnerId }),
    setup: (c) => seedPartnerBalance(c.partnerId, 200, "USD"),
    act: (c) => {
      getPartnerService().settle({
        partnerId: c.partnerId,
        amount: 150,
        currency: "USD",
        settlementMethod: "CASH",
        discount: { amount_usd: 40, amount_lbp: 0 },
        userId: 1,
      });
    },
    rows: { PARTNER_SETTLEMENT: 1, COUNTERPARTY_DISCOUNT: 1 },
    // The settlement void sweeps the bundled discount (_reversePartnerSettlementLedger).
    reverse: { kind: "void" },
  },

  // ── PARTNER_PAYMENT / PARTNER_ADJUSTMENT — §4.7 ──
  ...CUR.flatMap(({ currency, x, inputs }): Case[] => [
    {
      name: `partner Add Debt, cash moved, ${currency}`,
      rules: [{ rule: "PARTNER_PAYMENT/add-debt", inputs: inputs(x) }],
      keys: (c) => ({ drawers: { tender: "General" }, partnerId: c.partnerId }),
      act: (c) => {
        getPartnerService().recordPartnerTransaction({
          transactionType: "ADJUSTMENT", // what the Partners page always sends
          partnerId: c.partnerId,
          amount: x,
          currency,
          direction: "DEBIT",
          userId: 1,
          moveCash: true,
        });
      },
      rows: { PARTNER_PAYMENT: 1 },
      reverse: { kind: "void" },
    },
    {
      name: `partner Add Credit, cash moved, ${currency}`,
      rules: [{ rule: "PARTNER_PAYMENT/add-credit", inputs: inputs(x) }],
      keys: (c) => ({ drawers: { tender: "General" }, partnerId: c.partnerId }),
      act: (c) => {
        getPartnerService().recordPartnerTransaction({
          transactionType: "ADJUSTMENT", // what the Partners page always sends
          partnerId: c.partnerId,
          amount: x,
          currency,
          direction: "CREDIT",
          userId: 1,
          moveCash: true,
        });
      },
      rows: { PARTNER_PAYMENT: 1 },
      reverse: { kind: "void" },
    },
  ]),
  ...(
    [
      {
        currency: "USD" as const,
        x: 25,
        direction: "DEBIT" as const,
        inputs: usd,
      },
      {
        currency: "LBP" as const,
        x: -700_000,
        direction: "CREDIT" as const,
        inputs: lbp,
      },
    ] as const
  ).map(
    ({ currency, x, direction, inputs }): Case => ({
      name: `partner paper entry (no cash), ${direction}, ${currency}`,
      rules: [{ rule: "PARTNER_ADJUSTMENT/paper", inputs: inputs(x) }],
      keys: (c) => ({ partnerId: c.partnerId }),
      act: (c) => {
        getPartnerService().recordPartnerTransaction({
          transactionType: "ADJUSTMENT", // what the Partners page always sends
          partnerId: c.partnerId,
          amount: Math.abs(x),
          currency,
          direction,
          userId: 1,
          moveCash: false,
        });
      },
      rows: { PARTNER_ADJUSTMENT: 1 },
      reverse: {
        kind: "correct",
        documented: true,
        correct: (c) => {
          getPartnerService().recordPartnerTransaction({
            transactionType: "ADJUSTMENT", // what the Partners page always sends
            partnerId: c.partnerId,
            amount: Math.abs(x),
            currency,
            direction: direction === "DEBIT" ? "CREDIT" : "DEBIT",
            userId: 1,
            moveCash: false,
          });
        },
      },
    }),
  ),

  // ── COUNTERPARTY_DISCOUNT — §4.7 ──
  ...CUR.map(
    ({ currency, x, inputs }): Case => ({
      name: `client debt write-off, ${currency}`,
      rules: [{ rule: "COUNTERPARTY_DISCOUNT/client", inputs: inputs(x) }],
      keys: () => ({ clientId: CLIENT_ID }),
      setup: () => {
        db.prepare(
          `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, created_by)
           VALUES (1, ?, 'Manual Debt', ?, ?, 1)`,
        ).run(CLIENT_ID, ...Object.values(amounts(currency, 3 * x)));
      },
      act: () => {
        ok(
          getDebtService().writeOffDebt({
            clientId: CLIENT_ID,
            amountUSD: currency === "USD" ? x : 0,
            amountLBP: currency === "LBP" ? x : 0,
            userId: 1,
          }),
        );
      },
      rows: { COUNTERPARTY_DISCOUNT: 1 },
      // Forgiving a receivable is a cost: profit −x.
      check: (_ctx, ids) =>
        expect(discountProfit(ids)).toEqual(
          currency === "USD" ? { usd: -x, lbp: 0 } : { usd: 0, lbp: -x },
        ),
      reverse: {
        kind: "correct",
        // "An opposite discount" cannot be produced (a write-off always
        // lowers the debt); a paper Manual Debt is the nearest entry.
        documented: false,
        correct: () => {
          getDebtRepository().addAccountCashEntry({
            direction: "debt",
            client_id: CLIENT_ID,
            ...amounts(currency, x),
            created_by: 1,
            move_cash: false,
          });
        },
      },
    }),
  ),
  {
    name: "partner write-off, partner owed the shop (forgiven), USD",
    rules: [
      { rule: "COUNTERPARTY_DISCOUNT/partner-forgiven", inputs: usd(30) },
    ],
    keys: (c) => ({ partnerId: c.partnerId }),
    setup: (c) => seedPartnerBalance(c.partnerId, 100, "USD"),
    act: (c) => {
      ok(
        getPartnerService().writeOff({
          partnerId: c.partnerId,
          amount_usd: 30,
          amount_lbp: 0,
          userId: 1,
        }),
      );
    },
    rows: { COUNTERPARTY_DISCOUNT: 1 },
    reverse: {
      kind: "correct",
      documented: false,
      correct: (c) => {
        getPartnerService().recordPartnerTransaction({
          transactionType: "ADJUSTMENT", // what the Partners page always sends
          partnerId: c.partnerId,
          amount: 30,
          currency: "USD",
          direction: "DEBIT",
          userId: 1,
          moveCash: false,
        });
      },
    },
  },
  {
    name: "partner write-off, shop owed the partner (received), LBP",
    rules: [
      { rule: "COUNTERPARTY_DISCOUNT/partner-received", inputs: lbp(400_000) },
    ],
    keys: (c) => ({ partnerId: c.partnerId }),
    setup: (c) => seedPartnerBalance(c.partnerId, -1_000_000, "LBP"),
    act: (c) => {
      ok(
        getPartnerService().writeOff({
          partnerId: c.partnerId,
          amount_usd: 0,
          amount_lbp: 400_000,
          userId: 1,
        }),
      );
    },
    rows: { COUNTERPARTY_DISCOUNT: 1 },
    reverse: {
      kind: "correct",
      documented: false,
      correct: (c) => {
        getPartnerService().recordPartnerTransaction({
          transactionType: "ADJUSTMENT", // what the Partners page always sends
          partnerId: c.partnerId,
          amount: 400_000,
          currency: "LBP",
          direction: "CREDIT",
          userId: 1,
          moveCash: false,
        });
      },
    },
  },
];

describe("Drawers & counterparties — postings match POSTING_RULES (characterization)", () => {
  for (const c of cases) {
    it(`${c.name}: posts exactly ${c.rules.map((r) => r.rule).join(" + ")}`, () => {
      const ctx = seedCtx();
      c.setup?.(ctx);
      const sinceId = maxTxnId();
      const before = snapshotLedgers(db);

      c.act(ctx);

      // 1. Exactly the expected new transaction rows (identity, rule 15).
      const rows = newRows(sinceId);
      expect(rowCounts(rows)).toEqual(c.rows);
      const primaryType = POSTING_RULES[c.rules[0].rule].transactionType;
      const primary = rows.filter((r) => r.type === primaryType && !r.auto);
      expect(primary).toHaveLength(1);
      const txnId = primary[0].id;

      // 2. Every ledger, full delta, from the table.
      const after = snapshotLedgers(db);
      const keys = c.keys(ctx);
      if (c.rules.length === 1) {
        expectPostingsMatchRule(
          POSTING_RULES[c.rules[0].rule],
          before,
          after,
          c.rules[0].inputs,
          keys,
        );
      } else {
        const want = mergedExpectation(
          c.rules.map((r) => ({
            rule: POSTING_RULES[r.rule],
            inputs: r.inputs,
          })),
          keys,
        );
        expectPostings(before, after, want);
      }
      c.check?.(
        ctx,
        rows.map((r) => r.id),
      );

      // 3. Reversal (rule 20).
      const nonReversible = NON_REVERSIBLE_TRANSACTION_TYPES.has(primaryType);
      if (c.reverse.kind === "void") {
        expect({ primaryType, nonReversible }).toEqual({
          primaryType,
          nonReversible: false,
        });
        getTransactionRepository().voidTransaction(txnId, 1);
        expectPostings(
          before,
          snapshotLedgers(db),
          c.reverse.leftover?.(ctx) ?? {},
        );
      } else {
        expect({ primaryType, nonReversible }).toEqual({
          primaryType,
          nonReversible: true,
        });
        expect(() =>
          getTransactionRepository().voidTransaction(txnId, 1),
        ).toThrow();
        expectPostings(after, snapshotLedgers(db), {});
        c.reverse.correct(ctx);
        expectPostings(before, snapshotLedgers(db), {});
      }
    });
  }
});

// ─── SUPPLIER_STOCK_INTAKE — §4.7 (stock moves too) ─────────────────────────

describe("SUPPLIER_STOCK_INTAKE — postings match POSTING_RULES (characterization)", () => {
  it("receiveStock 3 × $12.50 from a named supplier: supplier +37.50 USD; void takes stock and debt back", () => {
    const rule = POSTING_RULES["SUPPLIER_STOCK_INTAKE/receive"];
    const productId = Number(
      db
        .prepare(
          `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
           VALUES (1, 'Posting Cable', 'Product', 10, 20, 2)`,
        )
        .run().lastInsertRowid,
    );
    const stock = () =>
      (
        db
          .prepare(`SELECT stock_quantity AS q FROM products WHERE id = ?`)
          .get(productId) as { q: number }
      ).q;
    const sinceId = maxTxnId();
    const before = snapshotLedgers(db);

    getProductRepository().receiveStock({
      product_id: productId,
      quantity: 3,
      unit_cost_usd: 12.5,
      supplier: "Stock Supplier",
      is_old_stock: false,
      created_by: 1,
    });

    const rows = newRows(sinceId);
    expect(rowCounts(rows)).toEqual({ SUPPLIER_STOCK_INTAKE: 1 });
    const supplier = db
      .prepare(
        `SELECT id FROM suppliers WHERE name = 'Stock Supplier' AND tenant_id = 1`,
      )
      .get() as { id: number };
    expectPostingsMatchRule(
      rule,
      before,
      snapshotLedgers(db),
      usd(r6(3 * 12.5)),
      {
        providerSupplierId: supplier.id,
      },
    );
    expect(stock()).toBe(5);

    expect(NON_REVERSIBLE_TRANSACTION_TYPES.has(rule.transactionType)).toBe(
      false,
    );
    getTransactionRepository().voidTransaction(rows[0].id, 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(stock()).toBe(2);
  });
});

// ─── SUPPLIER_SETTLEMENT — §4.7 (needs a real row to settle) ────────────────

describe("SUPPLIER_SETTLEMENT — postings match POSTING_RULES (characterization)", () => {
  for (const cur of [
    { currency: "USD" as const, x: 100, f: 5, c: 1 },
    { currency: "LBP" as const, x: 1_000_000, f: 50_000, c: 10_000 },
  ]) {
    it(`OMT SEND ${cur.currency} settled: PCD −net, OMT −(net + commission); void nets to 0`, () => {
      const rule = POSTING_RULES["SUPPLIER_SETTLEMENT/system-model1"];
      const { omtId } = seedCtx();
      const preFs = snapshotLedgers(db);

      // The row to settle: a walk-in OMT SEND booking +(x + f) on OMT.
      new FinancialServiceRepository().createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: cur.x,
        currency: cur.currency,
        commission: cur.c,
        omtFee: cur.f,
        payments: [
          { method: "CASH", currencyCode: cur.currency, amount: cur.x + cur.f },
        ],
      });
      const fsRow = db
        .prepare(
          `SELECT id, commission_model, service_type FROM financial_services ORDER BY id DESC LIMIT 1`,
        )
        .get() as {
        id: number;
        commission_model: number;
        service_type: string;
      };
      // The rule is the model-1, non-bills one — fail loudly if not.
      expect({
        model: fsRow.commission_model,
        type: fsRow.service_type,
      }).toEqual({ model: 1, type: "SEND" });

      const net = cur.x + cur.f - cur.c;
      const sinceId = maxTxnId();
      const before = snapshotLedgers(db);
      getSupplierRepository().settleTransactions({
        supplier_id: omtId,
        financial_service_ids: [fsRow.id],
        ...amounts(cur.currency, net),
        commission_usd: cur.currency === "USD" ? cur.c : 0,
        commission_lbp: cur.currency === "LBP" ? cur.c : 0,
        payments: [
          { method: "CASH", currency_code: cur.currency, amount: net },
        ],
        created_by: 1,
      });

      const rows = newRows(sinceId);
      expect(rowCounts(rows)).toEqual({
        SUPPLIER_SETTLEMENT: 1,
        "SUPPLIER_PAYMENT(auto)": 1,
      });
      const after = snapshotLedgers(db);
      expectPostingsMatchRule(
        rule,
        before,
        after,
        { x: net, f: 0, c: cur.c, currency: cur.currency },
        { drawers: { tender: "OMT_System" }, providerSupplierId: omtId },
      );
      // Settling nets OMT back to where it stood before the SEND.
      expect(
        ledgerDeltas(preFs, after).supplier[`${omtId}|${cur.currency}`] ?? 0,
      ).toBe(0);

      const settlementId = rows.find(
        (r) => r.type === "SUPPLIER_SETTLEMENT",
      )!.id;
      expect(NON_REVERSIBLE_TRANSACTION_TYPES.has(rule.transactionType)).toBe(
        false,
      );
      getTransactionRepository().voidTransaction(settlementId, 1);
      expectPostings(before, snapshotLedgers(db), {});
    });
  }
});
