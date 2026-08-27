/**
 * GENERAL_DRAWER_UNRESTRICTED.md Phase 4 — Rule-20 reversal-symmetry proof
 * for a non-USD/LBP General top-up (EUR).
 *
 * ## What this file actually proves (read before extending it)
 *
 * The plan's Phase 4 line reads: "create a EUR top-up -> void it ->
 * `payments` and `drawer_balances` net to 0 in EUR. Expected to pass
 * (generic `_reversePayments` reverses per currency) but it is an unproven
 * path for a non-USD/LBP currency — assert it, don't assume."
 *
 * Asserting it (rather than assuming it) surfaces a fact the plan's author
 * did not have: **`DRAWER_TOPUP` is a member of
 * `NON_REVERSIBLE_TRANSACTION_TYPES`** (constants/transactionTypes.ts,
 * "two drawer movements but only the General-side payments leg — a void
 * would restore General and strand the source drawer's deduction"). That
 * rationale describes `createTopUpFromDrawer` (the internal transfer mode,
 * whose source-drawer debit is a raw UPDATE with no payments row). But
 * `createTopUp` — the External Cash-In mode this ticket's EUR scenario
 * actually uses — shares the exact same `TRANSACTION_TYPES.DRAWER_TOPUP`
 * constant on its transaction row (DrawerTopUpRepository.ts `createTopUp`,
 * step 2), even though EVERY leg it writes (USD, LBP, and each
 * `extra_currencies` entry) IS backed by a real `payments` row via
 * `insertPaymentRow` — there is no stranded second drawer in this mode.
 *
 * `TransactionRepository._assertReversible` (the single gate both
 * `voidTransaction` and `refundTransaction` call, before either ever reaches
 * `_reversePayments`) checks `NON_REVERSIBLE_TRANSACTION_TYPES` by TYPE, not
 * by which sub-path created the row — so it throws
 * `"DRAWER_TOPUP transactions cannot be voided or refunded — reverse them
 * from their own module"` for a `createTopUp` row exactly as it does for a
 * `createTopUpFromDrawer` row. **There is no numeric "does it net to zero"
 * question to answer, because the real void/refund path refuses to run at
 * all** — the generic reversal `_reversePayments` is never reached.
 *
 * This is consistent with the codebase's own documented pattern for other
 * non-reversible types (CREDIT_CASH_IN/DEBT_CASH_OUT/DRAWER_CASHOUT/
 * MTC_TOPUP/ALFA_TOPUP): "Rule-20 owner: an opposite manual entry", not an
 * automatic reversal. But for DRAWER_TOPUP specifically, that manual
 * fallback is `DrawerCashoutRepository.createCashout` — and until this file's
 * review pass, its `CreateDrawerCashoutData` shape had ONLY `amount_usd`/
 * `amount_lbp`, no `extra_currencies` field at all. So for a non-USD/LBP
 * top-up (EUR in this file), there was **no reversal owner whatsoever** —
 * not the generic path (blocked by type), and not the documented manual
 * correction path either (structurally could not express a non-USD/LBP
 * amount).
 *
 * **FIXED**: `DrawerCashoutRepository.CreateDrawerCashoutData` now has an
 * `extra_currencies` field mirroring Drawer Top-Up's inflow shape,
 * sign-flipped (minus the lot cost-basis fields — a cash-out never writes an
 * `exchange_lots` row). The "FIX PROOF" test below creates the mistaken EUR
 * top-up, corrects it with a EUR cash-out, and asserts `payments` +
 * `drawer_balances` net to exactly 0 in EUR — the documented manual-entry
 * pattern, now actually able to express a non-USD/LBP amount. This does NOT
 * touch `NON_REVERSIBLE_TRANSACTION_TYPES` or `_assertReversible` — the
 * void/refund gate above stays exactly as it was; the fix is entirely on the
 * "opposite manual entry" side. Correcting a mistaken foreign-currency
 * top-up's LOT (as opposed to its drawer balance) is still a separate, manual
 * Q15 write-off (`ExchangeLotRepository.adjust`) — deliberately kept
 * money-free and independent, exactly like correcting any other wrong-lot-
 * rate top-up already requires.
 *
 * Rule-17 sabotage bonus finding (not asserted here — production keeps the
 * gate — but worth recording): temporarily deleting `DRAWER_TOPUP` from
 * `NON_REVERSIBLE_TRANSACTION_TYPES` and re-running the void test above made
 * `voidTransaction` succeed instead of throwing, and it DID net EUR to
 * exactly 0 (payments: +300 then a mirrored -300 "Reversal" row;
 * drawer_balances: 300 -> 0). So the generic `_reversePayments` mechanism
 * the plan's author expected to "just work" for a non-USD/LBP currency is,
 * mechanically, correct — the only thing standing between here and a
 * working reversal is the blanket type-level policy gate, not a bug in the
 * per-currency reversal math itself.
 *

 * ## Companion Phase-4 acceptance cases — already covered, not duplicated here
 *
 * - "a EUR top-up into General with no currency_drawers row SUCCEEDS":
 *   already `DrawerTopUpRepository.test.ts` ->
 *   `"accepts an ACTIVE currency with no currency_drawers row for General"`.
 * - "an unknown code is still REJECTED": already covered, but not as an
 *   identity/allowlist check — Phase 2 removed that. The real remaining
 *   guard is the LOT COST-BASIS requirement:
 *   `DrawerTopUpRepository.lotCreation.test.ts` ->
 *   `"rejects an exotic top-up with no cost basis available anywhere…"`
 *   (whole transaction rolls back) proves an unfamiliar/exotic code is
 *   rejected when it carries no operator override, no configured rate, and
 *   no feed hint; `"unknown-code auto-registration creates currencies +
 *   currency_drawers rows and the lot lands (FK proof)"` (same file) proves
 *   the SAME unknown code is accepted once a cost basis is supplied. A
 *   literal "reject currency code XYZ merely for being unrecognized" test
 *   would misrepresent the shipped Phase 2 behavior (the Zod schema only
 *   requires `currency_code` to be a non-empty string <= 10 chars — see
 *   `electron-app/schemas/index.ts` `DrawerTopUpCreateSchema`) — flagged in
 *   the task report instead of faked here.
 */

import Database from "better-sqlite3";
import { DrawerTopUpRepository } from "../DrawerTopUpRepository";
import { DrawerTopUpService } from "../../services/DrawerTopUpService";
import { TransactionRepository } from "../TransactionRepository";
import { DrawerCashoutRepository } from "../DrawerCashoutRepository";
import { resetCurrencyRepository } from "../CurrencyRepository";
import { resetExchangeLotRepository } from "../ExchangeLotRepository";
import { resetRateRepository } from "../RateRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema — mirrors DrawerTopUpRepository.lotCreation.test.ts
//     (same tables that fixture needed to exercise extra_currencies + lot
//     creation) plus `debt_ledger`, which `TransactionRepository._cancelDebt`
//     reads unconditionally on every void/refund (no hasTable guard) once
//     `_assertReversible` lets a call through. ─────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE drawer_topups (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      notes TEXT,
      source_drawer TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE currencies (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT,
      symbol TEXT,
      decimal_places INTEGER DEFAULT 2,
      is_active INTEGER DEFAULT 1,
      UNIQUE (tenant_id, code)
    );

    CREATE TABLE exchange_rates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER DEFAULT 1,
      to_code     TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate    REAL NOT NULL DEFAULT 0,
      sell_rate   REAL NOT NULL DEFAULT 0,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      updated_at  TEXT DEFAULT (datetime('now')),
      UNIQUE (tenant_id, to_code)
    );

    CREATE TABLE currency_drawers (
      tenant_id INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL,
      drawer_name TEXT NOT NULL
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
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
      profit_usd REAL,
      profit_lbp REAL,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Read unconditionally by TransactionRepository._cancelDebt on every
    -- void/refund that gets past _assertReversible (no hasTable guard) —
    -- empty here, never populated by a drawer top-up.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      transaction_type TEXT,
      amount_usd REAL,
      amount_lbp REAL,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      covered_usd REAL DEFAULT 0,
      covered_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      due_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE drawer_cashouts (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_lots (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER DEFAULT 1,
      currency_code  TEXT NOT NULL,
      drawer_name    TEXT NOT NULL DEFAULT 'General',
      source_type    TEXT NOT NULL CHECK(source_type IN ('EXCHANGE_BUY', 'DRAWER_TOPUP', 'ADJUSTMENT')),
      source_table   TEXT,
      source_id      INTEGER,
      original_qty   REAL NOT NULL,
      remaining_qty  REAL NOT NULL,
      unit_cost_usd  REAL NOT NULL,
      acquired_at    DATETIME NOT NULL,
      is_voided      INTEGER NOT NULL DEFAULT 0,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id, currency_code) REFERENCES currencies(tenant_id, code)
    );
    CREATE INDEX idx_exchange_lots_fifo ON exchange_lots(tenant_id, currency_code, acquired_at, id);
  `);

  return db;
}

// ─── Mock the connection module (same target BaseRepository/singletons read
//     from — mirrors every other DrawerTopUpRepository test file) ─────────

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────

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
  return row?.balance ?? 0;
}

function enableDrawerCurrency(
  db: Database.Database,
  drawerName: string,
  currencyCode: string,
): void {
  // The currency must EXIST and be ACTIVE, not merely have a junction row —
  // `currency_drawers` FKs to `currencies(tenant_id, code)` in production;
  // this fixture enforces the same FK (`PRAGMA foreign_keys = ON` above).
  const code = currencyCode.toUpperCase();
  const exists = db
    .prepare("SELECT 1 FROM currencies WHERE code = ? AND tenant_id = 1")
    .get(code);
  if (!exists) {
    db.prepare(
      "INSERT INTO currencies (code, name, symbol, decimal_places, is_active, tenant_id) VALUES (?, ?, ?, 2, 1, 1)",
    ).run(code, code, code);
  }
  db.prepare(
    "INSERT INTO currency_drawers (currency_code, drawer_name, tenant_id) VALUES (?, ?, 1)",
  ).run(currencyCode, drawerName);
}

function paymentsFor(db: Database.Database, currencyCode: string): any[] {
  return db
    .prepare("SELECT * FROM payments WHERE currency_code = ?")
    .all(currencyCode) as any[];
}

describe("Phase 4 rule-20 proof — EUR top-up into General, reversal symmetry", () => {
  let db: Database.Database;
  let repo: DrawerTopUpRepository;
  let service: DrawerTopUpService;
  let txnRepo: TransactionRepository;
  let cashoutRepo: DrawerCashoutRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetCurrencyRepository();
    resetExchangeLotRepository();
    resetRateRepository();
    repo = new DrawerTopUpRepository();
    service = new DrawerTopUpService(repo);
    txnRepo = new TransactionRepository();
    cashoutRepo = new DrawerCashoutRepository();
  });

  afterEach(() => {
    resetTenantContext();
    resetCurrencyRepository();
    resetExchangeLotRepository();
    resetRateRepository();
    db.close();
  });

  it("creates the EUR top-up through the real service/repository path: drawer_balances EUR 0 -> 300, one payments row", () => {
    enableDrawerCurrency(db, "General", "EUR");
    expect(balance(db, "General", "EUR")).toBe(0);

    const result = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [
          { currency_code: "EUR", amount: 300, acquisition_usd_per_unit: 1.08 },
        ],
      },
      1,
    );

    expect(result.success).toBe(true);
    expect(balance(db, "General", "EUR")).toBeCloseTo(300, 2);

    const eurPayments = paymentsFor(db, "EUR");
    expect(eurPayments).toHaveLength(1);
    expect(eurPayments[0].amount).toBeCloseTo(300, 2);
    expect(eurPayments[0].drawer_name).toBe("General");
  });

  it("REAL FINDING: voidTransaction on the real void path REJECTS the EUR top-up outright — the generic _reversePayments never runs, so there is nothing that 'nets to zero'", () => {
    enableDrawerCurrency(db, "General", "EUR");

    const result = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [
          { currency_code: "EUR", amount: 300, acquisition_usd_per_unit: 1.08 },
        ],
      },
      1,
    );
    expect(result.success).toBe(true);
    const topUpId = result.id as number;

    const txnRow = db
      .prepare(
        "SELECT id FROM transactions WHERE source_table = 'drawer_topups' AND source_id = ?",
      )
      .get(topUpId) as { id: number };

    // 0 -> 300 confirmed before we even attempt the void.
    expect(balance(db, "General", "EUR")).toBeCloseTo(300, 2);
    expect(paymentsFor(db, "EUR")).toHaveLength(1);

    // The real void entry point — TransactionRepository.voidTransaction —
    // throws before it ever reaches _reversePayments, because
    // _assertReversible gates on NON_REVERSIBLE_TRANSACTION_TYPES by TYPE
    // (DRAWER_TOPUP), not by which createTopUp*/mode wrote the row.
    expect(() => txnRepo.voidTransaction(txnRow.id, 1)).toThrow(
      /DRAWER_TOPUP transactions cannot be voided or refunded/,
    );

    // Nothing moved: still exactly the original create-leg state, per
    // currency, arithmetic asserted explicitly (not just "no new rows").
    expect(balance(db, "General", "EUR")).toBeCloseTo(300, 2);
    const eurPaymentsAfter = paymentsFor(db, "EUR");
    expect(eurPaymentsAfter).toHaveLength(1);
    expect(eurPaymentsAfter[0].amount).toBeCloseTo(300, 2);

    // The original transaction row is still ACTIVE — the block happens
    // up-front, before the UPDATE ... SET status = 'VOIDED' step.
    const txnAfter = db
      .prepare("SELECT status FROM transactions WHERE id = ?")
      .get(txnRow.id) as { status: string };
    expect(txnAfter.status).toBe("ACTIVE");
  });

  it("REAL FINDING: refundTransaction is blocked by the identical gate (same _assertReversible call, same message)", () => {
    enableDrawerCurrency(db, "General", "EUR");

    const result = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [
          { currency_code: "EUR", amount: 300, acquisition_usd_per_unit: 1.08 },
        ],
      },
      1,
    );
    const topUpId = result.id as number;
    const txnRow = db
      .prepare(
        "SELECT id FROM transactions WHERE source_table = 'drawer_topups' AND source_id = ?",
      )
      .get(topUpId) as { id: number };

    expect(() => txnRepo.refundTransaction(txnRow.id, 1)).toThrow(
      /DRAWER_TOPUP transactions cannot be voided or refunded/,
    );
    expect(balance(db, "General", "EUR")).toBeCloseTo(300, 2);
  });

  it("FIX PROOF: DrawerCashoutRepository.extra_currencies is the rule-20 manual-correction owner — a EUR cash-out nets the mistaken top-up back to 0", () => {
    // This test previously only proved, at compile time, that
    // CreateDrawerCashoutData structurally could NOT carry a EUR amount
    // (`@ts-expect-error` on an `extra_currencies` field that did not
    // exist) — the review's actual finding: DRAWER_TOPUP is permanently
    // non-reversible (see the test above) AND its documented rule-20 owner
    // ("an opposite manual entry", transactionTypes.ts) could not express a
    // non-USD/LBP amount either, so a mistaken EUR top-up had NO reversal
    // path whatsoever. `DrawerCashoutRepository.CreateDrawerCashoutData` now
    // has `extra_currencies` (mirrors Drawer Top-Up's inflow shape,
    // sign-flipped, minus the lot cost-basis fields a cash-out never needs)
    // — this proves the corrected path end to end: create the mistaken EUR
    // top-up, then correct it with a EUR cash-out, and assert `payments` +
    // `drawer_balances` net to exactly 0 in EUR.
    enableDrawerCurrency(db, "General", "EUR");

    const topUpResult = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [
          { currency_code: "EUR", amount: 300, acquisition_usd_per_unit: 1.08 },
        ],
      },
      1,
    );
    expect(topUpResult.success).toBe(true);
    expect(balance(db, "General", "EUR")).toBeCloseTo(300, 2);
    expect(paymentsFor(db, "EUR")).toHaveLength(1);

    // The manual correction: an opposite Drawer Cash-Out for the same EUR
    // amount, exactly as MTC_TOPUP/ALFA_TOPUP's documented "opposite manual
    // top-up" pattern already works for other non-reversible types.
    const cashoutId = cashoutRepo.createCashout(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [{ currency_code: "EUR", amount: 300 }],
        notes: "Correcting a mistaken EUR 300 top-up",
      },
      1,
    );
    expect(cashoutId).toBeGreaterThan(0);

    // Net to exactly 0 in EUR: the top-up's +300 leg and the cash-out's -300
    // leg both landed as real `payments` rows against `drawer_balances`.
    expect(balance(db, "General", "EUR")).toBeCloseTo(0, 2);
    const eurPaymentsAfter = paymentsFor(db, "EUR");
    expect(eurPaymentsAfter).toHaveLength(2);
    const totalEur = eurPaymentsAfter.reduce(
      (sum, p) => sum + (p.amount as number),
      0,
    );
    expect(totalEur).toBeCloseTo(0, 2);

    // The original DRAWER_TOPUP transaction itself is untouched (still
    // ACTIVE, not voided) — this is a NEW opposite entry, not a reversal of
    // the original row, exactly like every other NON_REVERSIBLE_TRANSACTION_
    // TYPES type's documented manual-correction pattern.
    const topUpTxn = db
      .prepare(
        "SELECT status FROM transactions WHERE source_table = 'drawer_topups' AND source_id = ?",
      )
      .get(topUpResult.id as number) as { status: string };
    expect(topUpTxn.status).toBe("ACTIVE");
  });
});
