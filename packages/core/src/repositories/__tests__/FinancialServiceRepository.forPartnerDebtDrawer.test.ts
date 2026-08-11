/**
 * BUG 2 repro — "a FOR-partner service paid by DEBT still moves the General
 * drawer" (owner report, verbatim: "lets say we did a service for partner
 * called '7welet souria' and payment method debt; it's affecting the
 * general drawer. Why?").
 *
 * "Payment method DEBT" in the current app is the `CUSTOMER_ACCOUNT`
 * payment-method code — the UI label is literally "Customer Account
 * (Debt)" (frontend/src/shared/components/__tests__/MultiPaymentInput.test.tsx
 * line 44). The legacy `DEBT` code was renamed to `CUSTOMER_ACCOUNT` in
 * migration v86 ("consolidate_customer_account_code") and no longer exists
 * as a registered payment-method row anywhere in the current schema
 * (create_db.sql, TenantRepository.seedPaymentMethods) — confirmed by
 * grepping the whole frontend for the literal string "DEBT": zero hits.
 *
 * This file empirically checks every way a FOR-partner (and, per the task's
 * ask, THROUGH-partner) financial service can reach the General drawer when
 * CUSTOMER_ACCOUNT/DEBT is the selected payment method, plus one adjacent
 * finding (THROUGH + a real drawer-affecting leg sent in the modern
 * `payments[]` array shape) that surfaced while tracing the guard chain.
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
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { isDrawerAffectingMethod } from "../../utils/payments";

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

// ─── In-memory schema (mirrors FinancialServiceRepository.partner.test.ts,
//     with `debt_ledger.due_date` added — bookClientDebtCharge's INSERT
//     names that column, and the CUSTOMER_ACCOUNT-leg paths below need it to
//     succeed instead of throwing "no such column: due_date") ─────────────

function createTestDb(withPaymentMethodsTable: boolean): Database.Database {
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
      balance_usd  REAL DEFAULT 0,
      balance_lbp  REAL DEFAULT 0,
      notes        TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      is_refunded           INTEGER NOT NULL DEFAULT 0,
      refunded_at           TEXT DEFAULT NULL
    );

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

    -- due_date added (missing from the sibling partner.test.ts fixture) —
    -- bookClientDebtCharge's INSERT names this column explicitly.
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
      due_date         DATETIME,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    INSERT INTO drawer_balances VALUES (1, 'General',      'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',      'LBP',    0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'USD',  500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD',  500, CURRENT_TIMESTAMP);
  `);

  if (withPaymentMethodsTable) {
    // Mirrors the CURRENT real schema (create_db.sql v147): only
    // CUSTOMER_ACCOUNT is seeded — the legacy 'DEBT' code was renamed away
    // in migration v86 and no row for it exists anywhere in a real DB.
    db.exec(`
      CREATE TABLE payment_methods (
        tenant_id INTEGER DEFAULT 1,
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        code           TEXT NOT NULL,
        label          TEXT NOT NULL,
        drawer_name    TEXT NOT NULL,
        affects_drawer INTEGER NOT NULL DEFAULT 1,
        sort_order     INTEGER NOT NULL DEFAULT 0,
        is_active      INTEGER NOT NULL DEFAULT 1,
        is_system      INTEGER NOT NULL DEFAULT 0,
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO payment_methods (tenant_id, code, label, drawer_name, affects_drawer, sort_order, is_active, is_system)
        VALUES (1, 'CASH', 'Cash', 'General', 1, 1, 1, 1);
      INSERT INTO payment_methods (tenant_id, code, label, drawer_name, affects_drawer, sort_order, is_active, is_system)
        VALUES (1, 'CUSTOMER_ACCOUNT', 'Customer Account (Debt)', 'General', 0, 4, 1, 1);
    `);
  }

  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedPartner(db: Database.Database, name = "7welet souria"): number {
  return Number(
    db.prepare("INSERT INTO partners (name) VALUES (?)").run(name)
      .lastInsertRowid,
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

function debtLedgerRows(db: Database.Database) {
  return db.prepare("SELECT * FROM debt_ledger").all() as Array<{
    amount_usd: number;
    amount_lbp: number;
  }>;
}

describe("BUG 2 repro — FOR/THROUGH-partner financial service paid by DEBT (CUSTOMER_ACCOUNT)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  function setup(withPaymentMethodsTable: boolean) {
    db = createTestDb(withPaymentMethodsTable);
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    resetPaymentMethodRepository();
    repo = new FinancialServiceRepository();
  }

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
    resetPaymentMethodRepository();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Primary ask: FOR-partner + DEBT — does General move?
  // ═══════════════════════════════════════════════════════════════════════

  describe("FOR mode — the exact scenario the owner described", () => {
    it("SEND disbursed via CUSTOMER_ACCOUNT ('Debt') is REJECTED before any drawer write — General delta is 0 because the transaction never commits", () => {
      setup(true);
      const partnerId = seedPartner(db);
      const generalBefore = drawerBalance(db, "General");

      // This is exactly the payload frontend/src/features/services/pages/
      // Services/index.tsx builds for a FOR-partner SEND: ONE leg, method =
      // whatever the operator picked in the (unfiltered, not
      // forPartner-aware) payment-method dropdown, direction "OUT" (the
      // shop's disbursement).
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
              amount: 105,
              direction: "OUT",
            },
          ],
        }),
      ).toThrow(/CUSTOMER_ACCOUNT/);

      // General drawer delta is 0 — the ASSERT the task asked for. It is
      // satisfied because `assertNoCustomerAccountLeg` (moneyPosting.ts)
      // throws before `processReturnLegs` ever runs, not because the leg
      // was correctly routed around a drawer.
      expect(drawerBalance(db, "General")).toBe(generalBefore);

      // No partial row survives either — this.db.transaction(...) rolled
      // the whole thing back.
      const rows = db
        .prepare("SELECT COUNT(*) c FROM financial_services")
        .get() as { c: number };
      expect(rows.c).toBe(0);
    });

    // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3 slice 2: this test used to
    // pin the exact gap the plan names for this repo — "the server ignores
    // cashoutMethod entirely for FOR-partner RECEIVE" — as a `.not.toThrow()`
    // characterization. "Ignored" was the bug, not a feature: the stale value
    // still reached `financial_services.paid_by`/`metadata_json.paid_by` as
    // if it had executed, exactly LIRA-114's audit-trail complaint applied to
    // this repo's RECEIVE branch. Flipped to "rejected before any row is
    // written" below.
    // rule 17: observed FAILING against the pre-slice-2 code (`paidBy` was
    // computed but never passed to `assertNoCounterPayment`, which received
    // `undefined` instead) — the call did NOT throw, confirming this was a
    // live gap, not just a stale comment/title.
    it("REJECTS a CUSTOMER_ACCOUNT cashout hint for a FOR-partner RECEIVE — the stale value must not reach the audit trail", () => {
      setup(true);
      const partnerId = seedPartner(db);
      const generalBefore = drawerBalance(db, "General");
      const omtSystemBefore = drawerBalance(db, "OMT_System");

      // Mirrors the real payload: forPartner RECEIVE forces `payments: []`
      // client-side (Services/index.tsx), but `cashoutMethod` is still sent
      // unconditionally for every RECEIVE.
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
          payments: [],
        }),
      ).toThrow(/Customer Account/i);

      // Nothing committed — this.db.transaction(...) rolled the whole thing back.
      expect(drawerBalance(db, "General")).toBe(generalBefore);
      expect(drawerBalance(db, "OMT_System")).toBe(omtSystemBefore);
      const rows = db
        .prepare("SELECT COUNT(*) c FROM financial_services")
        .get() as { c: number };
      expect(rows.c).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // "try THROUGH mode and CUSTOMER_ACCOUNT too" (task's own suggestion)
  // ═══════════════════════════════════════════════════════════════════════

  describe("THROUGH mode + CUSTOMER_ACCOUNT — the debt leg itself never touches General", () => {
    it("SEND with a CUSTOMER_ACCOUNT leg sent in the modern payments[] array books client debt, General delta is 0", () => {
      setup(true);
      const partnerId = seedPartner(db);
      const generalBefore = drawerBalance(db, "General");

      const { id } = repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        omtFee: 5,
        partnerId,
        partnerMode: "THROUGH",
        clientName: "Walk-in Debtor",
        phoneNumber: "70000000",
        payments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 105 },
        ],
      });

      expect(id).toBeGreaterThan(0);
      expect(drawerBalance(db, "General")).toBe(generalBefore);
      expect(drawerBalance(db, "OMT_System")).toBe(500); // untouched

      const debtRows = debtLedgerRows(db);
      expect(debtRows).toHaveLength(1);
      expect(debtRows[0].amount_usd).toBeCloseTo(105, 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // LIRA-125 (fixed 2026-08-10) — this block used to document a real split:
  // THROUGH mode + a REAL drawer-affecting leg sent via the modern
  // payments[] array format (what the live frontend always sends —
  // MultiPaymentInput never leaves paymentLines empty) credited General/PCD
  // while the legacy single-`paidByMethod` fallback path explicitly skipped
  // crediting ANY drawer "for partner transactions" — same business event,
  // two different answers depending only on payload shape
  // (PARTNER_DISBURSEMENT_MATRIX.md rows 2 vs 3). Fixed by dropping the
  // legacy path's extra `&& !data.partnerId` clause, so it now shares the
  // exact same predicate (`isDrawerAffectingMethod` alone) the multi-leg
  // loop already used. All three tests below now assert the AGREED
  // (correct, real-money-moves) behavior for both payload shapes.
  // ═══════════════════════════════════════════════════════════════════════

  describe("LIRA-125 — THROUGH mode: legacy paidByMethod and modern payments[] now agree", () => {
    it("single-leg legacy paidByMethod path CREDITS the Primary Cash Drawer for a THROUGH-partner SEND (matches the multi-leg loop below)", () => {
      setup(true);
      const partnerId = seedPartner(db);
      const generalBefore = drawerBalance(db, "General");
      const omtSystemBefore = drawerBalance(db, "OMT_System");

      repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        omtFee: 5,
        partnerId,
        partnerMode: "THROUGH",
        paidByMethod: "CASH", // no `payments` array at all
      });

      // OMT is the base system, so CASH routes to the Primary Cash Drawer
      // (OMT_System), never General — the SAME drawer/amount the multi-leg
      // sibling test below observes for the identical logical transaction.
      expect(drawerBalance(db, "OMT_System")).toBeCloseTo(
        omtSystemBefore + 105,
        2,
      );
      expect(drawerBalance(db, "General")).toBe(generalBefore);
    });

    it("multi-leg payments:[{CASH}] path (the shape the real UI actually sends) credits the SAME drawer, by the SAME amount, for the identical logical transaction (parity proof)", () => {
      setup(true);
      const partnerId = seedPartner(db);
      const generalBefore = drawerBalance(db, "General");

      repo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        omtFee: 5,
        partnerId,
        partnerMode: "THROUGH",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
      });

      // OMT is the (default, no system_settings row) base system, so the
      // cash leg routes to the Primary Cash Drawer (OMT_System), not
      // General directly — asserting the ACTUAL observed drawer below.
      expect(drawerBalance(db, "General")).toBe(generalBefore);
      expect(drawerBalance(db, "OMT_System")).toBeCloseTo(605, 2); // 500 + 105
    });

    it("General specifically: both shapes land the credit on General when the provider is the SECONDARY system (WHISH, not primary here)", () => {
      setup(true);
      const partnerId = seedPartner(db);
      const generalBefore = drawerBalance(db, "General");

      repo.createTransaction({
        provider: "WHISH",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0,
        whishFee: 3,
        partnerId,
        partnerMode: "THROUGH",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 103 }],
      });

      // resolveServiceCashDrawer only reroutes to the PCD when
      // ctx.provider === ctx.baseSystem (OMT here). WHISH is secondary, so
      // paymentMethodToDrawerName("CASH") falls through to "General" — and,
      // as above, nothing in the multi-leg loop skips it for a partner
      // transaction.
      expect(drawerBalance(db, "General")).toBeCloseTo(
        generalBefore + 103,
        2,
      );
      expect(drawerBalance(db, "Whish_System")).toBe(500); // correctly untouched
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Direct unit check of the utility the task asked to verify: does the
  // literal string "DEBT" (the RETIRED code, pre-migration-v86) resolve
  // correctly via isDrawerAffectingMethod? Answer depends on whether the
  // payment_methods table is reachable — this is the LIRA-105 canonical
  // vs unregistered-code fallback discrepancy the task flagged.
  // ═══════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════
  // LIRA-114 — owner's exact repro: partner "7welet souria", cost $1008,
  // price $1010, payment method Customer Account, in the Services module's
  // cost/price flow (KatchForm-style catalog item — iPick/Katsh/app-wallet).
  // These are the SAME figures LIRA-115 reproduces (session-basket refund).
  //
  // Root-cause conclusion (see current_sprint.md LIRA-114 for the full
  // trace): the literal scenario — a FOR-partner cost/price sale where the
  // customer "pays" (an IN-direction leg, any method including
  // CUSTOMER_ACCOUNT) — is rejected before any drawer write, exactly like
  // the plain-SEND case above rejects an OUT-direction CUSTOMER_ACCOUNT
  // disbursement. The rejecting guard here is actually the MORE general
  // `assertNoCounterPayment` ("a partner financial service takes no counter
  // payment"), which fires for ANY IN-direction payment leg regardless of
  // method — there is no walk-in customer on a FOR-partner sale, so the
  // operator's payment-method choice never even gets evaluated. A
  // FOR-partner cost/price sale that DOES succeed (no payment legs at all —
  // "the full selling price goes on the partner's tab") debits the COST
  // from the PROVIDER'S OWN drawer (iPick), never General. For every
  // provider actually reachable from the shipped UI, that is correct
  // accounting (the shop genuinely spent iPick stock), not a routing bug —
  // `mapDrawerName` only falls back to "General" for provider
  // "BOB"/"OTHER", which no shipped form ever sends.
  // ═══════════════════════════════════════════════════════════════════════

  describe("LIRA-114 — FOR-partner cost/price sale (owner's exact cost 1008 / price 1010)", () => {
    it("cost/price sale with a CUSTOMER_ACCOUNT (customer-paid, IN) leg is REJECTED before any drawer write — General delta is 0", () => {
      setup(true);
      const partnerId = seedPartner(db);
      const generalBefore = drawerBalance(db, "General");
      const iPickBefore = drawerBalance(db, "iPick");

      expect(() =>
        repo.createTransaction({
          provider: "iPick",
          serviceType: "SEND",
          amount: 1010,
          currency: "USD",
          commission: 0,
          cost: 1008,
          price: 1010,
          partnerId,
          partnerMode: "FOR",
          payments: [
            {
              method: "CUSTOMER_ACCOUNT",
              currencyCode: "USD",
              amount: 1010,
            },
          ],
        }),
      ).toThrow(/no counter payment/);

      // Neither drawer moved — the transaction never committed.
      expect(drawerBalance(db, "General")).toBe(generalBefore);
      expect(drawerBalance(db, "iPick")).toBe(iPickBefore);
      const rows = db
        .prepare("SELECT COUNT(*) c FROM financial_services")
        .get() as { c: number };
      expect(rows.c).toBe(0);
    });

    it("cost/price sale with NO payment legs (the only way FOR-partner + cost/price succeeds) debits iPick's OWN drawer for the cost — General is untouched, partner_ledger owes the price", () => {
      setup(true);
      const partnerId = seedPartner(db);
      const generalBefore = drawerBalance(db, "General");
      const iPickBefore = drawerBalance(db, "iPick");

      const { id } = repo.createTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: 1010,
        currency: "USD",
        commission: 0,
        cost: 1008,
        price: 1010,
        partnerId,
        partnerMode: "FOR",
        payments: [],
      });

      expect(id).toBeGreaterThan(0);
      // The cost leaves iPick's own provider drawer — never General.
      expect(drawerBalance(db, "General")).toBe(generalBefore);
      expect(drawerBalance(db, "iPick")).toBeCloseTo(iPickBefore - 1008, 2);

      // The partner owes the full selling price on their tab.
      const ledgerRows = db
        .prepare(
          "SELECT transaction_type, amount, currency, direction FROM partner_ledger WHERE partner_id = ?",
        )
        .all(partnerId) as Array<{
        transaction_type: string;
        amount: number;
        currency: string;
        direction: string;
      }>;
      expect(ledgerRows).toHaveLength(1);
      expect(ledgerRows[0]).toMatchObject({
        transaction_type: "FOR_IPICK",
        amount: 1010,
        currency: "USD",
        direction: "DEBIT",
      });
    });
  });

  describe("isDrawerAffectingMethod('DEBT') — the retired code name, resolved directly", () => {
    it("with the real payment_methods table present (current schema — no DEBT row, only CUSTOMER_ACCOUNT): resolves to NOT drawer-affecting", () => {
      setup(true);
      expect(isDrawerAffectingMethod("DEBT")).toBe(false);
      expect(isDrawerAffectingMethod("CUSTOMER_ACCOUNT")).toBe(false);
    });

    it("with the payment_methods table absent (DB-unavailable fallback — matches most jest fixtures in this repo, including the sibling *.partner.test.ts file): 'DEBT' WRONGLY resolves to drawer-affecting", () => {
      setup(false);
      // Confirms the exact discrepancy the task asked to check: the
      // catch-block fallback in payments.ts (`return
      // !NON_DRAWER_METHODS.has(method)`) has never heard of "DEBT" (it was
      // never a key of NON_DRAWER_METHODS or FALLBACK_DRAWER_MAP), so it
      // defaults an unrecognised legacy code to `true`. Nothing in the
      // current codebase sends this literal string as a method any more
      // (grep confirms zero hits in frontend/src), so this is a latent
      // inconsistency, not the owner's live repro — documented here so it
      // doesn't quietly regress if a future caller resurrects the literal.
      expect(isDrawerAffectingMethod("DEBT")).toBe(true);
      // CUSTOMER_ACCOUNT is correctly non-drawer-affecting even on this
      // fallback path, because it IS a key of NON_DRAWER_METHODS.
      expect(isDrawerAffectingMethod("CUSTOMER_ACCOUNT")).toBe(false);
    });
  });
});
