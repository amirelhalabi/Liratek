/**
 * LIRA-319 US4 (T045) + US5 financial-send part (T053) — an extra charge on
 * a financial-service send: OMT/Whish system SEND, a Katsh/catalog cart
 * carrier, a Binance SEND and an OMT/Whish App transfer.
 *
 * The rule (research R2, data-model.md): the extra is its own field. It
 * raises what the customer's legs must cover and the row's `amount_*`, lands
 * in the drawer of the payment method used (FR-004), and is stamped on
 * `extra_usd/lbp`. It never changes the provider fee, the commission, the
 * profit stamp, the supplier ledger or the partner ledger. `checkoutTotal`
 * stays the PRE-extra total — the repository adds the extra itself.
 *
 * Each case runs as twins: the same payload with and without the extra, so
 * the assertion is "differs by exactly the extra, and only where it should",
 * then voids both and checks every ledger nets to 0 (rule 20).
 *
 * Real production schema (create_db.sql + migrations, shop_base_system =
 * OMT); nothing is mocked. Field names come from `createFinancialServiceSchema`
 * — fixtures are typed as its input and parsed through it (rule 24).
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
import { ProfitRepository } from "../ProfitRepository";
import {
  createFinancialServiceSchema,
  type CreateFinancialServicePayload,
} from "../../validators/financial";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
  type LedgerSnapshot,
} from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL = fs.readFileSync(
  path.join(REPO_ROOT, "electron-app/create_db.sql"),
  "utf-8",
);
const RATE = 89_500;

let db: Database.Database;
let repo: FinancialServiceRepository;

function resetAll(): void {
  resetFinancialServiceRepository();
  resetTransactionRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetDebtRepository();
  resetDebtService();
  resetClientRepository();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  initFixedTenantContext(1);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["General", "USD", 10_000],
    ["General", "LBP", 900_000_000],
    ["OMT_System", "USD", 10_000],
    ["Binance", "USDT", 10_000],
    ["Whish_App", "USD", 10_000],
    ["Katsh", "LBP", 900_000_000],
  ] as const)
    seed.run(d, c, b);
  repo = new FinancialServiceRepository();
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

/** Parse through the shared schema (both transports validate with it). */
function parse(p: CreateFinancialServicePayload): CreateFinancialServiceData {
  return createFinancialServiceSchema.parse(p) as CreateFinancialServiceData;
}

function create(p: CreateFinancialServicePayload): number {
  return repo.createTransaction({ exchangeRate: RATE, ...parse(p) }).id;
}

interface TxnRow {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  extra_usd: number;
  extra_lbp: number;
}

function txnOf(fsId: number): TxnRow {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, extra_usd, extra_lbp
         FROM transactions
        WHERE source_table = 'financial_services' AND source_id = ? AND reverses_id IS NULL`,
    )
    .get(fsId) as TxnRow;
}

function fsRow(fsId: number): {
  amount: number;
  commission: number;
  omt_fee: number | null;
  whish_fee: number | null;
  price: number;
} {
  return db
    .prepare(
      `SELECT amount, commission, omt_fee, whish_fee, price FROM financial_services WHERE id = ?`,
    )
    .get(fsId) as {
    amount: number;
    commission: number;
    omt_fee: number | null;
    whish_fee: number | null;
    price: number;
  };
}

function countTxns(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }
  ).n;
}

function addClient(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`,
      )
      .run(`Client ${Math.random()}`, `03${Math.floor(Math.random() * 1e6)}`)
      .lastInsertRowid,
  );
}

function addPartner(): number {
  return Number(
    db
      .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, ?)`)
      .run(`Partner ${Math.random()}`).lastInsertRowid,
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function round(map: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    const r = r2(v);
    if (r !== 0) out[k] = r;
  }
  return out;
}

interface RunResult {
  fsId: number;
  txn: TxnRow;
  deltas: ReturnType<typeof ledgerDeltas>;
}

/** Create, record the deltas, void, check every ledger is back (rule 20). */
function runAndVoid(p: CreateFinancialServicePayload): RunResult {
  const before: LedgerSnapshot = snapshotLedgers(db);
  const fsId = create(p);
  const txn = txnOf(fsId);
  const deltas = ledgerDeltas(before, snapshotLedgers(db));
  getTransactionRepository().voidTransaction(txn.id, 1);
  expectPostings(before, snapshotLedgers(db), {});
  return { fsId, txn, deltas };
}

/**
 * The twin check: `withExtra` differs from `plain` by exactly `extra` in
 * `extraDrawerKey` (or in the debt ledger when `onAccount`), and in nothing
 * else — same supplier and partner deltas, same fee / commission / profit.
 */
function expectTwin(args: {
  plain: CreateFinancialServicePayload;
  withExtra: CreateFinancialServicePayload;
  extra: { usd: number; lbp: number };
  extraDrawerKey?: string;
  debtKey?: string;
}): RunResult {
  const a = runAndVoid(args.plain);
  const b = runAndVoid(args.withExtra);

  // Stamped on its own columns; plain twin carries none.
  expect({ usd: a.txn.extra_usd, lbp: a.txn.extra_lbp }).toEqual({
    usd: 0,
    lbp: 0,
  });
  expect({ usd: b.txn.extra_usd, lbp: b.txn.extra_lbp }).toEqual(args.extra);
  // Amount includes the extra; profit never does.
  expect(r2(b.txn.amount_usd - a.txn.amount_usd)).toBe(args.extra.usd);
  expect(Math.round(b.txn.amount_lbp - a.txn.amount_lbp)).toBe(args.extra.lbp);
  expect(r2(b.txn.profit_usd)).toBe(r2(a.txn.profit_usd));
  expect(Math.round(b.txn.profit_lbp)).toBe(Math.round(a.txn.profit_lbp));
  // Provider fee, commission, principal and price untouched.
  expect(fsRow(b.fsId)).toEqual(fsRow(a.fsId));
  // Supplier and partner ledgers identical (the extra is shop money).
  expect(round(b.deltas.supplier)).toEqual(round(a.deltas.supplier));
  expect(round(b.deltas.partner)).toEqual(round(a.deltas.partner));

  const extraAmt = args.extra.usd > 0 ? args.extra.usd : args.extra.lbp;
  if (args.extraDrawerKey) {
    const expectedDrawers = { ...round(a.deltas.drawers) };
    expectedDrawers[args.extraDrawerKey] = r2(
      (expectedDrawers[args.extraDrawerKey] ?? 0) + extraAmt,
    );
    expect(round(b.deltas.drawers)).toEqual(round(expectedDrawers));
    expect(round(b.deltas.debt)).toEqual(round(a.deltas.debt));
  }
  if (args.debtKey) {
    const expectedDebt = { ...round(a.deltas.debt) };
    expectedDebt[args.debtKey] = r2(
      (expectedDebt[args.debtKey] ?? 0) + extraAmt,
    );
    expect(round(b.deltas.debt)).toEqual(round(expectedDebt));
    expect(round(b.deltas.drawers)).toEqual(round(a.deltas.drawers));
  }
  return b;
}

function expectRefused(p: CreateFinancialServicePayload, message: RegExp): void {
  const before = snapshotLedgers(db);
  const n = countTxns();
  expect(() =>
    repo.createTransaction({
      exchangeRate: RATE,
      ...(p as CreateFinancialServiceData),
    }),
  ).toThrow(message);
  expect(countTxns()).toBe(n);
  expectPostings(before, snapshotLedgers(db), {});
}

// OMT system SEND (OMT is the base system): $100 principal + $1 fee.
const omtSend: CreateFinancialServicePayload = {
  provider: "OMT",
  serviceType: "SEND",
  amount: 100,
  currency: "USD",
  omtFee: 1,
  tender_exchange_rate: RATE,
};

describe("OMT system SEND with an extra", () => {
  it("split legs: $100 + $1 fee + $1 extra → PCD +102, extra 1, fee/commission/supplier unchanged", () => {
    const b = expectTwin({
      plain: {
        ...omtSend,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
      },
      withExtra: {
        ...omtSend,
        extra_usd: 1,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 102 }],
      },
      extra: { usd: 1, lbp: 0 },
      extraDrawerKey: "OMT_System|USD",
    });
    expect(r2(b.txn.amount_usd)).toBe(102);
    expect(r2(b.deltas.drawers["OMT_System|USD"] ?? 0)).toBe(102);
  });

  it("single payment (paidByMethod CASH, no legs): the drawer takes the extra too", () => {
    expectTwin({
      plain: { ...omtSend, paidByMethod: "CASH" },
      withExtra: { ...omtSend, paidByMethod: "CASH", extra_usd: 1 },
      extra: { usd: 1, lbp: 0 },
      extraDrawerKey: "OMT_System|USD",
    });
  });

  it("T053: fully on the customer's account (single payment) → debt includes the extra", () => {
    const clientId = addClient();
    const phone = (
      db
        .prepare(`SELECT phone_number FROM clients WHERE id = ?`)
        .get(clientId) as { phone_number: string }
    ).phone_number;
    const base: CreateFinancialServicePayload = {
      ...omtSend,
      paidByMethod: "CUSTOMER_ACCOUNT",
      clientId,
      clientName: "Account client",
      phoneNumber: phone,
    };
    const b = expectTwin({
      plain: base,
      withExtra: { ...base, extra_usd: 1 },
      extra: { usd: 1, lbp: 0 },
      debtKey: `${clientId}|USD`,
    });
    expect(r2(b.deltas.debt[`${clientId}|USD`] ?? 0)).toBe(102);
  });

  it("T053: an account leg → debt includes the extra", () => {
    const clientId = addClient();
    const base: CreateFinancialServicePayload = {
      ...omtSend,
      clientId,
      clientName: "Account client",
    };
    expectTwin({
      plain: {
        ...base,
        payments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 101 },
        ],
      },
      withExtra: {
        ...base,
        extra_usd: 1,
        payments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 102 },
        ],
      },
      extra: { usd: 1, lbp: 0 },
      debtKey: `${clientId}|USD`,
    });
  });

  it("legs that do not cover the extra are refused", () => {
    expectRefused(
      {
        ...omtSend,
        extra_usd: 1,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
      },
      /reconcile|expected/i,
    );
  });
});

// Katsh catalog cart carrier: 500,000 LBP price, 400,000 LBP cost.
const katshCarrier: CreateFinancialServicePayload = {
  provider: "Katsh",
  serviceType: "SEND",
  amount: 500_000,
  cost: 400_000,
  currency: "LBP",
  commission: 100_000,
  paidByMethod: "CASH",
  tender_exchange_rate: RATE,
  checkoutTotal: { usd: 0, lbp: 500_000 },
};

describe("Katsh cart carrier with an extra", () => {
  it("legs 550,000 LBP vs checkoutTotal 500,000 + extra 50,000 → General +550,000, margin unchanged", () => {
    const b = expectTwin({
      plain: {
        ...katshCarrier,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 500_000 }],
      },
      withExtra: {
        ...katshCarrier,
        extra_lbp: 50_000,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 550_000 }],
      },
      extra: { usd: 0, lbp: 50_000 },
      extraDrawerKey: "General|LBP",
    });
    expect(Math.round(b.txn.amount_lbp)).toBe(550_000);
    expect(Math.round(b.txn.profit_lbp)).toBe(100_000);
  });

  it("a single-unit catalog sale with no legs: drawer takes price + extra", () => {
    const single: CreateFinancialServicePayload = {
      ...katshCarrier,
      checkoutTotal: undefined,
    };
    expectTwin({
      plain: single,
      withExtra: { ...single, extra_lbp: 50_000 },
      extra: { usd: 0, lbp: 50_000 },
      extraDrawerKey: "General|LBP",
    });
  });

  it("T053: a catalog sale fully on account (no legs) → debt includes the extra", () => {
    const clientId = addClient();
    const single: CreateFinancialServicePayload = {
      ...katshCarrier,
      checkoutTotal: undefined,
      paidByMethod: "CUSTOMER_ACCOUNT",
      clientId,
    };
    expectTwin({
      plain: single,
      withExtra: { ...single, extra_lbp: 50_000 },
      extra: { usd: 0, lbp: 50_000 },
      debtKey: `${clientId}|LBP`,
    });
  });

  it("a cart sibling (deferPayment) carrying an extra is refused — the carrier takes it", () => {
    expectRefused(
      {
        provider: "Katsh",
        serviceType: "BILL",
        amount: 200_000,
        cost: 200_000,
        price: 200_000,
        currency: "LBP",
        commission: 0,
        deferPayment: true,
        extra_lbp: 10_000,
      },
      /session checkout/i,
    );
  });
});

describe("wallet SEND with an extra", () => {
  it("Binance: 100 USDT + $2 fee, $1 extra, checkoutTotal $102 → General +103, Binance −100 USDT", () => {
    const base: CreateFinancialServicePayload = {
      provider: "BINANCE",
      serviceType: "SEND",
      amount: 100,
      currency: "USDT",
      commission: 2,
      tender_exchange_rate: RATE,
      checkoutTotal: { usd: 102, lbp: 0 },
    };
    const b = expectTwin({
      plain: {
        ...base,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 102 }],
      },
      withExtra: {
        ...base,
        extra_usd: 1,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 103 }],
      },
      extra: { usd: 1, lbp: 0 },
      extraDrawerKey: "General|USD",
    });
    expect(r2(b.deltas.drawers["Binance|USDT"] ?? 0)).toBe(-100);
  });

  it("Whish App transfer: $100 + $2 fee, $1 extra → General +103, Whish_App −100", () => {
    const base: CreateFinancialServicePayload = {
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 2,
      whishFee: 2,
      tender_exchange_rate: RATE,
      checkoutTotal: { usd: 102, lbp: 0 },
    };
    expectTwin({
      plain: {
        ...base,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 102 }],
      },
      withExtra: {
        ...base,
        extra_usd: 1,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 103 }],
      },
      extra: { usd: 1, lbp: 0 },
      extraDrawerKey: "General|USD",
    });
  });

  it("Whish App single payment (no legs): the drawer takes the extra", () => {
    const base: CreateFinancialServicePayload = {
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 2,
      whishFee: 2,
      paidByMethod: "CASH",
    };
    expectTwin({
      plain: base,
      withExtra: { ...base, extra_usd: 1 },
      extra: { usd: 1, lbp: 0 },
      extraDrawerKey: "General|USD",
    });
  });
});

describe("THROUGH-partner SEND (secondary system) with an extra", () => {
  // Not proven failing-first: added after the fix to pin the partner-ledger
  // claim on the one partner mode the Services page allows an extra on.
  it("WHISH SEND through a partner: drawer +extra, partner ledger identical", () => {
    const partnerId = addPartner();
    const base: CreateFinancialServicePayload = {
      provider: "WHISH",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      whishFee: 1,
      partnerId,
      partnerMode: "THROUGH",
      tender_exchange_rate: RATE,
    };
    const b = expectTwin({
      plain: {
        ...base,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
      },
      withExtra: {
        ...base,
        extra_usd: 1,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 102 }],
      },
      extra: { usd: 1, lbp: 0 },
      extraDrawerKey: "General|USD",
    });
    expect(Object.keys(round(b.deltas.partner)).length).toBeGreaterThan(0);
  });
});

describe("refusals — nothing is written", () => {
  it("no extra on a RECEIVE payout", () => {
    expectRefused(
      {
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        extra_usd: 1,
      },
      /payout/i,
    );
  });

  it("no extra on a for-partner transaction", () => {
    expectRefused(
      {
        ...omtSend,
        partnerId: addPartner(),
        partnerMode: "FOR",
        extra_usd: 1,
      },
      /for-partner/i,
    );
  });

  it("the extra can't be more than what the customer owes before it", () => {
    expectRefused(
      {
        ...omtSend,
        extra_usd: 102,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 203 }],
      },
      /can't be more than the sale itself/i,
    );
  });

  it("the extra is in the checkout currency only", () => {
    expectRefused(
      {
        ...omtSend,
        extra_lbp: 89_500,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 101 },
          { method: "CASH", currencyCode: "LBP", amount: 89_500 },
        ],
      },
      /currency/i,
    );
  });

  it("a negative extra is refused", () => {
    expectRefused(
      {
        ...omtSend,
        extra_usd: -1,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      },
      /negative/i,
    );
  });
});

describe("createFinancialServiceSchema — the same refusals at the edge (both transports)", () => {
  const ok = (p: CreateFinancialServicePayload) =>
    createFinancialServiceSchema.safeParse(p).success;

  it("accepts an extra on a SEND and on a BILL", () => {
    expect(ok({ ...omtSend, extra_usd: 1 })).toBe(true);
    expect(
      ok({
        provider: "Katsh",
        serviceType: "BILL",
        amount: 200_000,
        cost: 200_000,
        price: 200_000,
        currency: "LBP",
        extra_lbp: 10_000,
      }),
    ).toBe(true);
  });

  it("refuses an extra on a RECEIVE, a for-partner and a deferred unit", () => {
    expect(
      ok({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        extra_usd: 1,
      }),
    ).toBe(false);
    expect(
      ok({ ...omtSend, partnerId: 1, partnerMode: "FOR", extra_usd: 1 }),
    ).toBe(false);
    expect(ok({ ...omtSend, deferPayment: true, extra_usd: 1 })).toBe(false);
  });

  it("an extra of 0 is accepted everywhere (it is no extra)", () => {
    expect(
      ok({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        extra_usd: 0,
      }),
    ).toBe(true);
  });
});

describe("Profits — the send's extra lands under Extra charges (SC-004)", () => {
  it("getExtraChargeTotals counts the OMT SEND's $1 extra; a void takes it back out", () => {
    const profits = new ProfitRepository();
    const fsId = create({
      ...omtSend,
      extra_usd: 1,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 102 }],
    });
    const range = ["2000-01-01 00:00:00", "2999-12-31 23:59:59"] as const;
    const live = profits.getExtraChargeTotals(...range);
    expect({ usd: r2(live.profit_usd), count: live.count }).toEqual({
      usd: 1,
      count: 1,
    });
    getTransactionRepository().voidTransaction(txnOf(fsId).id, 1);
    expect(r2(profits.getExtraChargeTotals(...range).profit_usd)).toBe(0);
  });
});
