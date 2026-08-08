/**
 * LIRA-090 Phase 4 — the telecom "Only Days" money path
 * (TELECOM_DAYS_VALIDITY_PLAN.md §5.1, §6.1, §2, §8).
 *
 * Covers, against `FinancialServiceRepository.createTransaction`'s
 * `processTelecomCreditReturn` (renamed from `processKatshReturnedCredits`):
 *
 *  1. Bug 1 (spec §6.1) — the iPick tab's identical Only-Days checkbox used
 *     to book NOTHING because the gate was hard-coded to `provider ===
 *     "Katsh"`. Proven failing-first (rule 17): see the task's final report
 *     for the exact before/after transcript this file's iPick test produced.
 *  2. The computed returned-credit default (spec §2/§5.1): when
 *     `mobileServiceItemId` resolves to a split-complete item and
 *     `returnedCreditsUsd` is OMITTED, the repository computes
 *     `maxReturnableCredits(item.credits)` itself. An explicit override
 *     (including 0) always wins. A split-incomplete item — or no
 *     `mobileServiceItemId` at all (every caller before this ticket) —
 *     books exactly what today's code books: no regression (spec §9).
 *  3. The invariant spec §5.1 states as the correctness check: for a
 *     complete-split item, `cost_lbp - maxReturned*recoveredRateLbp ===
 *     days_cost_lbp` — using the SAME `maxReturnableCredits`/
 *     `deriveItemEconomics` the repository itself calls (rule 14), proving
 *     no drift between what's booked and what the calc module predicts.
 *  4. The carrier-line movement (spec §5.1/§8): the credit return also
 *     lands on the shop's primary line for that carrier, tied to the
 *     transaction (rule 20 reversal owner) — and is skipped (not thrown)
 *     when no primary line is configured yet.
 *  5. Self-charge (spec §5.2): full-face credits (no SMS burn), LBP cost
 *     debit, validity extension, no financial_services row, no profit.
 *
 * `mobile_service_items`/`carrier_lines`/`carrier_line_movements` use the
 * SAME `globalThis.__LIRATEK_TEST_DB__` injection hook as
 * CarrierLineRepository/CarrierLineMovementRepository/
 * MobileServiceItemRepository's own Phase 3 tests — no `jest.mock` needed;
 * `getDatabase()` reads the same global from every repository/service in
 * this test file.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";
import {
  MobileServiceItemRepository,
  resetMobileServiceItemRepository,
  type CreateMobileServiceItemData,
} from "../MobileServiceItemRepository.js";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository.js";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository.js";
import { resetCarrierLineService } from "../../services/CarrierLineService.js";
import {
  maxReturnableCredits,
  deriveItemEconomics,
} from "../../utils/telecomCredit.js";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";

// ─── In-memory schema ────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT DEFAULT 'staff',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      tenant_id INTEGER DEFAULT 1,
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      provider              TEXT NOT NULL,
      service_type          TEXT NOT NULL,
      amount                REAL NOT NULL,
      currency              TEXT DEFAULT 'USD' NOT NULL,
      commission            REAL DEFAULT 0,
      cost                  REAL DEFAULT 0,
      price                 REAL DEFAULT 0,
      paid_by               TEXT DEFAULT 'CASH',
      client_id             INTEGER REFERENCES clients(id),
      client_name           TEXT,
      reference_number      TEXT,
      phone_number          TEXT,
      omt_service_type      TEXT,
      omt_fee               REAL DEFAULT 0,
      whish_fee             REAL DEFAULT 0,
      profit_rate           REAL,
      pay_fee               INTEGER DEFAULT 0,
      payment_method_fee    REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      item_key              TEXT,
      note                  TEXT,
      sender_name           TEXT,
      sender_phone          TEXT,
      receiver_name         TEXT,
      receiver_phone        TEXT,
      sender_client_id      INTEGER,
      receiver_client_id    INTEGER,
      is_settled            INTEGER NOT NULL DEFAULT 1,
      settled_at            TEXT,
      settlement_id         INTEGER,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by            INTEGER,
      edited_by             TEXT,
      edited_at             TEXT,
      paid_amount           REAL DEFAULT NULL,
      paid_currency         TEXT DEFAULT NULL,
      partner_id            INTEGER,
      partner_mode          TEXT,
      commission_model      INTEGER NOT NULL DEFAULT 0,
      is_refunded           INTEGER DEFAULT 0,
      refunded_at           TEXT DEFAULT NULL
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id    INTEGER NOT NULL,
      user_id      INTEGER NOT NULL DEFAULT 1,
      amount_usd   REAL NOT NULL DEFAULT 0,
      amount_lbp   REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id    INTEGER,
      client_name  TEXT,
      client_phone TEXT,
      reverses_id  INTEGER,
      profit_usd   REAL NOT NULL DEFAULT 0,
      profit_lbp   REAL NOT NULL DEFAULT 0,
      summary      TEXT,
      metadata_json TEXT,
      device_id    TEXT,
      transaction_time DATETIME,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      created_by       INTEGER,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      provider     TEXT,
      is_active    INTEGER NOT NULL DEFAULT 1,
      is_system    INTEGER NOT NULL DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id   INTEGER NOT NULL,
      entry_type    TEXT NOT NULL,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      note          TEXT,
      created_by    INTEGER,
      transaction_id INTEGER,
      is_auto       INTEGER NOT NULL DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- LIRA-090 v140 tables (Phase 1/3) ----------------------------------------

    CREATE TABLE mobile_service_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id        INTEGER,
      provider         TEXT NOT NULL,
      category         TEXT NOT NULL,
      subcategory      TEXT NOT NULL,
      label            TEXT NOT NULL,
      cost_lbp         REAL NOT NULL DEFAULT 0,
      sell_lbp         REAL NOT NULL DEFAULT 0,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      is_active        INTEGER NOT NULL DEFAULT 1,
      validity_days    INTEGER,
      credits          REAL,
      days_cost_lbp    REAL,
      sell_days_lbp    REAL,
      sell_credit_lbp  REAL,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, provider, category, subcategory, label)
    );

    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      notes               TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      is_primary          INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_carrier_lines_one_primary_per_carrier
      ON carrier_lines(tenant_id, carrier)
      WHERE is_primary = 1;

    CREATE TABLE carrier_line_movements (
      id                            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                     INTEGER,
      carrier_line_id               INTEGER NOT NULL,
      transaction_id                INTEGER,
      credits_delta                 REAL NOT NULL DEFAULT 0,
      validity_days_delta           INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at  TEXT,
      reason                        TEXT NOT NULL,
      is_reversed                   INTEGER NOT NULL DEFAULT 0,
      created_at                    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Provider drawers for the cost/price flow. MTC/Alfa are USD-only (spec §4).
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD',  1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP',     0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Katsh',   'USD',   500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Katsh',   'LBP', 50000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'iPick',   'USD',   500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'iPick',   'LBP', 50000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'MTC',     'USD',     0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Alfa',    'USD',     0, CURRENT_TIMESTAMP);
  `);

  return db;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** The 77$ cart from the plan's worked example (§2.3) — same fixture Phase
 *  3a's MobileServiceItemRepository.split.test.ts uses. */
const CART_77: CreateMobileServiceItemData = {
  provider: "iPick",
  category: "mtc",
  subcategory: "Cart",
  label: "77$ Cart",
  cost_lbp: 7_600_000,
  sell_lbp: 7_800_000,
  credits: 77,
  days_cost_lbp: 1_162_000,
  sell_days_lbp: 1_300_000,
  sell_credit_lbp: 6_600_000,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function drawerBalance(
  db: Database.Database,
  name: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(name, currency) as { balance: number } | undefined;
  return row ? row.balance : 0;
}

function txnIdForFsRow(db: Database.Database, fsId: number): number {
  const row = db
    .prepare(
      "SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?",
    )
    .get(fsId) as { id: number } | undefined;
  if (!row)
    throw new Error(`No transaction row found for financial_services #${fsId}`);
  return row.id;
}

function creditReturnPayments(
  db: Database.Database,
  txnId: number,
): Array<{ drawer_name: string; currency_code: string; amount: number }> {
  return db
    .prepare(
      `SELECT drawer_name, currency_code, amount FROM payments
       WHERE transaction_id = ? AND method = 'CREDIT_RETURN'`,
    )
    .all(txnId) as Array<{
    drawer_name: string;
    currency_code: string;
    amount: number;
  }>;
}

function movementsForLine(
  db: Database.Database,
  carrierLineId: number,
): Array<{
  transaction_id: number | null;
  credits_delta: number;
  validity_days_delta: number;
  reason: string;
}> {
  return db
    .prepare(
      `SELECT transaction_id, credits_delta, validity_days_delta, reason
       FROM carrier_line_movements WHERE carrier_line_id = ?`,
    )
    .all(carrierLineId) as Array<{
    transaction_id: number | null;
    credits_delta: number;
    validity_days_delta: number;
    reason: string;
  }>;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("FinancialServiceRepository — LIRA-090 telecom Only-Days money path", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  let itemRepo: MobileServiceItemRepository;
  let lineRepo: CarrierLineRepository;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetMobileServiceItemRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    resetTransactionRepository();
    repo = new FinancialServiceRepository();
    itemRepo = new MobileServiceItemRepository();
    lineRepo = new CarrierLineRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    resetTenantContext();
    resetMobileServiceItemRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    resetTransactionRepository();
    db.close();
  });

  // ── Bug 1 (spec §6.1): iPick must book the SAME leg Katsh always did ──────

  describe("Bug 1 — iPick Only-Days credit return (spec §6.1)", () => {
    it("iPick Only-Days sale books the MTC credit-return leg (manual override, no item lookup)", () => {
      const before = drawerBalance(db, "MTC", "USD");

      repo.createTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: 1_300_000,
        currency: "LBP",
        commission: 0,
        cost: 1_162_000,
        price: 1_300_000,
        paidByMethod: "CASH",
        itemCategory: "mtc",
        returnedCreditsUsd: 10,
      });

      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(before + 10, 4);
    });

    it("Katsh Only-Days sale still books the leg (unchanged legacy behavior)", () => {
      const before = drawerBalance(db, "Alfa", "USD");

      repo.createTransaction({
        provider: "Katsh",
        serviceType: "SEND",
        amount: 1_300_000,
        currency: "LBP",
        commission: 0,
        cost: 1_162_000,
        price: 1_300_000,
        paidByMethod: "CASH",
        itemCategory: "alfa",
        returnedCreditsUsd: 10,
      });

      expect(drawerBalance(db, "Alfa", "USD")).toBeCloseTo(before + 10, 4);
    });

    it("a non-telecom-reseller provider (e.g. OMT_APP cost/price) never books a credit-return leg", () => {
      const mtcBefore = drawerBalance(db, "MTC", "USD");
      const alfaBefore = drawerBalance(db, "Alfa", "USD");

      repo.createTransaction({
        provider: "WHISH_APP",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0,
        cost: 90,
        price: 100,
        paidByMethod: "CASH",
        itemCategory: "mtc",
        returnedCreditsUsd: 10,
      });

      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(mtcBefore, 4);
      expect(drawerBalance(db, "Alfa", "USD")).toBeCloseTo(alfaBefore, 4);
    });
  });

  // ── The computed returned-credit default (spec §2/§5.1) ───────────────────

  describe("Computed returned-credit default (spec §2/§5.1)", () => {
    it("computes maxReturnableCredits(item.credits) when returnedCreditsUsd is omitted and the item's split is complete", () => {
      const item = itemRepo.createItem(CART_77);
      const before = drawerBalance(db, "MTC", "USD");

      const result = repo.createTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: CART_77.sell_days_lbp as number,
        currency: "LBP",
        commission: 0,
        cost: CART_77.cost_lbp,
        price: CART_77.sell_days_lbp as number,
        paidByMethod: "CASH",
        itemCategory: "mtc",
        mobileServiceItemId: item.id,
        // returnedCreditsUsd deliberately omitted — computed default must fire.
      });

      const expected = maxReturnableCredits(CART_77.credits as number);
      expect(expected).toBeCloseTo(73, 4); // the plan's own headline case

      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(before + expected, 4);

      const txnId = txnIdForFsRow(db, result.id);
      const legs = creditReturnPayments(db, txnId);
      expect(legs).toHaveLength(1);
      expect(legs[0]!.amount).toBeCloseTo(expected, 4);
    });

    it("an explicit operator override (including a value below the computed default) always wins", () => {
      const item = itemRepo.createItem(CART_77);
      const before = drawerBalance(db, "MTC", "USD");

      repo.createTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: CART_77.sell_days_lbp as number,
        currency: "LBP",
        commission: 0,
        cost: CART_77.cost_lbp,
        price: CART_77.sell_days_lbp as number,
        paidByMethod: "CASH",
        itemCategory: "mtc",
        mobileServiceItemId: item.id,
        returnedCreditsUsd: 50, // real transfer differed from the computed 73 (spec §2.2)
      });

      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(before + 50, 4);
    });

    it("an explicit override of exactly 0 books nothing, even though the item's split is complete", () => {
      const item = itemRepo.createItem(CART_77);
      const before = drawerBalance(db, "MTC", "USD");

      const result = repo.createTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: CART_77.sell_days_lbp as number,
        currency: "LBP",
        commission: 0,
        cost: CART_77.cost_lbp,
        price: CART_77.sell_days_lbp as number,
        paidByMethod: "CASH",
        itemCategory: "mtc",
        mobileServiceItemId: item.id,
        returnedCreditsUsd: 0,
      });

      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(before, 4);
      const txnId = txnIdForFsRow(db, result.id);
      expect(creditReturnPayments(db, txnId)).toHaveLength(0);
    });

    it("no regression: a split-incomplete item (no days_cost_lbp) books nothing when returnedCreditsUsd is omitted", () => {
      const incomplete = itemRepo.createItem({
        ...CART_77,
        label: "Legacy Cart",
        days_cost_lbp: null,
      });
      const before = drawerBalance(db, "MTC", "USD");

      repo.createTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: 1_300_000,
        currency: "LBP",
        commission: 0,
        cost: 1_162_000,
        price: 1_300_000,
        paidByMethod: "CASH",
        itemCategory: "mtc",
        mobileServiceItemId: incomplete.id,
        // no returnedCreditsUsd, split incomplete -> no default to fall back to.
      });

      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(before, 4);
    });

    it("no regression: every pre-ticket caller (no mobileServiceItemId at all) behaves byte-identically", () => {
      const before = drawerBalance(db, "MTC", "USD");

      // The exact call shape every caller used before this ticket.
      repo.createTransaction({
        provider: "Katsh",
        serviceType: "SEND",
        amount: 1_300_000,
        currency: "LBP",
        commission: 0,
        cost: 1_162_000,
        price: 1_300_000,
        paidByMethod: "CASH",
        itemCategory: "mtc",
        // no mobileServiceItemId, no returnedCreditsUsd
      });

      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(before, 4);
    });
  });

  // ── Real drawer-delta invariant (spec §5.1) ────────────────────────────────
  //
  // The previous "invariant" test was tautological: it computed
  //   net = cost_lbp − booked × (creditCost / booked) = cost_lbp − creditCost = days_cost_lbp
  // algebraically, which holds for ANY booked value — including 0. A bug that
  // books the wrong credit amount still passes that assertion. The tests below
  // pin the ACTUAL drawer rows.
  //
  // Spec §5.1 money table:
  //   iPick/Katsh LBP drawer: −cost_lbp = −7,600,000   (FULL gross, not days fraction)
  //   MTC/Alfa USD drawer:    +73                        (maxReturnableCredits(77))
  //   Primary carrier line:   +73 credits
  //   Net "LBP-equivalent" cost: cost_lbp − maxReturned × recoveredRateLbp = days_cost_lbp
  //
  // Each assertion is independently falsifiable: a bug that zeros the USD credit
  // passes the old test but fails assertion 2; a bug that only books a partial LBP
  // debit passes the old test but fails assertion 1.

  describe("Real drawer-delta invariant (spec §5.1)", () => {
    it("iPick complete-split sale: LBP debit = FULL cost_lbp, MTC USD credit = +73, primary line +73, net LBP = days_cost_lbp", () => {
      const item = itemRepo.createItem(CART_77);
      const line = lineRepo.createLine({
        carrier: "mtc",
        phone_number: "71100001",
      });
      lineRepo.setPrimary(line.id);

      const iPickLbpBefore = drawerBalance(db, "iPick", "LBP");
      const mtcUsdBefore = drawerBalance(db, "MTC", "USD");
      const lineCreditsBefore = lineRepo.getById(line.id)!.credits;

      repo.createTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: CART_77.sell_days_lbp as number,
        currency: "LBP",
        commission: 0,
        cost: CART_77.cost_lbp,
        price: CART_77.sell_days_lbp as number,
        paidByMethod: "CASH",
        itemCategory: "mtc",
        mobileServiceItemId: item.id,
        // returnedCreditsUsd deliberately omitted — computed default fires.
      });

      // 1. Full gross cost left the iPick LBP drawer — NOT just the days fraction.
      //    A bug that sends cost_lbp=days_cost_lbp instead of full cost_lbp
      //    would make this fail; the old algebraic test would still pass it.
      expect(drawerBalance(db, "iPick", "LBP")).toBeCloseTo(
        iPickLbpBefore - CART_77.cost_lbp,
        2,
      );

      // 2. The MTC USD drawer received exactly 73 — maxReturnableCredits(77).
      //    A bug that books 0 or the wrong amount fails here, not in an algebra check.
      const expectedReturned = maxReturnableCredits(CART_77.credits as number);
      expect(expectedReturned).toBeCloseTo(73, 4); // pin the headline case
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(
        mtcUsdBefore + expectedReturned,
        4,
      );

      // 3. The primary carrier line received the same +73.
      expect(lineRepo.getById(line.id)!.credits).toBeCloseTo(
        lineCreditsBefore + expectedReturned,
        4,
      );

      // 4. Net LBP effect = days_cost_lbp — verified via the calc module's
      //    recoveredRateLbp (rule 14, one definition). This assertion NOW depends
      //    on assertions 1+2 being true first: if either drawer delta were wrong
      //    the net would be wrong too, but the earlier concrete assertions catch
      //    that directly so this one is additive, not the primary guard.
      const economics = deriveItemEconomics({
        costLbp: CART_77.cost_lbp,
        daysCostLbp: CART_77.days_cost_lbp,
        creditsUsd: CART_77.credits,
      });
      const recoveredRateLbp = economics.recoveredRateLbp as number;
      const iPickLbpDelta = iPickLbpBefore - drawerBalance(db, "iPick", "LBP"); // positive = debit
      const mtcUsdDelta = drawerBalance(db, "MTC", "USD") - mtcUsdBefore; // positive = credit
      const netLbp = iPickLbpDelta - mtcUsdDelta * recoveredRateLbp;
      expect(netLbp).toBeCloseTo(CART_77.days_cost_lbp as number, 2);
    });

    it("Katsh complete-split sale (alfa item): Katsh LBP debit = FULL cost_lbp, Alfa USD credit = +73, primary alfa line +73, net LBP = days_cost_lbp", () => {
      // The §6.1 fix widened the gate to both reseller apps. This test is the
      // Katsh mirror of the iPick test above — both should behave identically.
      const alfaItem = itemRepo.createItem({
        ...CART_77,
        provider: "Katsh",
        category: "alfa",
        label: "77$ Alfa Cart",
      });
      const alfaLine = lineRepo.createLine({
        carrier: "alfa",
        phone_number: "71100002",
      });
      lineRepo.setPrimary(alfaLine.id);

      const katshLbpBefore = drawerBalance(db, "Katsh", "LBP");
      const alfaUsdBefore = drawerBalance(db, "Alfa", "USD");
      const alfaLineCreditsBefore = lineRepo.getById(alfaLine.id)!.credits;

      repo.createTransaction({
        provider: "Katsh",
        serviceType: "SEND",
        amount: CART_77.sell_days_lbp as number,
        currency: "LBP",
        commission: 0,
        cost: CART_77.cost_lbp,
        price: CART_77.sell_days_lbp as number,
        paidByMethod: "CASH",
        itemCategory: "alfa",
        mobileServiceItemId: alfaItem.id,
      });

      // 1. Full gross cost left the Katsh LBP drawer.
      expect(drawerBalance(db, "Katsh", "LBP")).toBeCloseTo(
        katshLbpBefore - CART_77.cost_lbp,
        2,
      );

      // 2. Alfa USD drawer received +73.
      const expectedReturned = maxReturnableCredits(CART_77.credits as number);
      expect(drawerBalance(db, "Alfa", "USD")).toBeCloseTo(
        alfaUsdBefore + expectedReturned,
        4,
      );

      // 3. Primary alfa line received +73.
      expect(lineRepo.getById(alfaLine.id)!.credits).toBeCloseTo(
        alfaLineCreditsBefore + expectedReturned,
        4,
      );

      // 4. Net LBP effect = days_cost_lbp.
      const economics = deriveItemEconomics({
        costLbp: CART_77.cost_lbp,
        daysCostLbp: CART_77.days_cost_lbp,
        creditsUsd: CART_77.credits,
      });
      const recoveredRateLbp = economics.recoveredRateLbp as number;
      const katshLbpDelta = katshLbpBefore - drawerBalance(db, "Katsh", "LBP");
      const alfaUsdDelta = drawerBalance(db, "Alfa", "USD") - alfaUsdBefore;
      const netLbp = katshLbpDelta - alfaUsdDelta * recoveredRateLbp;
      expect(netLbp).toBeCloseTo(CART_77.days_cost_lbp as number, 2);
    });

    it("split-INCOMPLETE legacy item: cost debit happens, but no extra credit-return (spec §9, no regression)", () => {
      // An item without the split filled in behaves byte-identically to pre-ticket:
      // the provider drawer is debited for the cost, but no MTC/Alfa USD credit
      // leg is added. Pinning this ensures the split-complete gate never fires
      // on old items and silently credits the wrong drawer.
      const incomplete = itemRepo.createItem({
        ...CART_77,
        label: "Legacy Incomplete Cart",
        days_cost_lbp: null,
      });

      const iPickLbpBefore = drawerBalance(db, "iPick", "LBP");
      const mtcUsdBefore = drawerBalance(db, "MTC", "USD");

      repo.createTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: 1_300_000,
        currency: "LBP",
        commission: 0,
        cost: 1_162_000,
        price: 1_300_000,
        paidByMethod: "CASH",
        itemCategory: "mtc",
        mobileServiceItemId: incomplete.id,
        // no returnedCreditsUsd, split incomplete -> no computed default
      });

      // The cost debit still happens (normal iPick cost/price flow).
      expect(drawerBalance(db, "iPick", "LBP")).toBeCloseTo(
        iPickLbpBefore - 1_162_000,
        2,
      );
      // But the MTC USD drawer is UNTOUCHED — no phantom credit-return leg.
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(mtcUsdBefore, 4);
    });
  });

  // ── The carrier-line movement (spec §5.1/§8) ───────────────────────────────

  describe("Carrier-line movement (spec §5.1/§8, rule 20 reversal owner)", () => {
    it("credits the shop's PRIMARY mtc line and ties the movement to this transaction", () => {
      const item = itemRepo.createItem(CART_77);
      const line = lineRepo.createLine({
        carrier: "mtc",
        phone_number: "70111111",
      });
      lineRepo.setPrimary(line.id);

      const result = repo.createTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: CART_77.sell_days_lbp as number,
        currency: "LBP",
        commission: 0,
        cost: CART_77.cost_lbp,
        price: CART_77.sell_days_lbp as number,
        paidByMethod: "CASH",
        itemCategory: "mtc",
        mobileServiceItemId: item.id,
      });

      const txnId = txnIdForFsRow(db, result.id);
      const updatedLine = lineRepo.getById(line.id)!;
      expect(updatedLine.credits).toBeCloseTo(73, 4);

      const movements = movementsForLine(db, line.id);
      expect(movements).toHaveLength(1);
      expect(movements[0]!.transaction_id).toBe(txnId);
      expect(movements[0]!.credits_delta).toBeCloseTo(73, 4);
      expect(movements[0]!.validity_days_delta).toBe(0);
      expect(movements[0]!.reason).toBe("ONLY_DAYS_RETURN");
    });

    it("skips the carrier-line movement (but still books the drawer credit) when no primary line is configured", () => {
      const item = itemRepo.createItem(CART_77);
      const before = drawerBalance(db, "MTC", "USD");

      expect(() =>
        repo.createTransaction({
          provider: "iPick",
          serviceType: "SEND",
          amount: CART_77.sell_days_lbp as number,
          currency: "LBP",
          commission: 0,
          cost: CART_77.cost_lbp,
          price: CART_77.sell_days_lbp as number,
          paidByMethod: "CASH",
          itemCategory: "mtc",
          mobileServiceItemId: item.id,
        }),
      ).not.toThrow();

      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(before + 73, 4);
    });
  });

  // ── Self-charge (spec §5.2) ─────────────────────────────────────────────────

  describe("selfChargeTelecomItem (spec §5.2)", () => {
    it("credits the FULL face value (not maxReturnableCredits), debits the provider drawer, and extends validity", () => {
      const item = itemRepo.createItem({ ...CART_77, validity_days: 30 });
      const line = lineRepo.createLine({
        carrier: "mtc",
        phone_number: "70222222",
        credits: 5,
        validity_expires_at: null,
      });
      lineRepo.setPrimary(line.id);

      const iPickLbpBefore = drawerBalance(db, "iPick", "LBP");
      const mtcUsdBefore = drawerBalance(db, "MTC", "USD");
      const fsCountBefore = (
        db.prepare("SELECT COUNT(*) AS c FROM financial_services").get() as {
          c: number;
        }
      ).c;

      const result = repo.selfChargeTelecomItem({
        mobileServiceItemId: item.id,
      });

      // Full face value (77), NOT maxReturnableCredits(77) = 73 — spec §5.2:
      // no SMS transfer happens, so nothing is burned.
      expect(result.creditsAdded).toBeCloseTo(77, 4);
      expect(result.costLbp).toBeCloseTo(7_600_000, 2);
      expect(result.validityDaysAdded).toBe(30);

      expect(drawerBalance(db, "iPick", "LBP")).toBeCloseTo(
        iPickLbpBefore - 7_600_000,
        2,
      );
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(mtcUsdBefore + 77, 4);

      const updatedLine = lineRepo.getById(line.id)!;
      expect(updatedLine.credits).toBeCloseTo(82, 4); // 5 + 77
      expect(updatedLine.validity_expires_at).not.toBeNull();

      // No sale row, no profit row.
      const fsCountAfter = (
        db.prepare("SELECT COUNT(*) AS c FROM financial_services").get() as {
          c: number;
        }
      ).c;
      expect(fsCountAfter).toBe(fsCountBefore);

      const txn = db
        .prepare(
          "SELECT type, source_table, profit_usd, profit_lbp, client_id FROM transactions WHERE id = ?",
        )
        .get(result.transactionId) as {
        type: string;
        source_table: string;
        profit_usd: number;
        profit_lbp: number;
        client_id: number | null;
      };
      // Review finding M3: a dedicated type, NOT FINANCIAL_SERVICE — see
      // constants/transactionTypes.ts's TELECOM_SELF_CHARGE doc comment for
      // why reusing FINANCIAL_SERVICE orphaned this row against every report
      // that assumes that type is backed by a real financial_services row
      // (ProfitRepository revenue-by-user/-client, receiptGating.ts).
      expect(txn.type).toBe("TELECOM_SELF_CHARGE");
      expect(txn.source_table).toBe("mobile_service_items");
      expect(txn.profit_usd).toBe(0);
      expect(txn.profit_lbp).toBe(0);
      expect(txn.client_id).toBeNull();

      const movements = movementsForLine(db, line.id);
      expect(movements).toHaveLength(1);
      expect(movements[0]!.transaction_id).toBe(result.transactionId);
      expect(movements[0]!.credits_delta).toBeCloseTo(77, 4);
      expect(movements[0]!.validity_days_delta).toBe(30);
      expect(movements[0]!.reason).toBe("SELF_CHARGE");
    });

    it("throws when the item has no primary line and no explicit carrierLineId", () => {
      const item = itemRepo.createItem({ ...CART_77, validity_days: 30 });
      expect(() =>
        repo.selfChargeTelecomItem({ mobileServiceItemId: item.id }),
      ).toThrow(/No primary mtc line configured/);
    });

    it("throws when the item is not alfa/mtc", () => {
      const item = itemRepo.createItem({
        ...CART_77,
        category: "internet",
        label: "Not Telecom",
      });
      expect(() =>
        repo.selfChargeTelecomItem({ mobileServiceItemId: item.id }),
      ).toThrow(/alfa\/mtc/);
    });

    it("throws when the item has no validity_days configured", () => {
      const item = itemRepo.createItem(CART_77); // validity_days omitted -> null
      const line = lineRepo.createLine({
        carrier: "mtc",
        phone_number: "70333333",
      });
      lineRepo.setPrimary(line.id);
      expect(() =>
        repo.selfChargeTelecomItem({ mobileServiceItemId: item.id }),
      ).toThrow(/validity_days/);
    });

    it("an explicit carrierLineId overrides the primary line", () => {
      const item = itemRepo.createItem({ ...CART_77, validity_days: 10 });
      const primary = lineRepo.createLine({
        carrier: "mtc",
        phone_number: "70444444",
      });
      lineRepo.setPrimary(primary.id);
      const other = lineRepo.createLine({
        carrier: "mtc",
        phone_number: "70555555",
      });

      const result = repo.selfChargeTelecomItem({
        mobileServiceItemId: item.id,
        carrierLineId: other.id,
      });

      expect(result.carrierLineId).toBe(other.id);
      expect(lineRepo.getById(other.id)!.credits).toBeCloseTo(77, 4);
      expect(lineRepo.getById(primary.id)!.credits).toBeCloseTo(0, 4);
    });
  });

  // ── Self-charge void path (review finding M3, rule 20) ─────────────────────
  //
  // Proves the transaction-row representation chosen for M3
  // (TRANSACTION_TYPES.TELECOM_SELF_CHARGE, deliberately absent from
  // NON_REVERSIBLE_TRANSACTION_TYPES) stays fully reversible end-to-end, using
  // a REAL `selfChargeTelecomItem` call (not a hand-built transactions row —
  // TransactionRepository.carrierLineReversal.test.ts already covers the
  // hand-built case) voided through the REAL TransactionRepository.
  describe("selfChargeTelecomItem — void path (review finding M3, rule 20)", () => {
    const FUTURE_EXPIRY = "2099-06-15";

    it("VOID nets every ledger the self-charge touched back to its pre-call value: iPick LBP, MTC USD, carrier line credits, AND validity_expires_at", () => {
      const item = itemRepo.createItem({ ...CART_77, validity_days: 30 });
      const line = lineRepo.createLine({
        carrier: "mtc",
        phone_number: "70666666",
        credits: 12,
        validity_expires_at: FUTURE_EXPIRY,
      });
      lineRepo.setPrimary(line.id);

      const iPickLbpBefore = drawerBalance(db, "iPick", "LBP");
      const mtcUsdBefore = drawerBalance(db, "MTC", "USD");
      const lineBefore = lineRepo.getById(line.id)!;

      const result = repo.selfChargeTelecomItem({
        mobileServiceItemId: item.id,
      });

      // Sanity: the seed actually moved every ledger before voiding.
      expect(drawerBalance(db, "iPick", "LBP")).toBeCloseTo(
        iPickLbpBefore - 7_600_000,
        2,
      );
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(mtcUsdBefore + 77, 4);
      const lineAfterCharge = lineRepo.getById(line.id)!;
      expect(lineAfterCharge.credits).toBeCloseTo(89, 4); // 12 + 77
      expect(lineAfterCharge.validity_expires_at).not.toBe(
        lineBefore.validity_expires_at,
      );

      txnRepo.voidTransaction(result.transactionId, 1);

      // Drawers net back to their pre-call values (generic payment-leg
      // reversal — pre-existing mechanism, type-agnostic).
      expect(drawerBalance(db, "iPick", "LBP")).toBeCloseTo(iPickLbpBefore, 2);
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(mtcUsdBefore, 4);

      // The carrier line nets EXACTLY back to its pre-mutation baseline —
      // TransactionRepository._reverseCarrierLineMovements (rule 20 owner).
      const lineAfterVoid = lineRepo.getById(line.id)!;
      expect(lineAfterVoid.credits).toBeCloseTo(lineBefore.credits, 4);
      expect(lineAfterVoid.validity_expires_at).toBe(
        lineBefore.validity_expires_at,
      );

      const movements = movementsForLine(db, line.id);
      expect(movements).toHaveLength(1);
      expect(movements[0]!.transaction_id).toBe(result.transactionId);
    });

    it("double-void does not double-restore: the second void throws, and every ledger stays at its post-first-void value", () => {
      const item = itemRepo.createItem({ ...CART_77, validity_days: 15 });
      const line = lineRepo.createLine({
        carrier: "mtc",
        phone_number: "70777777",
        credits: 3,
        validity_expires_at: FUTURE_EXPIRY,
      });
      lineRepo.setPrimary(line.id);

      const iPickLbpBefore = drawerBalance(db, "iPick", "LBP");
      const mtcUsdBefore = drawerBalance(db, "MTC", "USD");
      const lineBefore = lineRepo.getById(line.id)!;

      const result = repo.selfChargeTelecomItem({
        mobileServiceItemId: item.id,
      });

      txnRepo.voidTransaction(result.transactionId, 1);

      const iPickLbpAfterFirstVoid = drawerBalance(db, "iPick", "LBP");
      const mtcUsdAfterFirstVoid = drawerBalance(db, "MTC", "USD");
      const lineAfterFirstVoid = lineRepo.getById(line.id)!;
      expect(iPickLbpAfterFirstVoid).toBeCloseTo(iPickLbpBefore, 2);
      expect(mtcUsdAfterFirstVoid).toBeCloseTo(mtcUsdBefore, 4);
      expect(lineAfterFirstVoid.credits).toBeCloseTo(lineBefore.credits, 4);
      expect(lineAfterFirstVoid.validity_expires_at).toBe(
        lineBefore.validity_expires_at,
      );

      expect(() => txnRepo.voidTransaction(result.transactionId, 1)).toThrow(
        /already voided/i,
      );

      // State after the REJECTED second attempt is byte-identical to after
      // the first void — no double-restore snuck in before the throw.
      expect(drawerBalance(db, "iPick", "LBP")).toBeCloseTo(
        iPickLbpAfterFirstVoid,
        2,
      );
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(
        mtcUsdAfterFirstVoid,
        4,
      );
      const lineAfterSecondAttempt = lineRepo.getById(line.id)!;
      expect(lineAfterSecondAttempt.credits).toBeCloseTo(
        lineAfterFirstVoid.credits,
        4,
      );
      expect(lineAfterSecondAttempt.validity_expires_at).toBe(
        lineAfterFirstVoid.validity_expires_at,
      );

      const movements = movementsForLine(db, line.id);
      expect(movements).toHaveLength(1);
      expect(movements[0]!.transaction_id).toBe(result.transactionId);
    });

    it("REFUND nets every ledger back to 0 the same way (the other generic reversal entry point)", () => {
      // A REAL (non-null) starting validity — reverseDelta's one documented
      // edge case is a line that started with NO validity at all (null),
      // which is covered by its own dedicated repository-level test, not
      // this end-to-end money-path proof.
      const line = lineRepo.createLine({
        carrier: "alfa",
        phone_number: "70888888",
        credits: 4,
        validity_expires_at: FUTURE_EXPIRY,
      });
      lineRepo.setPrimary(line.id);
      const alfaItem = itemRepo.createItem({
        ...CART_77,
        category: "alfa",
        label: "Alfa 77$ Cart",
        validity_days: 20,
      });

      const alfaUsdBefore = drawerBalance(db, "Alfa", "USD");
      const iPickLbpBefore = drawerBalance(db, "iPick", "LBP");
      const lineBefore = lineRepo.getById(line.id)!;

      const result = repo.selfChargeTelecomItem({
        mobileServiceItemId: alfaItem.id,
      });

      txnRepo.refundTransaction(result.transactionId, 1);

      expect(drawerBalance(db, "iPick", "LBP")).toBeCloseTo(iPickLbpBefore, 2);
      expect(drawerBalance(db, "Alfa", "USD")).toBeCloseTo(alfaUsdBefore, 4);
      const lineAfterRefund = lineRepo.getById(line.id)!;
      expect(lineAfterRefund.credits).toBeCloseTo(lineBefore.credits, 4);
      expect(lineAfterRefund.validity_expires_at).toBe(
        lineBefore.validity_expires_at,
      );
      expect(movementsForLine(db, line.id)[0]!.transaction_id).toBe(
        result.transactionId,
      );
    });
  });

  // ── Only-Days sale — void/reversal path (rule 20, spec §8) ────────────────
  //
  // The `selfChargeTelecomItem` void tests above prove TELECOM_SELF_CHARGE
  // transactions reverse cleanly. This suite proves the same for a real
  // Only-Days sale via `createTransaction` (FINANCIAL_SERVICE type). Both
  // paths write a carrier_line_movements row; both must net to 0 on void/refund.
  //
  // Rule 17: these tests were proven to FAIL before `_reverseCarrierLineMovements`
  // was wired into the void path (the two call sites in TransactionRepository were
  // temporarily commented out and these tests were observed to fail). See the
  // branch's final report for the captured failing output.

  describe("Only-Days createTransaction — void/reversal path (rule 20, spec §8)", () => {
    const FUTURE_EXPIRY = "2099-12-31";

    it("VOID nets every ledger the Only-Days sale touched back to its pre-call value: iPick LBP, MTC USD, carrier line credits", () => {
      const item = itemRepo.createItem(CART_77);
      const line = lineRepo.createLine({
        carrier: "mtc",
        phone_number: "72100001",
        credits: 5,
        validity_expires_at: FUTURE_EXPIRY,
      });
      lineRepo.setPrimary(line.id);

      const iPickLbpBefore = drawerBalance(db, "iPick", "LBP");
      const mtcUsdBefore = drawerBalance(db, "MTC", "USD");
      const lineCreditsBefore = lineRepo.getById(line.id)!.credits;

      const result = repo.createTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: CART_77.sell_days_lbp as number,
        currency: "LBP",
        commission: 0,
        cost: CART_77.cost_lbp,
        price: CART_77.sell_days_lbp as number,
        paidByMethod: "CASH",
        itemCategory: "mtc",
        mobileServiceItemId: item.id,
      });

      // Sanity: the sale moved every ledger before voiding.
      expect(drawerBalance(db, "iPick", "LBP")).toBeCloseTo(
        iPickLbpBefore - CART_77.cost_lbp,
        2,
      );
      const expectedReturned = maxReturnableCredits(CART_77.credits as number);
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(
        mtcUsdBefore + expectedReturned,
        4,
      );
      expect(lineRepo.getById(line.id)!.credits).toBeCloseTo(
        lineCreditsBefore + expectedReturned,
        4,
      );

      const txnId = txnIdForFsRow(db, result.id);
      txnRepo.voidTransaction(txnId, 1);

      // Every ledger returns to its pre-call value.
      expect(drawerBalance(db, "iPick", "LBP")).toBeCloseTo(iPickLbpBefore, 2);
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(mtcUsdBefore, 4);
      expect(lineRepo.getById(line.id)!.credits).toBeCloseTo(
        lineCreditsBefore,
        4,
      );

      // The movement row is marked reversed (not deleted).
      const movements = movementsForLine(db, line.id);
      expect(movements).toHaveLength(1);
      expect(movements[0]!.transaction_id).toBe(txnId);
      const movementRow = db
        .prepare(
          "SELECT is_reversed FROM carrier_line_movements WHERE carrier_line_id = ?",
        )
        .get(line.id) as { is_reversed: number };
      expect(movementRow.is_reversed).toBe(1);
    });

    it("double-void does not double-restore: second void throws, all ledgers stay at post-first-void value", () => {
      const item = itemRepo.createItem(CART_77);
      const line = lineRepo.createLine({
        carrier: "mtc",
        phone_number: "72100002",
        credits: 2,
        validity_expires_at: FUTURE_EXPIRY,
      });
      lineRepo.setPrimary(line.id);

      const iPickLbpBefore = drawerBalance(db, "iPick", "LBP");
      const mtcUsdBefore = drawerBalance(db, "MTC", "USD");
      const lineCreditsBefore = lineRepo.getById(line.id)!.credits;

      const result = repo.createTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: CART_77.sell_days_lbp as number,
        currency: "LBP",
        commission: 0,
        cost: CART_77.cost_lbp,
        price: CART_77.sell_days_lbp as number,
        paidByMethod: "CASH",
        itemCategory: "mtc",
        mobileServiceItemId: item.id,
      });

      const txnId = txnIdForFsRow(db, result.id);
      txnRepo.voidTransaction(txnId, 1);

      // Capture ledger values after the first (valid) void.
      const iPickLbpAfterVoid = drawerBalance(db, "iPick", "LBP");
      const mtcUsdAfterVoid = drawerBalance(db, "MTC", "USD");
      const lineCreditsAfterVoid = lineRepo.getById(line.id)!.credits;

      // These should all be back to pre-call values.
      expect(iPickLbpAfterVoid).toBeCloseTo(iPickLbpBefore, 2);
      expect(mtcUsdAfterVoid).toBeCloseTo(mtcUsdBefore, 4);
      expect(lineCreditsAfterVoid).toBeCloseTo(lineCreditsBefore, 4);

      // Second void must throw — the "already voided" guard.
      expect(() => txnRepo.voidTransaction(txnId, 1)).toThrow(
        /already voided/i,
      );

      // All ledgers remain at their post-first-void values — no double-restore.
      expect(drawerBalance(db, "iPick", "LBP")).toBeCloseTo(
        iPickLbpAfterVoid,
        2,
      );
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(mtcUsdAfterVoid, 4);
      expect(lineRepo.getById(line.id)!.credits).toBeCloseTo(
        lineCreditsAfterVoid,
        4,
      );
    });
  });
});
