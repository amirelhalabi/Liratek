/**
 * LIRA-256 — OMT statement commission types: settlement guard.
 *
 * A settlement that names the OMT commission types its statement covers is
 * REFUSED (before any write) if it selects a new-style (commission_model =
 * 1) OMT transfer of an uncovered type (decision S1) — so an uncovered
 * transfer stays queued at gross with its commission pending, and the typed
 * commission is split only across the transfers actually settled. Old-style
 * (model 0) rows are never restricted (S5). The choice is stamped on the
 * settlement's metadata. Absent = all types = today's behaviour (S3).
 *
 * Fixture: copied from `SupplierRepository.accountSettlement.test.ts` (full
 * v150+ schema incl. `omt_service_type`, `supplier_settlements`,
 * `settlement_commission_allocations`, `transactions`, `payments`). Rows are
 * seeded directly (the guard reads only provider / omt_service_type /
 * commission_model; the commission itself is typed at settlement), with the
 * TOP_UP ledger sibling the real writer books for a model-1 SEND.
 *
 * RULE 17 — run red against the unchanged repository: the refusal cases
 * settled instead of throwing; the metadata stamp was missing.
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetFinancialServiceRepository } from "../FinancialServiceRepository";

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
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

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
      commission_eligible INTEGER NOT NULL DEFAULT 1,
      commission_rate_currency TEXT DEFAULT 'USD',
      account_supplier_id INTEGER REFERENCES suppliers(id),
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP', 'SALE_COST', 'PAYMENT', 'ADJUSTMENT', 'SETTLEMENT', 'CASH_PRIZE', 'SUPPLIER_PAYS_US', 'DISCOUNT', 'STOCK_INTAKE')),
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
      settlement_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Full column set — SupplierRepository._bookCommissionAtSettlement /
    -- getAccountUnsettled read gross via
    -- getFinancialServiceRepository().findById()/getUnsettledBySupplier(),
    -- which select FinancialServiceRepository.getColumns()'s full explicit
    -- list (rule 14: reusing SUPPLIER_OWED_EXPR rather than re-deriving it
    -- means every one of these columns must exist here too).
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
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
      receive_fee_model INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
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

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    -- Unrelated to this file's own scenarios, but _cancelDebt/
    -- _restoreRepaymentDebt run unconditionally on every void (no-op here —
    -- no rows ever match).
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
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 1000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'USD', 1000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'LBP', 0);
  `);

  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function seedSupplier(
  db: Database.Database,
  name: string,
  provider: string,
  accountSupplierId: number | null = null,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO suppliers (name, provider, account_supplier_id, is_system, commission_eligible)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        provider,
        accountSupplierId,
        accountSupplierId ? 0 : 1,
        accountSupplierId ? 0 : 1,
      ).lastInsertRowid,
  );
}

/** A pending OMT SEND plus the TOP_UP ledger sibling its writer books
 *  (model 1: gross x + f; model 0: net x + f − c). */
function seedOmtSend(
  db: Database.Database,
  omtId: number,
  data: {
    amount: number;
    fee: number;
    type: string | null;
    model?: 0 | 1;
    commission?: number;
    currency?: "USD" | "LBP";
  },
): number {
  const model = data.model ?? 1;
  const commission = data.commission ?? Math.round(data.fee * 10) / 100;
  const currency = data.currency ?? "USD";
  const id = Number(
    db
      .prepare(
        `INSERT INTO financial_services
           (provider, service_type, amount, currency, commission, omt_fee,
            omt_service_type, commission_model, is_settled)
         VALUES ('OMT', 'SEND', ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(data.amount, currency, commission, data.fee, data.type, model)
      .lastInsertRowid,
  );
  const owed = data.amount + data.fee - (model === 0 ? commission : 0);
  db.prepare(
    `INSERT INTO supplier_ledger
       (supplier_id, entry_type, amount_usd, amount_lbp, is_auto, source_ref_table, source_ref_id)
     VALUES (?, 'TOP_UP', ?, ?, 1, 'financial_services', ?)`,
  ).run(
    omtId,
    currency === "USD" ? owed : 0,
    currency === "LBP" ? owed : 0,
    id,
  );
  return id;
}

function counts(db: Database.Database): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of [
    "supplier_ledger",
    "payments",
    "supplier_settlements",
    "settlement_commission_allocations",
    "transactions",
  ]) {
    out[t] = (
      db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }
    ).n;
  }
  return out;
}

function fsState(db: Database.Database, id: number) {
  return db
    .prepare(
      `SELECT settlement_id, is_settled, commission FROM financial_services WHERE id = ?`,
    )
    .get(id) as {
    settlement_id: number | null;
    is_settled: number;
    commission: number;
  };
}

function ledgerSum(db: Database.Database, supplierId: number) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd),0) AS usd, COALESCE(SUM(amount_lbp),0) AS lbp
       FROM supplier_ledger WHERE supplier_id = ? AND COALESCE(is_refunded,0) = 0`,
    )
    .get(supplierId) as { usd: number; lbp: number };
}

function drawerTotals(db: Database.Database) {
  return db
    .prepare(
      `SELECT drawer_name, currency_code, balance FROM drawer_balances ORDER BY drawer_name, currency_code`,
    )
    .all() as Array<{
    drawer_name: string;
    currency_code: string;
    balance: number;
  }>;
}

function settlementTxn(db: Database.Database) {
  return db
    .prepare(
      `SELECT id, status, metadata_json FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT' ORDER BY id DESC LIMIT 1`,
    )
    .get() as
    | { id: number; status: string; metadata_json: string | null }
    | undefined;
}

function errorText(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    const cause = (e as { details?: { cause?: unknown } })?.details?.cause;
    const parts = [e instanceof Error ? e.message : String(e)];
    if (cause instanceof Error) parts.push(cause.message);
    return parts.join(" | ");
  }
  throw new Error("Expected function to throw, but it did not");
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("LIRA-256 — settlement refuses uncovered OMT commission types", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let txnRepo: TransactionRepository;
  let omtId: number;
  let appId: number;
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    repo = new SupplierRepository();
    txnRepo = new TransactionRepository();
    resetFinancialServiceRepository();
    resetTransactionRepository();
    omtId = seedSupplier(db, "OMT", "OMT");
    appId = seedSupplier(db, "OMT App", "OMT_APP", omtId);
  });

  afterEach(() => {
    db.close();
    resetFinancialServiceRepository();
    resetTransactionRepository();
  });

  const settleTx = (
    ids: number[],
    gross: number,
    commission: number,
    covered?: string[],
  ) =>
    repo.settleTransactions({
      supplier_id: omtId,
      financial_service_ids: ids,
      amount_usd: gross - commission,
      amount_lbp: 0,
      commission_usd: commission,
      commission_lbp: 0,
      created_by: 1,
      payments: [
        { method: "CASH", currency_code: "USD", amount: gross - commission },
      ],
      ...(covered ? { covered_omt_service_types: covered as never } : {}),
    });

  const settleAcc = (
    selections: Array<{ kind: "FINANCIAL_SERVICE" | "LEDGER"; id: number }>,
    net: number,
    commission: number,
    covered?: string[],
  ) =>
    repo.settleAccount({
      account_supplier_id: omtId,
      direction: "PAY",
      selections,
      amount_usd: net,
      amount_lbp: 0,
      commission_usd: commission,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: net }],
      ...(covered ? { covered_omt_service_types: covered as never } : {}),
    });

  it("(a) settleTransactions: an uncovered Western Union row is refused, nothing written", () => {
    const intra = seedOmtSend(db, omtId, {
      amount: 461,
      fee: 7,
      type: "INTRA",
    });
    const wu = seedOmtSend(db, omtId, {
      amount: 517,
      fee: 9,
      type: "WESTERN_UNION",
    });
    const before = counts(db);
    const msg = errorText(() =>
      settleTx([intra, wu], 461 + 7 + 517 + 9, 1.37, ["INTRA"]),
    );
    expect(msg).toContain(`#${wu}`);
    expect(msg).toContain("Western Union");
    expect(counts(db)).toEqual(before);
    expect(fsState(db, intra).settlement_id).toBeNull();
    expect(fsState(db, wu).settlement_id).toBeNull();
  });

  it("(b) settleAccount: the same refusal, nothing written", () => {
    const intra = seedOmtSend(db, omtId, {
      amount: 461,
      fee: 7,
      type: "INTRA",
    });
    const wu = seedOmtSend(db, omtId, {
      amount: 517,
      fee: 9,
      type: "WESTERN_UNION",
    });
    const before = counts(db);
    const msg = errorText(() =>
      settleAcc(
        [
          { kind: "FINANCIAL_SERVICE", id: intra },
          { kind: "FINANCIAL_SERVICE", id: wu },
        ],
        461 + 7 + 517 + 9 - 1.37,
        1.37,
        ["INTRA"],
      ),
    );
    expect(msg).toContain(`#${wu}`);
    expect(msg).toContain("Western Union");
    expect(counts(db)).toEqual(before);
    expect(fsState(db, wu).settlement_id).toBeNull();
  });

  it("(c) covered INTRA-only settle: the whole commission lands on the INTRA row; WU untouched; choice stamped", () => {
    const intra = seedOmtSend(db, omtId, {
      amount: 461,
      fee: 7,
      type: "INTRA",
    });
    const wu = seedOmtSend(db, omtId, {
      amount: 517,
      fee: 9,
      type: "WESTERN_UNION",
    });
    const wuBefore = fsState(db, wu);
    settleTx([intra], 468, 1.37, ["INTRA"]);
    const allocs = db
      .prepare(
        `SELECT financial_service_id, commission_usd FROM settlement_commission_allocations`,
      )
      .all() as Array<{ financial_service_id: number; commission_usd: number }>;
    expect(allocs.map((a) => a.financial_service_id)).toEqual([intra]);
    expect(allocs.reduce((s, a) => s + a.commission_usd, 0)).toBeCloseTo(
      1.37,
      10,
    );
    const meta = JSON.parse(settlementTxn(db)!.metadata_json ?? "{}");
    expect(meta.covered_omt_service_types).toEqual(["INTRA"]);
    expect(fsState(db, wu)).toEqual(wuBefore);
    expect(fsState(db, wu).settlement_id).toBeNull();
  });

  it("(d) no covered types → today's behaviour: both settle, both get allocations, no metadata key", () => {
    const intra = seedOmtSend(db, omtId, {
      amount: 461,
      fee: 7,
      type: "INTRA",
    });
    const wu = seedOmtSend(db, omtId, {
      amount: 517,
      fee: 9,
      type: "WESTERN_UNION",
    });
    settleTx([intra, wu], 994, 2);
    expect(fsState(db, intra).settlement_id).not.toBeNull();
    expect(fsState(db, wu).settlement_id).not.toBeNull();
    const n = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM settlement_commission_allocations`)
        .get() as { n: number }
    ).n;
    expect(n).toBe(2);
    const meta = JSON.parse(settlementTxn(db)!.metadata_json ?? "{}");
    expect("covered_omt_service_types" in meta).toBe(false);
  });

  it("(e) a row saved without a type is refused under [INTRA] and accepted under [INTRA, UNSPECIFIED]", () => {
    const untyped = seedOmtSend(db, omtId, { amount: 150, fee: 2, type: null });
    const msg = errorText(() => settleTx([untyped], 152, 0.2, ["INTRA"]));
    expect(msg).toContain(`#${untyped}`);
    expect(msg).toContain("Type not recorded");
    expect(() =>
      settleTx([untyped], 152, 0.2, ["INTRA", "UNSPECIFIED"]),
    ).not.toThrow();
    expect(fsState(db, untyped).settlement_id).not.toBeNull();
  });

  it("(f) a legacy (model 0) batch is never restricted (S5) but still stamped", () => {
    const a = seedOmtSend(db, omtId, {
      amount: 100,
      fee: 5,
      type: "INTRA",
      model: 0,
      commission: 0.5,
    });
    const b = seedOmtSend(db, omtId, {
      amount: 100,
      fee: 5,
      type: "WESTERN_UNION",
      model: 0,
      commission: 0.5,
    });
    // Legacy: amount paid = Σ net owed (209), the commission is informational.
    repo.settleTransactions({
      supplier_id: omtId,
      financial_service_ids: [a, b],
      amount_usd: 209,
      amount_lbp: 0,
      commission_usd: 1,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 209 }],
      covered_omt_service_types: ["INTRA"],
    });
    expect(fsState(db, b).settlement_id).not.toBeNull();
    const meta = JSON.parse(settlementTxn(db)!.metadata_json ?? "{}");
    expect(meta.covered_omt_service_types).toEqual(["INTRA"]);
  });

  it("(g) the stamp is de-duplicated and in type order", () => {
    const intra = seedOmtSend(db, omtId, {
      amount: 461,
      fee: 7,
      type: "INTRA",
    });
    settleTx([intra], 468, 0.7, ["WESTERN_UNION", "INTRA", "INTRA"]);
    const meta = JSON.parse(settlementTxn(db)!.metadata_json ?? "{}");
    expect(meta.covered_omt_service_types).toEqual(["INTRA", "WESTERN_UNION"]);
  });

  it("(h) settleAccount: an OMT App LEDGER row plus an INTRA row under [INTRA] succeeds (LEDGER rows never restricted)", () => {
    const intra = seedOmtSend(db, omtId, {
      amount: 461,
      fee: 7,
      type: "INTRA",
    });
    const appLedger = Number(
      db
        .prepare(
          `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd) VALUES (?, 'TOP_UP', 200)`,
        )
        .run(appId).lastInsertRowid,
    );
    settleAcc(
      [
        { kind: "FINANCIAL_SERVICE", id: intra },
        { kind: "LEDGER", id: appLedger },
      ],
      468 + 200 - 0.7,
      0.7,
      ["INTRA"],
    );
    expect(fsState(db, intra).settlement_id).not.toBeNull();
    const meta = JSON.parse(settlementTxn(db)!.metadata_json ?? "{}");
    expect(meta.covered_omt_service_types).toEqual(["INTRA"]);
  });

  it("(i) settleAccount with FS rows from TWO members (no commission member resolved) still refuses the uncovered WU row", () => {
    const intra = seedOmtSend(db, omtId, {
      amount: 461,
      fee: 7,
      type: "INTRA",
    });
    const wu = seedOmtSend(db, omtId, {
      amount: 517,
      fee: 9,
      type: "WESTERN_UNION",
    });
    // OMT App legacy cost-flow sale with its own per-sale supplier debt — the
    // getUnsettledBySupplier UNION branch (supplier_debt_booked = 1).
    const appFs = Number(
      db
        .prepare(
          `INSERT INTO financial_services
             (provider, service_type, amount, currency, cost, price, commission_model, supplier_debt_booked, is_settled)
           VALUES ('OMT_APP', 'SEND', 50, 'USD', 48, 50, 0, 1, 0)`,
        )
        .run().lastInsertRowid,
    );
    const before = counts(db);
    const msg = errorText(() =>
      settleAcc(
        [
          { kind: "FINANCIAL_SERVICE", id: intra },
          { kind: "FINANCIAL_SERVICE", id: wu },
          { kind: "FINANCIAL_SERVICE", id: appFs },
        ],
        468 + 526 + 48,
        0,
        ["INTRA"],
      ),
    );
    expect(msg).toContain(`#${wu}`);
    expect(counts(db)).toEqual(before);
    expect(fsState(db, intra).settlement_id).toBeNull();
    expect(fsState(db, wu).settlement_id).toBeNull();
  });

  it("(j) covered settle → void through settleAccount nets supplier balance, drawers and allocations to zero", () => {
    const intra = seedOmtSend(db, omtId, {
      amount: 461,
      fee: 7,
      type: "INTRA",
    });
    const wu = seedOmtSend(db, omtId, {
      amount: 517,
      fee: 9,
      type: "WESTERN_UNION",
    });
    const preOmt = ledgerSum(db, omtId);
    const preDrawers = drawerTotals(db);
    const wuBefore = fsState(db, wu);
    settleAcc([{ kind: "FINANCIAL_SERVICE", id: intra }], 468 - 1.37, 1.37, [
      "INTRA",
    ]);
    expect(fsState(db, intra).settlement_id).not.toBeNull();
    const txn = settlementTxn(db)!;
    txnRepo.voidTransaction(txn.id, 1);
    const post = ledgerSum(db, omtId);
    expect(post.usd).toBeCloseTo(preOmt.usd, 10);
    expect(post.lbp).toBeCloseTo(preOmt.lbp, 10);
    expect(drawerTotals(db)).toEqual(preDrawers);
    const n = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM settlement_commission_allocations`)
        .get() as { n: number }
    ).n;
    expect(n).toBe(0);
    expect(fsState(db, intra).settlement_id).toBeNull();
    expect(fsState(db, wu)).toEqual(wuBefore);
    const status = (
      db
        .prepare(`SELECT status FROM transactions WHERE id = ?`)
        .get(txn.id) as { status: string }
    ).status;
    expect(status).toBe("VOIDED");
  });
});
