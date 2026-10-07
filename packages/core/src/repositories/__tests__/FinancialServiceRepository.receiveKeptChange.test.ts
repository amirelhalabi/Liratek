/**
 * Payout kept change on financial-service RECEIVE flows (owner decisions
 * 2026-10-07, docs/FEATURE_GUIDE.md §4.1 "Kept change").
 *
 * A RECEIVE is a payout: the shop hands the customer money. Kept change on a
 * payout = the shop hands out a round figure a little SHORT of what it owes
 * (under PAYOUT_KEEP_CHANGE_MAX, in the payout currency) and the leftover is
 * shop profit inside the transaction's own profit stamp, so the generic void
 * negates it. A payout never carries change (OUT) legs.
 *
 * Covered here (failing-first, rule 17):
 *   - OMT/WHISH system RECEIVE, CASH cashout (Services page)        → accepted
 *   - wallet RECEIVE: Binance cash-out, OMT App / Whish App RECEIVE → accepted
 *   - phantom kept on an exact payout                                → refused
 *   - over the shortfall / at the cap / wrong currency              → refused
 *   - FOR-partner, session basket (deferPayment), CUSTOMER_ACCOUNT
 *     cashout, wallet cashout of a system RECEIVE, other providers   → refused
 *   - an OUT (change) leg on a RECEIVE                               → refused
 *   - void nets every ledger AND the profit stamp to 0, per currency (rule 20)
 *
 * Real schema (`electron-app/create_db.sql` + migrations), fresh per test.
 * Field names come from the core schema (`CreateFinancialServiceInput`,
 * rule 24).
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

type Payload = Partial<CreateFinancialServiceInput> & {
  deferPayment?: boolean;
};

let db: Database.Database;
let repo: FinancialServiceRepository;
const CLIENT_ID = 1;
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
    ["Whish_System", "USD", 10_000],
    ["Whish_System", "LBP", 900_000_000],
    ["Binance", "USDT", 10_000],
    ["OMT_App", "USD", 10_000],
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

/** Σ profit over ACTIVE transactions, per currency — the stamp side of rule 20. */
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

function seedPartner(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO partners (tenant_id, name, is_active) VALUES (1, 'Kept Partner', 1)`,
      )
      .run().lastInsertRowid,
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Create the kept payout, check: the stamp is the control's stamp + kept,
 * the drawers moved by the legs actually handed out (not the full amount
 * owed), then void and check every ledger and the profit sum net to 0.
 */
function expectKeptAccepted(args: {
  control: Payload;
  kept: Payload;
  keptUsd: number;
  keptLbp: number;
  /** "drawer|currency" → expected delta of the PAID-OUT drawer. */
  paidDrawer: string;
  paidDelta: number;
}): void {
  // Control (exact payout, no kept) in its own snapshot window.
  const c0 = snapshotLedgers(db);
  const controlId = create(args.control);
  const controlTxn = txnOf(controlId);
  getTransactionRepository().voidTransaction(controlTxn.id, 1);
  expectPostings(c0, snapshotLedgers(db), {});

  const before = snapshotLedgers(db);
  const p0 = profitSum();
  const fsId = create(args.kept);
  const t = txnOf(fsId);
  expect(r2(t.profit_usd - controlTxn.profit_usd)).toBe(args.keptUsd);
  expect(Math.round(t.profit_lbp - controlTxn.profit_lbp)).toBe(args.keptLbp);
  const deltas = ledgerDeltas(before, snapshotLedgers(db));
  expect(r2(deltas.drawers[args.paidDrawer] ?? 0)).toBe(args.paidDelta);

  // Rule 20: void nets drawers, supplier, partner, debt AND profit to 0.
  getTransactionRepository().voidTransaction(t.id, 1);
  expectPostings(before, snapshotLedgers(db), {});
  expect(profitSum()).toEqual(p0);
}

function expectRefused(p: Payload, message: RegExp): void {
  const before = snapshotLedgers(db);
  const n = countTxns();
  expect(() => create(p)).toThrow(message);
  // Rolled back: nothing written, nothing moved.
  expect(countTxns()).toBe(n);
  expectPostings(before, snapshotLedgers(db), {});
}

// ─── accepted ───────────────────────────────────────────────────────────────

describe("RECEIVE payout kept change — accepted, booked as profit, void nets to 0", () => {
  it("OMT system RECEIVE, USD cash: owed $100.73, hands out $100, keeps $0.73", () => {
    const base: Payload = {
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100.73,
      currency: "USD",
      omtServiceType: "INTRA",
      cashoutMethod: "CASH",
    };
    expectKeptAccepted({
      control: {
        ...base,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 100.73 }],
      },
      kept: {
        ...base,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
        kept_change_usd: 0.73,
      },
      keptUsd: 0.73,
      keptLbp: 0,
      paidDrawer: "OMT_System|USD",
      paidDelta: -100,
    });
  });

  it("OMT system RECEIVE, LBP cash: owed 5,050,000, hands out 5,000,000, keeps 50,000", () => {
    const base: Payload = {
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 5_050_000,
      currency: "LBP",
      omtServiceType: "INTRA",
      cashoutMethod: "CASH",
    };
    expectKeptAccepted({
      control: {
        ...base,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 5_050_000 }],
      },
      kept: {
        ...base,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 5_000_000 }],
        kept_change_lbp: 50_000,
      },
      keptUsd: 0,
      keptLbp: 50_000,
      paidDrawer: "OMT_System|LBP",
      paidDelta: -5_000_000,
    });
  });

  it("Binance cash-out (wallet RECEIVE): 100 USDT, $2 fee → owes $98, hands out $97.50, keeps $0.50", () => {
    const base: Payload = {
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USDT",
      commission: 2,
      clientId: CLIENT_ID,
    };
    expectKeptAccepted({
      control: {
        ...base,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 98 }],
      },
      kept: {
        ...base,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 97.5 }],
        kept_change_usd: 0.5,
      },
      keptUsd: 0.5,
      keptLbp: 0,
      paidDrawer: "General|USD",
      paidDelta: -97.5,
    });
  });

  it("Whish App RECEIVE (wallet), LBP: owes 2,000,000, hands out 1,950,000, keeps 50,000", () => {
    const base: Payload = {
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 2_000_000,
      currency: "LBP",
      commission: 0,
    };
    expectKeptAccepted({
      control: {
        ...base,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 2_000_000 }],
      },
      kept: {
        ...base,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 1_950_000 }],
        kept_change_lbp: 50_000,
      },
      keptUsd: 0,
      keptLbp: 50_000,
      paidDrawer: "General|LBP",
      paidDelta: -1_950_000,
    });
  });
});

// ─── tampered claims ────────────────────────────────────────────────────────

describe("RECEIVE payout kept change — a tampered claim is refused", () => {
  const omt = (amount: number, paid: number, extra: Payload): Payload => ({
    provider: "OMT",
    serviceType: "RECEIVE",
    amount,
    currency: "USD",
    omtServiceType: "INTRA",
    cashoutMethod: "CASH",
    payments: [{ method: "CASH", currencyCode: "USD", amount: paid }],
    ...extra,
  });

  it("phantom kept on an exact payout (fits inside the $0.05 reconcile epsilon) is refused", () => {
    expectRefused(omt(100, 100, { kept_change_usd: 0.04 }), /keep change/i);
  });

  it("phantom kept on an exact Binance cash-out is refused", () => {
    expectRefused(
      {
        provider: "BINANCE",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USDT",
        commission: 2,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 98 }],
        kept_change_usd: 0.04,
      },
      /keep change/i,
    );
  });

  it("kept above the real shortfall is refused", () => {
    expectRefused(omt(100.5, 100, { kept_change_usd: 0.9 }), /reconcile|more than/i);
  });

  it("kept at the $1 cap is refused", () => {
    expectRefused(omt(101.5, 100.5, { kept_change_usd: 1 }), /small leftover/i);
  });

  it("kept in the other currency than the payout is refused", () => {
    expectRefused(
      omt(100.5, 100, { kept_change_lbp: 44_750 }),
      /payout currency/i,
    );
  });
});

// ─── unsupported payout shapes ──────────────────────────────────────────────

describe("RECEIVE payout kept change — refused where it cannot be booked correctly", () => {
  it("FOR-partner RECEIVE refuses kept change (exact amount required)", () => {
    const partnerId = seedPartner();
    expectRefused(
      {
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        omtServiceType: "INTRA",
        partnerId,
        partnerMode: "FOR",
        payments: [],
        kept_change_usd: 0.5,
      },
      /partner/i,
    );
  });

  it("session basket item (deferPayment) refuses kept change", () => {
    expectRefused(
      {
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        omtServiceType: "INTRA",
        deferPayment: true,
        kept_change_usd: 0.5,
      },
      /keep(ing)? change/i,
    );
  });

  it("CUSTOMER_ACCOUNT cashout refuses kept change", () => {
    expectRefused(
      {
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100.5,
        currency: "USD",
        omtServiceType: "INTRA",
        clientId: CLIENT_ID,
        cashoutMethod: "CUSTOMER_ACCOUNT",
        payments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 100 },
        ],
        kept_change_usd: 0.5,
      },
      /keep(ing)? change/i,
    );
  });

  it("a system RECEIVE paid out from a wallet refuses kept change", () => {
    expectRefused(
      {
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100.5,
        currency: "USD",
        omtServiceType: "INTRA",
        cashoutMethod: "WHISH",
        payments: [{ method: "WHISH", currencyCode: "USD", amount: 100 }],
        kept_change_usd: 0.5,
      },
      /keep(ing)? change/i,
    );
  });

  it("a Binance cash-out credited to the customer account refuses kept change", () => {
    expectRefused(
      {
        provider: "BINANCE",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USDT",
        commission: 2,
        clientId: CLIENT_ID,
        cashoutMethod: "CUSTOMER_ACCOUNT",
        payments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 97.5 },
        ],
        kept_change_usd: 0.5,
      },
      /keep(ing)? change/i,
    );
  });
});

describe("RECEIVE payout kept change — other providers", () => {
  it("a RECEIVE on a non-OMT/Whish provider (no payout branch) refuses kept change", () => {
    expectRefused(
      {
        provider: "BOB",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        kept_change_usd: 0.5,
      },
      /keep(ing)? change/i,
    );
  });
});

// ─── no change legs on a payout ─────────────────────────────────────────────

describe("RECEIVE is a payout — change (OUT) legs are refused", () => {
  it("an OMT RECEIVE carrying an OUT leg is refused and writes nothing", () => {
    expectRefused(
      {
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        omtServiceType: "INTRA",
        cashoutMethod: "CASH",
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 100 },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 50_000,
            direction: "OUT",
          },
        ],
      },
      /change \(OUT\) legs/i,
    );
  });

  it("a Binance cash-out carrying an OUT leg is refused and writes nothing", () => {
    expectRefused(
      {
        provider: "BINANCE",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USDT",
        commission: 2,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 98 },
          { method: "CASH", currencyCode: "USD", amount: 2, direction: "OUT" },
        ],
      },
      /change \(OUT\) legs/i,
    );
  });
});
