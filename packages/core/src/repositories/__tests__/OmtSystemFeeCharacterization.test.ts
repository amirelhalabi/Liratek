/**
 * OMT/WHISH SYSTEM SEND/RECEIVE — PRIMARY CASH DRAWER (PCD) GUARD.
 *
 * Re-derived (2026-07-30) from the float model (PR #66, superseded) to the
 * owner's confirmed model —
 * `docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md` §1/§8, and
 * `docs/FEATURE_GUIDE.md` §7/§8/§8.1 (now authoritative, not historical):
 *
 *   "we dont have omt system balance.. no need for another drawer. we can
 *    use our omt system drawer" — `OMT_System`/`Whish_System` is the
 *    PHYSICAL CASH DRAWER at the money-transfer counter for whichever
 *    provider is primary (`shop_base_system`), not a balance tracked inside
 *    the provider's own books. The float model's SEND `-x`/RECEIVE `+x`
 *    "float" legs are DELETED — the drawer now moves only because real
 *    banknotes move.
 *
 * Notation unchanged: x = principal, f = customer-facing fee, c = the shop's
 * commission (its cut of f; c ≤ f, c = 0 for WHISH).
 *
 * PCD = "primary cash drawer" = `OMT_System` when `shop_base_system='OMT'`,
 * `Whish_System` when `'WHISH'` (`primaryCashDrawerName()`,
 * `constants/systemFloatDrawers.ts`). Every cash leg of a primary-system
 * SEND/RECEIVE — customer payment, payout, change, the fee — routes to the
 * PCD via `resolveServiceCashDrawer(method, ctx)` (`utils/payments.ts`)
 * whenever `ctx.provider === ctx.baseSystem` (partner-or-not is NOT part of
 * the predicate). App wallets/Binance and non-primary-system flows are
 * untouched (General / their own wallet drawer, same as before #66).
 *
 * Target drawer table (plan §1 / FEATURE_GUIDE §8.1) — every case nets to
 * exactly the shop's own commission `c`, not `f` like the superseded float
 * model's table did:
 *
 *   SEND,    fee on top   : PCD +(x+f)             Δowed +(x+f−c)   PCDΣ−Δowed = +c
 *   SEND,    fee included : PCD +x                 Δowed +(x−c)     PCDΣ−Δowed = +c
 *   RECEIVE, fee on top   : PCD −x, +f (net −(x−f)) Δowed −(x−f+c)  PCDΣ−Δowed = +c
 *   RECEIVE, fee included : PCD −(x−f)             Δowed −(x−f+c)   PCDΣ−Δowed = +c
 *
 * The invariant every case below asserts (plan §8.4 / FEATURE_GUIDE §8.1):
 *
 *   Σ(drawer deltas) + Σ(receivable deltas) − Δ(supplier_ledger owed)
 *     = c + kept_change
 *
 * (the debt_ledger receivable term covers the CUSTOMER_ACCOUNT-funded SEND
 * case, where the "payment" leg is a receivable instead of a drawer credit —
 * see `assertInvariant`'s `debtDeltaUsd` param. That modeling predates this
 * re-derivation and is preserved unchanged — it was already correct.)
 *
 * Supplier ledger is GROSS again (plan §8.3, `grossOwedDelta()` in
 * `FinancialServiceRepository.ts`, replacing #66's fee-only `feeOwedDelta`):
 *
 *   SEND    → +(principal + fee − commission)
 *   RECEIVE → −(principal − fee + commission)
 *
 * This is NOT a return of the pre-#66 gross-reserve bug: that bug
 * double-counted `x` because the drawer ALSO carried it as a provider-side
 * balance. Here the PCD holds `x` as the shop's OWN physical cash — a
 * different fact from "what the shop owes the provider" — so tracking both
 * is not tracking the same number twice.
 *
 * RE-PROOF STATUS (rule 17): every expectation below was re-derived from the
 * model above by reading the already-landed production implementation
 * (`FinancialServiceRepository.ts`'s SEND/RECEIVE branches +
 * `resolveServiceCashDrawer`/`grossOwedDelta`) and confirmed against an
 * actual `npx jest` run of the pre-existing (float-model) expectations,
 * which fail with `Received: 0` on every General-drawer assertion — i.e.
 * cash no longer lands in General at all, consistent with the PCD model.
 * This file's edit is test-only; no production line changed. The individual
 * per-case comments that recorded a live failing-first proof under the FLOAT
 * model are preserved where they still document real (pre-PR#66 / pre-#66)
 * history — each such block is now marked "[historical]".
 *
 * RULE 17 — PROVEN FAILING-FIRST 2026-07-31 (serialized, single-agent).
 * Three independent sabotages of production code were each applied alone,
 * this suite run, and reverted (tree verified clean after every one):
 *
 *   1. `resolveServiceCashDrawer` (utils/payments.ts) stripped of its
 *      primary-system branch so every cash leg falls through to General:
 *      6 of 10 cases went red, General reading -95 where 0 is expected —
 *      i.e. the cash landed in the till instead of the cash drawer.
 *   2. `grossOwedDelta` reverted to PR #66's fee-only `fee - commission`:
 *      the supplier ledger read 4.5 instead of 104.5.
 *   3. `grossOwedDelta`'s RECEIVE sign flipped positive: 6 tests across this
 *      file, `.partner` and `.supplierLedgerAmount` went red. (Note for
 *      whoever extends the settlement suite: `SupplierRepository.settlement`
 *      does NOT constrain that sign — all 28 of its tests stayed green.)
 *
 * Do not delete these notes; they make the proof re-runnable without
 * re-deriving it.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";

// ─── Mock DB connection (shared by all sub-repositories) ─────────────────────

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// ─── Mock DebtService (only used by CUSTOMER_ACCOUNT cashout — unused here) ──

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema — every table the SYSTEM path touches ──────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff');
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL,
      commission REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      client_id INTEGER REFERENCES clients(id),
      client_name TEXT,
      reference_number TEXT,
      phone_number TEXT,
      omt_service_type TEXT,
      omt_fee REAL DEFAULT 0,
      whish_fee REAL DEFAULT 0,
      profit_rate REAL,
      pay_fee INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      item_key TEXT,
      note TEXT,
      sender_name TEXT,
      sender_phone TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      sender_client_id INTEGER,
      receiver_client_id INTEGER,
      is_settled INTEGER NOT NULL DEFAULT 1,
      settled_at TEXT,
      settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER REFERENCES partners(id),
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      commission_model INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT NOT NULL,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER REFERENCES users(id),
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER DEFAULT 1,
      is_system INTEGER DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Included for schema completeness; NOT queried on this code path since
    -- every call below passes an explicit exchangeRate (getUsdLbpSellRate,
    -- the only reader, is short-circuited by the ?? operator).
    CREATE TABLE currencies (
      tenant_id INTEGER DEFAULT 1,
      code TEXT PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE currency_drawers (
      tenant_id INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL,
      drawer_name TEXT NOT NULL
    );

    INSERT INTO drawer_balances VALUES (1, 'General',      'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',      'LBP', 100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_App',      'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App',    'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD', 500,  CURRENT_TIMESTAMP);

    -- Primary (base) system supplier row — required for the supplier-ledger
    -- auto-booking block to fire at all (getByProvider lookup).
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');
  `);

  return db;
}

function balance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row ? row.balance : 0;
}

function supplierLedgerSumUsd(db: Database.Database, provider: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sl.amount_usd), 0) as total
         FROM supplier_ledger sl JOIN suppliers s ON s.id = sl.supplier_id
        WHERE s.provider = ?`,
    )
    .get(provider) as { total: number };
  return row.total;
}

function debtLedgerSumUsd(db: Database.Database): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount_usd), 0) as total FROM debt_ledger`)
    .get() as { total: number };
  return row.total;
}

function rowCount(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as {
    c: number;
  };
  return row.c;
}

// Drawers snapshotted for every case (union of everything the map says the
// primary-system path can touch: General, the PCD (`OMT_System` — the real,
// countable cash drawer for whichever provider is primary, plan §1), and the
// app-wallet drawer a split payout/payment can also hit).
const DRAWERS: Array<[string, string]> = [
  ["General", "USD"],
  ["OMT_System", "USD"],
  ["OMT_App", "USD"],
];

interface Snapshot {
  drawers: Record<string, number>;
  supplierUsd: number;
  debtUsd: number;
}

function snapshot(db: Database.Database): Snapshot {
  const drawers: Record<string, number> = {};
  for (const [name, currency] of DRAWERS) {
    drawers[`${name}_${currency}`] = balance(db, name, currency);
  }
  return {
    drawers,
    supplierUsd: supplierLedgerSumUsd(db, "OMT"),
    debtUsd: debtLedgerSumUsd(db),
  };
}

function drawerDelta(before: Snapshot, after: Snapshot, key: string): number {
  return after.drawers[key] - before.drawers[key];
}

function drawerDeltaSum(before: Snapshot, after: Snapshot): number {
  let sum = 0;
  for (const [name, currency] of DRAWERS) {
    sum += drawerDelta(before, after, `${name}_${currency}`);
  }
  return sum;
}

/**
 * THE invariant (plan §8.4 / FEATURE_GUIDE §8.1):
 *
 *   Σ(drawer deltas) + Σ(receivable deltas) − Δ(supplier_ledger owed)
 *     = c + kept_change
 *
 * `debtDeltaUsd` extends Σ to include the debt_ledger receivable for
 * CUSTOMER_ACCOUNT-funded legs, where the "payment" leg is a receivable
 * instead of a drawer credit (no drawer moves at all under the PCD model —
 * the customer's cash never physically arrived — so the bare drawer-delta
 * sum alone would be missing the customer's side of the transaction
 * entirely). This handling is unchanged from before the PCD re-derivation —
 * it already modeled the receivable correctly and is preserved as-is.
 */
function assertInvariant(
  before: Snapshot,
  after: Snapshot,
  opts: { commission: number; keptChange?: number; debtDeltaUsd?: number },
): void {
  const sigma = drawerDeltaSum(before, after) + (opts.debtDeltaUsd ?? 0);
  const owedDelta = after.supplierUsd - before.supplierUsd;
  const lhs = sigma - owedDelta;
  const rhs = opts.commission + (opts.keptChange ?? 0);
  expect(lhs).toBeCloseTo(rhs, 5);
}

describe("OMT SYSTEM primary-cash-drawer (PCD) GUARD — SEND/RECEIVE routes to PCD, gross supplier ledger", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 1 — RECEIVE, fee ON TOP, single CASH leg (x=100, f=5, c=1)
  //
  // [historical, pre-PR#66] Pre-RESERVE-model-fix: General -105.10
  // (=-(x+commission)), OMT_System +105.10 — the "decreasing x+fees from
  // BOTH drawers" bug the owner originally reported, plus no fee leg at all
  // (RECEIVE had no fee field then). Unrelated to the PCD re-derivation
  // below; kept for the record.
  //
  // rule 17: proven failing-first 2026-07-31 (see the file header for the
  // three sabotages and their observed wrong values) — the PCD-model numbers below are re-derived
  // from PRIMARY_CASH_DRAWER_PLAN.md §1/§8.3 against the already-landed
  // repository (confirmed by an actual `npx jest` run showing the
  // float-model expectations fail with General "Received: 0" — cash no
  // longer lands there). A separate serialized pass will do the
  // revert-production-and-confirm-red exercise for these exact numbers.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 1 — RECEIVE fee-on-top, single leg (x=100, f=5, c=1)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    // All cash now lands in the PCD (OMT_System) — provider "OMT" ===
    // baseSystem "OMT", so both the fee leg and the payout route through
    // resolveServiceCashDrawer to the PCD instead of General.
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(0, 5); // no leg touches General anymore
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-95, 5); // PCD: +5 (fee) - 100 (payout) = -95
    // Gross supplier ledger (grossOwedDelta, RECEIVE): -(x - f + c) = -(100 - 5 + 1) = -96
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(-96, 5);
    // PCDΣ(-95) - Δowed(-96) = 1 = c(1)
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 2 — RECEIVE, fee INCLUDED (x=100, f=5, c=1).
  //
  // [historical] `includingFees` was never read for RECEIVE at all before
  // the fee-included RECEIVE mode existed — unrelated to the PCD
  // re-derivation.
  //
  // Carries an explicit payout LEG (95 = x−f), so `reconcileLegs` actually
  // runs. Without legs it no-ops, and this case would pass while the real
  // leg-vs-total contract went unchecked. Unlike SEND, RECEIVE's `amount` is
  // the GROSS received (the frontend does NOT pre-net it), and the branch
  // reconciles against `payoutAmount` (x−f) — this leg pins that.
  //
  // rule 17: proven failing-first 2026-07-31 (see the file header for the
  // three sabotages and their observed wrong values) — PCD numbers re-derived per CASE 1's note.
  // The PCD (OMT_System) starts this test seeded at $500 (createTestDb),
  // comfortably above the $95 payout — no fixture funding change needed.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 2 — RECEIVE fee-included, explicit $95 payout leg (x=100, f=5, c=1)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      includingFees: true,
      cashoutMethod: "CASH",
      // Customer collects the NET: x − f = 95.
      payments: [{ method: "CASH", currencyCode: "USD", amount: 95 }],
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    // No separate fee leg (fee-included nets it out of the payout instead).
    // The single payout leg routes to the PCD, not General.
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(0, 5); // no leg touches General
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-95, 5); // PCD: -(x-f) = -95
    // Gross supplier ledger is unaffected by fee mode — same -(x-f+c) as CASE 1.
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(-96, 5); // -(100-5+1)
    // PCDΣ(-95) - Δowed(-96) = 1 = c(1)
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 3 — SEND, fee ON TOP, single CASH leg (x=100, f=5, c=1).
  //
  // [historical, pre-PR#66] Pre-RESERVE-model-fix: General net 0 (the
  // RESERVE row zeroed the customer's cash back out), OMT_System +105
  // (gross reserve, wrong sign for a float). Unrelated to the PCD
  // re-derivation below; kept for the record.
  //
  // rule 17: proven failing-first 2026-07-31 (see the file header for the
  // three sabotages and their observed wrong values) — PCD numbers re-derived per CASE 1's note.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 3 — SEND fee-on-top, single leg (x=100, f=5, c=1)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      paidByMethod: "CASH",
      includingFees: false,
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    // The customer's full payment (x+f) is cash that lands directly in the
    // PCD (OMT_System) — the old float model's separate "-x reserve" leg is
    // deleted, so General never sees this money at all.
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(0, 5); // no leg touches General
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(105, 5); // PCD: +(x+f) = +105
    // Gross supplier ledger (grossOwedDelta, SEND): +(x + f - c) = 100 + 5 - 1 = 104
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(104, 5);
    // PCDΣ(105) - Δowed(104) = 1 = c(1)
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 4 — SEND, fee INCLUDED, single CASH leg. Customer budget $100 with a
  // $5 fee inside it, so the transfer principal is $95.
  //
  // THIS CASE USES THE REAL FRONTEND PAYLOAD SHAPE, and that is the whole
  // point of it. `data.amount` reaching the repository is ALWAYS the net
  // principal — Services/index.tsx back-calculates `sentAmount = budget − fee`
  // before the IPC call when the fee-included toggle is on. So a $100 budget
  // arrives as amount=95, omtFee=5, and the customer's CASH leg is $100.
  //
  // [historical] An earlier version of this case sent amount=100 (as if it
  // were the budget) AND omitted `payments` entirely — both flaws mattered
  // (the payload shape never occurs in production, and with no legs
  // `reconcileLegs` no-ops so the leg-vs-total hard reject could not fire).
  // That earlier defect (fixed pre-#66, owner-reported 2026-07-30, "OMT
  // SEND: payment legs do not reconcile … diff $1.00") is unrelated to the
  // PCD re-derivation below; kept for the record.
  //
  // rule 17: proven failing-first 2026-07-31 (see the file header for the
  // three sabotages and their observed wrong values) — PCD numbers re-derived per CASE 1's note —
  // the FLOAT-model proof this case used to carry ("restoring
  // `totalCollected = includingFees ? sentAmount : …` … makes this red")
  // no longer applies verbatim now that the float leg it referenced
  // (`floatDelta`) has been deleted outright; a separate serialized pass
  // re-proves this case's CURRENT numbers failing-first.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 4 — SEND fee-included, real frontend shape: budget $100 = principal $95 + fee $5, ONE $100 CASH leg", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      // Pre-netted by the frontend: budget 100 − fee 5.
      amount: 95,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      includingFees: true,
      // The customer physically hands over the full budget. Legs MUST be
      // present or the reconciler is bypassed and this case proves nothing.
      payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    // Customer's cash lands in the PCD (OMT_System), not General — the whole
    // $100 budget is real cash on a primary-system SEND.
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(0, 5); // no leg touches General
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(100, 5); // PCD: +budget = +100
    // Gross supplier ledger (grossOwedDelta, SEND): principal(95) + fee(5) - commission(1) = 99
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(99, 5);
    // PCDΣ(100) - Δowed(99) = 1 = c(1)
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 5 — RECEIVE, fee = 0, SPLIT payout: CASH 60 + OMT wallet 40
  // (x=100, c=1). Isolates split-leg payout behavior from the fee.
  //
  // rule 17: proven failing-first 2026-07-31 (see the file header for the
  // three sabotages and their observed wrong values) — PCD numbers re-derived per CASE 1's note. The
  // CASH leg (only) resolves to the PCD (provider "OMT" === baseSystem
  // "OMT", method CASH); the OMT-wallet leg falls through unchanged to
  // OMT_App (`paymentMethodToDrawerName("OMT") !== "General"`, so the
  // resolver's condition 3 fails and it is untouched by this feature) — see
  // FEATURE_GUIDE §7 "App-wallet movement" / plan §1 decision #5.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 5 — RECEIVE fee=0, SPLIT payout: CASH 60 + OMT wallet 40 (x=100, c=1)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      cashoutMethod: "CASH",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 60 },
        { method: "OMT", currencyCode: "USD", amount: 40 },
      ],
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(0, 5); // no leg touches General
    expect(drawerDelta(before, after, "OMT_App_USD")).toBeCloseTo(-40, 5); // wallet leg unchanged
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(-60, 5); // PCD: -(CASH leg) = -60
    // Gross supplier ledger (grossOwedDelta, RECEIVE): -(x - f + c) = -(100 - 0 + 1) = -101
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(-101, 5);
    // PCDΣ(-60 - 40 = -100) - Δowed(-101) = 1 = c(1)
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 6 — SEND, fee ON TOP, SPLIT payment: CASH 60 + OMT wallet 45
  // (sum = 105 = totalCustomerPays; x=100, f=5, c=1).
  //
  // [historical, pre-PR#66] Pre-fix: `isPaidByNonCash` (any-leg-non-cash)
  // skipped the cash leg's reserve while the system drawer still credited
  // the FULL gross, producing General +60 (never reserved) AND OMT_System
  // +105 (unreduced) — a genuine extra +60 nowhere accounted for. Unrelated
  // to the PCD re-derivation below; kept for the record.
  //
  // rule 17: proven failing-first 2026-07-31 (see the file header for the
  // three sabotages and their observed wrong values) — PCD numbers re-derived per CASE 1's note —
  // same split-routing rule as CASE 5 (CASH leg → PCD, OMT-wallet leg →
  // OMT_App unchanged), applied to the customer-payment side instead of the
  // payout side.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 6 — SEND fee-on-top, SPLIT payment: CASH 60 + OMT wallet 45 (x=100, f=5, c=1)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 60 },
        { method: "OMT", currencyCode: "USD", amount: 45 },
      ],
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(0, 5); // no leg touches General
    expect(drawerDelta(before, after, "OMT_App_USD")).toBeCloseTo(45, 5); // wallet leg unchanged
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(60, 5); // PCD: +(CASH leg) = +60, NOT -100+leftover
    // Gross supplier ledger (grossOwedDelta, SEND): 100 + 5 - 1 = 104
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(104, 5);
    // PCDΣ(60 + 45 = 105) - Δowed(104) = 1 = c(1)
    assertInvariant(before, after, { commission: 1 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 7 — CUSTOMER_ACCOUNT-funded SEND (x=100, f=5, c=1).
  //
  // [historical, pre-PR#66] Pre-fix: `systemDrawerCredit` was forced to 0
  // for a single on-account payment (the float never moved even though the
  // transfer physically happened) — a FLOAT-model defect, unrelated to the
  // PCD re-derivation below.
  //
  // Under the PCD model the SEND float leg is deleted outright (no
  // "draw the float down immediately" posting exists anymore — CASE 4's
  // comment on the deleted `floatDelta` applies here too): the customer's
  // payment is a receivable, not real cash, so NO drawer moves at all. This
  // is the CORRECT PCD-model behavior, not a bug — the PCD only tracks
  // banknotes that physically moved, and none did (the shop hasn't handed
  // out its own cash; it drew on the provider relationship, tracked purely
  // in the supplier ledger).
  //
  // rule 17: proven failing-first 2026-07-31 (see the file header for the
  // three sabotages and their observed wrong values) — PCD numbers re-derived per CASE 1's note. The
  // OMT_System delta of 0 (replacing the float model's -100) was confirmed
  // by the pre-edit `npx jest` run, which showed "Received: 0" against the
  // old "-100" expectation.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 7 — SEND CUSTOMER_ACCOUNT-funded, no drawer moves (receivable only) (x=100, f=5, c=1)", () => {
    const before = snapshot(db);

    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      paidByMethod: "CUSTOMER_ACCOUNT",
      clientName: "Test Client",
      phoneNumber: "70000000",
      includingFees: false,
      exchangeRate: 90000,
    });

    const after = snapshot(db);

    // No drawer moves for the customer's side — it's a receivable, not cash.
    expect(drawerDelta(before, after, "General_USD")).toBeCloseTo(0, 5);
    // The PCD does NOT move either: no real cash physically moved (the
    // float-model's automatic "-x" draw-down leg is deleted).
    expect(drawerDelta(before, after, "OMT_System_USD")).toBeCloseTo(0, 5);
    // debt_ledger carries the full customer-owed total (x + f = 105).
    expect(after.debtUsd - before.debtUsd).toBeCloseTo(105, 5);
    // Gross supplier ledger (grossOwedDelta, SEND): 100 + 5 - 1 = 104
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(104, 5);

    // Extended invariant: the debt receivable stands in for the missing
    // drawer credit (no drawer moved for the customer's payment, and now no
    // drawer moved for the shop's own cash either — the invariant's
    // receivable term carries the entire customer-facing total).
    assertInvariant(before, after, {
      commission: 1,
      debtDeltaUsd: after.debtUsd - before.debtUsd,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 8 — REJECTED: walk-in transaction on the SECONDARY provider
  // (WHISH, when shop_base_system = OMT) with no partnerId. Pre-fix: this
  // silently skipped the supplier-ledger entry (skipSecondarySupplierLedger)
  // and booked NOTHING anywhere — the obligation vanished into no ledger at
  // all. Orchestrator default: reject outright. Unaffected by the PCD
  // re-derivation (no drawer or ledger row is ever written on this path) —
  // unchanged from the float model, still green.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 8 — REJECTED: walk-in WHISH SEND with no partnerId writes nothing", () => {
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");
    const txnCountBefore = rowCount(db, "transactions");
    const paymentsCountBefore = rowCount(db, "payments");

    expect(() =>
      repo.createTransaction({
        provider: "WHISH",
        serviceType: "SEND",
        amount: 50,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
        exchangeRate: 90000,
      }),
    ).toThrow(/secondary system/i);

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(rowCount(db, "transactions")).toBe(txnCountBefore);
    expect(rowCount(db, "payments")).toBe(paymentsCountBefore);
    expect(after.drawers).toEqual(before.drawers);
  });

  // Unaffected by the PCD re-derivation (symmetric rejection path, no drawer
  // write on either branch) — unchanged from the float model, still green.
  it("CASE 8b — REJECTED: walk-in WHISH RECEIVE with no partnerId writes nothing (symmetric)", () => {
    const before = snapshot(db);
    const fsCountBefore = rowCount(db, "financial_services");

    expect(() =>
      repo.createTransaction({
        provider: "WHISH",
        serviceType: "RECEIVE",
        amount: 50,
        currency: "USD",
        commission: 0,
        cashoutMethod: "CASH",
        exchangeRate: 90000,
      }),
    ).toThrow(/secondary system/i);

    const after = snapshot(db);
    expect(rowCount(db, "financial_services")).toBe(fsCountBefore);
    expect(after.drawers).toEqual(before.drawers);
  });

  // Unaffected by the PCD re-derivation — a THROUGH-partner WHISH SEND runs
  // on the SECONDARY provider (WHISH != baseSystem OMT), so
  // resolveServiceCashDrawer's provider===baseSystem predicate is false and
  // this transaction never touches the PCD; still green, no assertion here
  // even names a drawer.
  it("does NOT reject a THROUGH-partner WHISH SEND (partnerId set)", () => {
    db.prepare(`INSERT INTO partners (name) VALUES ('Test Partner')`).run();

    expect(() =>
      repo.createTransaction({
        provider: "WHISH",
        serviceType: "SEND",
        amount: 50,
        currency: "USD",
        commission: 0,
        partnerId: 1,
        exchangeRate: 90000,
      }),
    ).not.toThrow();
  });
});
