/**
 * LIRA-269 follow-up — a discount on a wallet SEND (Binance SEND, OMT App /
 * Whish App SEND).
 *
 * Meaning (owner rule, MTC/Alfa decision 2026-10-02, FEATURE_GUIDE §10
 * "Discounts reduce profit"): the discount comes off the SHOP'S FEE, capped
 * at the fee. The customer pays `amount + (fee − discount)`, the shop books
 * `commission = fee − discount`, and the wallet still sends the full
 * `amount` — the wallet side is a fact the discount cannot change.
 *
 * One helper (`walletSendAmounts`, utils/walletReceivePayout.ts) computes
 * `customerPays` for the sheet's `checkoutTotal` AND the repository's check
 * that a caller's `checkoutTotal` agrees with `amount + commission` (rule
 * 14/22). The two bugs this guards, both ACCEPTED before the fix:
 *   - OMT/Whish App: the page sent the undiscounted `checkoutTotal` with a
 *     discounted `commission`. With legs at the undiscounted total, the
 *     drawer took in `fee` while the profit stamp said `fee − discount`.
 *   - Binance: the page booked the full fee while the cash taken in was
 *     short by the discount.
 * Both are now refused before any row is written. No `checkoutTotal` at all
 * stays unchecked (the lira-108 raw-caller contract, legReconciliation test).
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
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetClientRepository } from "../ClientRepository";
import type { CreateFinancialServiceInput } from "../../validators/financial";
import { walletSendAmounts } from "../../utils/walletReceivePayout";
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

type Payload = Partial<CreateFinancialServiceInput>;

let db: Database.Database;
let repo: FinancialServiceRepository;
const RATE = 89_500;

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
    ["Binance", "USDT", 10_000],
    ["Whish_App", "USD", 10_000],
    ["OMT_App", "LBP", 900_000_000],
  ] as const)
    seed.run(d, c, b);
  repo = new FinancialServiceRepository();
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

function create(p: Payload): number {
  return repo.createTransaction({
    exchangeRate: RATE,
    ...p,
  } as Parameters<FinancialServiceRepository["createTransaction"]>[0]).id;
}

function txnOf(fsId: number): {
  id: number;
  profit_usd: number;
  profit_lbp: number;
} {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp FROM transactions
        WHERE source_table = 'financial_services' AND source_id = ? AND reverses_id IS NULL`,
    )
    .get(fsId) as { id: number; profit_usd: number; profit_lbp: number };
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

function countTxns(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }
  ).n;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Create, check the stamp / stored fee / drawer deltas, void, check every
 *  ledger and the profit stamp net to 0 (rule 20). A Binance row is
 *  denominated in USDT, so its fee is not in the USD/LBP profit stamp — it
 *  is asserted on `financial_services.commission` instead. */
function expectAccepted(args: {
  payload: Payload;
  profitUsd: number;
  profitLbp: number;
  fsCommission: number;
  drawers: Record<string, number>;
}): void {
  const before = snapshotLedgers(db);
  const p0 = profitSum();
  const fsId = create(args.payload);
  const t = txnOf(fsId);
  const row = db
    .prepare(`SELECT commission FROM financial_services WHERE id = ?`)
    .get(fsId) as { commission: number };
  expect(row.commission).toBe(args.fsCommission);
  expect(r2(t.profit_usd)).toBe(args.profitUsd);
  expect(Math.round(t.profit_lbp)).toBe(args.profitLbp);
  const deltas = ledgerDeltas(before, snapshotLedgers(db));
  for (const [key, delta] of Object.entries(args.drawers)) {
    expect(r2(deltas.drawers[key] ?? 0)).toBe(delta);
  }

  getTransactionRepository().voidTransaction(t.id, 1);
  expectPostings(before, snapshotLedgers(db), {});
  expect(profitSum()).toEqual(p0);
}

function expectRefused(p: Payload, message: RegExp): void {
  const before = snapshotLedgers(db);
  const n = countTxns();
  expect(() => create(p)).toThrow(message);
  expect(countTxns()).toBe(n);
  expectPostings(before, snapshotLedgers(db), {});
}

// Whish App SEND, USD: $100 + $2 fee; $0.50 off.
const APP_USD = walletSendAmounts({ walletOutflow: 100, fee: 2, discount: 0.5 });
const appUsdBase: Payload = {
  provider: "WHISH_APP",
  serviceType: "SEND",
  amount: 100,
  currency: "USD",
  commission: APP_USD.commission,
  whishFee: 2,
  tender_exchange_rate: RATE,
  checkoutTotal: { usd: APP_USD.customerPays, lbp: 0 },
};

// OMT App SEND, LBP: 2,000,000 + 50,000 fee; 20,000 off.
const APP_LBP = walletSendAmounts({
  walletOutflow: 2_000_000,
  fee: 50_000,
  discount: 20_000,
});
const appLbpBase: Payload = {
  provider: "OMT_APP",
  serviceType: "SEND",
  amount: 2_000_000,
  currency: "LBP",
  commission: APP_LBP.commission,
  omtFee: 50_000,
  tender_exchange_rate: RATE,
  checkoutTotal: { usd: 0, lbp: APP_LBP.customerPays },
};

// Binance SEND: 100 USDT + $2 fee; $0.50 off (cash side in USD).
const BIN = walletSendAmounts({ walletOutflow: 100, fee: 2, discount: 0.5 });
const binanceBase: Payload = {
  provider: "BINANCE",
  serviceType: "SEND",
  amount: 100,
  currency: "USDT",
  commission: BIN.commission,
  tender_exchange_rate: RATE,
  checkoutTotal: { usd: BIN.customerPays, lbp: 0 },
};

describe("wallet SEND with a discount — the customer pays less, the shop keeps fee − discount", () => {
  it("helper sanity: $100 + $2 fee, $0.50 off → customer pays $101.50, fee booked $1.50", () => {
    expect(APP_USD.customerPays).toBe(101.5);
    expect(APP_USD.commission).toBe(1.5);
    expect(APP_LBP.customerPays).toBe(2_030_000);
  });

  it("Whish App (USD): $101.50 taken in, $100 sent, profit $1.50; void nets to 0", () => {
    expectAccepted({
      payload: {
        ...appUsdBase,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: APP_USD.customerPays },
        ],
      },
      profitUsd: 1.5,
      profitLbp: 0,
      fsCommission: 1.5,
      drawers: { "Whish_App|USD": -100, "General|USD": 101.5 },
    });
  });

  it("OMT App (LBP): 2,030,000 taken in, 2,000,000 sent, profit 30,000 LBP; void nets to 0", () => {
    expectAccepted({
      payload: {
        ...appLbpBase,
        payments: [
          { method: "CASH", currencyCode: "LBP", amount: APP_LBP.customerPays },
        ],
      },
      profitUsd: 0,
      profitLbp: 30_000,
      fsCommission: 30_000,
      drawers: { "OMT_App|LBP": -2_000_000, "General|LBP": 2_030_000 },
    });
  });

  it("Binance: $101.50 taken in, 100 USDT sent, fee booked $1.50; void nets to 0", () => {
    expectAccepted({
      payload: {
        ...binanceBase,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: BIN.customerPays },
        ],
      },
      profitUsd: 0,
      profitLbp: 0,
      fsCommission: 1.5,
      drawers: { "Binance|USDT": -100, "General|USD": 101.5 },
    });
  });

  it("kept change on top of a discount: hands $105, $3 back, keeps $0.50 → profit $2.00", () => {
    expectAccepted({
      payload: {
        ...appUsdBase,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 105 },
          { method: "CASH", currencyCode: "USD", amount: 3, direction: "OUT" },
        ],
        kept_change_usd: 0.5,
      },
      profitUsd: 2,
      profitLbp: 0,
      fsCommission: 1.5,
      drawers: { "Whish_App|USD": -100, "General|USD": 102 },
    });
  });

  it("App: the pre-fix payload (undiscounted checkoutTotal + legs, discounted fee) is refused and writes nothing", () => {
    expectRefused(
      {
        ...appUsdBase,
        checkoutTotal: { usd: 102, lbp: 0 },
        payments: [{ method: "CASH", currencyCode: "USD", amount: 102 }],
      },
      /does not match|do not reconcile/i,
    );
  });

  it("Binance: the pre-fix payload (full fee booked, cash short by the discount) is refused and writes nothing", () => {
    expectRefused(
      {
        ...binanceBase,
        commission: 2,
        checkoutTotal: { usd: 101.5, lbp: 0 },
        payments: [{ method: "CASH", currencyCode: "USD", amount: 101.5 }],
      },
      /does not match|do not reconcile/i,
    );
  });
});
