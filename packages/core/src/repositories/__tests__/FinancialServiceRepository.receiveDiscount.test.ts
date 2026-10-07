/**
 * LIRA-269 — a discount on a wallet RECEIVE payout sheet (Binance cash-out,
 * OMT App / Whish App RECEIVE).
 *
 * Meaning (evidence in walletReceivePayout.ts): the discount comes off the
 * SHOP'S FEE, capped at the fee. The wallet inflow is a fact, so the customer
 * receives MORE by the discount (or, when the customer pays the fee
 * separately, less fee is collected). The page sends `commission = fee −
 * discount`; the repository pays out `walletReceiveAmounts(...)` of that —
 * the SAME helper the sheet's target is computed from (rule 14/22).
 *
 * Covered:
 *   - Binance USD and Whish App LBP: a discounted exact payout is accepted,
 *     posts the wallet inflow and the raised payout, stamps fee − discount
 *   - kept change on top of a discount still works (stamp = fee − d + kept)
 *   - customer-pays-the-fee-separately: payout unchanged, fee legs = fee − d
 *   - the pre-fix sheet target (payout − discount, full fee) is refused —
 *     the reported bug's server side
 *   - void nets every ledger and the profit stamp to 0, per currency (rule 20)
 *
 * Rule 17 note: the repository's payout rule (`wallet − commission`) was
 * already right before LIRA-269; what was wrong was the sheet. These tests
 * failed first only because the shared helper did not exist yet — they are
 * NOT proven failing-first against the server behaviour itself.
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
import { walletReceiveAmounts } from "../../utils/walletReceivePayout";
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
    ["Whish_App", "LBP", 900_000_000],
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

/**
 * Create, check the stamp, the stored fee and the drawer deltas, void, check
 * everything nets to 0. Note: a Binance row is denominated in USDT, so its
 * fee is not in the USD/LBP `transactions` profit stamp (only kept change
 * is) — pre-existing, outside LIRA-269; its fee is asserted on
 * `financial_services.commission` instead.
 */
function expectAccepted(args: {
  payload: Payload;
  profitUsd: number;
  profitLbp: number;
  /** financial_services.commission — the fee the shop keeps. */
  fsCommission: number;
  drawers: Record<string, number>;
}): void {
  const before = snapshotLedgers(db);
  const p0 = profitSum();
  const fsId = create(args.payload);
  const t = txnOf(fsId);
  const fs = db
    .prepare(`SELECT commission FROM financial_services WHERE id = ?`)
    .get(fsId) as { commission: number };
  expect(fs.commission).toBe(args.fsCommission);
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

// Binance cash-out: 100 USDT + $2 fee on top → 102 USDT arrives; $0.50 off.
const BINANCE = walletReceiveAmounts({
  walletInflow: 102,
  fee: 2,
  discount: 0.5,
});
const binanceBase: Payload = {
  provider: "BINANCE",
  serviceType: "RECEIVE",
  amount: 102,
  currency: "USDT",
  commission: BINANCE.commission,
  tender_exchange_rate: RATE,
};

// Whish App RECEIVE, LBP: 2,000,000 + 20,000 fee on top; 10,000 off.
const WHISH = walletReceiveAmounts({
  walletInflow: 2_020_000,
  fee: 20_000,
  discount: 10_000,
});
const whishBase: Payload = {
  provider: "WHISH_APP",
  serviceType: "RECEIVE",
  amount: 2_020_000,
  currency: "LBP",
  commission: WHISH.commission,
  whishFee: 20_000,
  tender_exchange_rate: RATE,
};

describe("wallet RECEIVE with a discount — the customer receives more, the shop keeps fee − discount", () => {
  it("Binance cash-out: pays out $100.50 exactly, keeps a $1.50 fee, void nets to 0", () => {
    expect(BINANCE.payout).toBe(100.5);
    expectAccepted({
      payload: {
        ...binanceBase,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: BINANCE.payout },
        ],
      },
      profitUsd: 0,
      profitLbp: 0,
      fsCommission: 1.5,
      drawers: { "Binance|USDT": 102, "General|USD": -100.5 },
    });
  });

  it("Whish App RECEIVE (LBP): pays out 2,010,000 exactly, stamps 10,000 LBP, void nets to 0", () => {
    expect(WHISH.payout).toBe(2_010_000);
    expectAccepted({
      payload: {
        ...whishBase,
        payments: [
          { method: "CASH", currencyCode: "LBP", amount: WHISH.payout },
        ],
      },
      profitUsd: 0,
      profitLbp: 10_000,
      fsCommission: 10_000,
      drawers: { "Whish_App|LBP": 2_020_000, "General|LBP": -2_010_000 },
    });
  });

  it("Binance: kept change on top of a discount — hands out $100, keeps $0.50 (stamp +$0.50, fee $1.50)", () => {
    expectAccepted({
      payload: {
        ...binanceBase,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
        kept_change_usd: 0.5,
      },
      profitUsd: 0.5,
      profitLbp: 0,
      fsCommission: 1.5,
      drawers: { "Binance|USDT": 102, "General|USD": -100 },
    });
  });

  it("Whish App (LBP): kept change on top of a discount — hands out 2,000,000, keeps 10,000", () => {
    expectAccepted({
      payload: {
        ...whishBase,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 2_000_000 }],
        kept_change_lbp: 10_000,
      },
      profitUsd: 0,
      profitLbp: 20_000,
      fsCommission: 10_000,
      drawers: { "Whish_App|LBP": 2_020_000, "General|LBP": -2_000_000 },
    });
  });

  it("Binance, customer pays the fee separately: payout stays $100, $1.50 fee collected", () => {
    const sep = walletReceiveAmounts({
      walletInflow: 100,
      fee: 2,
      discount: 0.5,
      feeCollectedSeparately: true,
    });
    expect(sep.payout).toBe(100);
    expect(sep.feeToCollect).toBe(1.5);
    expectAccepted({
      payload: {
        ...binanceBase,
        amount: 100,
        commission: sep.commission,
        payments: [{ method: "CASH", currencyCode: "USD", amount: sep.payout }],
        feePayments: [
          { method: "CASH", currencyCode: "USD", amount: sep.feeToCollect },
        ],
      },
      profitUsd: 0,
      profitLbp: 0,
      fsCommission: 1.5,
      // $100 out for the payout, $1.50 in for the fee.
      drawers: { "Binance|USDT": 100, "General|USD": -98.5 },
    });
  });

  it("the pre-fix sheet (payout − discount with the full fee booked) is refused and writes nothing", () => {
    expectRefused(
      {
        ...binanceBase,
        commission: 2,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 99.5 }],
      },
      /reconcil|does not match|mismatch/i,
    );
  });
});
