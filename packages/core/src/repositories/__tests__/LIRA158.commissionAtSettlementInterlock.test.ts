/**
 * LIRA-158_COMMISSION_REPORTING_PLAN.md §2 / §3 Phase 1 — THE INTERLOCK.
 *
 * Two writes shipped in ONE change and must be proven together, never apart
 * (CLAUDE.md rule 20's "reversal owner" discipline applied to the FORWARD
 * side too — see the plan's own framing: "widening alone double-counts;
 * zeroing alone makes settled commission vanish"):
 *
 *   EDIT 1 — FinancialServiceRepository.ts's `profit_usd`/`profit_lbp` stamp
 *   (the commission TERM only) now reads 0 for an AT_SETTLEMENT row
 *   (`commissionModel === 1`) UNLESS it took the cost/price margin branch
 *   (`useCostPriceFlow`) — a bill's margin is earned NOW, not deferred.
 *   `kept_change_usd`/`kept_change_lbp` stay unconditional in both legs.
 *
 *   EDIT 2 — SupplierRepository.ts's SUPPLIER_SETTLEMENT profit stamp is
 *   widened from `isBillsOnlyBatch` to `batchModel === 1`, so EVERY new-model
 *   settlement (not just bills) recognises the operator's ENTERED commission
 *   on the settlement's own transaction, dated to the settlement day (D7).
 *
 * This file's fixture is the union of two already-proven fixtures — reused
 * verbatim, not re-derived, per rule 14 (CLAUDE.md's "read a row with the
 * formula that wrote it" + the schema-trap warning: enumerate every table a
 * code path touches, including unconditional prepares):
 *   - `FinancialServiceRepository.omtCommissionModelGate.test.ts` — proven to
 *     drive a REAL `FinancialServiceRepository.createTransaction()` round
 *     trip for an OMT SEND (real `omtServiceType`/`omtFee`, so
 *     `calculateCommission` actually fires) and for a BILL (cost/price flow).
 *   - `TransactionRepository.supplierSettlementReversal.test.ts` — proven to
 *     drive `SupplierRepository.settleTransactions()` AND
 *     `TransactionRepository.voidTransaction()` over a `commission_model = 1`
 *     SUPPLIER_SETTLEMENT row (includes `debt_ledger`, required because
 *     `TransactionRepository._cancelDebt` runs UNCONDITIONALLY on every
 *     void/refund with no schema-drift guard of its own — omitting this table
 *     throws "no such table: debt_ledger" from inside the void's own
 *     transaction(), which reads as a broken assertion, not a schema gap).
 *
 * Rule 17 (prove regression tests against the buggy code): each `it()` below
 * names, in its own comment, the exact code shape that would make it fail —
 * "revert to this shape and watch the assertion break" — so a future reader
 * doesn't have to re-derive the setup to run the failing-first proof this
 * task's own instructions forbade running here (RUN NOTHING; the owner's
 * consolidated gate is the first actual execution of these numbers).
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  SupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
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

// DebtService is only reachable through `!deferPayment` branches in
// FinancialServiceRepository — every createTransaction() call in this file
// either omits deferPayment (plain OMT SEND, no client/debt involved) or
// sets it true (the BILL fixture, which deliberately skips the customer
// debt/credit paths — the basket recorder owns those). Mocked anyway,
// matching FinancialServiceRepository.omtCommissionModelGate.test.ts's own
// precedent, so a future change to either path can't reach a real
// DebtRepository/debt_ledger write this fixture didn't provision for.
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    -- BaseRepository.resolveFallbackUserId() (invoked by
    -- FinancialServiceRepository.createTransaction whenever a call omits
    -- 'userId' — cases 1/2/8/9 below all do) orders by
    -- "(role = 'admin') DESC" — the role column MUST exist or that query
    -- throws "no such column: role" from inside createTransaction()'s own
    -- transaction(), which reads as a broken assertion, not a schema gap.
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role TEXT DEFAULT 'staff'
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    -- Not exercised by any assertion in this file (no test here sets
    -- clientName/senderName/receiverName/partnerId), but several
    -- unconditional-LOOKING code paths inside
    -- FinancialServiceRepository.createTransaction sit behind sibling
    -- conditions that ARE false for every fixture in this file (isForPartner,
    -- 'data.payments' presence) — included anyway per the schema-trap
    -- warning (CLAUDE.md / FinancialServiceRepository.omtCommissionModelGate
    -- .test.ts's own fixture, copied verbatim) rather than hand-proving every
    -- branch of a 3000-line method stays unreached.
    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL, phone_number TEXT, notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      commission_entry_mode TEXT CHECK(commission_entry_mode IN ('LUMP', 'RATE')) DEFAULT 'LUMP',
      commission_rate REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT',   'OMT',   1);
    INSERT INTO suppliers (name, provider, is_system) VALUES ('Whish', 'WHISH', 0);
    INSERT INTO suppliers (name, provider, is_system) VALUES ('Katsh', 'Katsh', 0);

    -- Full column set — both FinancialServiceRepository.createTransaction's
    -- INSERT (real round trip, cases 1-4/8/9) AND
    -- SupplierRepository._bookCommissionAtSettlement's re-read via
    -- getFinancialServiceRepository().findById() (SUPPLIER_OWED_EXPR's full
    -- explicit column list, rule 14) need every one of these columns.
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
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

    -- Unrelated to this file's own scenarios, but TransactionRepository's
    -- _cancelDebt runs UNCONDITIONALLY on every void/refund (no schema-drift
    -- guard of its own) and needs this table to exist even though no row
    -- here ever matches its query.
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances VALUES (1, 'General',     'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',     'LBP', 0,    CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',  'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',  'LBP', 5000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System','USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Katsh',       'USD', 0,    CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Katsh',       'LBP', 0,    CURRENT_TIMESTAMP);

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');
  `);

  return db;
}

function supplierIdByProvider(db: Database.Database, provider: string): number {
  const row = db
    .prepare(`SELECT id FROM suppliers WHERE provider = ?`)
    .get(provider) as { id: number };
  return row.id;
}

/** The single FINANCIAL_SERVICE transaction createTransaction() wrote. */
function fsTxnFor(
  db: Database.Database,
  fsId: number,
): { profit_usd: number; profit_lbp: number; status: string } {
  return db
    .prepare(
      `SELECT profit_usd, profit_lbp, status FROM transactions
       WHERE source_table = 'financial_services' AND source_id = ? AND type = 'FINANCIAL_SERVICE'`,
    )
    .get(fsId) as { profit_usd: number; profit_lbp: number; status: string };
}

/** The SUPPLIER_SETTLEMENT transaction settleTransactions() wrote. */
function settlementTxnFor(
  db: Database.Database,
  settlementLedgerId: number,
): { id: number; profit_usd: number; profit_lbp: number; status: string } {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp, status FROM transactions
       WHERE source_table = 'supplier_ledger' AND source_id = ? AND type = 'SUPPLIER_SETTLEMENT'`,
    )
    .get(settlementLedgerId) as {
    id: number;
    profit_usd: number;
    profit_lbp: number;
    status: string;
  };
}

/**
 * Rule 20's "nets to 0" check, spelled the way every real profit query in
 * this codebase spells it: only ACTIVE-status rows count (a VOIDED
 * original's own profit_usd/profit_lbp value is left in place by
 * TransactionRepository._voidTransactionInternal — see its step 1 — it is
 * excluded by status, not by being zeroed out; TransactionRepository.ts's
 * own doc comment on `_reverseSupplierSettlement` names this exact
 * mechanism: "the transaction's own profit_usd/profit_lbp nets to 0 the same
 * generic way every other transaction's profit does").
 */
function activeProfitSum(
  db: Database.Database,
  fsId: number,
  settlementLedgerId: number,
): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp
       FROM transactions
       WHERE status = 'ACTIVE' AND (
         (source_table = 'financial_services' AND source_id = ?) OR
         (source_table = 'supplier_ledger' AND source_id = ?)
       )`,
    )
    .get(fsId, settlementLedgerId) as { usd: number; lbp: number };
}

/** Direct-INSERT fixture builder for settlement-only cases (5-7) that don't
 *  need a real createTransaction() round trip — mirrors
 *  SupplierRepository.commissionAtSettlement.test.ts's own `seedFs` shape. */
function seedFs(
  db: Database.Database,
  opts: {
    provider: string;
    serviceType?: string;
    amount: number;
    currency?: string;
    commission?: number;
    commissionModel: 0 | 1;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (provider, service_type, amount, currency, commission, commission_model, is_settled)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      opts.provider,
      opts.serviceType ?? "RECEIVE",
      opts.amount,
      opts.currency ?? "USD",
      opts.commission ?? 0,
      opts.commissionModel,
    );
  return Number(res.lastInsertRowid);
}

describe("LIRA-158 Phase 1 — the interlock (EDIT 1 + EDIT 2)", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;
  let supplierRepo: SupplierRepository;
  let txnRepo: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    fsRepo = new FinancialServiceRepository();
    supplierRepo = new SupplierRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    resetSupplierRepository();
    resetTransactionRepository();
    db.close();
  });

  // ── EDIT 1 — FinancialServiceRepository.ts profit stamp gate ────────────

  describe("EDIT 1 — FinancialServiceRepository profit-stamp commission-term gate", () => {
    it(
      "case 1: model-1 OMT SEND — the FINANCIAL_SERVICE profit stamp is 0, " +
        "while fs.commission still holds the auto-calc ESTIMATE (proves the " +
        "STAMP was zeroed, not the estimate column)",
      () => {
        // Realistic OMT SEND: INTRA service, $5 OMT fee (explicit, skips the
        // lookup table) → calculateCommission("INTRA", 5) = 0.50 — a
        // genuinely nonzero estimate (omtFees.test.ts pins this exact value).
        const { id: fsId } = fsRepo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0, // ignored — calculatedCommission overrides via the auto-calc branch
          omtServiceType: "INTRA",
          omtFee: 5,
          paidByMethod: "CASH",
          exchangeRate: 90000,
        });

        const fs = db
          .prepare(
            `SELECT commission, commission_model FROM financial_services WHERE id = ?`,
          )
          .get(fsId) as { commission: number; commission_model: number };
        expect(fs.commission_model).toBe(1);
        // The estimate is untouched — Phase 1 zeroes the STAMP, never
        // fs.commission itself (D6 no stamp-back).
        expect(fs.commission).toBeCloseTo(0.5, 4);

        const txn = fsTxnFor(db, fsId);
        // Would read 0.5 if the `commissionModel === 1 && !useCostPriceFlow`
        // gate on FinancialServiceRepository.ts's profit_usd/profit_lbp stamp
        // (EDIT 1) were reverted to the bare
        // `currency === "USD" ? commission : 0` ternary.
        expect(txn.profit_usd).toBe(0);
        expect(txn.profit_lbp).toBe(0);
      },
    );

    it(
      "case 2: model-1 row WITH kept change — profit stamp == kept change " +
        "EXACTLY (commission term zeroed, kept_change stays unconditional)",
      () => {
        const { id: fsId } = fsRepo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5, // estimate 0.50 — would leak into the stamp as 3.50 if EDIT 1 were reverted
          paidByMethod: "CASH",
          exchangeRate: 90000,
          kept_change_usd: 3,
        });

        const txn = fsTxnFor(db, fsId);
        // 0 (zeroed commission term) + 3 (kept change, unconditional) = 3.
        // Would read 3.5 if EDIT 1 were reverted (commission term not
        // zeroed) — proving kept_change SURVIVED Phase 1's gate rather than
        // being accidentally caught by it. Would read 0 if kept_change were
        // ever pulled INSIDE the gate's ternary instead of added outside it
        // — the regression this test exists to pin
        // (lira-108-keep-change-modules.spec.ts is the e2e mirror).
        expect(txn.profit_usd).toBe(3);
        expect(txn.profit_lbp).toBe(0);
      },
    );

    it(
      "case 3: model-0 row — profit stamp is UNCHANGED, still == commission " +
        "(D3 cutover, byte-for-byte)",
      () => {
        // Provider "OTHER" is neither OMT/WHISH nor BILL → commissionModel
        // stays 0 (isOmtWhishTransfer/BILL gate, :1489-1493) and
        // calculatedCommission falls through to the bare `data.commission`.
        const { id: fsId } = fsRepo.createTransaction({
          provider: "OTHER",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 5,
          paidByMethod: "CASH",
          exchangeRate: 90000,
        });

        const fs = db
          .prepare(`SELECT commission_model FROM financial_services WHERE id = ?`)
          .get(fsId) as { commission_model: number };
        expect(fs.commission_model).toBe(0);

        const txn = fsTxnFor(db, fsId);
        // Would read 0 if the gate were ever widened past `commissionModel
        // === 1` (e.g. an unconditional zero, or a mistakenly-inverted
        // check) — this is the D3 cutover regression guard: a legacy
        // (model-0) row must keep stamping its commission exactly as before
        // Phase 1 shipped.
        expect(txn.profit_usd).toBe(5);
        expect(txn.profit_lbp).toBe(0);
      },
    );

    it(
      "case 4: model-1 BILL priced WITH A MARGIN (cost=10, price=12) — " +
        "stamp == 2, NOT zeroed — pins the !useCostPriceFlow half of the gate",
      () => {
        // Every REAL bill submission site sends cost === price (KatchForm.tsx
        // :1272-1273/:1404-1405/:1778-1779), so this fixture is the ONLY
        // place in the whole test suite that exercises cost !== price for a
        // BILL row — see LIRA-158_COMMISSION_REPORTING_PLAN.md §1.1b.
        const { id: fsId } = fsRepo.createTransaction({
          provider: "Katsh",
          serviceType: "BILL",
          amount: 12,
          cost: 10,
          price: 12,
          currency: "USD",
          commission: 0,
          deferPayment: true,
          exchangeRate: 90000,
          userId: 1,
        });

        const fs = db
          .prepare(`SELECT commission_model FROM financial_services WHERE id = ?`)
          .get(fsId) as { commission_model: number };
        expect(fs.commission_model).toBe(1); // BILL is always AT_SETTLEMENT

        const txn = fsTxnFor(db, fsId);
        // `commission` here is `price - cost + telecomCreditReturnCredit(0)`
        // = 12 - 10 = 2 — a MARGIN earned NOW, not a supplier commission
        // deferred to settlement. Would read 0 if the gate were simplified
        // to the naive `commissionModel === 1 ? 0 : ...` (dropping the
        // `!useCostPriceFlow` half) — silently deleting a bill's margin the
        // moment cost != price, invisible in every other fixture because
        // every real bill ships cost === price.
        expect(txn.profit_usd).toBe(2);
        expect(txn.profit_lbp).toBe(0);
      },
    );
  });

  // ── EDIT 2 — SupplierRepository.ts settlement profit stamp widening ─────

  describe("EDIT 2 — SupplierRepository settlement profit stamp (batchModel === 1)", () => {
    it(
      "case 5: non-bills model-1 settlement (plain OMT RECEIVE batch) — the " +
        "SUPPLIER_SETTLEMENT transaction carries the ENTERED commission as " +
        "profit_usd/profit_lbp",
      () => {
        const omtId = supplierIdByProvider(db, "OMT");
        const fsId = seedFs(db, {
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 100,
          commissionModel: 1,
        });

        const result = supplierRepo.settleTransactions({
          supplier_id: omtId,
          financial_service_ids: [fsId],
          amount_usd: 0,
          amount_lbp: 0,
          commission_usd: 7,
          commission_lbp: 0,
          created_by: 1,
        });

        const txn = settlementTxnFor(db, result.id);
        // Would read 0 on the pre-EDIT-2 code, which gated on
        // `isBillsOnlyBatch` — false for a plain OMT/WHISH SEND/RECEIVE
        // batch (only a BILL-only batch was ever true). This is the
        // regression EDIT 2 exists to fix.
        expect(txn.profit_usd).toBe(7);
        expect(txn.profit_lbp).toBe(0);
      },
    );

    it(
      "case 6: legacy model-0 settlement — SUPPLIER_SETTLEMENT stamps 0/0, " +
        "UNCHANGED (D3 cutover)",
      () => {
        const omtId = supplierIdByProvider(db, "OMT");
        const fsId = seedFs(db, {
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          commission: 5,
          commissionModel: 0,
        });

        const result = supplierRepo.settleTransactions({
          supplier_id: omtId,
          financial_service_ids: [fsId],
          amount_usd: 95,
          amount_lbp: 0,
          commission_usd: 5,
          commission_lbp: 0,
          created_by: 1,
          payments: [{ method: "CASH", currency_code: "USD", amount: 95 }],
        });

        const txn = settlementTxnFor(db, result.id);
        // Would read 5 if `batchModel === 1` were ever loosened to also
        // match a legacy batch (e.g. a stray `batchModel !== undefined`) —
        // a legacy batch's commission is already stamped at CREATION time
        // (fs.commission embedded, D3), so stamping it again here would
        // double-count it against itself.
        expect(txn.profit_usd).toBe(0);
        expect(txn.profit_lbp).toBe(0);
      },
    );

    it(
      "case 7: bills-only settlement — profit stamp UNCHANGED from today " +
        "(isBillsOnlyBatch implies batchModel === 1, so EDIT 2 changes nothing here)",
      () => {
        const katshId = supplierIdByProvider(db, "Katsh");
        const fs1 = seedFs(db, {
          provider: "Katsh",
          serviceType: "BILL",
          amount: 0,
          currency: "LBP",
          commissionModel: 1,
        });
        const fs2 = seedFs(db, {
          provider: "Katsh",
          serviceType: "BILL",
          amount: 0,
          currency: "LBP",
          commissionModel: 1,
        });

        const result = supplierRepo.settleTransactions({
          supplier_id: katshId,
          financial_service_ids: [fs1, fs2],
          amount_usd: 0,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: 40000,
          entry_mode: "LUMP",
          created_by: 1,
        });

        const txn = settlementTxnFor(db, result.id);
        // This assertion is IDENTICAL before and after EDIT 2 — a bills-only
        // batch always has batchModel === 1 (isBillsOnlyBatch's own
        // definition requires it), so widening the condition from
        // `isBillsOnlyBatch` to `batchModel === 1` cannot change this
        // result. Included as the regression guard that the widening left
        // the shipped bills-only shape byte-for-byte alone.
        expect(txn.profit_lbp).toBe(40000);
        expect(txn.profit_usd).toBe(0);
      },
    );
  });

  // ── THE INTERLOCK — the reason this ticket exists ───────────────────────

  describe("the interlock", () => {
    it(
      "case 8: a model-1 OMT SEND whose auto-calc ESTIMATE (0.50) differs " +
        "from the settlement's ENTERED commission (2.00) is recognised " +
        "EXACTLY ONCE, at the ENTERED figure — not the estimate, and not both " +
        "added together",
      () => {
        const omtId = supplierIdByProvider(db, "OMT");

        // Estimate: calculateCommission("INTRA", 5) = 0.50.
        const { id: fsId } = fsRepo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5,
          paidByMethod: "CASH",
          exchangeRate: 90000,
        });

        const fs = db
          .prepare(`SELECT commission FROM financial_services WHERE id = ?`)
          .get(fsId) as { commission: number };
        expect(fs.commission).toBeCloseTo(0.5, 4); // the estimate — unaffected by the settlement below

        const creationTxn = fsTxnFor(db, fsId);
        expect(creationTxn.profit_usd).toBe(0); // EDIT 1: the estimate never reaches profit at creation

        // Settle with a DELIBERATELY DIFFERENT entered commission (2.00,
        // not 0.50) — every OTHER fixture in this repo uses entered ==
        // estimate, which is precisely why this bug class was invisible
        // until this ticket (LIRA-158_COMMISSION_REPORTING_PLAN.md §6).
        const settlement = supplierRepo.settleTransactions({
          supplier_id: omtId,
          financial_service_ids: [fsId],
          amount_usd: 0,
          amount_lbp: 0,
          commission_usd: 2.0,
          commission_lbp: 0,
          created_by: 1,
        });

        const settlementTxn = settlementTxnFor(db, settlement.id);
        // Would read 0 if EDIT 2 were reverted (the entered commission never
        // reaches the settlement stamp at all).
        expect(settlementTxn.profit_usd).toBe(2);

        const total = activeProfitSum(db, fsId, settlement.id);
        // THE assertion that makes a double-count unmistakable: would read
        // 2.50 if EDIT 1 were reverted (the 0.50 estimate stamped at
        // creation ADDS to the 2.00 entered at settlement — a double count
        // hiding in plain sight because it's a plausible-looking number).
        // Would read 0.50 if EDIT 2 were reverted (only the stale estimate
        // ever reached profit; the entered commission is never recognised
        // at all). Reads 2.00 only when both halves of the interlock are in
        // place together.
        expect(total.usd).toBeCloseTo(2, 4);
        expect(total.lbp).toBeCloseTo(0, 4);
      },
    );
  });

  // ── Rule 20 — create -> settle -> void nets to 0 ────────────────────────

  describe("create -> settle -> void nets to 0 per currency (rule 20)", () => {
    it(
      "case 9: void of the settlement removes the settlement's own profit " +
        "recognition (status flips out of the ACTIVE filter, the same generic " +
        "mechanism every other transaction's profit reversal relies on) — " +
        "the FS row's own (already-zero) stamp is untouched throughout",
      () => {
        const omtId = supplierIdByProvider(db, "OMT");
        const { id: fsId } = fsRepo.createTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 100,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          omtFee: 5,
          paidByMethod: "CASH",
          exchangeRate: 90000,
        });

        const settlement = supplierRepo.settleTransactions({
          supplier_id: omtId,
          financial_service_ids: [fsId],
          amount_usd: 0,
          amount_lbp: 0,
          commission_usd: 3,
          commission_lbp: 0,
          created_by: 1,
        });
        const settlementTxn = settlementTxnFor(db, settlement.id);

        // Forward path: recognised exactly once, at the entered figure.
        expect(activeProfitSum(db, fsId, settlement.id).usd).toBeCloseTo(3, 4);

        txnRepo.voidTransaction(settlementTxn.id, 1);

        // The settlement's OWN transaction row flips to status = 'VOIDED'
        // (TransactionRepository._voidTransactionInternal step 1) — its
        // profit_usd COLUMN VALUE is left in place (3), it is excluded by
        // STATUS, not by being zeroed; the void's reversal row carries no
        // profit of its own (its INSERT never binds profit_usd/profit_lbp,
        // defaulting to 0). Every real profit query in ProfitRepository
        // filters `status = 'ACTIVE'`, so this nets to exactly 0. Would fail
        // (read 3, not 0) if EDIT 2's stamp were ever written somewhere the
        // generic void/refund status-flip doesn't reach — e.g. a second,
        // bespoke ledger table read by an ACTIVE-agnostic query.
        const after = activeProfitSum(db, fsId, settlement.id);
        expect(after.usd).toBeCloseTo(0, 4);
        expect(after.lbp).toBeCloseTo(0, 4);

        // Sanity companion (not the point of this test, but cheap to check):
        // the original settlement row really did flip, and the FS row's own
        // creation-time stamp — already 0 per EDIT 1 — was never touched by
        // the settlement's void at all.
        const originalStatus = db
          .prepare(`SELECT status FROM transactions WHERE id = ?`)
          .get(settlementTxn.id) as { status: string };
        expect(originalStatus.status).toBe("VOIDED");
        expect(fsTxnFor(db, fsId).profit_usd).toBe(0);
      },
    );
  });
});
