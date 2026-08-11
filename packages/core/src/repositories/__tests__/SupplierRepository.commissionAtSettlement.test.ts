/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md D2-D6, D8 — the NEW-MODEL
 * (`commission_model` = 1, AT_SETTLEMENT) half of
 * `SupplierRepository.settleTransactions` (Phase 0 "settlement machinery"):
 *
 *   - D4: a batch mixing commission_model 0 and 1 rows is hard-rejected.
 *   - D5: `supplier_settlements` — the real per-batch commission record,
 *     uniquely linked to the settlement's own supplier_ledger row.
 *   - D6: `settlement_commission_allocations` — one row per settled fs row,
 *     largest-remainder proportional split (weighted by each row's own
 *     gross `supplier_owed`, equal-fallback when every row's gross is 0 —
 *     the "bills settlement note").
 *   - D8: entry_mode/rate/unit_count snapshot.
 *   - The commission credit itself — a SUPPLIER_PAYS_US ledger row, is_auto,
 *     linked via source_ref to the settlement's own ledger row (never by
 *     time proximity — the LIRA-085 lesson).
 *
 * LEGACY (commission_model = 0) batches must stay byte-for-byte identical to
 * `SupplierRepository.settlement.test.ts`'s existing coverage — asserted
 * again here as a regression guard specific to the new code path's
 * early-exit.
 *
 * Rule 17: "hard-rejects a batch mixing commission_model 0 and 1 rows" was
 * run against a version with the `distinctModels.size > 1` throw commented
 * out in `_resolveSettlementBatchModel` — OBSERVED FAILING (the settlement
 * silently succeeded instead of throwing, and a $0.10 commission entered for
 * the WHOLE mixed batch got attributed via allocation as if every row were
 * new-model, double-netting the legacy row's already-embedded cut — exactly
 * D4's warning). Reverted to the guard and re-run green before finalizing.
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";

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
      commission_entry_mode TEXT CHECK(commission_entry_mode IN ('LUMP', 'RATE')) DEFAULT 'LUMP',
      commission_rate REAL,
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
      source_ref_table TEXT DEFAULT NULL,
      source_ref_id INTEGER DEFAULT NULL,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Full column set — SupplierRepository._bookCommissionAtSettlement reads
    -- gross via getFinancialServiceRepository().findById(), which selects
    -- FinancialServiceRepository.getColumns()'s full explicit list (rule 14:
    -- reusing SUPPLIER_OWED_EXPR rather than re-deriving it means every one
    -- of these columns must exist on this fixture, even though most are
    -- unused by this file's own scenarios).
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
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
      commission_model INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

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
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'LBP', 0);
  `);

  return db;
}

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

function seedSupplier(
  db: Database.Database,
  provider = "OMT",
  isSystem = 1,
): number {
  const res = db
    .prepare(
      "INSERT INTO suppliers (name, provider, is_system) VALUES (?, ?, ?)",
    )
    .run(provider, provider, isSystem);
  return Number(res.lastInsertRowid);
}

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

function allocationsFor(
  db: Database.Database,
  settlementLedgerId: number,
): Array<{
  financial_service_id: number;
  commission_usd: number;
  commission_lbp: number;
}> {
  return db
    .prepare(
      `SELECT financial_service_id, commission_usd, commission_lbp
       FROM settlement_commission_allocations WHERE settlement_ledger_id = ?
       ORDER BY financial_service_id ASC`,
    )
    .all(settlementLedgerId) as any[];
}

function settlementFor(db: Database.Database, settlementLedgerId: number): any {
  return db
    .prepare(`SELECT * FROM supplier_settlements WHERE ledger_entry_id = ?`)
    .get(settlementLedgerId);
}

function commissionCreditRows(
  db: Database.Database,
  supplierId: number,
): any[] {
  return db
    .prepare(
      `SELECT * FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'SUPPLIER_PAYS_US'`,
    )
    .all(supplierId);
}

describe("SupplierRepository.settleTransactions() — commission-at-settlement (new-model)", () => {
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

  // ── D4: mixed-model hard-reject ─────────────────────────────────────────

  it("hard-rejects a batch mixing commission_model 0 and 1 rows", () => {
    const supplierId = seedSupplier(db, "OMT");
    const legacyFs = seedFs(db, {
      provider: "OMT",
      amount: 100,
      commission: 5,
      commissionModel: 0,
    });
    const newFs = seedFs(db, {
      provider: "OMT",
      amount: 60,
      commission: 0,
      commissionModel: 1,
    });

    expect(() =>
      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [legacyFs, newFs],
        amount_usd: 155,
        amount_lbp: 0,
        commission_usd: 5,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 155 }],
      }),
    ).toThrow(/Cannot settle mixed commission-model transactions/i);

    // Atomic: nothing committed by the rejected attempt.
    const ledgerCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM supplier_ledger").get() as any
    ).cnt;
    expect(ledgerCount).toBe(0);
    const fsRows = db
      .prepare(
        "SELECT is_settled, settlement_id FROM financial_services WHERE id IN (?, ?)",
      )
      .all(legacyFs, newFs) as any[];
    expect(
      fsRows.every((r) => r.is_settled === 0 && r.settlement_id === null),
    ).toBe(true);
  });

  it("does NOT reject a batch where every row shares the SAME model (1)", () => {
    const supplierId = seedSupplier(db, "OMT");
    const fs1 = seedFs(db, {
      provider: "OMT",
      amount: 100,
      commissionModel: 1,
    });
    const fs2 = seedFs(db, {
      provider: "OMT",
      amount: 50,
      commissionModel: 1,
    });

    expect(() =>
      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [fs1, fs2],
        amount_usd: 150,
        amount_lbp: 0,
        commission_usd: 3,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 150 }],
      }),
    ).not.toThrow();
  });

  // ── D5/D6: single-row LUMP batch ────────────────────────────────────────

  it("books supplier_settlements + one allocation row + the SUPPLIER_PAYS_US commission credit for a single-row new-model batch", () => {
    const supplierId = seedSupplier(db, "OMT");
    const fsId = seedFs(db, {
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      commissionModel: 1,
    });

    const result = repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [fsId],
      amount_usd: 95, // gross(100) - commission(5), computed by the caller
      amount_lbp: 0,
      commission_usd: 5,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 95 }],
    });

    const settlement = settlementFor(db, result.id);
    expect(settlement).toBeDefined();
    expect(settlement.supplier_id).toBe(supplierId);
    expect(settlement.commission_usd).toBeCloseTo(5, 2);
    expect(settlement.commission_lbp).toBeCloseTo(0, 2);
    expect(settlement.model).toBe(1);
    expect(settlement.entry_mode).toBe("LUMP");
    // Gross weight for the one row = its own supplier_owed (OMT SEND: amount
    // + fee(0) - commission(0, new-model rows carry no creation-time
    // commission) = 100).
    expect(settlement.gross_usd).toBeCloseTo(100, 2);

    const allocations = allocationsFor(db, result.id);
    expect(allocations).toHaveLength(1);
    expect(allocations[0].financial_service_id).toBe(fsId);
    expect(allocations[0].commission_usd).toBeCloseTo(5, 2);
    expect(allocations[0].commission_lbp).toBeCloseTo(0, 2);

    const credits = commissionCreditRows(db, supplierId);
    expect(credits).toHaveLength(1);
    expect(credits[0].amount_usd).toBeCloseTo(-5, 2); // negative = supplier owes shop
    expect(credits[0].amount_lbp).toBeCloseTo(0, 2);
    expect(credits[0].is_auto).toBe(1);
    expect(credits[0].source_ref_table).toBe("supplier_ledger");
    expect(credits[0].source_ref_id).toBe(result.id);
  });

  // ── D6: largest-remainder proportional allocation across multiple rows ──

  it("splits an entered commission across multiple new-model rows proportional to each row's gross, summing to the entered total EXACTLY", () => {
    const supplierId = seedSupplier(db, "OMT");
    // Gross (supplier_owed) for a bare OMT RECEIVE (no fee columns set) is
    // -(amount - 0 + 0) = -amount; allocation weights by ABS(gross), so this
    // still splits 100 : 50 : 50 → 50% / 25% / 25%.
    const fs1 = seedFs(db, {
      provider: "OMT",
      amount: 100,
      commissionModel: 1,
    });
    const fs2 = seedFs(db, {
      provider: "OMT",
      amount: 50,
      commissionModel: 1,
    });
    const fs3 = seedFs(db, {
      provider: "OMT",
      amount: 50,
      commissionModel: 1,
    });

    const result = repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [fs1, fs2, fs3],
      amount_usd: 0, // RECEIVE-heavy: net pay is the caller's concern, not this test's
      amount_lbp: 0,
      commission_usd: 10.01, // deliberately not evenly divisible by the 50/25/25 split
      commission_lbp: 0,
      created_by: 1,
    });

    const allocations = allocationsFor(db, result.id);
    expect(allocations).toHaveLength(3);
    const sum = allocations.reduce((s, a) => s + a.commission_usd, 0);
    expect(sum).toBeCloseTo(10.01, 10); // exact-sum guarantee (D6)

    const byId = new Map(
      allocations.map((a) => [a.financial_service_id, a.commission_usd]),
    );
    // 50% of 10.01 = 5.005 → 5.00 or 5.01 depending on remainder distribution;
    // each 25% share ≈ 2.5025. Assert each lands within a cent of its ideal
    // proportional share (largest-remainder can shift the exact cent).
    expect(byId.get(fs1)!).toBeCloseTo(5.0, 1);
    expect(byId.get(fs2)!).toBeCloseTo(2.5, 1);
    expect(byId.get(fs3)!).toBeCloseTo(2.5, 1);
  });

  // ── Bills settlement note: gross = 0 for every row → equal-weight fallback ─

  it("bills settlement note: a batch whose rows all have $0 gross owed (bill principal never touched the ledger) splits the commission EQUALLY, needs no payment legs", () => {
    const supplierId = seedSupplier(db, "Katsh", 0);
    // BILL rows never book a TOP_UP/SALE_COST to the ledger — supplier_owed
    // for a non-OMT/WHISH provider with cost=0 is ABS(amount) per
    // SUPPLIER_OWED_EXPR's fallback branch... to genuinely simulate "gross
    // owed is 0" (the plan's actual bills shape, where the provider drawer
    // already absorbed the bill via a prepaid cost leg, never the ledger),
    // seed amount = 0 directly — the row's face value is tracked elsewhere
    // (price/cost), only supplier_owed (amount-derived here) is 0.
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
    const fs3 = seedFs(db, {
      provider: "Katsh",
      serviceType: "BILL",
      amount: 0,
      currency: "LBP",
      commissionModel: 1,
    });

    // $0-net settlement (SupplierRepository.ts:146's existing allowance) —
    // no payments[] needed.
    expect(() =>
      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [fs1, fs2, fs3],
        amount_usd: 0,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 60000, // 3 bills × 20,000 LBP
        entry_mode: "RATE",
        commission_rate: 20000,
        commission_unit_count: 3,
        created_by: 1,
      }),
    ).not.toThrow();

    const settlementRow = db
      .prepare(
        `SELECT id FROM supplier_ledger WHERE supplier_id = ? AND entry_type = 'SETTLEMENT'`,
      )
      .get(supplierId) as { id: number };

    const settlement = settlementFor(db, settlementRow.id);
    expect(settlement.entry_mode).toBe("RATE");
    expect(settlement.rate).toBe(20000);
    expect(settlement.unit_count).toBe(3);
    expect(settlement.gross_lbp).toBe(0);

    const allocations = allocationsFor(db, settlementRow.id);
    expect(allocations).toHaveLength(3);
    // Equal-weight fallback: every row's gross is 0, so the 60,000 LBP
    // commission splits evenly — 20,000 each, exact (no remainder).
    for (const a of allocations) {
      expect(a.commission_lbp).toBe(20000);
    }

    const credits = commissionCreditRows(db, supplierId);
    expect(credits).toHaveLength(1);
    expect(credits[0].amount_lbp).toBe(-60000);
  });

  // ── Reviewer finding #2: currency-bucket weights must exclude foreign-
  //    currency rows from the equal-weight fallback ───────────────────────

  it("mixed USD + LBP batch: an all-zero LBP bucket falls back to equal split ACROSS LBP ROWS ONLY, never bleeding into the USD row", () => {
    const supplierId = seedSupplier(db, "Katsh", 0);
    // fs1: a real USD row with nonzero gross (ELSE ABS(amount) branch of
    // SUPPLIER_OWED_EXPR — Katsh is neither OMT/WHISH nor a wallet provider,
    // and this isn't a BILL) — the row commission_usd should attribute to.
    const fs1 = seedFs(db, {
      provider: "Katsh",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commissionModel: 1,
    });
    // fs2/fs3: BILL rows, LBP, $0 gross (bills settlement note — principal
    // never touches the ledger). Pre-fix, usdWeights/lbpWeights are built by
    // mapping EVERY row (including fs1) to 0 when its own currency doesn't
    // match the bucket — so the LBP bucket's weightSum is 0 across ALL
    // THREE rows, and allocateProportional's equal-weight fallback spreads
    // the LBP commission across fs1 too (a USD row that has nothing to do
    // with the LBP bills).
    const fs2 = seedFs(db, {
      provider: "Katsh",
      serviceType: "BILL",
      amount: 0,
      currency: "LBP",
      commissionModel: 1,
    });
    const fs3 = seedFs(db, {
      provider: "Katsh",
      serviceType: "BILL",
      amount: 0,
      currency: "LBP",
      commissionModel: 1,
    });

    const result = repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [fs1, fs2, fs3],
      amount_usd: 95, // gross(100) - commission_usd(5) for fs1
      amount_lbp: 0,
      commission_usd: 5,
      commission_lbp: 60000,
      entry_mode: "RATE",
      commission_rate: 30000,
      commission_unit_count: 2,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 95 }],
    });

    const allocations = allocationsFor(db, result.id);
    expect(allocations).toHaveLength(3);
    const byId = new Map(
      allocations.map((a) => [
        a.financial_service_id,
        { usd: a.commission_usd, lbp: a.commission_lbp },
      ]),
    );

    // fs1 (the only USD row) takes the entire USD commission and NONE of
    // the LBP commission — the LBP equal-weight fallback must be scoped to
    // the LBP rows only.
    expect(byId.get(fs1)!.usd).toBeCloseTo(5, 2);
    expect(byId.get(fs1)!.lbp).toBe(0);

    // fs2/fs3 (the two LBP bill rows) split the 60,000 LBP equally between
    // THEMSELVES ONLY — 30,000 each — and take no USD share.
    expect(byId.get(fs2)!.lbp).toBe(30000);
    expect(byId.get(fs3)!.lbp).toBe(30000);
    expect(byId.get(fs2)!.usd).toBe(0);
    expect(byId.get(fs3)!.usd).toBe(0);

    const lbpSum = allocations.reduce((s, a) => s + a.commission_lbp, 0);
    expect(lbpSum).toBe(60000);
  });

  // ── Legacy (commission_model = 0) batches — byte-for-byte unchanged ──────

  it("legacy batch (commission_model = 0): writes NO supplier_settlements/allocations/commission-credit rows — informational commission only", () => {
    const supplierId = seedSupplier(db, "OMT");
    const fsId = seedFs(db, {
      provider: "OMT",
      amount: 100,
      commission: 0.1,
      commissionModel: 0,
    });

    const result = repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [fsId],
      amount_usd: 99.9,
      amount_lbp: 0,
      commission_usd: 0.1,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 99.9 }],
    });

    expect(settlementFor(db, result.id)).toBeUndefined();
    expect(allocationsFor(db, result.id)).toHaveLength(0);
    expect(commissionCreditRows(db, supplierId)).toHaveLength(0);

    // Ledger nets to 0 exactly like SupplierRepository.settlement.test.ts's
    // own coverage — no new row appears.
    const ledgerRows = db
      .prepare(`SELECT entry_type FROM supplier_ledger WHERE supplier_id = ?`)
      .all(supplierId) as any[];
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].entry_type).toBe("SETTLEMENT");
  });

  // ── Schema-drift guard: commission_model present, new tables absent ─────

  it("falls back to legacy behavior when commission_model is stamped 1 but the connected schema lacks the v150 tables", () => {
    // Simulate a partially-upgraded / hand-rolled fixture: drop the new
    // tables entirely after seeding a commission_model = 1 row.
    db.exec(`DROP TABLE settlement_commission_allocations;`);
    db.exec(`DROP TABLE supplier_settlements;`);

    const supplierId = seedSupplier(db, "OMT");
    const fsId = seedFs(db, {
      provider: "OMT",
      amount: 100,
      commissionModel: 1,
    });

    expect(() =>
      repo.settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [fsId],
        amount_usd: 100,
        amount_lbp: 0,
        commission_usd: 5,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
      }),
    ).not.toThrow();

    // No commission credit booked — the schema can't support the audit
    // record, so this settlement is treated as legacy-shaped.
    expect(commissionCreditRows(db, supplierId)).toHaveLength(0);
    const fsRow = db
      .prepare(`SELECT is_settled FROM financial_services WHERE id = ?`)
      .get(fsId) as { is_settled: number };
    expect(fsRow.is_settled).toBe(1);
  });
});
