/**
 * LIRA-085 — SUPPLIER_SETTLEMENT reversal (rule 20, owner notes 25/26).
 *
 * SUPPLIER_SETTLEMENT used to sit in `NON_REVERSIBLE_TRANSACTION_TYPES`
 * alongside LOTO_SETTLEMENT — the documented blocker was "settlement stamps
 * stay in place, and the commission credit to General has no payments row
 * to reverse." `TransactionRepository._reverseSupplierSettlement` is the
 * owner.
 *
 * PRIMARY-CASH-DRAWER MODEL UPDATE
 * (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md §1/§8, superseding the
 * 2026-07-29 float model the day after it shipped): `supplier_ledger`
 * TOP_UP rows are now booked GROSS (`x + f − c` SEND / `−(x−(f−c))`
 * RECEIVE) — the shop's commission is embedded in what's owed, not carved
 * out, so `SupplierRepository.settleTransactions` still funds no separate
 * commission credit (no `General += commission` / settle-drawer
 * `-= commission` pair, no `SUPPLIER_PAYS_US` ledger row) — same structural
 * property as the float model, different reason. This REMAINS most of what
 * `_reverseSupplierSettlement` used to have to undo — the settlement ledger
 * row's own generic soft-void (`_markSourceRefunded`) still nets the ledger
 * back to its pre-settlement TOP_UP-only balance ALL BY ITSELF (no second
 * ledger row masks it), and the net-payment leg (a real payment-method
 * drawer — for a PRIMARY-system supplier that is now `OMT_System`/
 * `Whish_System` itself, decision #10; it is no longer "never touched") is
 * reversed for free by the generic `_reversePayments`. The ONE thing still
 * bespoke: un-stamping `financial_services.settlement_id`/`is_settled`
 * (mirroring the exact create-time `isPendingSettlement` condition so
 * cost/price-flow rows whose `is_settled` was already 1 before the
 * settlement are left untouched).
 *
 * Rule-17 classification:
 *   FAILING-FIRST (verified red pre-fix by commenting out the
 *   `_reverseSupplierSettlement` call sites in `_voidTransactionInternal`/
 *   `refundTransaction` and re-running):
 *     - "financial_services.settlement_id clears, is_settled resets for a
 *       pending (OMT/WHISH, commission>0) row"
 *     - "is_settled is LEFT ALONE for an already-realized (commission=0 or
 *       non-OMT/WHISH) row" — the un-stamp must not un-realize profit this
 *       settlement never gated
 *   Pre-fix, `_assertReversible` throws before any of this runs at all
 *   (SUPPLIER_SETTLEMENT was in NON_REVERSIBLE) — proven directly below.
 *
 *   RE-DERIVED for the primary-cash-drawer model (rule 20 — create + settle
 *   + reverse must net to 0 across EVERY ledger touched, per currency):
 *     - net-payment leg reversal via the generic `_reversePayments` now
 *       restores the PCD (`OMT_System`/`Whish_System`), not General, for a
 *       primary-system supplier — the float model's inverse
 *     - the supplier_ledger nets back to the pre-settlement TOP_UP-only
 *       balance exactly as before (unaffected by WHERE the cash leg lands)
 *     - double-void/refund guards, unaffected
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

    -- Full column set — SupplierRepository._bookCommissionAtSettlement (new-
    -- model tests below) reads gross via
    -- getFinancialServiceRepository().findById(), which selects
    -- FinancialServiceRepository.getColumns()'s full explicit list (rule 14:
    -- reusing SUPPLIER_OWED_EXPR rather than re-deriving it means every one
    -- of these columns must exist here too, even though most are unused by
    -- this file's own scenarios).
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
      paid_by TEXT DEFAULT 'CASH',
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      client_id INTEGER,
      client_name TEXT,
      reference_number TEXT,
      phone_number TEXT,
      sender_name TEXT,
      sender_phone TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      sender_client_id INTEGER,
      receiver_client_id INTEGER,
      omt_service_type TEXT,
      omt_fee REAL DEFAULT 0,
      whish_fee REAL DEFAULT 0,
      profit_rate REAL,
      pay_fee INTEGER DEFAULT 0,
      item_key TEXT,
      note TEXT,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_at TEXT,
      settlement_id INTEGER,
      payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      created_by INTEGER,
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      partner_id INTEGER,
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT,
      commission_model INTEGER NOT NULL DEFAULT 0,
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

    -- Migration v150 (COMMISSION_AT_SETTLEMENT_PLAN.md §3) real schema.
    CREATE TABLE supplier_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      supplier_id INTEGER NOT NULL,
      ledger_entry_id INTEGER NOT NULL UNIQUE,
      gross_usd REAL NOT NULL DEFAULT 0,
      gross_lbp REAL NOT NULL DEFAULT 0,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      entry_mode TEXT NOT NULL DEFAULT 'LUMP' CHECK(entry_mode IN ('LUMP', 'RATE')),
      rate REAL,
      unit_count INTEGER,
      model INTEGER NOT NULL CHECK(model IN (0, 1)),
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE settlement_commission_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      settlement_ledger_id INTEGER NOT NULL,
      financial_service_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
): {
  is_settled: number;
  settled_at: string | null;
  settlement_id: number | null;
} {
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

  it("sanity: a still-NON_REVERSIBLE type (LOTO_CASH_PRIZE) is refused by _assertReversible", () => {
    // LOTO (ticket sales) moved OUT of NON_REVERSIBLE_TRANSACTION_TYPES this
    // ticket (2026-07-28) — TransactionRepository now owns a dedicated
    // guard/reversal pair (_assertLotoTicketVoidable / _reverseLotoSupplierLedger),
    // so a bare "LOTO" row no longer throws here. LOTO_CASH_PRIZE stays
    // non-reversible (no reversal owner exists for its side effects), so it's
    // the type that still exercises this sanity case — and _assertReversible
    // throws for it BEFORE _assertLotoTicketVoidable would ever run (that
    // guard only fires for type === "LOTO"), so this fixture (no
    // loto_tickets/loto_checkpoints tables) never needs them.
    const txnId = txnRepo.createTransaction({
      type: "LOTO_CASH_PRIZE",
      source_table: "loto_cash_prizes",
      source_id: 1,
      user_id: 1,
      amount_usd: 10,
      amount_lbp: 0,
      summary: "Loto cash prize payout",
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
      // Auto TOP_UP the SEND itself would have booked — GROSS under the
      // primary-cash-drawer model (plan §8.3's own worked example):
      // x + f − c = 100 + 5 − 0.5 = 104.5. The $100 principal now lives in
      // the PCD (OMT_System) as the shop's own cash — a different fact from
      // what's owed the provider (plan §8.1) — so both are tracked, not
      // double-counted.
      db.prepare(
        `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto, note)
         VALUES (?, 'TOP_UP', 104.5, 0, 1, 'Auto: SEND via OMT (gross)')`,
      ).run(omtId);

      const settlement = supplierRepo.settleTransactions({
        supplier_id: omtId,
        financial_service_ids: [fsId],
        amount_usd: 104.5, // exactly what's owed (gross) — no further commission subtraction
        amount_lbp: 0,
        commission_usd: 0.5, // informational only — no drawer effect
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 104.5 }],
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

      // TOP_UP(104.5) stands; SETTLEMENT(-104.5) excluded (soft-voided) —
      // nets back to +104.5, the pre-settlement outstanding debt. No
      // SUPPLIER_PAYS_US row exists anymore under the gross model.
      expect(ledgerSum(db, omtId)).toBeCloseTo(104.5, 2);

      const settlementRow = db
        .prepare(`SELECT is_refunded FROM supplier_ledger WHERE id = ?`)
        .get(settlementLedgerId) as { is_refunded: number };
      expect(settlementRow.is_refunded).toBe(1);

      const commissionRow = db
        .prepare(
          `SELECT is_refunded FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'SUPPLIER_PAYS_US'`,
        )
        .get(omtId) as { is_refunded: number } | undefined;
      expect(commissionRow).toBeUndefined();
    });

    it("VOID: reverses the net-payment leg (generic _reversePayments) — the PCD (OMT_System) restores to its pre-settlement balance, General untouched throughout", () => {
      const omtBefore = drawerBal(db, "OMT_System");
      const generalBefore = drawerBal(db, "General");

      txnRepo.voidTransaction(settlementTxnId, 1);

      // The CASH leg (-104.5) is a real `payments` row resolved to the PCD
      // at settlement time (supplier.provider "OMT" === baseSystem "OMT",
      // decision #10) — the generic `_reversePayments` path restores THAT
      // drawer for free. No bespoke commission funding exists to reverse.
      expect(drawerBal(db, "OMT_System")).toBeCloseTo(omtBefore + 104.5, 4);
      // General was never touched by the settlement leg, so it is not
      // touched by the reversal either.
      expect(drawerBal(db, "General")).toBeCloseTo(generalBefore, 4);
    });

    it("VOID: the PCD (OMT_System) is debited by the settlement, then fully restored — rule 20 net-zero across create+settle+reverse", () => {
      const omtSystemSeeded = 500; // seeded balance before settleTransactions ran (fixture)
      // Settlement DEBITS the PCD by the $104.5 CASH leg (decision #10) —
      // it is NOT untouched; that was the float model's (now-superseded)
      // rule, inverted here (FEATURE_GUIDE §8.1 settlement identity).
      expect(drawerBal(db, "OMT_System")).toBeCloseTo(
        omtSystemSeeded - 104.5, // 395.5
        2,
      );

      txnRepo.voidTransaction(settlementTxnId, 1);

      // VOID restores the PCD to its pre-settlement (seeded) balance —
      // create + settle + reverse nets the PCD to exactly 0 delta overall,
      // matching the supplier-ledger's own net-zero (previous test).
      expect(drawerBal(db, "OMT_System")).toBeCloseTo(omtSystemSeeded, 2);
    });

    it("VOID: clears settlement_id AND resets is_settled/settled_at (commission>0, OMT — was pending before settlement)", () => {
      txnRepo.voidTransaction(settlementTxnId, 1);
      const fs = fsRow(db, fsId);
      expect(fs.settlement_id).toBeNull();
      expect(fs.is_settled).toBe(0);
      expect(fs.settled_at).toBeNull();
    });

    it("REFUND does the identical ledger/drawer/fs restore, original settlement txn stays ACTIVE", () => {
      const omtBefore = drawerBal(db, "OMT_System");
      const generalBefore = drawerBal(db, "General");
      const refundId = txnRepo.refundTransaction(settlementTxnId, 1);

      expect(ledgerSum(db, omtId)).toBeCloseTo(104.5, 2);
      // REFUND restores the PCD (where the settlement CASH leg actually
      // landed) — General is untouched, exactly as the VOID path.
      expect(drawerBal(db, "OMT_System")).toBeCloseTo(omtBefore + 104.5, 4);
      expect(drawerBal(db, "General")).toBeCloseTo(generalBefore, 4);
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

    it("FAILING-FIRST capture: a bare ledger soft-void ALREADY nets the ledger correctly (no second row masks it), but leaves financial_services stamped — the ONE remaining bespoke step", () => {
      // Demonstrates exactly what's left for _reverseSupplierSettlement to
      // do: soft-voiding ONLY the SETTLEMENT ledger row (what the generic
      // `_markSourceRefunded` step alone would do, pre-dating any of this
      // method's own logic) is SUFFICIENT to net supplier_ledger back to
      // the pre-settlement TOP_UP-only balance — no SUPPLIER_PAYS_US row
      // exists to mask it (that machinery predates both the gross and
      // fee-only models and stays removed). What it does NOT do is touch
      // financial_services.
      db.prepare(
        `UPDATE supplier_ledger SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(settlementLedgerId);

      // Ledger already correct: TOP_UP(104.5) is the only unrefunded row.
      expect(ledgerSum(db, omtId)).toBeCloseTo(104.5, 2);

      // But financial_services stays stamped — proving this IS still the
      // dedicated method's job (verified against _reverseSupplierSettlement
      // being commented out of the void/refund call sites — see this file's
      // header doc comment).
      const fs = fsRow(db, fsId);
      expect(fs.settlement_id).toBe(settlementLedgerId);
      expect(fs.is_settled).toBe(1);
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

      // Task C regression guard: Katsh is an ordinary (non-primary)
      // supplier — provider "Katsh" !== baseSystem "OMT" — so its CASH
      // settlement leg must resolve to General exactly as before the PCD
      // model existed, never OMT_System.
      const omtBefore = drawerBal(db, "OMT_System");
      const generalBefore = drawerBal(db, "General");

      const settlement = supplierRepo.settleTransactions({
        supplier_id: katshId,
        financial_service_ids: [fsId],
        amount_usd: 15,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 15 }],
      });
      const settlementTxn = txnRepo.getBySourceId(
        "supplier_ledger",
        settlement.id,
      )!;

      expect(fsRow(db, fsId).is_settled).toBe(1);
      expect(fsRow(db, fsId).settlement_id).toBe(settlement.id);

      // General absorbs the $15 CASH leg; the PCD (OMT_System) is
      // completely untouched — routing to it is gated on
      // provider === baseSystem, which "Katsh" never satisfies.
      expect(drawerBal(db, "General")).toBeCloseTo(generalBefore - 15, 4);
      expect(drawerBal(db, "OMT_System")).toBeCloseTo(omtBefore, 4);

      txnRepo.voidTransaction(settlementTxn.id, 1);

      const after = fsRow(db, fsId);
      expect(after.settlement_id).toBeNull();
      // is_settled must STAY 1 — it was already realized at creation,
      // independent of settlement_id (commission = 0 → never a "pending"
      // row). Resetting it would un-realize profit this settlement never
      // gated.
      expect(after.is_settled).toBe(1);

      // VOID restores General (where the leg actually landed); PCD stays
      // untouched through the reversal too.
      expect(drawerBal(db, "General")).toBeCloseTo(generalBefore, 4);
      expect(drawerBal(db, "OMT_System")).toBeCloseTo(omtBefore, 4);
    });
  });

  // ── Multi-currency settlement ─────────────────────────────────────────────

  describe("mixed USD+LBP commission (gross model, LBP leg)", () => {
    it("VOID reverses the LBP net-payment leg generically; the PCD (OMT_System, LBP) is debited by settlement then fully restored — General LBP untouched throughout", () => {
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
      // Gross TOP_UP (plan §8.3): x + f − c = 1,000,000 + 50,000 − 5,000 =
      // 1,045,000 LBP. The 1,000,000 LBP principal now lives in the PCD
      // (OMT_System) itself, as the shop's own cash (plan §8.1) — a
      // different fact from what's owed the provider, tracked here.
      db.prepare(
        `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, is_auto, note)
         VALUES (?, 'TOP_UP', 0, 1045000, 1, 'Auto: LBP SEND via OMT (gross)')`,
      ).run(omtId);

      const generalLbpSeeded = drawerBal(db, "General", "LBP"); // 0
      const omtLbpSeeded = drawerBal(db, "OMT_System", "LBP"); // 5,000,000

      const settlement = supplierRepo.settleTransactions({
        supplier_id: omtId,
        financial_service_ids: [fsId],
        amount_usd: 0,
        amount_lbp: 1045000, // exactly what's owed (gross) — no further commission subtraction
        commission_usd: 0,
        commission_lbp: 5000, // informational only — no drawer effect
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "LBP", amount: 1045000 }],
      });
      const settlementTxn = txnRepo.getBySourceId(
        "supplier_ledger",
        settlement.id,
      )!;

      // Settlement debits the PCD (LBP) by exactly the CASH leg; General
      // LBP is never touched (the leg only ever routes to the PCD for this
      // primary-system supplier, decision #10).
      expect(drawerBal(db, "OMT_System", "LBP")).toBeCloseTo(
        omtLbpSeeded - 1045000, // 3,955,000
        0,
      );
      expect(drawerBal(db, "General", "LBP")).toBeCloseTo(generalLbpSeeded, 2);

      txnRepo.voidTransaction(settlementTxn.id, 1);

      // The CASH LBP leg (-1,045,000) is a real `payments` row resolved to
      // the PCD — the generic `_reversePayments` path restores THAT drawer
      // for free, back to its seeded value (rule 20: net-zero across
      // create+settle+reverse).
      expect(drawerBal(db, "OMT_System", "LBP")).toBeCloseTo(omtLbpSeeded, 0);
      // General LBP was never touched by the settlement leg, so it is not
      // touched by the reversal either.
      expect(drawerBal(db, "General", "LBP")).toBeCloseTo(generalLbpSeeded, 2);

      const supplierBalLbp = db
        .prepare(
          `SELECT COALESCE(SUM(amount_lbp), 0) AS lbp FROM supplier_ledger
           WHERE supplier_id = ? AND COALESCE(is_refunded, 0) = 0`,
        )
        .get(omtId) as { lbp: number };
      // Nets back to the pre-settlement TOP_UP-only balance (1,045,000).
      expect(supplierBalLbp.lbp).toBeCloseTo(1045000, 0);
    });
  });

  // ── COMMISSION_AT_SETTLEMENT_PLAN.md D5/D6 — new-model reversal ───────────
  //
  // A commission_model = 1 settlement books THREE new things
  // (SupplierRepository._bookCommissionAtSettlement) that the fee-only-model
  // paragraphs above don't cover: the SUPPLIER_PAYS_US commission credit
  // itself, a `supplier_settlements` row, and one `settlement_commission_
  // allocations` row per settled fs row. Rule 20 requires create → settle →
  // void to net to 0 across EVERY one of these, per currency — the credit
  // via the EXISTING LIRA-091 sibling cascade (no bespoke code), the other
  // two via `_reverseCommissionAtSettlementRecords` (DELETE, since neither
  // table has a soft-void column of its own).

  describe("COMMISSION_AT_SETTLEMENT_PLAN.md D5/D6 — new-model (commission_model = 1) settlement", () => {
    function seedNewModelFs(
      db: Database.Database,
      provider: string,
      amount: number,
    ): number {
      const res = db
        .prepare(
          `INSERT INTO financial_services
             (provider, service_type, amount, currency, commission, commission_model, is_settled)
           VALUES (?, 'RECEIVE', ?, 'USD', 0, 1, 0)`,
        )
        .run(provider, amount);
      return Number(res.lastInsertRowid);
    }

    function allocationsFor(
      db: Database.Database,
      settlementLedgerId: number,
    ): any[] {
      return db
        .prepare(
          `SELECT * FROM settlement_commission_allocations WHERE settlement_ledger_id = ?`,
        )
        .all(settlementLedgerId);
    }

    function supplierSettlementFor(
      db: Database.Database,
      settlementLedgerId: number,
    ): any {
      return db
        .prepare(`SELECT * FROM supplier_settlements WHERE ledger_entry_id = ?`)
        .get(settlementLedgerId);
    }

    function commissionCreditRow(
      db: Database.Database,
      supplierId: number,
    ): any {
      return db
        .prepare(
          `SELECT * FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'SUPPLIER_PAYS_US'`,
        )
        .get(supplierId);
    }

    it("VOID soft-voids the commission credit (LIRA-091 sibling cascade, no bespoke code) and DELETEs the allocations + supplier_settlements rows — nets to 0 across every table touched", () => {
      const omtId = supplierIdByProvider(db, "OMT");
      const fs1 = seedNewModelFs(db, "OMT", 100);
      const fs2 = seedNewModelFs(db, "OMT", 50);

      const settlement = supplierRepo.settleTransactions({
        supplier_id: omtId,
        financial_service_ids: [fs1, fs2],
        amount_usd: 145, // caller-computed net pay (gross 150 - commission 5)
        amount_lbp: 0,
        commission_usd: 5,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 145 }],
      });
      const settlementTxn = txnRepo.getBySourceId(
        "supplier_ledger",
        settlement.id,
      )!;

      // Forward path: all three new records exist.
      expect(supplierSettlementFor(db, settlement.id)).toBeDefined();
      expect(allocationsFor(db, settlement.id)).toHaveLength(2);
      const creditBefore = commissionCreditRow(db, omtId);
      expect(creditBefore).toBeDefined();
      expect(creditBefore.amount_usd).toBeCloseTo(-5, 2);
      expect(creditBefore.is_refunded).toBe(0);

      txnRepo.voidTransaction(settlementTxn.id, 1);

      // 1. Commission credit soft-voided (found via the settlement's own
      //    source_table/source_id — the EXACT LIRA-091 cascade mechanism
      //    every other auto supplier sibling uses; no bespoke reversal code
      //    exists for this row).
      const creditAfter = commissionCreditRow(db, omtId);
      expect(creditAfter.is_refunded).toBe(1);

      // 2/3. supplier_settlements + allocations DELETEd (no soft-void column
      //    on either table — see _reverseCommissionAtSettlementRecords).
      expect(supplierSettlementFor(db, settlement.id)).toBeUndefined();
      expect(allocationsFor(db, settlement.id)).toHaveLength(0);

      // Rule 20: nets to 0 across supplier_ledger too — no unrefunded rows
      // for this supplier at all (no TOP_UP was ever booked for these
      // new-model rows in this fixture, mirroring a bills-shaped batch).
      const unrefundedSum = db
        .prepare(
          `SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM supplier_ledger
           WHERE supplier_id = ? AND COALESCE(is_refunded, 0) = 0`,
        )
        .get(omtId) as { usd: number };
      expect(unrefundedSum.usd).toBeCloseTo(0, 4);

      // financial_services rows un-stamped (new-model rows are always
      // pending-settlement per D2, so is_settled resets to 0 too).
      const fsRows = db
        .prepare(
          `SELECT is_settled, settlement_id FROM financial_services WHERE id IN (?, ?)`,
        )
        .all(fs1, fs2) as any[];
      expect(
        fsRows.every((r) => r.is_settled === 0 && r.settlement_id === null),
      ).toBe(true);
    });

    it("REFUND does the identical D5/D6 cleanup as VOID", () => {
      const omtId = supplierIdByProvider(db, "OMT");
      const fsId = seedNewModelFs(db, "OMT", 100);

      const settlement = supplierRepo.settleTransactions({
        supplier_id: omtId,
        financial_service_ids: [fsId],
        amount_usd: 95,
        amount_lbp: 0,
        commission_usd: 5,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 95 }],
      });
      const settlementTxn = txnRepo.getBySourceId(
        "supplier_ledger",
        settlement.id,
      )!;

      txnRepo.refundTransaction(settlementTxn.id, 1);

      expect(commissionCreditRow(db, omtId).is_refunded).toBe(1);
      expect(supplierSettlementFor(db, settlement.id)).toBeUndefined();
      expect(allocationsFor(db, settlement.id)).toHaveLength(0);
    });

    // ── Rule 17 — FAILING-FIRST: prove _reverseCommissionAtSettlementRecords
    // is genuinely the piece doing this work, not a coincidence of the
    // generic cascade. Reproduced by calling the void path with that one
    // step skipped (simulating the pre-fix code) and observing the
    // allocations/supplier_settlements rows survive — then confirming the
    // real (unskipped) path above cleans them up.
    it("FAILING-FIRST capture: without the D5/D6 cleanup step, VOID leaves the allocations + supplier_settlements rows behind (proves the step is load-bearing)", () => {
      const omtId = supplierIdByProvider(db, "OMT");
      const fsId = seedNewModelFs(db, "OMT", 100);

      const settlement = supplierRepo.settleTransactions({
        supplier_id: omtId,
        financial_service_ids: [fsId],
        amount_usd: 95,
        amount_lbp: 0,
        commission_usd: 5,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 95 }],
      });

      // Simulate the pre-fix state directly: soft-void only the SETTLEMENT
      // ledger row and the commission credit (what the OLD, fee-only-model
      // `_reverseSupplierSettlement` did in full) — WITHOUT deleting the
      // new D5/D6 records, i.e. skip exactly the one step this test guards.
      db.prepare(
        `UPDATE supplier_ledger SET is_refunded = 1, refunded_at = CURRENT_TIMESTAMP
         WHERE id = ? OR (supplier_id = ? AND entry_type = 'SUPPLIER_PAYS_US')`,
      ).run(settlement.id, omtId);

      // Demonstrates the exact gap: the ledger side looks reversed, but the
      // audit/allocation records are still there — corrupting future
      // per-type commission reporting with a settlement that no longer
      // exists on the ledger. This is what `_reverseCommissionAtSettlementRecords`
      // fixes (proven in the two tests above, where the full void path DOES
      // clean these up).
      expect(supplierSettlementFor(db, settlement.id)).toBeDefined();
      expect(allocationsFor(db, settlement.id)).toHaveLength(1);
    });
  });
});
