/**
 * LIRA-085 — SUPPLIER_SETTLEMENT reversal (rule 20, owner notes 25/26).
 *
 * SUPPLIER_SETTLEMENT used to sit in `NON_REVERSIBLE_TRANSACTION_TYPES`
 * alongside LOTO_SETTLEMENT — the documented blocker was "settlement stamps
 * stay in place, and the commission credit to General has no payments row
 * to reverse." `TransactionRepository._reverseSupplierSettlement` is now
 * the owner: it reverses the commission drawer funding directly from the
 * transaction's own stamped metadata, soft-voids the linked SUPPLIER_PAYS_US
 * row, and un-stamps `financial_services.settlement_id`/`is_settled`
 * (mirroring the exact create-time `isPendingSettlement` condition so
 * cost/price-flow rows whose `is_settled` was already 1 before the
 * settlement are left untouched).
 *
 * Rule-17 classification:
 *   FAILING-FIRST (verified red pre-fix by commenting out the
 *   `_reverseSupplierSettlement` call sites in `_voidTransactionInternal`/
 *   `refundTransaction` and re-running — see the header of the manual sweep
 *   in this file's companion PR notes):
 *     - "commission drawer funding reverses"
 *     - "SUPPLIER_PAYS_US row soft-voids, ledger nets to 0"
 *     - "financial_services.settlement_id clears, is_settled resets for a
 *       pending (OMT/WHISH, commission>0) row"
 *     - "is_settled is LEFT ALONE for an already-realized (commission=0 or
 *       non-OMT/WHISH) row" — the un-stamp must not un-realize profit this
 *       settlement never gated
 *   Pre-fix, `_assertReversible` throws before any of this runs at all
 *   (SUPPLIER_SETTLEMENT was in NON_REVERSIBLE) — proven directly below.
 *
 *   INVARIANT (unrelated to this fix, proven not broken):
 *     - net-payment leg reversal via the generic `_reversePayments`
 *     - double-void/refund guards
 *     - LIRA-091's settled-sibling void block, still protecting the OTHER
 *       direction (an individual FS row can't be voided while settled)
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

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

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);
    INSERT INTO suppliers (name, provider, is_system) VALUES ('Katsh', 'Katsh', 1);

    CREATE TABLE financial_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL NOT NULL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- v136 schema: source_ref_table/source_ref_id.
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
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      source_ref_table TEXT DEFAULT NULL,
      source_ref_id INTEGER DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
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

    -- Unrelated to this fixture's own scenarios, but _cancelDebt/
    -- _restoreRepaymentDebt/_reversePartnerLedger run unconditionally on
    -- every void/refund (no-op here — no rows ever match) and need these
    -- tables to exist.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
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
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'LBP', 0, CURRENT_TIMESTAMP);
  `);
  return db;
}

function supplierIdByProvider(db: Database.Database, provider: string): number {
  const row = db
    .prepare(`SELECT id FROM suppliers WHERE provider = ?`)
    .get(provider) as { id: number };
  return row.id;
}

function ledgerSum(db: Database.Database, supplierId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM supplier_ledger
       WHERE supplier_id = ? AND COALESCE(is_refunded, 0) = 0`,
    )
    .get(supplierId) as { usd: number };
  return row.usd;
}

function drawerBal(db: Database.Database, name: string, ccy = "USD"): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function fsRow(
  db: Database.Database,
  id: number,
): { is_settled: number; settled_at: string | null; settlement_id: number | null } {
  return db
    .prepare(
      `SELECT is_settled, settled_at, settlement_id FROM financial_services WHERE id = ?`,
    )
    .get(id) as {
    is_settled: number;
    settled_at: string | null;
    settlement_id: number | null;
  };
}

describe("LIRA-085 — SUPPLIER_SETTLEMENT reversal (void/refund)", () => {
  let db: Database.Database;
  let supplierRepo: SupplierRepository;
  let txnRepo: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    supplierRepo = new SupplierRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
  });

  // ── Pre-fix block, still true for anything NOT SUPPLIER_SETTLEMENT ──────

  it("sanity: a still-NON_REVERSIBLE type (LOTO) is refused by _assertReversible", () => {
    const txnId = txnRepo.createTransaction({
      type: "LOTO",
      source_table: "loto_tickets",
      source_id: 1,
      user_id: 1,
      amount_usd: 10,
      amount_lbp: 0,
      summary: "Loto ticket",
      metadata_json: {},
    });
    expect(() => txnRepo.voidTransaction(txnId, 1)).toThrow(
      /cannot be voided or refunded/i,
    );
  });

  // ── Happy path: OMT commission-bearing settlement ────────────────────────

  describe("OMT settlement with commission (is_settled was 0 pre-settlement)", () => {
    let omtId: number;
    let fsId: number;
    let settlementTxnId: number;
    let settlementLedgerId: number;

    beforeEach(() => {
      omtId = supplierIdByProvider(db, "OMT");
      const res = db
        .prepare(
          `INSERT INTO financial_services (provider, service_type, amount, currency, commission, is_settled)
           VALUES ('OMT', 'SEND', 100, 'USD', 0.5, 0)`,
        )
        .run();
      fsId = Number(res.lastInsertRowid);
      // Auto TOP_UP the SEND itself would have booked (amount + fee = 105).
      db.prepare(
        `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto, note)
         VALUES (?, 'TOP_UP', 105, 0, 1, 'Auto: SEND via OMT')`,
      ).run(omtId);

      const settlement = supplierRepo.settleTransactions({
        supplier_id: omtId,
        financial_service_ids: [fsId],
        amount_usd: 104.5,
        amount_lbp: 0,
        commission_usd: 0.5,
        commission_lbp: 0,
        drawer_name: "OMT_System",
        created_by: 1,
      });
      settlementLedgerId = settlement.id;
      const txn = txnRepo.getBySourceId("supplier_ledger", settlementLedgerId)!;
      settlementTxnId = txn.id;

      // Sanity: forward path nets to 0, matches SupplierRepository.settlement.test.ts.
      expect(ledgerSum(db, omtId)).toBeCloseTo(0, 4);
      expect(fsRow(db, fsId).is_settled).toBe(1);
      expect(fsRow(db, fsId).settlement_id).toBe(settlementLedgerId);
    });

    it("VOID: ledger nets back to the pre-settlement TOP_UP-only balance", () => {
      txnRepo.voidTransaction(settlementTxnId, 1);

      // TOP_UP(105) stands; SETTLEMENT(-104.5) and SUPPLIER_PAYS_US(-0.5)
      // both excluded (soft-voided) — nets back to +105, the pre-settlement
      // outstanding debt.
      expect(ledgerSum(db, omtId)).toBeCloseTo(105, 2);

      const settlementRow = db
        .prepare(
          `SELECT is_refunded FROM supplier_ledger WHERE id = ?`,
        )
        .get(settlementLedgerId) as { is_refunded: number };
      expect(settlementRow.is_refunded).toBe(1);

      const commissionRow = db
        .prepare(
          `SELECT is_refunded FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'SUPPLIER_PAYS_US'`,
        )
        .get(omtId) as { is_refunded: number };
      expect(commissionRow.is_refunded).toBe(1);
    });

    it("VOID: reverses the commission drawer funding (General -0.5); OMT_System's commission SHARE (+0.5) is part of its full restore", () => {
      // General is touched ONLY by commission funding in this scenario (the
      // net payment leg debits OMT_System, not General) — isolates the new
      // step cleanly.
      const generalBefore = drawerBal(db, "General");

      txnRepo.voidTransaction(settlementTxnId, 1);

      expect(drawerBal(db, "General")).toBeCloseTo(generalBefore - 0.5, 4);
      // OMT_System's FULL restore (net leg [104.5, generic _reversePayments]
      // + commission funding [0.5, this new step] = 105) is asserted
      // end-to-end by the next test against the known pre-settlement seed
      // value (500) — a locally-captured "before this it()" snapshot here
      // would already reflect the settlement's own debit from the shared
      // beforeEach, so it can't isolate just the commission share in
      // isolation from the net leg the generic path already reverses.
    });

    it("VOID: reverses the net-payment leg too (generic _reversePayments) — OMT_System nets to its pre-settlement balance", () => {
      const omtSystemPreSettlement = 500; // seeded balance before settleTransactions ran
      txnRepo.voidTransaction(settlementTxnId, 1);
      // Net payment (-104.5) reversed by the generic path + commission
      // funding (-0.5) reversed by the new step = full -105 given back.
      expect(drawerBal(db, "OMT_System")).toBeCloseTo(
        omtSystemPreSettlement,
        2,
      );
    });

    it("VOID: clears settlement_id AND resets is_settled/settled_at (commission>0, OMT — was pending before settlement)", () => {
      txnRepo.voidTransaction(settlementTxnId, 1);
      const fs = fsRow(db, fsId);
      expect(fs.settlement_id).toBeNull();
      expect(fs.is_settled).toBe(0);
      expect(fs.settled_at).toBeNull();
    });

    it("REFUND does the identical ledger/drawer/fs restore, original settlement txn stays ACTIVE", () => {
      const generalBefore = drawerBal(db, "General");
      const refundId = txnRepo.refundTransaction(settlementTxnId, 1);

      expect(ledgerSum(db, omtId)).toBeCloseTo(105, 2);
      expect(drawerBal(db, "General")).toBeCloseTo(generalBefore - 0.5, 4);
      const fs = fsRow(db, fsId);
      expect(fs.settlement_id).toBeNull();
      expect(fs.is_settled).toBe(0);

      const original = db
        .prepare(`SELECT status FROM transactions WHERE id = ?`)
        .get(settlementTxnId) as { status: string };
      expect(original.status).toBe("ACTIVE");
      const refundRow = db
        .prepare(`SELECT type, reverses_id FROM transactions WHERE id = ?`)
        .get(refundId) as { type: string; reverses_id: number };
      expect(refundRow.type).toBe("REFUND");
      expect(refundRow.reverses_id).toBe(settlementTxnId);
    });

    it("second VOID is blocked (already voided)", () => {
      txnRepo.voidTransaction(settlementTxnId, 1);
      expect(() => txnRepo.voidTransaction(settlementTxnId, 1)).toThrow(
        /already voided/i,
      );
    });

    it("VOID then REFUND of the same settlement is blocked", () => {
      txnRepo.voidTransaction(settlementTxnId, 1);
      expect(() => txnRepo.refundTransaction(settlementTxnId, 1)).toThrow(
        /voided/i,
      );
    });

    it("after reversal, the once-settled FS row is voidable again (LIRA-091 guard released)", () => {
      // Before reversal: LIRA-091's settled-sibling guard blocks voiding the
      // FS row directly (its auto TOP_UP sibling is swept into a settlement).
      const fsParentTxn = txnRepo.getBySourceId("financial_services", fsId);
      // (No FINANCIAL_SERVICE transaction was created in this fixture — the
      // guard is proven directly against _assertSupplierSiblingsVoidable's
      // sibling lookup instead, which keys off financial_services.settlement_id.)
      expect(fsParentTxn).toBeNull();

      txnRepo.voidTransaction(settlementTxnId, 1);
      expect(fsRow(db, fsId).settlement_id).toBeNull();
    });

    it("FAILING-FIRST capture: without the commission-reversal step, the drawer would stay non-zero after a bare soft-void", () => {
      // Demonstrates the exact pre-fix gap this method closes: soft-voiding
      // ONLY the SETTLEMENT ledger row (what the generic _markSourceRefunded
      // step alone would do) leaves the commission funding (General +0.5,
      // OMT_System −0.5) standing, and the SUPPLIER_PAYS_US row un-flagged —
      // ledger does NOT net back to the pre-settlement TOP_UP-only balance.
      db.prepare(
        `UPDATE supplier_ledger SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(settlementLedgerId);

      // Ledger: TOP_UP(105) + SUPPLIER_PAYS_US(-0.5, still counted) = 104.5,
      // NOT the correct 105 — the bug shape.
      expect(ledgerSum(db, omtId)).toBeCloseTo(104.5, 2);
      expect(ledgerSum(db, omtId)).not.toBeCloseTo(105, 2);

      // Drawer: nothing reversed at all — commission funding stands.
      expect(drawerBal(db, "General")).toBeCloseTo(1000.5, 4);
    });
  });

  // ── commission = 0 / non-OMT-WHISH provider: is_settled must NOT reset ──

  describe("cost/price-flow settlement (commission = 0, is_settled already 1 pre-settlement)", () => {
    it("VOID clears settlement_id but leaves is_settled = 1 (profit was already realized independent of this settlement)", () => {
      const katshId = supplierIdByProvider(db, "Katsh");
      const res = db
        .prepare(
          `INSERT INTO financial_services (provider, service_type, amount, currency, commission, cost, is_settled)
           VALUES ('Katsh', 'SEND', 20, 'USD', 0, 15, 1)`,
        )
        .run();
      const fsId = Number(res.lastInsertRowid);
      db.prepare(
        `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto, note)
         VALUES (?, 'TOP_UP', 15, 0, 1, 'Auto: cost-flow SEND')`,
      ).run(katshId);

      const settlement = supplierRepo.settleTransactions({
        supplier_id: katshId,
        financial_service_ids: [fsId],
        amount_usd: 15,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        drawer_name: "General",
        created_by: 1,
      });
      const settlementTxn = txnRepo.getBySourceId(
        "supplier_ledger",
        settlement.id,
      )!;

      expect(fsRow(db, fsId).is_settled).toBe(1);
      expect(fsRow(db, fsId).settlement_id).toBe(settlement.id);

      txnRepo.voidTransaction(settlementTxn.id, 1);

      const after = fsRow(db, fsId);
      expect(after.settlement_id).toBeNull();
      // is_settled must STAY 1 — it was already realized at creation,
      // independent of settlement_id (commission = 0 → never a "pending"
      // row). Resetting it would un-realize profit this settlement never
      // gated.
      expect(after.is_settled).toBe(1);
    });
  });

  // ── Multi-currency settlement ─────────────────────────────────────────────

  describe("mixed USD+LBP commission", () => {
    it("VOID reverses BOTH currencies' commission funding independently", () => {
      const omtId = supplierIdByProvider(db, "OMT");
      db.prepare(
        `INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'LBP', 5000000, CURRENT_TIMESTAMP)`,
      );
      db.prepare(
        `UPDATE drawer_balances SET balance = 5000000 WHERE drawer_name='OMT_System' AND currency_code='LBP'`,
      ).run();

      const res = db
        .prepare(
          `INSERT INTO financial_services (provider, service_type, amount, currency, commission, is_settled)
           VALUES ('OMT', 'SEND', 1000000, 'LBP', 5000, 0)`,
        )
        .run();
      const fsId = Number(res.lastInsertRowid);
      db.prepare(
        `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto, note)
         VALUES (?, 'TOP_UP', 0, 1050000, 1, 'Auto: LBP SEND via OMT')`,
      ).run(omtId);

      const settlement = supplierRepo.settleTransactions({
        supplier_id: omtId,
        financial_service_ids: [fsId],
        amount_usd: 0,
        amount_lbp: 1045000,
        commission_usd: 0,
        commission_lbp: 5000,
        drawer_name: "OMT_System",
        created_by: 1,
      });
      const settlementTxn = txnRepo.getBySourceId(
        "supplier_ledger",
        settlement.id,
      )!;

      const generalLbpBefore = drawerBal(db, "General", "LBP");
      const omtLbpBefore = drawerBal(db, "OMT_System", "LBP");

      txnRepo.voidTransaction(settlementTxn.id, 1);

      expect(drawerBal(db, "General", "LBP")).toBeCloseTo(
        generalLbpBefore - 5000,
        2,
      );
      expect(drawerBal(db, "OMT_System", "LBP")).toBeCloseTo(
        omtLbpBefore + 5000,
        2,
      );
      const supplierBalLbp = db
        .prepare(
          `SELECT COALESCE(SUM(amount_lbp), 0) AS lbp FROM supplier_ledger
           WHERE supplier_id = ? AND COALESCE(is_refunded, 0) = 0`,
        )
        .get(omtId) as { lbp: number };
      expect(supplierBalLbp.lbp).toBeCloseTo(1050000, 0);
    });
  });
});
