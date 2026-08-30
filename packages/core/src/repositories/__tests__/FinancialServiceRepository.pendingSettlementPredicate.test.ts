/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md §3/Phase 0, decision D2 — the ONE
 * pending-supplier-settlement predicate (`isPendingSupplierSettlement` /
 * `PENDING_SETTLEMENT_SQL`, FinancialServiceRepository.ts).
 *
 * Rule 17 (CLAUDE.md): this file's headline test —
 * "a NEW-model Katsh BILL row is born is_settled = 0" — was run against the
 * PRE-swap creation logic (`isOmtOrWhish && commission > 0`, which never
 * flagged BILLs pending at all) before this fix landed, and OBSERVED
 * FAILING:
 *
 *   FAIL src/repositories/__tests__/FinancialServiceRepository.pendingSettlementPredicate.test.ts
 *     ● COMMISSION_AT_SETTLEMENT_PLAN.md D2 — is_settled at creation ›
 *       a NEW-model Katsh BILL row (commission = 0 at creation) is born
 *       is_settled = 0 — commission is entered AT settlement, not guessed here
 *
 *       expect(received).toBe(expected) // Object.is equality
 *       Expected: 0
 *       Received: 1
 *
 *         at Object.<anonymous> (.../FinancialServiceRepository.pendingSettlementPredicate.test.ts:NN:NN)
 *
 * Reproduced by temporarily reverting the creation-time predicate to:
 *   const isOmtOrWhish = data.provider === "OMT" || data.provider === "WHISH";
 *   const isPendingSettlement = isOmtOrWhish && commission > 0;
 * (the exact pre-Phase-0 code, per COMMISSION_AT_SETTLEMENT_PLAN.md §1.2) —
 * a zero-commission Katsh BILL was born is_settled = 1 (immediately
 * "settled"), invisible to the settle tab. Reverted back to the
 * predicate-swap fix and re-run green before this file was finalized.
 *
 * IMPORTANT — post-review correction (2-reviewer FIX_FIRST, critical money
 * bug), UPDATED 2026-08-29 for Phase 2 (D1, shipped): `commission_model` was
 * gated to BILL rows ONLY at creation while Phase 2 was unshipped, because
 * stamping OMT/WHISH SEND/RECEIVE `commission_model = 1` before
 * `grossOwedDelta`/`SUPPLIER_OWED_EXPR` stopped netting their auto-calculated
 * commission out of `supplier_owed` would have double-subtracted it (see
 * `FinancialServiceRepository.omtCommissionModelGate.test.ts`, which guards
 * this specific defect end-to-end with a realistic nonzero-commission OMT
 * SEND). COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 2 (D1) has now shipped —
 * BOTH halves landed together (the gross-payable flip AND widening this
 * stamp) — so OMT/WHISH SEND/RECEIVE are now ALSO born `commission_model =
 * 1`, same as BILL. The "is_settled at creation" describe block below tests
 * each kind's CORRECT (POST-Phase-2) behavior: BILL and OMT/WHISH are both
 * born commission_model = 1 (and therefore unconditionally PENDING —
 * `isPendingSupplierSettlement`'s model=1 branch returns `true` for either
 * kind with no commission check at all, unlike the legacy marker it
 * replaces); BINANCE (out of §0 scope) is the only kind still born
 * commission_model = 0, following the preserved legacy marker.
 *
 * LIRA-112 (2026-08-09, D12) update: `isPendingSupplierSettlement` gained a
 * required `supplierCommissionEligible` field and the BILL branch dropped
 * its `provider IN ('iPick', 'Katsh')` hardcode. Rule 17 for THIS fix: the
 * BILL branch was temporarily reverted to
 * `row.service_type === "BILL" && (row.provider === "iPick" || row.provider
 * === "Katsh")` (the exact pre-fix condition, ignoring
 * supplierCommissionEligible) — the new
 * "new-model iPick BILL, supplier commission_eligible = 0 → NOT pending"
 * truth-table case and the "is born is_settled = 1" creation-time test
 * FAILED (received `true`/`0` where `false`/`1` was expected), proving both
 * providers were still being treated identically. Reverted back to the real
 * fix and re-run green before this file was finalized — see the task report
 * for the exact failure output.
 */

import Database from "better-sqlite3";
import {
  FinancialServiceRepository,
  isPendingSupplierSettlement,
} from "../FinancialServiceRepository";
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
      commission_eligible INTEGER NOT NULL DEFAULT 1 CHECK(commission_eligible IN (0, 1)),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- LIRA-112 (D12): iPick earns no commission at all; Katsh earns
    -- 20,000 LBP/bill. This is the data-driven config PENDING_SETTLEMENT_SQL's
    -- BILL branch now reads instead of a provider-name hardcode.
    INSERT INTO suppliers (name, provider, is_system, commission_eligible) VALUES ('OMT',   'OMT',   1, 1);
    INSERT INTO suppliers (name, provider, is_system, commission_eligible) VALUES ('Whish', 'WHISH', 0, 1);
    INSERT INTO suppliers (name, provider, is_system, commission_eligible) VALUES ('iPick', 'iPick', 0, 0);
    INSERT INTO suppliers (name, provider, is_system, commission_eligible) VALUES ('Katsh', 'Katsh', 0, 1);

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

describe("COMMISSION_AT_SETTLEMENT_PLAN.md D2 — is_settled at creation", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it(
    "a NEW-model Katsh BILL row (commission = 0 at creation) is born " +
      "is_settled = 0 — commission is entered AT settlement, not guessed here",
    () => {
      const { id } = repo.createTransaction({
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
        .prepare(
          `SELECT is_settled, commission, commission_model FROM financial_services WHERE id = ?`,
        )
        .get(id) as {
        is_settled: number;
        commission: number;
        commission_model: number;
      };

      expect(row.commission).toBe(0);
      expect(row.commission_model).toBe(1);
      expect(row.is_settled).toBe(0);
    },
  );

  // ── LIRA-112 (D12) ────────────────────────────────────────────────────────
  //
  // Owner: "i said ipick bills gives us no comission, but katsh does...
  // Whereas in ipick its not the case. No comission in ipick." Both the
  // pre-plan code AND Phase 0/1 (the test above, pre-this-fix) treated
  // iPick and Katsh identically — this is the exact bug.
  it(
    "a NEW-model iPick BILL row is born is_settled = 1 (iPick earns NO " +
      "commission — LIRA-112 — never pending, unlike Katsh above)",
    () => {
      const { id } = repo.createTransaction({
        provider: "iPick",
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
        .prepare(
          `SELECT is_settled, commission, commission_model FROM financial_services WHERE id = ?`,
        )
        .get(id) as {
        is_settled: number;
        commission: number;
        commission_model: number;
      };

      expect(row.commission).toBe(0);
      // Still stamped commission_model = 1 (still structurally a BILL, per
      // D3's service_type-only gate) — but never pending, because iPick's
      // OWN supplier row says commission_eligible = 0.
      expect(row.commission_model).toBe(1);
      expect(row.is_settled).toBe(1);
    },
  );

  it("a NEW-model iPick BILL never appears in getUnsettledBySupplier('iPick') — absent from the commission settlement queue", () => {
    repo.createTransaction({
      provider: "iPick",
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

    expect(repo.getUnsettledBySupplier("iPick")).toHaveLength(0);
  });

  it(
    "the PENDING_SETTLEMENT_SQL fragment itself excludes an iPick BILL even " +
      "if is_settled/commission_model were forced to look pending (defensive: " +
      "proves the query-level gate, not just the creation-time short-circuit)",
    () => {
      db.prepare(
        `INSERT INTO financial_services
           (provider, service_type, amount, currency, commission, is_settled, commission_model)
         VALUES ('iPick', 'BILL', 20, 'USD', 0, 0, 1)`,
      ).run();

      expect(repo.getUnsettledBySupplier("iPick")).toHaveLength(0);
    },
  );

  // ── OMT/WHISH are NOW AT_SETTLEMENT (commission_model = 1) at creation ──
  //
  // COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 2 (D1, shipped 2026-08-29):
  // OMT/WHISH SEND/RECEIVE are now stamped `commission_model = 1`, same as
  // BILL — see this file's header doc comment and
  // FinancialServiceRepository.omtCommissionModelGate.test.ts (re-derived in
  // the same change) for why the gross-payable flip and this stamp widening
  // had to land together. A model=1 OMT/WHISH row is UNCONDITIONALLY
  // pending settlement (`isPendingSupplierSettlement`'s model=1 branch never
  // checks `commission` at all) — unlike the legacy marker it replaces
  // (which required `commission > 0`), so a zero-commission row is now
  // BORN PENDING too (`is_settled = 0`), the OPPOSITE of pre-Phase-2.

  it("an OMT SEND row is born commission_model = 1, is_settled = 0 (unconditionally pending, even with commission = 0 at creation)", () => {
    // OLD -> NEW (pre-Phase-2, this file's own prior assertions):
    // commission_model 0 -> 1, is_settled 1 -> 0.
    const { id } = repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      paidByMethod: "CASH",
    });

    const row = db
      .prepare(
        `SELECT is_settled, commission, commission_model FROM financial_services WHERE id = ?`,
      )
      .get(id) as {
      is_settled: number;
      commission: number;
      commission_model: number;
    };

    expect(row.commission).toBe(0);
    expect(row.commission_model).toBe(1);
    expect(row.is_settled).toBe(0);
  });

  it("a WHISH RECEIVE (WHISH always forces commission to 0 — 'no commission' business rule) is born commission_model = 1, is_settled = 0", () => {
    // Base system is OMT (seeded above) — WHISH is the SECONDARY system here,
    // so a walk-in WHISH transaction must route THROUGH a partner (unrelated
    // to this predicate; just satisfying that separate guard).
    // OLD -> NEW (pre-Phase-2): commission_model 0 -> 1, is_settled 1 -> 0.
    const partnerId = Number(
      db.prepare("INSERT INTO partners (name) VALUES ('P')").run()
        .lastInsertRowid,
    );
    const { id } = repo.createTransaction({
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 50,
      currency: "USD",
      commission: 0,
      whishFee: 0,
      partnerId,
      partnerMode: "THROUGH",
      paidByMethod: "CASH",
    });

    const row = db
      .prepare(
        `SELECT is_settled, commission_model FROM financial_services WHERE id = ?`,
      )
      .get(id) as { is_settled: number; commission_model: number };

    expect(row.commission_model).toBe(1);
    expect(row.is_settled).toBe(0);
  });

  it("a NEW-model provider OUT of §0 scope (BINANCE) is unaffected — commission_model = 0, born is_settled = 1 same as before", () => {
    const { id } = repo.createTransaction({
      provider: "BINANCE",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0,
      paidByMethod: "CASH",
    });

    const row = db
      .prepare(
        `SELECT is_settled, commission_model FROM financial_services WHERE id = ?`,
      )
      .get(id) as { is_settled: number; commission_model: number };

    expect(row.commission_model).toBe(0);
    expect(row.is_settled).toBe(1);
  });
});

describe("COMMISSION_AT_SETTLEMENT_PLAN.md D2 — legacy-model (commission_model = 0) behavior unchanged", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Simulates rows that existed BEFORE the v150 migration — inserted
   * directly (bypassing the repository), with commission_model = 0, exactly
   * what the migration's `ALTER ... DEFAULT 0` leaves pre-existing rows at.
   *
   * UPDATED for Phase 2 (D1, shipped 2026-08-29): a FRESHLY-CREATED OMT/WHISH
   * row is NO LONGER born commission_model = 0 (see the describe block
   * above) — these `insertLegacyRow` fixtures now stand in specifically for
   * PRE-CUTOVER data (created before this deploy), the whole reason D3 chose
   * a per-row flag over a date cutoff. The mechanism under test
   * (`getUnsettledBySupplier`'s legacy-marker branch) is itself unaffected by
   * Phase 2 either way, so nothing in this describe block needed re-deriving.
   */
  function insertLegacyRow(opts: {
    provider: string;
    serviceType: string;
    commission: number;
    isSettled: number;
  }): number {
    return Number(
      db
        .prepare(
          `INSERT INTO financial_services
             (provider, service_type, amount, currency, commission, is_settled, commission_model)
           VALUES (?, ?, 100, 'USD', ?, ?, 0)`,
        )
        .run(opts.provider, opts.serviceType, opts.commission, opts.isSettled)
        .lastInsertRowid,
    );
  }

  it("legacy OMT SEND with commission > 0, is_settled = 0 is STILL picked up by the settle-tab query", () => {
    insertLegacyRow({
      provider: "OMT",
      serviceType: "SEND",
      commission: 5,
      isSettled: 0,
    });
    initFixedTenantContext(1);
    const repo = new FinancialServiceRepository();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../db/connection").setDb(db);

    const rows = repo.getUnsettledBySupplier("OMT");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.commission === 5)).toBe(true);
    resetTenantContext();
  });

  it("legacy OMT SEND with commission = 0 is NOT picked up (unchanged — the old marker excludes zero-commission legacy rows)", () => {
    insertLegacyRow({
      provider: "OMT",
      serviceType: "SEND",
      commission: 0,
      isSettled: 0,
    });
    initFixedTenantContext(1);
    const repo = new FinancialServiceRepository();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../db/connection").setDb(db);

    const rows = repo.getUnsettledBySupplier("OMT");
    expect(rows).toHaveLength(0);
    resetTenantContext();
  });

  it("legacy Katsh BILL (provider not OMT/WHISH) is never pending regardless of commission — unchanged", () => {
    insertLegacyRow({
      provider: "Katsh",
      serviceType: "BILL",
      commission: 0,
      isSettled: 0,
    });
    initFixedTenantContext(1);
    const repo = new FinancialServiceRepository();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../db/connection").setDb(db);

    const rows = repo.getUnsettledBySupplier("Katsh");
    expect(rows).toHaveLength(0);
    resetTenantContext();
  });
});

describe("isPendingSupplierSettlement — the ONE shared predicate (truth table)", () => {
  it.each<[string, Parameters<typeof isPendingSupplierSettlement>[0], boolean]>(
    [
      [
        "new-model OMT SEND, commission=0 → pending (the whole point of D2)",
        {
          commission_model: 1,
          provider: "OMT",
          service_type: "SEND",
          commission: 0,
          supplierCommissionEligible: false, // irrelevant to this branch
        },
        true,
      ],
      [
        "new-model WHISH RECEIVE, commission=0 → pending",
        {
          commission_model: 1,
          provider: "WHISH",
          service_type: "RECEIVE",
          commission: 0,
          supplierCommissionEligible: false, // irrelevant to this branch
        },
        true,
      ],
      [
        // LIRA-112 (D12) — CORRECTS the pre-fix assumption this exact case
        // used to assert (both providers treated identically, expected
        // `true`). Owner: "ipick bills gives us no comission... Whereas in
        // ipick its not the case." iPick's supplier row is
        // commission_eligible = 0, so it's never pending, regardless of it
        // being a structurally-BILL, commission_model = 1 row.
        "new-model iPick BILL, supplier commission_eligible = 0 → NOT pending (LIRA-112 fix)",
        {
          commission_model: 1,
          provider: "iPick",
          service_type: "BILL",
          commission: 0,
          supplierCommissionEligible: false,
        },
        false,
      ],
      [
        "new-model Katsh BILL, supplier commission_eligible = 1 → pending (Phase 1 scope fence)",
        {
          commission_model: 1,
          provider: "Katsh",
          service_type: "BILL",
          commission: 0,
          supplierCommissionEligible: true,
        },
        true,
      ],
      [
        "new-model BINANCE SEND → NOT pending (out of §0 scope fence)",
        {
          commission_model: 1,
          provider: "BINANCE",
          service_type: "SEND",
          commission: 0,
          supplierCommissionEligible: false, // irrelevant to this branch
        },
        false,
      ],
      [
        // LIRA-112 — proves the gate is data-driven (rule 14), not a
        // provider-name list: an entirely made-up provider's BILL is
        // pending or not purely from its OWN supplier's
        // commission_eligible bit, exactly like iPick/Katsh above. No
        // hardcoded provider name appears in isPendingSupplierSettlement's
        // BILL branch anymore.
        "new-model BILL from an unlisted provider, commission_eligible = 0 → NOT pending (data-driven, no provider allowlist)",
        {
          commission_model: 1,
          provider: "SomeFutureBillProvider",
          service_type: "BILL",
          commission: 0,
          supplierCommissionEligible: false,
        },
        false,
      ],
      [
        "new-model BILL from an unlisted provider, commission_eligible = 1 → pending (data-driven, no provider allowlist)",
        {
          commission_model: 1,
          provider: "SomeFutureBillProvider",
          service_type: "BILL",
          commission: 0,
          supplierCommissionEligible: true,
        },
        true,
      ],
      [
        "legacy OMT SEND, commission > 0 → pending (the preserved historical marker)",
        {
          commission_model: 0,
          provider: "OMT",
          service_type: "SEND",
          commission: 5,
          supplierCommissionEligible: false, // irrelevant to this branch
        },
        true,
      ],
      [
        "legacy OMT SEND, commission = 0 → NOT pending (legacy marker unchanged)",
        {
          commission_model: 0,
          provider: "OMT",
          service_type: "SEND",
          commission: 0,
          supplierCommissionEligible: false, // irrelevant to this branch
        },
        false,
      ],
      [
        "legacy iPick BILL, commission = 0 → NOT pending (bills were always born settled pre-cutover)",
        {
          commission_model: 0,
          provider: "iPick",
          service_type: "BILL",
          commission: 0,
          supplierCommissionEligible: false, // irrelevant to this branch
        },
        false,
      ],
    ],
  )("%s", (_label, row, expected) => {
    expect(isPendingSupplierSettlement(row)).toBe(expected);
  });
});
