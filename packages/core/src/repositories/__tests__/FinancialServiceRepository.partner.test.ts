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
      partner_mode          TEXT CHECK(partner_mode IN ('THROUGH', 'FOR'))
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
    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      provider   TEXT,
      is_active  INTEGER DEFAULT 1,
      is_system  INTEGER DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT',   'OMT',   1);
    INSERT INTO suppliers (name, provider, is_system) VALUES ('WHISH', 'WHISH', 1);

    -- Supplier ledger (SupplierRepository FK target)
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
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
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
    repo = new FinancialServiceRepository();
    mockAddCredit.mockClear();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
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

      it("does NOT credit OMT_System drawer (the disbursement leg IS the money movement)", () => {
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

        expect(drawerBalance(db, "OMT_System")).toBe(before);
      });

      it("debits General by the disbursed amount (shop fronts the transfer via cash OUT leg)", () => {
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

        expect(drawerBalance(db, "General")).toBeCloseTo(before - 105, 2);
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
    });

    // ── OMT RECEIVE ───────────────────────────────────────────────────────────

    describe("OMT RECEIVE for partner", () => {
      // NOTE (PFT-3b, commit 3ad8204): FOR-mode RECEIVE now books the
      // incoming funds as a real inflow to the service's own drawer (the
      // shop actually received the money into its OMT wallet/account) and
      // owes the partner a CREDIT settled later. The pre-PFT-3b model
      // DEBITED the system drawer to simulate an immediate walk-in payout,
      // which no longer happens in FOR mode (no walk-in customer — see
      // lira-119's "RECEIVE (all): drawer sign" failing-first discriminator).
      it("credits OMT_System drawer (funds arrive; shop owes partner at settlement)", () => {
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

        // OMT_System must be CREDITED — the money physically arrived in our system
        expect(drawerBalance(db, "OMT_System")).toBeGreaterThan(before);
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

    // NOTE (PFT-3b, commit 3ad8204): a FOR-partner financial service has no
    // walk-in customer, so `cashoutMethod`/`clientId` are meaningless for
    // FOR-mode RECEIVE and are simply ignored — the service drawer is
    // CREDITED with the incoming funds either way (see the "credits
    // OMT_System drawer" case above). This case now proves that passing a
    // CUSTOMER_ACCOUNT cashout hint does not change that outcome (it no
    // longer flips the drawer to a debit, as the pre-PFT-3b model did).
    it("still credits OMT_System for FOR RECEIVE even with a CUSTOMER_ACCOUNT cashout hint (no walk-in customer in FOR mode)", () => {
      const partnerId = seedPartner(db);
      const clientId = seedClient(db);
      const before = drawerBalance(db, "OMT_System");

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
      });

      // FOR mode: cashoutMethod is ignored; funds physically arrive, so credit.
      expect(drawerBalance(db, "OMT_System")).toBeGreaterThan(before);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Normal transactions — regression guard (no partner)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Normal transactions — no partner (regression guard)", () => {
    it("OMT SEND — General nets to zero and OMT_System is credited when no partner", () => {
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

      // 3-drawer pattern: customer payment (+105) and cash reserve (-105) cancel out
      expect(drawerBalance(db, "General")).toBe(generalBefore);
      expect(drawerBalance(db, "OMT_System")).toBeGreaterThan(omtBefore);
    });

    it("OMT RECEIVE debits OMT_System and General when no partner", () => {
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

      expect(drawerBalance(db, "OMT_System")).toBeLessThan(omtBefore);
      expect(drawerBalance(db, "General")).toBeLessThan(generalBefore);
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
});
