/**
 * FinancialServiceRepository — Partner Mode Tests
 *
 * Verifies drawer effects and partner ledger entries for every combination:
 *
 *   FOR  mode  → partner uses OUR system
 *                - SEND:    System drawer credited  / General skipped / DEBIT partner (amount+fee)
 *                - RECEIVE: System drawer debited   / cashout skipped / CREDIT partner (amount only)
 *
 *   THROUGH mode → we use THEIR system
 *                - SEND:    System drawer skipped / CREDIT partner (amount)
 *                - RECEIVE: System drawer skipped / DEBIT partner  (amount)
 *
 *   Normal (no partner) → existing behaviour unchanged (regression guard)
 *
 *   Bug fix guard → CUSTOMER_ACCOUNT cashout on THROUGH RECEIVE must NOT debit system drawer
 *
 * All tests run against an in-memory SQLite database.  Sub-repositories
 * (TransactionRepository, SupplierRepository) share the same mock connection
 * and therefore the same test DB — no extra mocking needed for them.
 *
 * DebtService (used only for CUSTOMER_ACCOUNT cashout) is mocked at the
 * module level so these tests stay focused and free of debt-schema setup.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getSupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

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

// ─── Mock DebtService (CUSTOMER_ACCOUNT cashout only) ────────────────────────

const mockAddCredit = jest.fn();
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: mockAddCredit }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema ────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    -- Users (FK target)
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT DEFAULT 'staff',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    -- Clients (FK target for financial_services / debt_ledger)
    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      balance_usd  REAL DEFAULT 0,
      balance_lbp  REAL DEFAULT 0,
      notes        TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Partners
    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      phone       TEXT,
      notes       TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Financial services (main table under test)
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
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
      partner_id            INTEGER REFERENCES partners(id),
      partner_mode          TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      commission_model      INTEGER NOT NULL DEFAULT 0,
      -- v68: required by TransactionRepository._markSourceRefunded, which
      -- every void/refund of a financial_services-sourced transaction hits
      -- unconditionally (task B/void proof needs a real void to complete).
      is_refunded           INTEGER NOT NULL DEFAULT 0,
      refunded_at           TEXT DEFAULT NULL
    );

    -- Partner ledger (tracks debits / credits per partner)
    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id       INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT NOT NULL,
      reference_table  TEXT,
      reference_id     INTEGER,
      amount           REAL NOT NULL,
      currency         TEXT NOT NULL DEFAULT 'USD',
      direction        TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes            TEXT,
      user_id          INTEGER REFERENCES users(id),
      settlement_method TEXT,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount   REAL NOT NULL DEFAULT 0
    );

    -- Unified accounting journal (TransactionRepository)
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
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Payment sub-ledger rows (one row per drawer movement)
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

    -- Drawer balances (live ledger updated by upsertBalanceDelta)
    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    -- Suppliers (SupplierRepository FK target)
    -- contact_name/phone/note are required, not cosmetic: SupplierRepository's
    -- getColumns() override selects them explicitly, so getByProvider() (and
    -- every other read) throws "no such column" without them — silently
    -- swallowed by FinancialServiceRepository's try/catch, which is exactly
    -- why the supplier-ledger side effects this file now asserts (task B)
    -- were previously unbookable here at all.
    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      contact_name TEXT,
      phone        TEXT,
      note         TEXT,
      provider     TEXT,
      is_active    INTEGER DEFAULT 1,
      is_system    INTEGER DEFAULT 0,
      module_key   TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT',   'OMT',   1);
    INSERT INTO suppliers (name, provider, is_system) VALUES ('WHISH', 'WHISH', 1);

    -- Supplier ledger (SupplierRepository FK target)
    -- v110/v120/v136 columns (is_auto / is_refunded+refunded_at /
    -- source_ref_table+source_ref_id) are REQUIRED, not cosmetic: without
    -- is_auto, SupplierRepository.addLedgerEntry's INSERT throws (the column
    -- is in every INSERT variant) and FinancialServiceRepository's call site
    -- swallows that in a try/catch — so a schema missing this column made
    -- EVERY auto supplier-ledger booking in this file silently no-op, which
    -- is exactly why the FOR-partner RECEIVE gross entry (task B) was
    -- previously unprovable here. source_ref_table/id + is_refunded/
    -- refunded_at are required for the void-reversal proof (rule 20) to run
    -- at all (TransactionRepository._cascadeSupplierSiblingVoid /
    -- _markSourceRefunded). Mirrors
    -- TransactionRepository.supplierSiblingVoidCascade.test.ts's fixture.
    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type  TEXT NOT NULL,
      amount_usd  REAL NOT NULL DEFAULT 0,
      amount_lbp  REAL NOT NULL DEFAULT 0,
      note        TEXT,
      created_by  INTEGER,
      transaction_id INTEGER,
      is_auto     INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      source_ref_table TEXT DEFAULT NULL,
      source_ref_id    INTEGER DEFAULT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Debt ledger — NOT exercised via CUSTOMER_ACCOUNT legs in this file
    -- (DebtService is mocked at the module level for that), but
    -- TransactionRepository._cancelDebt queries this table unconditionally
    -- on every void/refund regardless of transaction type (no early-return
    -- by type), so a void call crashes without it.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      created_by       INTEGER,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed drawer balances
    INSERT INTO drawer_balances VALUES (1, 'General',      'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',      'LBP',    0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'USD',  500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD',  500, CURRENT_TIMESTAMP);
  `);

  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedPartner(db: Database.Database, name = "TestPartner"): number {
  return Number(
    db.prepare("INSERT INTO partners (name) VALUES (?)").run(name)
      .lastInsertRowid,
  );
}

function seedClient(db: Database.Database): number {
  return Number(
    db
      .prepare("INSERT INTO clients (full_name, phone_number) VALUES (?, ?)")
      .run("Test Client", "0000000000").lastInsertRowid,
  );
}

function drawerBalance(
  db: Database.Database,
  drawer: string,
  currency = "USD",
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function partnerLedger(db: Database.Database, partnerId: number) {
  return db
    .prepare("SELECT * FROM partner_ledger WHERE partner_id = ? ORDER BY id")
    .all(partnerId) as Array<{
    transaction_type: string;
    amount: number;
    currency: string;
    direction: string;
    reference_id: number;
    reference_table: string;
  }>;
}

function supplierIdByProvider(db: Database.Database, provider: string): number {
  const row = db
    .prepare("SELECT id FROM suppliers WHERE provider = ?")
    .get(provider) as { id: number };
  return row.id;
}

function ledgerRowsForSupplier(db: Database.Database, supplierId: number) {
  return db
    .prepare(
      "SELECT * FROM supplier_ledger WHERE supplier_id = ? ORDER BY id ASC",
    )
    .all(supplierId) as Array<{
    id: number;
    entry_type: string;
    amount_usd: number;
    amount_lbp: number;
    tenant_id: number;
    is_refunded: number;
    source_ref_table: string | null;
    source_ref_id: number | null;
    transaction_id: number | null;
  }>;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("FinancialServiceRepository — partner mode", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    // Sub-repositories are singletons — reset so they don't hold any stale
    // per-instance state across tests (mirrors
    // TransactionRepository.supplierSiblingVoidCascade.test.ts's fixture).
    resetSupplierRepository();
    resetTransactionRepository();
    repo = new FinancialServiceRepository();
    mockAddCredit.mockClear();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FOR mode — partner uses OUR system
  // ═══════════════════════════════════════════════════════════════════════════

  describe("FOR mode — partner uses our system", () => {
    // ── OMT SEND ─────────────────────────────────────────────────────────────

    describe("OMT SEND for partner", () => {
      // NOTE (PFT-3b, commit 3ad8204): FOR-mode SEND for OMT/WHISH/OMT_APP/
      // WHISH_APP no longer reserves/credits the system drawer. The shop
      // fronts the transfer via an explicit OUT disbursement leg (drawer
      // follows the leg's method); the partner owes exactly what the shop
      // disbursed. `FinancialServiceRepository.ts` now throws
      // "A partner SEND must include the shop's disbursement as OUT payment
      // legs" if no such leg is supplied — these five cases were written
      // against the pre-PFT-3b model (system-drawer credit, no legs
      // required) and are updated here to match the new contract; see
      // frontend/tests/e2e-electron/lira-119-partner-for-financial-service.spec.ts
      // for the owner-validated catalog this now follows.
      const disbursementLeg = (amount: number) => ({
        payments: [
          {
            method: "CASH",
            currencyCode: "USD",
            amount,
            direction: "OUT" as const,
          },
        ],
      });

      // Primary Cash Drawer plan §8.2 (2026-07-30): the disbursement leg's
      // drawer is resolved by `resolveServiceCashDrawer(method, ctx)`, not
      // hardcoded to General. Since this transaction's provider ("OMT")
      // equals the shop's base system ("OMT", the fixture's default — no
      // system_settings row means FinancialServiceRepository's try/catch
      // falls back to "OMT"), the CASH disbursement leg IS a primary-system
      // cash-family leg and lands in the PCD (OMT_System), exactly like a
      // walk-in SEND's customer-cash leg. This is a genuine behavior change
      // from the pre-PCD model (where a FOR-partner SEND's disbursement was
      // deliberately routed to General because the system drawer was a
      // provider-side float, not real till cash) — under the current model
      // there is only ONE physical cash drawer for primary-system transfers,
      // and every cash leg on that system uses it, partner or not (decision
      // #6: "route by the SYSTEM the transaction runs on, not the
      // counterparty").
      // rule 17: this file's PRE-existing assertion ("stays at `before`") was
      // run against the implemented primary-cash-drawer production code
      // (`npx jest FinancialServiceRepository.partner.test.ts`, 2026-07-30)
      // and observed to FAIL — `Expected: 500, Received: 395`, i.e.
      // OMT_System DOES move under the current implementation. 395 is what
      // the implemented `resolveServiceCashDrawer` actually produces for
      // these inputs (verified by running the suite, not re-derived by hand
      // alone) — matching the arithmetic derivation in the comment below.
      it("debits OMT_System (PCD) by the disbursed amount — the disbursement leg IS the money movement, and OMT is the primary system", () => {
        const partnerId = seedPartner(db);
        const before = drawerBalance(db, "OMT_System");

        repo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5,
          partnerId,
          partnerMode: "FOR",
          ...disbursementLeg(105),
        });

        // 395 = before(500) - 105 (principal 100 + fee 5, the full CASH OUT
        // disbursement leg, routed to the PCD by resolveServiceCashDrawer).
        expect(drawerBalance(db, "OMT_System")).toBeCloseTo(before - 105, 2);
      });

      // rule 17: this file's PRE-existing assertion (`before - 105`) was run
      // against the implemented production code and observed to FAIL —
      // `Expected: 895, Received: 1000`, i.e. General is NOT touched under
      // the current implementation. Flipped to "unchanged" below, verified
      // green by running the suite.
      it("does NOT touch General (the disbursement leg now targets the PCD, not General)", () => {
        const partnerId = seedPartner(db);
        const before = drawerBalance(db, "General");

        repo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5,
          partnerId,
          partnerMode: "FOR",
          ...disbursementLeg(105),
        });

        expect(drawerBalance(db, "General")).toBe(before);
      });

      it("creates a DEBIT ledger entry for exactly what the shop disbursed (partner owes us everything)", () => {
        const partnerId = seedPartner(db);

        repo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5,
          partnerId,
          partnerMode: "FOR",
          ...disbursementLeg(105),
        });

        const entries = partnerLedger(db, partnerId);
        expect(entries).toHaveLength(1);
        expect(entries[0].direction).toBe("DEBIT");
        expect(entries[0].transaction_type).toBe("FOR_OMT_SEND");
        expect(entries[0].amount).toBeCloseTo(105, 2); // matches the disbursed OUT leg (100 + 5 fee)
        expect(entries[0].currency).toBe("USD");
      });

      it("ledger reference_id points to the financial_services row", () => {
        const partnerId = seedPartner(db);

        const { id: fsId } = repo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5,
          partnerId,
          partnerMode: "FOR",
          ...disbursementLeg(105),
        });

        const entries = partnerLedger(db, partnerId);
        expect(entries[0].reference_id).toBe(fsId);
        expect(entries[0].reference_table).toBe("financial_services");
      });

      it("stores partner_id and partner_mode = FOR on the financial_services row", () => {
        const partnerId = seedPartner(db);

        const { id } = repo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5,
          partnerId,
          partnerMode: "FOR",
          ...disbursementLeg(105),
        });

        const row = db
          .prepare(
            "SELECT partner_id, partner_mode FROM financial_services WHERE id = ?",
          )
          .get(id) as { partner_id: number; partner_mode: string };

        expect(row.partner_id).toBe(partnerId);
        expect(row.partner_mode).toBe("FOR");
      });

      // Task C (open owner question, PRIMARY_CASH_DRAWER_PLAN.md §6 item 6a):
      // decision #6 (2026-07-30) resolved the gross supplier-ledger question
      // for the FOR-partner RECEIVE side only (see the "books a gross
      // supplier-ledger TOP_UP entry" test below, in the RECEIVE block) — the
      // SEND side was deliberately left alone. This test pins TODAY'S
      // behavior (no entry), not an endorsement: the transfer still runs on
      // the real OMT rails on the SEND side too, so a symmetric gross entry
      // is arguably owed there as well — flagged as unresolved in the plan,
      // NOT fixed here (this pass is test-only; the asymmetry is a
      // production question for the owner, not a test bug).
      it("[OPEN OWNER QUESTION — see plan §6 item 6a] books NO supplier-ledger entry for a FOR-partner SEND (pre-existing asymmetry, not an endorsement)", () => {
        const partnerId = seedPartner(db);
        const omtId = supplierIdByProvider(db, "OMT");

        repo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5,
          partnerId,
          partnerMode: "FOR",
          ...disbursementLeg(105),
        });

        // The FOR-partner dispatch returns early (FinancialServiceRepository.ts,
        // "PFT-3b — FOR-PARTNER DISPATCH") before the generic auto-record
        // supplier-debt block ever runs, and the SEND arm of the dispatch
        // itself never calls supplierRepo.addLedgerEntry — unlike the
        // RECEIVE arm, which does (see below). Zero rows is TODAY'S
        // behavior, asserted so nobody reads this green suite as having
        // resolved the SEND-side question.
        expect(ledgerRowsForSupplier(db, omtId)).toHaveLength(0);
      });
    });

    // ── OMT RECEIVE ───────────────────────────────────────────────────────────

    describe("OMT RECEIVE for partner", () => {
      // Primary Cash Drawer plan §2#6 / decision #6 (2026-07-30 follow-up —
      // supersedes the PFT-3b note this test used to carry): a FOR-partner
      // RECEIVE runs on the shop's OWN primary system but moves NO drawer at
      // transaction time — no real cash arrived in the PCD (the partner's
      // own customer dealt with the PARTNER's counter, not the shop's till).
      // Obligations only: the provider still owes/is owed on the real OMT
      // rails (gross supplier ledger — see the dedicated test below) and the
      // partner owes the shop on their tab (partner ledger, tested further
      // below). The partner's later collection pays out of the PCD at
      // settlement — not here.
      // rule 17: this file's PRE-existing assertion (`toBeGreaterThan`) was
      // run against the implemented production code and observed to FAIL —
      // `Expected: > 500, Received: 500` (OMT_System does NOT move). Flipped
      // to "unchanged" below, verified green by running the suite.
      it("does NOT move the PCD (OMT_System) at transaction time — obligations only (decision #6)", () => {
        const partnerId = seedPartner(db);
        const before = drawerBalance(db, "OMT_System");

        repo.createTransaction({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 100,
          currency: "USD",
          commission: 1,
          cashoutMethod: "CASH",
          partnerId,
          partnerMode: "FOR",
        });

        // No drawer moves — the partner's customer dealt with the partner's
        // own till, not ours. The obligation is captured in the supplier
        // ledger (next test) and the partner ledger (test below), not here.
        expect(drawerBalance(db, "OMT_System")).toBe(before);
      });

      // ── Task B: the FOR-partner RECEIVE gross supplier-ledger booking ──────
      //
      // This is BRAND NEW production code (FinancialServiceRepository.ts,
      // the "isPrimarySystemProvider" branch inside the FOR-RECEIVE arm of
      // the PFT-3b dispatch) — before decision #6 this path booked NOTHING
      // to the supplier ledger (the old model credited the system-drawer
      // float instead, so the provider relationship needed no separate
      // entry). It is the least-proven thing in the whole feature, so this
      // block asserts: the entry EXISTS, carries the GROSS amount (not
      // fee-only, not the partner-credit amount), is tenant-scoped, and
      // reverses to exactly 0 on void (rule 20).
      it("books a gross supplier-ledger TOP_UP entry for the provider (obligations only, decision #6)", () => {
        const partnerId = seedPartner(db);
        const omtId = supplierIdByProvider(db, "OMT");

        repo.createTransaction({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 100, // x
          currency: "USD",
          commission: 0.5, // c — no omtServiceType, so this is NOT overridden
          // by the auto-calc block (that only fires when omtServiceType is
          // set); calculatedCommission stays exactly `data.commission`.
          omtFee: 5, // f — resolvedProviderFee reads `data.omtFee ?? 0` directly.
          cashoutMethod: "CASH",
          partnerId,
          partnerMode: "FOR",
        });

        // grossOwedDelta(RECEIVE) = -(x - f + c) = -(100 - 5 + 0.5) = -95.5.
        // Matches PRIMARY_CASH_DRAWER_PLAN.md §8.3's worked example exactly
        // (x=100, f=5, c=0.5 → RECEIVE books -95.5).
        const entries = ledgerRowsForSupplier(db, omtId);
        expect(entries).toHaveLength(1);
        expect(entries[0].entry_type).toBe("TOP_UP"); // never PAYMENT — addLedgerEntry force-negates only PAYMENT
        expect(entries[0].amount_usd).toBeCloseTo(-95.5, 2);
        expect(entries[0].amount_lbp).toBe(0);
        // Tenant-scoped: booked under initFixedTenantContext(1) — must carry
        // that tenant, not a default/null/other tenant's row.
        expect(entries[0].tenant_id).toBe(1);
        // Back-linked to the parent financial_services row so the generic
        // void/refund path can find and cascade-void this sibling (rule 20).
        expect(entries[0].source_ref_table).toBe("financial_services");
        expect(entries[0].is_refunded).toBe(0);
      });

      it("reverses the gross supplier-ledger entry to net exactly 0 on void (rule 20)", () => {
        const partnerId = seedPartner(db);
        const omtId = supplierIdByProvider(db, "OMT");

        const { id: fsId } = repo.createTransaction({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 100,
          currency: "USD",
          commission: 0.5,
          omtFee: 5,
          cashoutMethod: "CASH",
          partnerId,
          partnerMode: "FOR",
        });

        // Sanity: the entry exists and books the gross amount before void.
        const balanceBefore = getSupplierRepository().getSupplierBalance(omtId);
        expect(balanceBefore.balance_usd).toBeCloseTo(-95.5, 2);

        const parentTxn = getTransactionRepository().getBySourceId(
          "financial_services",
          fsId,
        );
        expect(parentTxn).not.toBeNull();

        getTransactionRepository().voidTransaction(parentTxn!.id, 1);

        // getSupplierBalance is the correct "nets to 0" proof (rule 20): it
        // sums only unrefunded rows (CLAUDE.md rule 15/20 pattern — the raw
        // SUM is NOT the right check here, since the original row stays in
        // place, soft-flagged, not compensated by an opposite row).
        const balanceAfter = getSupplierRepository().getSupplierBalance(omtId);
        expect(balanceAfter.balance_usd).toBe(0);
        expect(balanceAfter.balance_lbp).toBe(0);

        // The original row itself is soft-voided, not deleted or replaced.
        const rows = ledgerRowsForSupplier(db, omtId);
        expect(rows).toHaveLength(1);
        expect(rows[0].is_refunded).toBe(1);
      });

      it("does NOT debit General drawer (partner pays out their own customer)", () => {
        const partnerId = seedPartner(db);
        const before = drawerBalance(db, "General");

        repo.createTransaction({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 100,
          currency: "USD",
          commission: 1,
          cashoutMethod: "CASH",
          partnerId,
          partnerMode: "FOR",
        });

        expect(drawerBalance(db, "General")).toBe(before);
      });

      it("creates a CREDIT ledger entry for amount only (commission kept by shop)", () => {
        const partnerId = seedPartner(db);

        repo.createTransaction({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 100,
          currency: "USD",
          commission: 1, // shop keeps this — NOT included in partner credit
          cashoutMethod: "CASH",
          partnerId,
          partnerMode: "FOR",
        });

        const entries = partnerLedger(db, partnerId);
        expect(entries).toHaveLength(1);
        expect(entries[0].direction).toBe("CREDIT"); // we owe partner
        expect(entries[0].transaction_type).toBe("FOR_OMT_RECEIVE");
        expect(entries[0].amount).toBeCloseTo(100, 2); // payout only, NOT 101
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CQ-4 (COUNTERPARTY_CONSOLIDATION_PLAN.md) — the charge-routing guard
  // trio, now shared via moneyPosting.ts's assertNoCounterPayment /
  // assertNoCustomerAccountLeg. These repo-level tests are the ONLY jest
  // proof that the FOR-partner dispatch actually WIRES the shared guards
  // (a unit test on the guard functions alone, in moneyPosting.test.ts,
  // proves the function's own logic but not that this repo calls it) —
  // SalesRepository/RechargeRepository/LotoTicketRepository have no
  // equivalent jest fixtures for FOR-partner mode at all (pre-existing gap;
  // their rejection is proven only by e2e lira-113/115/116/118).
  // ═══════════════════════════════════════════════════════════════════════════

  describe("CQ-4 guard wiring — counter-payment / mutual-exclusivity rejection", () => {
    it("rejects a counter payment (IN leg) on a FOR-partner financial service", () => {
      const partnerId = seedPartner(db);

      expect(() =>
        repo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5,
          partnerId,
          partnerMode: "FOR",
          payments: [{ method: "CASH", currencyCode: "USD", amount: 50 }],
        }),
      ).toThrow(/no counter payment/i);
    });

    it("rejects a CUSTOMER_ACCOUNT leg arriving as a return/OUT leg on a FOR-partner financial service", () => {
      const partnerId = seedPartner(db);

      expect(() =>
        repo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5,
          partnerId,
          partnerMode: "FOR",
          payments: [
            {
              method: "CUSTOMER_ACCOUNT",
              currencyCode: "USD",
              amount: 50,
              direction: "OUT",
            },
          ],
        }),
      ).toThrow(/CUSTOMER_ACCOUNT/);
    });

    it("does not throw for a valid FOR-partner disbursement (no counter payment, no CUSTOMER_ACCOUNT leg)", () => {
      const partnerId = seedPartner(db);

      expect(() =>
        repo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5,
          partnerId,
          partnerMode: "FOR",
          payments: [
            {
              method: "CASH",
              currencyCode: "USD",
              amount: 105,
              direction: "OUT",
            },
          ],
        }),
      ).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // THROUGH mode — we use THEIR system
  // ═══════════════════════════════════════════════════════════════════════════

  describe("THROUGH mode — we use their system", () => {
    // ── WHISH SEND ───────────────────────────────────────────────────────────

    describe("WHISH SEND through partner", () => {
      it("does NOT credit Whish_System drawer (it is not our system)", () => {
        const partnerId = seedPartner(db);
        const before = drawerBalance(db, "Whish_System");

        repo.createTransaction({
          provider: "WHISH",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          whishFee: 3,
          partnerId,
          partnerMode: "THROUGH",
          paidByMethod: "CASH",
        });

        expect(drawerBalance(db, "Whish_System")).toBe(before);
      });

      it("creates a CREDIT ledger entry (we owe partner for their system usage)", () => {
        const partnerId = seedPartner(db);

        repo.createTransaction({
          provider: "WHISH",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          whishFee: 3,
          partnerId,
          partnerMode: "THROUGH",
          paidByMethod: "CASH",
        });

        const entries = partnerLedger(db, partnerId);
        expect(entries).toHaveLength(1);
        expect(entries[0].direction).toBe("CREDIT");
        expect(entries[0].transaction_type).toBe("THROUGH_WHISH_SEND");
      });
    });

    // ── WHISH RECEIVE ─────────────────────────────────────────────────────────

    describe("WHISH RECEIVE through partner", () => {
      it("does NOT debit Whish_System drawer (it is not our system)", () => {
        const partnerId = seedPartner(db);
        const before = drawerBalance(db, "Whish_System");

        repo.createTransaction({
          provider: "WHISH",
          serviceType: "RECEIVE",
          amount: 100,
          currency: "USD",
          commission: 1,
          cashoutMethod: "CASH",
          partnerId,
          partnerMode: "THROUGH",
        });

        expect(drawerBalance(db, "Whish_System")).toBe(before);
      });

      it("creates a DEBIT ledger entry (partner owes us)", () => {
        const partnerId = seedPartner(db);

        repo.createTransaction({
          provider: "WHISH",
          serviceType: "RECEIVE",
          amount: 100,
          currency: "USD",
          commission: 1,
          cashoutMethod: "CASH",
          partnerId,
          partnerMode: "THROUGH",
        });

        const entries = partnerLedger(db, partnerId);
        expect(entries).toHaveLength(1);
        expect(entries[0].direction).toBe("DEBIT");
        expect(entries[0].transaction_type).toBe("THROUGH_WHISH_RECEIVE");
      });
    });

    it("defaults to THROUGH mode when partnerMode is omitted", () => {
      const partnerId = seedPartner(db);

      const { id } = repo.createTransaction({
        provider: "WHISH",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0,
        partnerId,
        // partnerMode intentionally omitted
        paidByMethod: "CASH",
      });

      const row = db
        .prepare("SELECT partner_mode FROM financial_services WHERE id = ?")
        .get(id) as { partner_mode: string };

      expect(row.partner_mode).toBe("THROUGH");

      const entries = partnerLedger(db, partnerId);
      expect(entries).toHaveLength(1);
      expect(entries[0].transaction_type).toMatch(/^THROUGH_/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOMER_ACCOUNT cashout — bug fix guard
  // ═══════════════════════════════════════════════════════════════════════════

  describe("CUSTOMER_ACCOUNT cashout — THROUGH partner must NOT debit system drawer", () => {
    it("does not debit Whish_System for THROUGH RECEIVE with CUSTOMER_ACCOUNT cashout", () => {
      const partnerId = seedPartner(db);
      const clientId = seedClient(db);
      const before = drawerBalance(db, "Whish_System");

      repo.createTransaction({
        provider: "WHISH",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        cashoutMethod: "CUSTOMER_ACCOUNT",
        clientId,
        partnerId,
        partnerMode: "THROUGH",
      });

      // Bug fix: skipSystemDrawer=true for THROUGH, so system drawer must stay unchanged
      expect(drawerBalance(db, "Whish_System")).toBe(before);
    });

    // Primary Cash Drawer plan §2#6 / decision #6 (2026-07-30): a FOR-partner
    // financial service has no walk-in customer, so `cashoutMethod`/
    // `clientId` are meaningless for FOR-mode RECEIVE — under decision #6 the
    // RECEIVE branch never reads `cashoutMethod` at all (no drawer moves at
    // transaction time either way). This test used to pin THAT as "ignored,
    // no drawer movement" (`.not.toThrow()`, implicitly, by calling
    // `createTransaction` unwrapped). FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md
    // §3 slice 2 wires `cashoutMethod` into the shared guard specifically
    // because "ignored" is the bug, not a feature: the value still reached
    // `financial_services.paid_by`/`metadata_json.paid_by` as if it had
    // executed (LIRA-114's audit-trail complaint, this repo's own flavor of
    // it). Flipped to "rejected before any row is written" below.
    // rule 17: observed FAILING against the pre-slice-2 code (temporarily
    // reverted `paidBy` back to `undefined` in the `assertNoCounterPayment`
    // call) — the call did NOT throw, confirming this was a live gap, not
    // just a stale comment.
    it("REJECTS a CUSTOMER_ACCOUNT cashout hint for FOR RECEIVE instead of silently ignoring it (no walk-in customer in FOR mode — the stale value must not reach the audit trail)", () => {
      const partnerId = seedPartner(db);
      const clientId = seedClient(db);
      const before = drawerBalance(db, "OMT_System");

      expect(() =>
        repo.createTransaction({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 100,
          currency: "USD",
          commission: 1,
          cashoutMethod: "CUSTOMER_ACCOUNT",
          clientId,
          partnerId,
          partnerMode: "FOR",
        }),
      ).toThrow(/Customer Account/i);

      // Nothing committed — the whole db.transaction rolled back.
      expect(drawerBalance(db, "OMT_System")).toBe(before);
      const rows = db
        .prepare("SELECT COUNT(*) c FROM financial_services")
        .get() as { c: number };
      expect(rows.c).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Normal transactions — regression guard (no partner)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Normal transactions — no partner (regression guard)", () => {
    // Primary Cash Drawer plan §1/§2#1 (2026-07-30, supersedes this test's
    // prior float-model title and comments): OMT is the primary system here
    // (the fixture's default baseSystem), so the customer's CASH leg is a
    // primary-system cash-family leg and routes to the PCD (OMT_System) via
    // `resolveServiceCashDrawer`, not General — there is no "reserve" leg of
    // any kind anymore (the float model's 3-drawer cancel-to-0 pattern is
    // gone; so is #66's "General keeps the cash-in permanently" reading).
    // rule 17: this file's PRE-existing assertion
    // (`generalBefore + 105` on General) was run against the implemented
    // production code and observed to FAIL — `Expected: 1105, Received: 1000`
    // (General is untouched). Flipped below to "unchanged", and to OMT_System
    // increasing by the full customer cash-in — verified green by running
    // the suite.
    it("OMT SEND — the customer's cash-in lands in OMT_System (PCD), General is untouched, when no partner", () => {
      const generalBefore = drawerBalance(db, "General");
      const omtBefore = drawerBalance(db, "OMT_System");

      repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        omtFee: 5,
        paidByMethod: "CASH",
      });

      // General is never touched by a primary-system CASH leg under this model.
      expect(drawerBalance(db, "General")).toBe(generalBefore);
      // 605 = omtBefore(500) + totalCustomerPays(105), where
      // totalCustomerPays = sentAmount(100) + providerFeeAmt(5) — the whole
      // customer cash-in (principal + fee), fee-on-top — lands in the PCD.
      expect(drawerBalance(db, "OMT_System")).toBeCloseTo(omtBefore + 105, 2);
    });

    // rule 17: this file's PRE-existing assertion (`toBeGreaterThan(omtBefore)`
    // on OMT_System) was run against the implemented production code and
    // observed to FAIL — `Expected: > 500, Received: 400` (OMT_System
    // DECREASES). Flipped below to reflect the payout being debited FROM the
    // PCD, and General staying untouched — verified green by running the
    // suite.
    it("OMT RECEIVE — the payout is debited from OMT_System (PCD), General is untouched, when no partner", () => {
      const omtBefore = drawerBalance(db, "OMT_System");
      const generalBefore = drawerBalance(db, "General");

      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 1,
        cashoutMethod: "CASH",
      });

      // 400 = omtBefore(500) - payoutAmount(100); no omtFee supplied on this
      // RECEIVE, so receiveFeeAmt=0 and payoutAmount = receiveAmount = 100.
      // The CASH cashout is a primary-system cash-family leg and comes OUT of
      // the PCD, not General.
      expect(drawerBalance(db, "OMT_System")).toBeCloseTo(omtBefore - 100, 2);
      // General is never touched by a primary-system CASH cashout under this model.
      expect(drawerBalance(db, "General")).toBe(generalBefore);
    });

    it("creates NO partner_ledger entries for normal transactions", () => {
      repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        paidByMethod: "CASH",
      });

      const count = (
        db.prepare("SELECT COUNT(*) as cnt FROM partner_ledger").get() as {
          cnt: number;
        }
      ).cnt;
      expect(count).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Task D: walk-in on the secondary system is rejected — this guard
  // PRE-DATES the primary-cash-drawer model (FEATURE_GUIDE §8 "Walk-in on the
  // secondary system is rejected") and must survive it unchanged: it lives in
  // FinancialServiceRepository.ts BEFORE any drawer/ledger predicate this
  // file's other tests re-derive, and is provider/baseSystem-driven, not
  // PCD-driven, so the model swap should not touch it at all. Asserted here
  // (not just left to OmtSystemFeeCharacterization.test.ts's CASE 8/8b)
  // because this file is the partner-semantics owner and the guard is the
  // hinge between "walk-in" and "route through a partner".
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Walk-in on the secondary system (regression guard, predates this change)", () => {
    it("throws when a walk-in transaction targets the secondary system with no partnerId", () => {
      // Fixture default baseSystem is "OMT" (no system_settings row — see
      // createTestDb's comment-free fallback, matching
      // FinancialServiceRepository.ts's try/catch default). WHISH is
      // therefore the secondary system here.
      expect(() =>
        repo.createTransaction({
          provider: "WHISH",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          whishFee: 3,
          paidByMethod: "CASH",
          // no partnerId — this is the case that must be rejected.
        }),
      ).toThrow(/secondary system/i);
    });

    it("does NOT throw for the same transaction routed through a partner (THROUGH mode)", () => {
      // Negative control: the guard is specifically about a MISSING
      // partnerId on the secondary system, not about the secondary system
      // itself — routing through a partner must keep working (this file's
      // "WHISH SEND through partner" block already exercises this path; this
      // assertion pins the boundary right next to the throw case above).
      const partnerId = seedPartner(db);
      expect(() =>
        repo.createTransaction({
          provider: "WHISH",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          whishFee: 3,
          partnerId,
          partnerMode: "THROUGH",
          paidByMethod: "CASH",
        }),
      ).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Multi-partner isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Multi-partner isolation", () => {
    it("each partner accumulates their own ledger entries independently", () => {
      const p1 = seedPartner(db, "Partner A");
      const p2 = seedPartner(db, "Partner B");

      repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        omtFee: 5,
        partnerId: p1,
        partnerMode: "FOR",
        // PFT-3b: FOR-mode SEND requires the shop's disbursement as an
        // explicit OUT payment leg (see the "OMT SEND for partner" block).
        payments: [
          {
            method: "CASH",
            currencyCode: "USD",
            amount: 105,
            direction: "OUT",
          },
        ],
      });

      repo.createTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 200,
        currency: "USD",
        commission: 2,
        cashoutMethod: "CASH",
        partnerId: p2,
        partnerMode: "FOR",
      });

      const p1Entries = partnerLedger(db, p1);
      const p2Entries = partnerLedger(db, p2);

      expect(p1Entries).toHaveLength(1);
      expect(p1Entries[0].direction).toBe("DEBIT"); // p1 owes us

      expect(p2Entries).toHaveLength(1);
      expect(p2Entries[0].direction).toBe("CREDIT"); // we owe p2

      // Cross-contamination guard
      expect(p1Entries[0].reference_id).not.toBe(p2Entries[0].reference_id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3 slice 2 — wire the REAL
  // legacy field (`paidByMethod` / `cashoutMethod`) into the shared guard.
  // Slice 1 (cc45227) left this repo passing `undefined` as a mechanical,
  // zero-behavior-change placeholder — these tests prove the wiring closes
  // the gap without over-blocking the ONE branch (OMT/WHISH-family SEND
  // transfers) that has a genuine disbursement-source concept.
  //
  // `paidBy` (line ~897 of FinancialServiceRepository.ts) already unifies
  // `data.cashoutMethod` (RECEIVE) and `data.paidByMethod` (SEND/BILL) — the
  // fix passes THAT variable instead of `undefined`. Every OTHER FOR-partner
  // branch (cost/price catalog, BINANCE SEND, RECEIVE) already hard-requires
  // `returnLegs.length === 0` — no legitimate disbursement concept exists
  // there — so a non-CASH legacy value reaching any of those branches is,
  // by construction, dead/stale data, never a real instruction. Verified
  // against every live caller (FinancialForm.tsx, OmtWhishAppTransferForm.tsx,
  // Services/index.tsx): none of them sends a non-CASH `paidByMethod`/
  // `cashoutMethod` top-level field on a FOR-partner submission — the
  // disbursement selection travels through the OUT leg's own `method`
  // instead (Services/index.tsx's state management guarantees the two never
  // diverge: `paidByMethod` only leaves "CASH" when `paymentLines` is
  // populated, which is exactly when the top-level field is superseded by
  // `payments[]` and never sent at all).
  // ═══════════════════════════════════════════════════════════════════════════

  describe("§3 slice 2 — legacy paidByMethod/cashoutMethod wiring", () => {
    // rule 17: observed FAILING against the pre-slice-2 code (`undefined` in
    // place of `paidBy`) — `createTransaction` returned successfully instead
    // of throwing, and `financial_services.paid_by`/`metadata_json.paid_by`
    // both recorded "CUSTOMER_ACCOUNT" despite the RECEIVE branch never
    // crediting any customer account (decision #6: no drawer, no debt — the
    // partner is credited, nothing else).
    it("rejects a stale CUSTOMER_ACCOUNT cashoutMethod on a FOR-partner RECEIVE (dead legacy field — no walk-in customer to credit)", () => {
      const partnerId = seedPartner(db);

      expect(() =>
        repo.createTransaction({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 100,
          currency: "USD",
          commission: 1,
          cashoutMethod: "CUSTOMER_ACCOUNT",
          partnerId,
          partnerMode: "FOR",
        }),
      ).toThrow(/Customer Account/i);
    });

    it("rejects a stale non-CASH paidByMethod on a FOR-partner cost/price catalog sale (iPick) — that branch forbids ALL legs, so any non-CASH value here is dead data", () => {
      const partnerId = seedPartner(db);

      expect(() =>
        repo.createTransaction({
          provider: "iPick",
          serviceType: "SEND",
          amount: 100.66,
          currency: "USD",
          commission: 0,
          cost: 90,
          price: 100.66,
          paidByMethod: "CUSTOMER_ACCOUNT",
          partnerId,
          partnerMode: "FOR",
        }),
      ).toThrow(/Customer Account/i);
    });

    it("rejects a stale drawer-affecting paidByMethod (e.g. OMT) on a FOR-partner BINANCE SEND — that branch forbids ALL legs too (USDT leaves the drawer directly, no counter payment concept)", () => {
      const partnerId = seedPartner(db);

      expect(() =>
        repo.createTransaction({
          provider: "BINANCE",
          serviceType: "SEND",
          amount: 60.55,
          currency: "USDT",
          commission: 2,
          paidByMethod: "OMT",
          partnerId,
          partnerMode: "FOR",
        }),
      ).toThrow(/no counter payment/i);
    });

    // Over-blocking proof: the ONE branch with a genuine disbursement-source
    // concept (OMT/WHISH-family SEND transfers) must keep working when
    // `paidByMethod` carries the neutral "CASH" value every live form
    // sends/defaults to, alongside the required OUT disbursement leg.
    it("does NOT over-block a legitimate FOR-partner SEND disbursement — paidByMethod='CASH' alongside the required OUT leg still succeeds", () => {
      const partnerId = seedPartner(db);

      expect(() =>
        repo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5,
          paidByMethod: "CASH",
          partnerId,
          partnerMode: "FOR",
          payments: [
            {
              method: "CASH",
              currencyCode: "USD",
              amount: 105,
              direction: "OUT",
            },
          ],
        }),
      ).not.toThrow();
    });

    // "Also" fix — moneyPosting.ts's assertPartnerIdRequired doc used to
    // document this as a permanent, un-fixed asymmetry: FinancialService's
    // OWN `isForPartner` is `!!(partnerId && mode === "FOR")`, so a bare
    // `mode: "FOR"` with no partnerId silently fell through to the walk-in
    // dispatch and ran as an ordinary, non-partner transaction.
    // rule 17: observed FAILING against the pre-fix code — the call
    // returned successfully (walk-in dispatch), `financial_services.partner_id`
    // was NULL, and no partner_ledger row was ever created for this payload.
    it("throws for a bare partnerMode 'FOR' with no partnerId, instead of silently falling through to the walk-in dispatch", () => {
      expect(() =>
        repo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5,
          partnerMode: "FOR",
          paidByMethod: "CASH",
          // no partnerId
        }),
      ).toThrow(/partnerId is required/i);
    });
  });
});
