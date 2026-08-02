/**
 * SupplierRepository — Settlement Tests
 *
 * Primary-cash-drawer model (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md
 * §1/§8, superseding the float model the day after it shipped, 2026-07-30):
 * `supplier_ledger` TOP_UP rows for OMT/WHISH are booked GROSS
 * (`grossOwedDelta` — SEND `+(x+f−c)`, RECEIVE `−(x−(f−c))`,
 * FinancialServiceRepository.ts) — the shop's commission is embedded in
 * what's owed, not carved out separately. `OMT_System`/`Whish_System` is no
 * longer a provider float — it IS the shop's physical primary cash drawer
 * (PCD), so a CASH settlement leg paid to the shop's PRIMARY-system
 * supplier (`supplier.provider === shop_base_system`) resolves to the PCD
 * (decision #10, via `resolveServiceCashDrawer`); a non-primary supplier's
 * settlement is unaffected and keeps paying out of General.
 *
 * Tests the atomic settleTransactions() method, which:
 * 1. Creates a SETTLEMENT supplier_ledger entry (negative = paying out the
 *    gross amount already owed — nets the ledger to 0 against the TOP_UP
 *    rows being settled; no separate "minus commission" step, since the
 *    shop's cut is already embedded in the gross figure)
 * 2. Marks financial_services rows as is_settled = 1
 * 3. Creates a unified transactions row for audit trail (commission
 *    stamped as informational metadata only — no separate drawer effect)
 * 4. Debits the net payment EXCLUSIVELY through real payment-method legs
 *    (`payments[]`, same mechanism `recordSupplierCashflow` uses, resolved
 *    through `resolveServiceCashDrawer`) — never a bare named drawer.
 *
 * Also tests the RechargeRepository.topUpFromSupplier() flow for
 * Katsh/iPick supplier-credit topups.
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";
import { RechargeRepository } from "../RechargeRepository";

// ─── Minimal in-memory schema ─────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      module_key TEXT,
      provider TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE', 'SUPPLIER_PAYS_US', 'DISCOUNT')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      device_id TEXT,
      summary TEXT,
      metadata_json TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed drawers
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'USD', 500);
  `);

  return db;
}

// ─── Mock the connection module ────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedSupplier(db: Database.Database, provider = "OMT"): number {
  const res = db
    .prepare(
      "INSERT INTO suppliers (name, provider, is_system) VALUES (?, ?, 1)",
    )
    .run(provider, provider);
  return Number(res.lastInsertRowid);
}

function seedUnsettledTransaction(
  db: Database.Database,
  provider: string,
  amount: number,
  commission: number,
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (provider, service_type, amount, currency, commission, is_settled)
       VALUES (?, 'RECEIVE', ?, 'USD', ?, 0)`,
    )
    .run(provider, amount, commission);
  return Number(res.lastInsertRowid);
}

function seedSettledTransaction(
  db: Database.Database,
  provider: string,
  amount: number,
  commission: number,
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (provider, service_type, amount, currency, commission, is_settled)
       VALUES (?, 'SEND', ?, 'USD', ?, 1)`,
    )
    .run(provider, amount, commission);
  return Number(res.lastInsertRowid);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SupplierRepository.settleTransactions()", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Basic happy path
  // ─────────────────────────────────────────────────────────────────────────

  it("creates a SETTLEMENT ledger entry with negative net amount", () => {
    const supplierId = seedSupplier(db);
    const txn1 = seedUnsettledTransaction(db, "OMT", 100, 0.1);
    const txn2 = seedUnsettledTransaction(db, "OMT", 150, 0.2);

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txn1, txn2],
      amount_usd: 249.7, // fee-net amount owed (already excludes commission)
      amount_lbp: 0,
      commission_usd: 0.3, // informational only — no drawer effect
      commission_lbp: 0,
      created_by: 1,
      note: "March settlement",
      payments: [{ method: "CASH", currency_code: "USD", amount: 249.7 }],
    });

    const entry = db
      .prepare("SELECT * FROM supplier_ledger WHERE supplier_id = ?")
      .get(supplierId) as any;

    expect(entry).toBeDefined();
    expect(entry.entry_type).toBe("SETTLEMENT");
    expect(entry.amount_usd).toBe(-249.7); // stored as negative (shop paying out)
    expect(entry.note).toBe("March settlement");
  });

  it("stamps CURRENT_TIMESTAMP-format created_at — never ISO (A6 ordering)", () => {
    const supplierId = seedSupplier(db);
    const txn1 = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txn1],
      amount_usd: 100,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
    });

    // ISO strings ('...T...Z') string-sort ABOVE every 'YYYY-MM-DD HH:MM:SS'
    // row of the same day ('T' > ' '), pinning settlement rows to the top of
    // ORDER BY created_at DESC lists. All stamps must be SQLite-format.
    const SQLITE_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

    const ledger = db
      .prepare("SELECT created_at FROM supplier_ledger WHERE supplier_id = ?")
      .get(supplierId) as { created_at: string };
    expect(ledger.created_at).toMatch(SQLITE_TS);

    const txn = db
      .prepare(
        "SELECT created_at FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT'",
      )
      .get() as { created_at: string };
    expect(txn.created_at).toMatch(SQLITE_TS);

    const fs = db
      .prepare("SELECT settled_at FROM financial_services WHERE id = ?")
      .get(txn1) as { settled_at: string };
    expect(fs.settled_at).toMatch(SQLITE_TS);
  });

  it("marks all selected financial_services rows as is_settled = 1", () => {
    const supplierId = seedSupplier(db);
    const txn1 = seedUnsettledTransaction(db, "OMT", 100, 0.1);
    const txn2 = seedUnsettledTransaction(db, "OMT", 150, 0.2);

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txn1, txn2],
      amount_usd: 249.7,
      amount_lbp: 0,
      commission_usd: 0.3,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 249.7 }],
    });

    const rows = db
      .prepare(
        "SELECT id, is_settled, settled_at, settlement_id FROM financial_services WHERE id IN (?, ?)",
      )
      .all(txn1, txn2) as any[];

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.is_settled).toBe(1);
      expect(row.settled_at).not.toBeNull();
      expect(row.settlement_id).toBeGreaterThan(0);
    }
  });

  it("sets settled_at and settlement_id on settled rows", () => {
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    const before = Date.now();
    const result = repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 99.9 }],
    });

    const row = db
      .prepare(
        "SELECT settled_at, settlement_id FROM financial_services WHERE id = ?",
      )
      .get(txnId) as any;

    expect(row.settlement_id).toBe(result.id);
    // settled_at is a UTC 'YYYY-MM-DD HH:MM:SS' stamp (datetime('now'), A6) —
    // parse it AS UTC; a bare new Date(...) would read it as local time.
    const settledAtMs = new Date(
      row.settled_at.replace(" ", "T") + "Z",
    ).getTime();
    // Second-granular stamp vs ms clock: allow the truncated second.
    expect(settledAtMs).toBeGreaterThanOrEqual(before - 1000);
  });

  it("commission_usd/commission_lbp are informational only — NO separate PCD credit beyond the payment leg", () => {
    // Pre-fix (Fix C): settlement credited a drawer with `+commission`
    // regardless of the payment leg used, funded off `drawer_name`. Under
    // the gross model there is nothing left to fund/realize — the shop's
    // cut is already embedded in `amount_usd` (grossOwedDelta), so the PCD
    // (OMT_System — supplier.provider "OMT" === baseSystem "OMT", decision
    // #10) must reflect ONLY the CASH payment leg's debit, never an extra
    // `+0.1`. General is untouched entirely (the leg never routes there for
    // a primary-system supplier).
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 99.9 }],
    });

    const omtSystem = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'",
      )
      .get() as any;
    const general = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
      )
      .get() as any;

    // Seeded at 500 → only the CASH leg's −99.9 debit = 400.1; pre-fix
    // (float model) this leg would have gone to General instead and left
    // OMT_System untouched at 500.
    expect(omtSystem.balance).toBeCloseTo(500 - 99.9, 4); // 400.1
    // General never touched — the leg resolves to the PCD, not General.
    expect(general.balance).toBeCloseTo(0, 4);
  });

  it("settlement pays through the PCD (OMT_System) when the supplier IS the primary provider — General is untouched", () => {
    // Primary-cash-drawer model (decision #10): OMT_System is no longer a
    // dormant "provider float" that settlement bypasses — it IS the shop's
    // physical cash drawer, so a CASH settlement leg paid to the shop's
    // primary-system supplier (provider "OMT" === baseSystem "OMT") debits
    // it directly, exactly like every other primary-system cash leg.
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    const omtBefore = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;
    const generalBefore = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 99.9 }],
    });

    const omtAfter = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;
    const generalAfter = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;

    expect(omtAfter).toBeCloseTo(omtBefore - 99.9, 4); // 500 - 99.9 = 400.1
    expect(generalAfter).toBeCloseTo(generalBefore, 4); // General never touched
  });

  it("creates a unified SUPPLIER_SETTLEMENT transaction row", () => {
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 99.9 }],
    });

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT'")
      .get() as any;

    expect(txn).toBeDefined();
    expect(txn.type).toBe("SUPPLIER_SETTLEMENT");
    expect(txn.source_table).toBe("supplier_ledger");
    expect(txn.amount_usd).toBeCloseTo(99.9, 2);
  });

  it("links the ledger entry to the unified transaction via transaction_id", () => {
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 99.9 }],
    });

    const ledgerEntry = db
      .prepare(
        "SELECT transaction_id FROM supplier_ledger WHERE supplier_id = ?",
      )
      .get(supplierId) as any;
    const unifiedTxn = db
      .prepare("SELECT id FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT'")
      .get() as any;

    expect(ledgerEntry.transaction_id).toBe(unifiedTxn.id);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Primary-cash-drawer model (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md
  // §8.3, superseding the 2026-07-29 float model the day after it shipped):
  // settlement pays off the GROSS TOP_UP directly — still no separate
  // "realize the commission" step, but now for a different reason.
  //
  // An OMT SEND books the auto TOP_UP as `x + f − c` (grossOwedDelta,
  // FinancialServiceRepository.ts) — the shop's commission is embedded in
  // the gross figure, not carved out. Settlement pays EXACTLY that figure
  // and the ledger nets to 0 with ONE entry. `OMT_System` is no longer a
  // dormant float this settlement bypasses — it IS the shop's PCD, so the
  // CASH settlement leg debits it directly (decision #10).
  //
  // Rule 17: this exact scenario (x=100, f=5, c=0.5) is the plan's own
  // worked example (§8.3): SEND books +104.5 owed. Verified failing
  // pre-fix (float model) — that version asserted a fee-only TOP_UP of 4.5
  // and a ZERO OMT_System delta from settlement; both invert here.
  // ─────────────────────────────────────────────────────────────────────────

  it("full cycle: TOP_UP(gross) → settle(same amount) nets ledger to 0; PCD debited exactly the settlement, commission informational only", () => {
    const supplierId = seedSupplier(db);
    // $100 SEND with $5 provider fee, $0.50 commission (shop's cut of the fee).
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.5);
    // The auto ledger entry the repository books at transaction time
    // (gross model, plan §8.3 worked example): x + f − c = 100 + 5 − 0.5 = 104.5.
    db.prepare(
      `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto, note)
       VALUES (?, 'TOP_UP', 104.5, 0, 1, 'Auto: SEND via OMT (gross)')`,
    ).run(supplierId);

    const drawerBefore = (name: string) =>
      (
        db
          .prepare(
            "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = 'USD'",
          )
          .get(name) as any
      ).balance as number;
    const omtBefore = drawerBefore("OMT_System");
    const genBefore = drawerBefore("General");

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 104.5, // exactly what's owed (gross) — no further commission subtraction
      amount_lbp: 0,
      commission_usd: 0.5, // informational only — no separate drawer effect
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 104.5 }],
    });

    // Supplier ledger nets to zero per currency:
    // TOP_UP 104.5 + SETTLEMENT −104.5 = 0. No second (SUPPLIER_PAYS_US) row.
    const bal = db
      .prepare(
        "SELECT COALESCE(SUM(amount_usd),0) usd, COALESCE(SUM(amount_lbp),0) lbp FROM supplier_ledger WHERE supplier_id = ?",
      )
      .get(supplierId) as any;
    expect(bal.usd).toBeCloseTo(0, 4);
    expect(bal.lbp).toBeCloseTo(0, 4);

    // No SUPPLIER_PAYS_US row exists anymore — that machinery is removed.
    const commRow = db
      .prepare(
        "SELECT amount_usd FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'SUPPLIER_PAYS_US'",
      )
      .get(supplierId) as any;
    expect(commRow).toBeUndefined();

    // Drawers: the PCD (OMT_System) is debited exactly the settlement
    // (−104.5); General reflects NOTHING — the leg never routes there for
    // this primary-system supplier.
    expect(drawerBefore("OMT_System")).toBeCloseTo(omtBefore - 104.5, 4);
    expect(drawerBefore("General")).toBeCloseTo(genBefore, 2);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Guard: double-settle prevention
  // ─────────────────────────────────────────────────────────────────────────

  it("does NOT re-settle already-settled rows (settlement_id guard)", () => {
    const supplierId = seedSupplier(db);
    const alreadySettled = seedSettledTransaction(db, "OMT", 100, 0.1);

    // Pre-mark as settled. The supplier-debt-settled marker is settlement_id
    // (NULL = outstanding); is_settled means "commission/profit realized", which
    // is set to 1 for SEND rows that still carry an outstanding supplier debt, so
    // it cannot be the re-settle guard. settleTransactions stamps settlement_id
    // and guards on `settlement_id IS NULL`.
    db.prepare(
      "UPDATE financial_services SET is_settled = 1, settlement_id = 999 WHERE id = ?",
    ).run(alreadySettled);

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [alreadySettled],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 99.9 }],
    });

    // UPDATE ... WHERE settlement_id IS NULL won't match — settlement_id is left
    // untouched at its existing value, i.e. the row is not re-settled.
    const row = db
      .prepare("SELECT settlement_id FROM financial_services WHERE id = ?")
      .get(alreadySettled) as any;
    expect(row.settlement_id).toBe(999);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Validation
  // ─────────────────────────────────────────────────────────────────────────

  it("throws DatabaseError when financial_service_ids is empty", () => {
    const supplierId = seedSupplier(db);

    expect(() =>
      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [],
        amount_usd: 0,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        created_by: 1,
      }),
    ).toThrow("No transactions selected for settlement");
  });

  it("throws DatabaseError when a nonzero net amount has no payment-method legs", () => {
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    expect(() =>
      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [txnId],
        amount_usd: 99.9,
        amount_lbp: 0,
        commission_usd: 0.1,
        commission_lbp: 0,
        created_by: 1,
        // no `payments` — OMT_System is not a valid fallback drawer anymore
      }),
    ).toThrow(/payment-method leg/i);
  });

  it("does NOT require payment-method legs when the net amount is exactly 0", () => {
    // A batch that nets to $0 (e.g. commission alone happened to offset what
    // was owed) needs no cash movement at all.
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    expect(() =>
      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [txnId],
        amount_usd: 0,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        created_by: 1,
      }),
    ).not.toThrow();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Atomic rollback
  // ─────────────────────────────────────────────────────────────────────────

  it("rolls back entirely if an error occurs mid-transaction", () => {
    const supplierId = seedSupplier(db);
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    // Break the drawer_balances table to cause a mid-transaction failure
    db.exec("DROP TABLE drawer_balances");

    expect(() =>
      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [txnId],
        amount_usd: 99.9,
        amount_lbp: 0,
        commission_usd: 0.1,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 99.9 }],
      }),
    ).toThrow();

    // Restore table and verify nothing was committed
    db.exec(`
      CREATE TABLE drawer_balances (
        tenant_id INTEGER DEFAULT 1,
        drawer_name TEXT NOT NULL,
        currency_code TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (drawer_name, currency_code)
      );
    `);

    const ledgerCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM supplier_ledger").get() as any
    ).cnt;
    const stillUnsettled = (
      db
        .prepare("SELECT is_settled FROM financial_services WHERE id = ?")
        .get(txnId) as any
    ).is_settled;

    expect(ledgerCount).toBe(0); // no ledger entry committed
    expect(stillUnsettled).toBe(0); // financial_services row not marked settled
  });

  // ─────────────────────────────────────────────────────────────────────────
  // End-to-end: INTRA $100 SEND, $1 fee, $0.10 commission (gross)
  //
  // Re-derivation note: under the gross model a SOLO RECEIVE's own ledger
  // entry is NEGATIVE (`−(x−(f−c))` — the provider owes the shop, not the
  // other way round), while settleTransactions() always books a
  // shop-pays-out SETTLEMENT row (`-Math.abs(amount_usd)`). A standalone
  // RECEIVE therefore isn't a scenario this method is ever called for
  // alone — only a batch whose NET happens to be positive (the MIXED case
  // below, which does include a RECEIVE leg) is settleable this way.
  // Re-derived this solo-transaction scenario to a SEND instead, which
  // does produce a genuine positive gross amount owed:
  // x + f − c = 100 + 1 − 0.1 = 100.9.
  // ─────────────────────────────────────────────────────────────────────────

  it("correctly settles a $100 OMT SEND, fee $1, $0.10 commission (gross) — pays the gross $100.90", () => {
    const supplierId = seedSupplier(db, "OMT");
    const txnId = seedUnsettledTransaction(db, "OMT", 100, 0.1);

    // Gross model (plan §8.3): x + f − c = 100 + 1 − 0.1 = 100.9 — the full
    // amount owed the provider, paid via one CASH leg.
    const result = repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 100.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      created_by: 1,
      note: "OMT $100 SEND settlement (gross)",
      payments: [{ method: "CASH", currency_code: "USD", amount: 100.9 }],
    });

    expect(result.id).toBeGreaterThan(0);

    // Verify ledger entry
    const ledger = db
      .prepare("SELECT * FROM supplier_ledger WHERE id = ?")
      .get(result.id) as any;
    expect(ledger.amount_usd).toBeCloseTo(-100.9, 2);

    // Verify financial_services settled
    const fs = db
      .prepare(
        "SELECT is_settled, settlement_id FROM financial_services WHERE id = ?",
      )
      .get(txnId) as any;
    expect(fs.is_settled).toBe(1);
    expect(fs.settlement_id).toBe(result.id);

    // PCD (OMT_System) debited exactly the CASH leg (−100.9); General
    // reflects nothing — the leg never routes there for this primary
    // provider.
    const omtSystem = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(omtSystem.balance).toBeCloseTo(500 - 100.9, 4); // 399.1

    const general = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(general.balance).toBeCloseTo(0, 4); // untouched
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Multiple transactions in one settlement
  // ─────────────────────────────────────────────────────────────────────────

  it("settles multiple transactions with correct totals", () => {
    const supplierId = seedSupplier(db, "OMT");
    const txn1 = seedUnsettledTransaction(db, "OMT", 100, 0.1); // $100 recv, $0.10 commission
    const txn2 = seedUnsettledTransaction(db, "OMT", 150, 0.2); // $150 recv, $0.20 commission

    // Whatever net figure the caller (UI) computes — here 249.70, e.g. the
    // sum of two gross owed amounts read off the ledger — settlement pays
    // it as-is, no further commission subtraction. (The specific figure is
    // opaque to this repository — it doesn't need re-deriving from x/f/c;
    // only the drawer ROUTING does.)
    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txn1, txn2],
      amount_usd: 249.7,
      amount_lbp: 0,
      commission_usd: 0.3,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 249.7 }],
    });

    const settled = db
      .prepare(
        "SELECT id, is_settled FROM financial_services WHERE id IN (?, ?)",
      )
      .all(txn1, txn2) as any[];
    expect(settled.every((r) => r.is_settled === 1)).toBe(true);

    // PCD (OMT_System) reflects ONLY the CASH leg — General is untouched.
    const omtSystem = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(omtSystem.balance).toBeCloseTo(500 - 249.7, 4); // 250.3

    const general = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(general.balance).toBeCloseTo(0, 4);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MIXED SEND+RECEIVE settlement batch — the single most valuable line in
  // this file: proves the supplier ledger nets to EXACTLY 0 across a batch
  // that mixes both directions, under the gross model (plan §8.3).
  //
  // SEND: x=100, f=5, c=1 → TOP_UP = x+f−c = 100+5−1 = 104.
  // RECEIVE: x=60, f=0 (not given), c=0.5 → TOP_UP = −(x−(f−c)) =
  //   −(60−(0−0.5)) = −(60+0.5) = −60.5.
  // Net owed across the batch = 104 + (−60.5) = 43.5 → settlement pays $43.5.
  // Commission total (informational) = 1 (SEND) + 0.5 (RECEIVE) = 1.5,
  // unchanged from the fee-only model — gross vs fee-only only moves WHERE
  // the principal is tracked, not the size of the shop's own cut.
  // ─────────────────────────────────────────────────────────────────────────

  it("MIXED SEND+RECEIVE batch: supplier_ledger nets to EXACTLY 0; the PCD (OMT_System) absorbs the settlement, General untouched", () => {
    const supplierId = seedSupplier(db, "OMT");

    // SEND leg: $100 principal, $5 fee, $1 commission — TOP_UP = 100+5-1 = 104.
    const sendTxn = seedUnsettledTransaction(db, "OMT", 100, 1);
    db.prepare(
      `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto, note)
       VALUES (?, 'TOP_UP', 104, 0, 1, 'Auto: SEND via OMT (gross)')`,
    ).run(supplierId);

    // RECEIVE leg: $60 principal, no fee, $0.5 commission —
    // TOP_UP = -(60-(0-0.5)) = -60.5.
    const receiveTxn = seedUnsettledTransaction(db, "OMT", 60, 0.5);
    db.prepare(
      `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto, note)
       VALUES (?, 'TOP_UP', -60.5, 0, 1, 'Auto: RECEIVE via OMT (gross)')`,
    ).run(supplierId);

    // Sanity: outstanding balance before settling = 104 + (-60.5) = 43.5.
    const owedBefore = (
      db
        .prepare(
          "SELECT COALESCE(SUM(amount_usd),0) usd FROM supplier_ledger WHERE supplier_id = ?",
        )
        .get(supplierId) as any
    ).usd;
    expect(owedBefore).toBeCloseTo(43.5, 4);

    // OMT_System already reflects whatever the SEND (+100) and RECEIVE (-60)
    // cash postings did at transaction time (FinancialServiceRepository,
    // out of this repository's scope) — snapshot it as "pre-settlement",
    // exactly like every other test in this file does.
    const omtBefore = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;
    const generalBefore = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;

    const result = repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [sendTxn, receiveTxn],
      amount_usd: 43.5,
      amount_lbp: 0,
      commission_usd: 1.5, // 1 (SEND) + 0.5 (RECEIVE) — informational only
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 43.5 }],
    });

    // supplier_ledger nets to EXACTLY 0: TOP_UP(104) + TOP_UP(-60.5) +
    // SETTLEMENT(-43.5) = 0 — still the single most valuable assertion in
    // this file; unchanged by the gross re-derivation (only the drawer
    // expectations below change).
    const ledgerBalance = (
      db
        .prepare(
          "SELECT COALESCE(SUM(amount_usd),0) usd FROM supplier_ledger WHERE supplier_id = ?",
        )
        .get(supplierId) as any
    ).usd;
    expect(ledgerBalance).toBeCloseTo(0, 4);

    // Both financial_services rows are marked settled.
    const settled = db
      .prepare(
        "SELECT id, is_settled, settlement_id FROM financial_services WHERE id IN (?, ?)",
      )
      .all(sendTxn, receiveTxn) as any[];
    expect(settled.every((r) => r.is_settled === 1)).toBe(true);
    expect(settled.every((r) => r.settlement_id === result.id)).toBe(true);

    // The PCD (OMT_System) absorbs the $43.5 settlement — it is the shop's
    // physical cash drawer for this primary-system supplier (decision #10),
    // not a dormant float settlement bypasses.
    const omtAfter = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;
    expect(omtAfter).toBeCloseTo(omtBefore - 43.5, 4);

    // General reflects NOTHING — the leg never routes there for this
    // primary-system supplier.
    const generalAfter = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;
    expect(generalAfter).toBeCloseTo(generalBefore, 4);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Regression guard (task C): a NON-primary supplier (an ordinary product
  // supplier, provider !== shop_base_system) must be COMPLETELY unaffected
  // by the PCD routing change — its CASH settlement leg still resolves to
  // General, exactly as before resolveServiceCashDrawer existed.
  // ─────────────────────────────────────────────────────────────────────────

  it("non-primary supplier (ordinary product supplier) settles out of General — PCD untouched", () => {
    // provider "Acme" !== baseSystem "OMT" (SettingsService.getShopBaseSystem()
    // defaults to "OMT" when no shop_base_system row exists, as in this
    // fixture) → CASH falls through resolveServiceCashDrawer to
    // paymentMethodToDrawerName("CASH") = "General" (payments.ts), exactly
    // as it did before the PCD model existed.
    const supplierId = seedSupplier(db, "Acme");
    const txnId = seedUnsettledTransaction(db, "Acme", 50, 0);

    const omtBefore = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;
    const generalBefore = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;

    repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [txnId],
      amount_usd: 50,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
    });

    const omtAfter = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;
    const generalAfter = (
      db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
        )
        .get() as any
    ).balance;

    // General absorbs the full $50 CASH leg.
    expect(generalAfter).toBeCloseTo(generalBefore - 50, 4);
    // OMT_System (the PCD) is completely untouched — routing to it is
    // gated on provider === baseSystem, which "Acme" never satisfies.
    expect(omtAfter).toBeCloseTo(omtBefore, 4);

    const fs = db
      .prepare(
        "SELECT is_settled, settlement_id FROM financial_services WHERE id = ?",
      )
      .get(txnId) as any;
    expect(fs.is_settled).toBe(1);
  });
});

// ─── Extended schema for topUpFromSupplier tests ─────────────────────────────
// Adds the recharges table that RechargeRepository requires.

function createExtendedTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      module_key TEXT,
      provider TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE', 'SUPPLIER_PAYS_US', 'DISCOUNT')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT NOT NULL,
      phone_number TEXT,
      client_id INTEGER,
      client_name TEXT,
      note TEXT,
      created_by INTEGER NOT NULL DEFAULT 1,
      edited_by TEXT,
      edited_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE transactions (
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
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed provider drawers for Katsh and iPick
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('iPick', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('iPick', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 500);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
  `);

  return db;
}

// ─── Opening balances via signed ADJUSTMENT (B4) ─────────────────────────────
//
// A supplier can start with an owed amount in EITHER direction: positive
// ADJUSTMENT = shop owes supplier; negative ADJUSTMENT = supplier owes the
// shop. addLedgerEntry must pass ADJUSTMENT signs through untouched (only
// PAYMENT forces negative) so getSupplierBalances() reflects the signed total.

describe("SupplierRepository — opening balance via signed ADJUSTMENT (B4)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resetTransactionRepository } =
    require("../TransactionRepository") as typeof import("../TransactionRepository");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    // ADJUSTMENT entries journal through the TransactionRepository singleton —
    // rebind it to THIS test's in-memory DB.
    resetTransactionRepository();
    repo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
  });

  const balanceOf = (supplierId: number) => {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(amount_usd),0) usd, COALESCE(SUM(amount_lbp),0) lbp
           FROM supplier_ledger WHERE supplier_id = ?`,
      )
      .get(supplierId) as { usd: number; lbp: number };
    return row;
  };

  it("positive ADJUSTMENT books an opening 'shop owes supplier' balance", () => {
    const supplierId = seedSupplier(db);
    repo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "ADJUSTMENT",
      amount_usd: 250,
      amount_lbp: 1_000_000,
      note: "Opening balance",
      created_by: 1,
    });

    const bal = balanceOf(supplierId);
    expect(bal.usd).toBeCloseTo(250, 2);
    expect(bal.lbp).toBeCloseTo(1_000_000, 2);
  });

  it("negative ADJUSTMENT books an opening 'supplier owes shop' balance (sign passes through)", () => {
    const supplierId = seedSupplier(db);
    repo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "ADJUSTMENT",
      amount_usd: -80,
      amount_lbp: 0,
      note: "Opening balance — supplier owes us",
      created_by: 1,
    });

    expect(balanceOf(supplierId).usd).toBeCloseTo(-80, 2);
    // The signed balance also flows through getSupplierBalances()
    const balances = repo.getSupplierBalances(true);
    const mine = balances.find((b) => b.supplier_id === supplierId);
    expect(mine?.total_usd).toBeCloseTo(-80, 2);
  });

  it("no drawer movement for either direction (opening balances are book entries)", () => {
    const supplierId = seedSupplier(db);
    const general = () =>
      (
        db
          .prepare(
            `SELECT balance FROM drawer_balances WHERE drawer_name='General' AND currency_code='USD'`,
          )
          .get() as { balance: number }
      ).balance;

    const before = general();
    repo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "ADJUSTMENT",
      amount_usd: 100,
      amount_lbp: 0,
      created_by: 1,
    });
    repo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "ADJUSTMENT",
      amount_usd: -40,
      amount_lbp: 0,
      created_by: 1,
    });
    expect(general()).toBeCloseTo(before, 2);
    expect(balanceOf(supplierId).usd).toBeCloseTo(60, 2);
  });
});

// ─── RechargeRepository.topUpFromSupplier() tests ────────────────────────────

describe("RechargeRepository.topUpFromSupplier()", () => {
  let db: Database.Database;
  let rechargeRepo: RechargeRepository;
  let supplierRepo: SupplierRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createExtendedTestDb();
    setDb(db);
    rechargeRepo = new RechargeRepository();
    supplierRepo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
  });

  it("increases Katsh drawer balance and creates supplier_ledger TOP_UP entry", () => {
    // Arrange: seed a Katsh supplier
    const supplierRes = db
      .prepare(
        "INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)",
      )
      .run("Katsh Supplier", "Katsh");
    const supplierId = Number(supplierRes.lastInsertRowid);

    // Act
    const result = rechargeRepo.topUpFromSupplier({
      provider: "Katsh",
      amount: 100,
      currency: "USD",
      userId: 1,
    });

    expect(result.success).toBe(true);

    // Assert: Katsh drawer increased by 100 USD
    const drawer = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'Katsh' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(drawer.balance).toBeCloseTo(100, 2);

    // Assert: supplier_ledger has a TOP_UP entry with amount_usd = 100
    const ledgerEntry = db
      .prepare(
        "SELECT * FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'TOP_UP'",
      )
      .get(supplierId) as any;
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry.entry_type).toBe("TOP_UP");
    expect(ledgerEntry.amount_usd).toBeCloseTo(100, 2);
    expect(ledgerEntry.amount_lbp).toBe(0);

    // Assert: NO source drawer was deducted — General stays at 500
    const general = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(general.balance).toBeCloseTo(500, 2);
  });

  it("records a recharge row with paid_by = SUPPLIER and type = TOP_UP", () => {
    db.prepare(
      "INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)",
    ).run("Katsh Supplier", "Katsh");

    rechargeRepo.topUpFromSupplier({
      provider: "Katsh",
      amount: 50,
      currency: "USD",
      userId: 1,
    });

    const recharge = db
      .prepare("SELECT * FROM recharges WHERE carrier = 'Katsh'")
      .get() as any;
    expect(recharge).toBeDefined();
    expect(recharge.recharge_type).toBe("TOP_UP");
    expect(recharge.paid_by).toBe("SUPPLIER");
    expect(recharge.amount).toBeCloseTo(50, 2);
    expect(recharge.currency_code).toBe("USD");
  });

  it("creates a unified transaction row for the top-up", () => {
    db.prepare(
      "INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)",
    ).run("Katsh Supplier", "Katsh");

    rechargeRepo.topUpFromSupplier({
      provider: "Katsh",
      amount: 75,
      currency: "USD",
      userId: 1,
    });

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'RECHARGE_TOPUP'")
      .get() as any;
    expect(txn).toBeDefined();
    expect(txn.amount_usd).toBeCloseTo(75, 2);
    expect(txn.source_table).toBe("recharges");
  });

  it("works when no supplier is found — still increases drawer, skips ledger", () => {
    // No supplier seeded for Katsh

    const result = rechargeRepo.topUpFromSupplier({
      provider: "Katsh",
      amount: 200,
      currency: "USD",
      userId: 1,
    });

    expect(result.success).toBe(true);

    // Drawer increased
    const drawer = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'Katsh' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(drawer.balance).toBeCloseTo(200, 2);

    // No ledger entries created
    const ledgerCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM supplier_ledger").get() as any
    ).cnt;
    expect(ledgerCount).toBe(0);
  });

  it("handles LBP currency — sets amount_lbp in ledger and not amount_usd", () => {
    const supplierRes = db
      .prepare(
        "INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)",
      )
      .run("Katsh Supplier", "Katsh");
    const supplierId = Number(supplierRes.lastInsertRowid);

    rechargeRepo.topUpFromSupplier({
      provider: "Katsh",
      amount: 1_000_000,
      currency: "LBP",
      userId: 1,
    });

    const ledgerEntry = db
      .prepare(
        "SELECT * FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'TOP_UP'",
      )
      .get(supplierId) as any;
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry.amount_lbp).toBeCloseTo(1_000_000, 0);
    expect(ledgerEntry.amount_usd).toBe(0);

    const drawer = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'Katsh' AND currency_code = 'LBP'",
      )
      .get() as any;
    expect(drawer.balance).toBeCloseTo(1_000_000, 0);
  });
});

// ─── Supplier settlement flow tests ──────────────────────────────────────────

describe("Supplier settlement flow for Katsh", () => {
  let db: Database.Database;
  let supplierRepo: SupplierRepository;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createExtendedTestDb();
    setDb(db);
    supplierRepo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
  });

  it("deducts from General drawer and creates PAYMENT entry, netting balance to 0", () => {
    // Arrange: seed supplier and a TOP_UP liability of $100
    const supplierRes = db
      .prepare(
        "INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)",
      )
      .run("Katsh Supplier", "Katsh");
    const supplierId = Number(supplierRes.lastInsertRowid);

    db.prepare(
      "INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, created_by) VALUES (?, 'TOP_UP', 100, 0, 1)",
    ).run(supplierId);

    // Verify pre-condition: net owed = +100
    const balanceBefore = db
      .prepare(
        "SELECT COALESCE(SUM(amount_usd), 0) as total FROM supplier_ledger WHERE supplier_id = ?",
      )
      .get(supplierId) as any;
    expect(balanceBefore.total).toBeCloseTo(100, 2);

    // Act: pay the supplier $100 from General drawer
    supplierRepo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "PAYMENT",
      amount_usd: 100,
      amount_lbp: 0,
      drawer_name: "General",
      created_by: 1,
      note: "Settle Katsh supplier debt",
    });

    // Assert: General drawer decreased by 100 (was 500)
    const general = db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'",
      )
      .get() as any;
    expect(general.balance).toBeCloseTo(400, 2); // 500 - 100

    // Assert: supplier_ledger has a PAYMENT entry with amount_usd = -100
    const paymentEntry = db
      .prepare(
        "SELECT * FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'PAYMENT'",
      )
      .get(supplierId) as any;
    expect(paymentEntry).toBeDefined();
    expect(paymentEntry.amount_usd).toBeCloseTo(-100, 2);

    // Assert: net balance (SUM of all ledger entries) = 0
    const netBalance = db
      .prepare(
        "SELECT COALESCE(SUM(amount_usd), 0) as total FROM supplier_ledger WHERE supplier_id = ?",
      )
      .get(supplierId) as any;
    expect(netBalance.total).toBeCloseTo(0, 4);
  });

  it("creates a SUPPLIER_PAYMENT unified transaction on settlement", () => {
    const supplierRes = db
      .prepare(
        "INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)",
      )
      .run("Katsh Supplier", "Katsh");
    const supplierId = Number(supplierRes.lastInsertRowid);

    supplierRepo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "PAYMENT",
      amount_usd: 50,
      amount_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });

    const txn = db
      .prepare("SELECT * FROM transactions WHERE type = 'SUPPLIER_PAYMENT'")
      .get() as any;
    expect(txn).toBeDefined();
    expect(txn.amount_usd).toBeCloseTo(50, 2);
    expect(txn.source_table).toBe("supplier_ledger");
  });
});
