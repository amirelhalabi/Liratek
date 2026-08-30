/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md Phase 0 — CRITICAL regression guard
 * (2-reviewer FIX_FIRST): the `commission_model` stamp at creation
 * (`FinancialServiceRepository.createTransaction`) and the
 * `grossOwedDelta`/`SUPPLIER_OWED_EXPR` payable formula are TWO HALVES OF
 * ONE INVARIANT that must always move TOGETHER (rule 14's hazard, made
 * concrete): stamping a row `commission_model = 1` (AT_SETTLEMENT) routes it
 * into the settlement path that books the operator's entered commission as
 * a real `SUPPLIER_PAYS_US` credit — correct ONLY if the payable formula
 * ITSELF no longer netted that same commission out at creation. Landing
 * either half without the other double-subtracts (or never subtracts) the
 * shop's cut. Originally (Phase 0) this meant: BILL got both halves (its
 * formula never included commission to begin with), OMT/WHISH got NEITHER
 * (their formula still netted `c`, so the stamp had to stay 0 or a
 * double-subtraction resulted) — see this file's `git blame` / the plan's
 * own boxed warning for that shape, still true of any FUTURE money type this
 * repo adds under the same discipline.
 *
 * UPDATED 2026-08-29 — COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 2 (D1,
 * shipped): BOTH halves for OMT/WHISH landed in the SAME change —
 * `grossOwedDelta`/`SUPPLIER_OWED_EXPR` no longer net `c` out of
 * `supplier_owed` at all, AND the `commission_model` stamp now covers
 * OMT/WHISH SEND/RECEIVE too (`isOmtWhishTransfer`, same predicate
 * `isPendingSupplierSettlement` already used). This file's fixture — a
 * REALISTIC OMT SEND with a real `omtServiceType` ("INTRA") and a real
 * `omtFee` (10), so `calculateCommission` fires and stores a genuinely
 * nonzero `commission` (1.0 = 10% of the $10 fee) — is exactly what a
 * fixture using `commission: 0` structurally cannot exercise (0 minus 0 is
 * still 0; no double-subtraction would ever show), which is why the ticket
 * that shipped Phase 2 named THIS file's fixture as the one to re-derive,
 * not replace.
 *
 * The test below is re-derived to the POST-Phase-2 invariant: a realistic
 * OMT SEND is now born `commission_model = 1`, `supplier_owed` is the TRUE
 * gross (100 + 10 = 110, no commission netted), and settling it takes the
 * NEW-MODEL path — a real `supplier_settlements` row, one allocation, and a
 * `SUPPLIER_PAYS_US` credit for the entered commission — netting
 * TOP_UP(110) + SETTLEMENT(-109) + SUPPLIER_PAYS_US(-1) to exactly 0. This
 * is a STATIC re-derivation from the shipped production code (read, not
 * executed — this task ran no tests/builds per its own instructions); the
 * owner's next full `yarn test` pass is the first actual execution of these
 * numbers and is the authoritative check.
 *
 * The drift this file guards against, going forward: if `grossOwedDelta`'s
 * `- commission` term (or `SUPPLIER_OWED_EXPR`'s) is ever reintroduced
 * WITHOUT reverting the `commission_model` stamp back to 0 for OMT/WHISH (or
 * vice versa — the stamp reverted without the formula), THIS row would
 * double-subtract the shop's cut again — `supplier_owed` would read 109
 * (commission netted) yet still route into the new-model settlement path
 * and book a SECOND `-1` `SUPPLIER_PAYS_US` credit, landing the ledger sum
 * at -1 instead of 0 (see the second assertion group below). A companion
 * file, `FinancialServiceRepository.grossOwedDeltaSqlJsParity.test.ts`,
 * guards the narrower JS-vs-SQL arithmetic agreement directly, independent
 * of any specific settlement shape.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  SupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
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

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL, role TEXT DEFAULT 'staff');
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

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

    -- Full column set — mirrors FinancialServiceRepository.pendingSettlementPredicate
    -- .test.ts's fixture (already proven to exercise a full OMT SEND
    -- createTransaction round trip), plus the v150 columns.
    CREATE TABLE financial_services (
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
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER REFERENCES partners(id),
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      commission_model INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT
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
      commission_entry_mode TEXT CHECK(commission_entry_mode IN ('LUMP', 'RATE')) DEFAULT 'LUMP',
      commission_rate REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT',   'OMT',   1);
    INSERT INTO suppliers (name, provider, is_system) VALUES ('Whish', 'WHISH', 0);

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

    -- Migration v150 (COMMISSION_AT_SETTLEMENT_PLAN.md §3) real schema —
    -- needed so SupplierRepository._hasCommissionAtSettlementSchema() sees a
    -- FULLY v150-upgraded connection (a partially-upgraded one would silently
    -- fall back to legacy behavior regardless of commission_model, masking
    -- exactly the bug this file guards).
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

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');

    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'USD', 500, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD', 500, CURRENT_TIMESTAMP);
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

describe("COMMISSION_AT_SETTLEMENT_PLAN.md Phase 0 double-subtraction guard", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;
  let supplierRepo: SupplierRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    fsRepo = new FinancialServiceRepository();
    supplierRepo = new SupplierRepository();
  });

  afterEach(() => {
    resetTenantContext();
    resetSupplierRepository();
    db.close();
  });

  it(
    "a realistic OMT SEND (real omtServiceType+omtFee, nonzero commission) is born " +
      "commission_model = 1 (AT_SETTLEMENT) — routed into the new-model settlement " +
      "path — settling it books a real commission credit and nets to 0 (Phase 2, D1)",
    () => {
      const omtId = supplierIdByProvider(db, "OMT");

      // Realistic OMT SEND: INTRA service, $10 OMT fee (explicit, skips the
      // lookup table) → calculateCommission("INTRA", 10) = 1.0 (10% of the
      // fee) — a genuinely nonzero commission, unlike every pre-existing
      // suite's hand-picked commission: 0 inputs.
      const { id: fsId } = fsRepo.createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0, // ignored — calculatedCommission overrides via the auto-calc branch
        omtServiceType: "INTRA",
        omtFee: 10,
        paidByMethod: "CASH",
      });

      const row = db
        .prepare(
          `SELECT commission, commission_model, is_settled FROM financial_services WHERE id = ?`,
        )
        .get(fsId) as {
        commission: number;
        commission_model: number;
        is_settled: number;
      };

      // The auto-calc branch genuinely fired — commission is still computed
      // and stored (an at-settlement DISPLAY ESTIMATE, D1), just no longer
      // subtracted from the payable.
      expect(row.commission).toBeCloseTo(1, 4);

      // THE INVARIANT (Phase 2, D1 — OLD -> NEW: 0 -> 1): born
      // commission_model = 1 (AT_SETTLEMENT), same as a BILL. Correct ONLY
      // because grossOwedDelta/SUPPLIER_OWED_EXPR ALSO stopped netting this
      // row's commission out of supplier_owed in the SAME change (see the
      // ledger assertion below) — the two halves of this invariant, landed
      // together (this file's own header explains the hazard if they ever
      // drift apart again).
      expect(row.commission_model).toBe(1);
      // Unconditionally pending settlement now — the model=1 OMT/WHISH
      // branch of isPendingSupplierSettlement never checks `commission` at
      // all (unlike the legacy marker it replaces for this row).
      expect(row.is_settled).toBe(0);

      // Gross TOP_UP booked at creation (grossOwedDelta), Phase 2 (D1) — no
      // commission netted: principal(100) + fee(10) = 110. OLD (pre-Phase-2):
      // 109 (=100+10-1). supplier_owed (SUPPLIER_OWED_EXPR) reads the same 110.
      const fs = fsRepo.findById(fsId)!;
      expect(fs.supplier_owed).toBeCloseTo(110, 4);
      expect(ledgerSum(db, omtId)).toBeCloseTo(110, 4);

      // Settle exactly like the NEW-model UI would: net pay = gross MINUS the
      // entered commission (the commission itself is booked separately, step
      // 5 below) — OLD -> NEW: amount_usd 109 -> 109 stays numerically the
      // SAME here (110 gross - 1 commission = 109, same net-pay figure the
      // pre-Phase-2 UI happened to compute a different way), but it is no
      // longer "the full supplier_owed with nothing further deducted" — it
      // is now "gross minus commission," and the commission is a REAL
      // second ledger entry (assertions below), not implicit.
      supplierRepo.settleTransactions({
        supplier_id: omtId,
        financial_service_ids: [fsId],
        amount_usd: 109,
        amount_lbp: 0,
        commission_usd: 1,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 109 }],
      });

      // THE ASSERTION THAT WOULD CATCH A REINTRODUCED DOUBLE-SUBTRACTION: with
      // commission_model correctly 1, `_resolveSettlementBatchModel` reads
      // this batch as NEW-MODEL and calls `_bookCommissionAtSettlement`,
      // which books a SECOND ledger row — a `SUPPLIER_PAYS_US` credit for
      // the entered $1 commission (assertions below) — on top of the
      // TOP_UP(110)/SETTLEMENT(-109) pair. TOP_UP(110) + SETTLEMENT(-109) +
      // SUPPLIER_PAYS_US(-1) nets to EXACTLY 0.
      //
      // If `grossOwedDelta`/`SUPPLIER_OWED_EXPR` ever regressed to netting
      // `c` out again WITHOUT reverting this stamp to 0, this same call would
      // book the SAME dollar of commission twice — once inside a
      // (regressed) 109 TOP_UP, once again as this -1 credit — landing the
      // ledger sum at -1, not 0.
      expect(ledgerSum(db, omtId)).toBeCloseTo(0, 4);

      // New-model audit records DO exist for this settlement (Phase 2, D1 —
      // OLD -> NEW: was asserted absent/undefined/length 0, now present) —
      // confirms the batch WAS routed into `_bookCommissionAtSettlement`.
      const settlementLedgerRow = db
        .prepare(
          `SELECT id FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'SETTLEMENT'`,
        )
        .get(omtId) as { id: number };
      const settlementRecord = db
        .prepare(`SELECT * FROM supplier_settlements WHERE ledger_entry_id = ?`)
        .get(settlementLedgerRow.id) as
        | { model: number; commission_usd: number; gross_usd: number }
        | undefined;
      expect(settlementRecord).toBeDefined();
      expect(settlementRecord!.model).toBe(1);
      expect(settlementRecord!.commission_usd).toBeCloseTo(1, 4);
      expect(settlementRecord!.gross_usd).toBeCloseTo(110, 4);
      const allocations = db
        .prepare(
          `SELECT * FROM settlement_commission_allocations WHERE settlement_ledger_id = ?`,
        )
        .all(settlementLedgerRow.id) as Array<{
        financial_service_id: number;
        commission_usd: number;
      }>;
      expect(allocations).toHaveLength(1);
      expect(allocations[0].financial_service_id).toBe(fsId);
      expect(allocations[0].commission_usd).toBeCloseTo(1, 4);
      const commissionCredit = db
        .prepare(
          `SELECT * FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'SUPPLIER_PAYS_US'`,
        )
        .get(omtId) as { amount_usd: number; is_auto: number } | undefined;
      expect(commissionCredit).toBeDefined();
      expect(commissionCredit!.amount_usd).toBeCloseTo(-1, 4);
      expect(commissionCredit!.is_auto).toBe(1);
    },
  );

  it("a NEW-model BILL (iPick/Katsh) is unaffected — still born commission_model = 1", () => {
    // Sanity companion: the gate must not be so narrow it stops BILLs from
    // getting the AT_SETTLEMENT flag Phase 1 actually shipped for them.
    db.exec(
      `INSERT INTO suppliers (name, provider, is_system) VALUES ('Katsh', 'Katsh', 0)`,
    );
    const { id } = fsRepo.createTransaction({
      provider: "Katsh",
      serviceType: "BILL",
      amount: 20,
      cost: 20,
      price: 20,
      currency: "USD",
      commission: 0,
      deferPayment: true,
      exchangeRate: 90000,
      userId: 1,
    });
    const row = db
      .prepare(`SELECT commission_model FROM financial_services WHERE id = ?`)
      .get(id) as { commission_model: number };
    expect(row.commission_model).toBe(1);
  });
});
