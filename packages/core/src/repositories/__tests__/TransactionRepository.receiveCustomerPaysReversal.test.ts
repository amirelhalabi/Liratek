/**
 * LIRA-321 T039 — undo of a Whish App / OMT App RECEIVE recorded with
 * "Customer pays" lines (spec US5.2, rule 20).
 *
 * For each of spec US3 (a), (b), (c), the forgive case and the OMT App
 * mirror: void it, and (separately) refund it, then check that every ledger
 * — Whish_App, OMT_App, USD cash, client debt — and the fee profit net to 0,
 * per currency.
 *
 * Expected reversal owners (no new code expected): the generic
 * `_reversePayments` negates every customer line like it negated the single
 * inflow row; `_cancelDebt` cancels the 'Service Debt' charge (already in
 * MODULE_DEBT_TRANSACTION_TYPES); the profit stamp (fee − forgiven) is
 * negated by the REFUND row / dropped by status VOIDED. A forgiven part is a
 * WAIVED_SHORTFALL sibling (FR-012, same writer as Exchange) voided by the
 * parent's cascade (`_cascadeWaivedShortfallSiblingVoid`).
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
  type CreateFinancialServiceData,
} from "../FinancialServiceRepository";
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
import { snapshotLedgers, expectPostings } from "../testHelpers/postingAssert";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf-8",
);

const RATE = 89_500;
const CLIENT_ID = 1;

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
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, 'Rami', '70111222')`,
  ).run(CLIENT_ID);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["General", "USD", 10_000],
    ["General", "LBP", 900_000_000],
    ["Whish_App", "USD", 10_000],
    ["OMT_App", "USD", 10_000],
  ] as const)
    seed.run(d, c, b);
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

type Line = { method: string; currencyCode: string; amount: number };
const L = (method: string, amount: number): Line => ({
  method,
  currencyCode: "USD",
  amount,
});

const WHISH_BASE = {
  provider: "WHISH_APP",
  serviceType: "RECEIVE",
  amount: 100,
  currency: "USD",
  commission: 5,
  whishFee: 5,
  includingFees: false,
  payments: [L("CASH", 100)],
  cashoutMethod: "CASH",
  feeCollectedSeparately: true,
};

const OMT_BASE = {
  provider: "OMT_APP",
  serviceType: "RECEIVE",
  amount: 100,
  currency: "USD",
  commission: 0,
  includingFees: false,
  payments: [L("CASH", 100)],
  cashoutMethod: "CASH",
};

const CASES: Array<[string, Record<string, unknown>, Record<string, number>]> =
  [
    [
      "Whish App (a) Whish 90 + OMT 10 + Cash 5",
      {
        ...WHISH_BASE,
        customerPayments: [L("WHISH", 90), L("OMT", 10), L("CASH", 5)],
      },
      { "Whish_App|USD": 90, "OMT_App|USD": 10, "General|USD": -95 },
    ],
    [
      "Whish App (b) Whish 90 + Cash 10 + Cash 5",
      {
        ...WHISH_BASE,
        customerPayments: [L("WHISH", 90), L("CASH", 10), L("CASH", 5)],
      },
      { "Whish_App|USD": 90, "General|USD": -85 },
    ],
    [
      "Whish App (c) Whish 90 + Cash 5 + Account 10",
      {
        ...WHISH_BASE,
        clientId: CLIENT_ID,
        customerPayments: [
          L("WHISH", 90),
          L("CASH", 5),
          L("CUSTOMER_ACCOUNT", 10),
        ],
      },
      { "Whish_App|USD": 90, "General|USD": -95 },
    ],
    [
      "Whish App forgive: Whish 97 + Cash 5, $3 forgiven",
      {
        ...WHISH_BASE,
        customerPayments: [L("WHISH", 97), L("CASH", 5)],
        customer_waived_amount: 3,
      },
      { "Whish_App|USD": 97, "General|USD": -95 },
    ],
    [
      "OMT App (c) mirror: OMT 90 + Account 10",
      {
        ...OMT_BASE,
        clientId: CLIENT_ID,
        customerPayments: [L("OMT", 90), L("CUSTOMER_ACCOUNT", 10)],
      },
      { "OMT_App|USD": 90, "General|USD": -100 },
    ],
  ];

function create(data: Record<string, unknown>): number {
  const { id } = new FinancialServiceRepository().createTransaction({
    exchangeRate: RATE,
    ...data,
  } as unknown as CreateFinancialServiceData);
  const row = db
    .prepare(
      `SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ? AND reverses_id IS NULL`,
    )
    .get(id) as { id: number };
  return row.id;
}

/** Σ profit over ACTIVE transactions, per currency. */
function profit(): { usd: number; lbp: number } {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp
         FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
  return {
    usd: Math.round(r.usd * 1e6) / 1e6,
    lbp: Math.round(r.lbp * 1e6) / 1e6,
  };
}

/** Outstanding client debt (refund-cancelled rows excluded). */
function openDebt(): number {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM debt_ledger
        WHERE client_id = ? AND COALESCE(is_refunded, 0) = 0`,
    )
    .get(CLIENT_ID) as { usd: number };
  return Math.round(r.usd * 1e6) / 1e6;
}

/** The forgiven-part rows (WAIVED_SHORTFALL siblings), not their reversals. */
function waivedSiblings(): { status: string; profit_usd: number }[] {
  return db
    .prepare(
      `SELECT status, profit_usd FROM transactions
        WHERE type = 'WAIVED_SHORTFALL' AND reverses_id IS NULL ORDER BY id`,
    )
    .all() as { status: string; profit_usd: number }[];
}

describe.each(CASES)("%s", (_name, payload, createDrawers) => {
  const forgiven = Number(payload.customer_waived_amount ?? 0);

  it("books a forgiven part as ONE WAIVED_SHORTFALL sibling (FR-012), none otherwise", () => {
    create(payload);
    expect(waivedSiblings()).toEqual(
      forgiven > 0 ? [{ status: "ACTIVE", profit_usd: -forgiven }] : [],
    );
  });

  it("creates the expected drawer deltas (sanity)", () => {
    const before = snapshotLedgers(db);
    create(payload);
    const debt = (payload.customerPayments as Line[]).find(
      (l) => l.method === "CUSTOMER_ACCOUNT",
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: createDrawers,
      ...(debt ? { debt: { [`${CLIENT_ID}|USD`]: debt.amount } } : {}),
    });
  });

  it("void nets every ledger and the profit to 0", () => {
    const before = snapshotLedgers(db);
    const profitBefore = profit();
    const txnId = create(payload);
    getTransactionRepository().voidTransaction(txnId, 1);
    expectPostings(before, snapshotLedgers(db), {});
    // The parent's void owns the sibling (rule 20).
    expect(waivedSiblings()).toHaveLength(forgiven > 0 ? 1 : 0);
    expect(waivedSiblings().every((r) => r.status === "VOIDED")).toBe(true);
    expect(openDebt()).toBe(0);
    expect(profit()).toEqual(profitBefore);
  });

  it("refund nets every ledger and the profit to 0", () => {
    const before = snapshotLedgers(db);
    const profitBefore = profit();
    const txnId = create(payload);
    getTransactionRepository().refundTransaction(txnId, 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(waivedSiblings()).toHaveLength(forgiven > 0 ? 1 : 0);
    expect(waivedSiblings().every((r) => r.status === "VOIDED")).toBe(true);
    expect(openDebt()).toBe(0);
    expect(profit()).toEqual(profitBefore);
  });
});
