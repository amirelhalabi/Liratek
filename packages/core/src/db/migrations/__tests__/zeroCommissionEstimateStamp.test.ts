/**
 * Migration v161 — zero_commission_estimate_stamp_for_at_settlement_rows
 * (LIRA-158_COMMISSION_REPORTING_PLAN.md Phase 0).
 *
 * `financial_services.commission_model = 1` (AT_SETTLEMENT) rows stamp
 * `transactions.profit_usd`/`profit_lbp` at creation with an ESTIMATE
 * (FinancialServiceRepository.ts:1881-1884: `(currency === "USD" ? commission
 * : 0) + kept_change_usd`, LBP mirror). The real, owner-entered commission is
 * booked separately at settlement (a LATER, separate change — Phase 1 — is
 * what stops the write path from stamping the estimate going forward). This
 * migration is the insurance backfill for rows ALREADY posted with that
 * stale estimate: it zeroes the COMMISSION TERM ONLY, preserving kept
 * change, and leaves `fs.commission` itself untouched (D6 no stamp-back,
 * D3 cutover-not-restatement — the column stays the audit record of what
 * was estimated). A REFUND row carries the NEGATED original stamp on the
 * same source_table/source_id (TransactionRepository.ts's refund insert:
 * `-original.profit_usd`/`-original.profit_lbp`), so correcting only the
 * original row would break create+refund netting to zero (rule 20) — the
 * REFUND row needs the opposite-sign correction (ADD the term back).
 *
 * Constructed directly against the migration's up()/down() (mirrors the
 * `MIGRATIONS.find(...).up(db)` pattern used by
 * `CommissionAtSettlementFoundationMigration.test.ts` /
 * `backfillAlfaPrepaidValidityDays.test.ts`), against a MINIMAL fixture
 * holding only what v161 touches: `transactions` and `financial_services`.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index.js";

const V161 = MIGRATIONS.find((m) => m.version === 161)!;

/** Minimal schema — only what v161 touches (plus the columns it reads). */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      commission REAL DEFAULT 0,
      commission_model INTEGER NOT NULL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 1,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function insertFs(
  db: Database.Database,
  opts: {
    tenantId?: number;
    provider?: string;
    serviceType?: string;
    currency?: string;
    cost?: number;
    price?: number;
    commission?: number;
    commissionModel: 0 | 1;
    isRefunded?: 0 | 1;
  },
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO financial_services
           (tenant_id, provider, service_type, currency, cost, price, commission, commission_model, is_settled, is_refunded)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        opts.tenantId ?? 1,
        opts.provider ?? "OMT",
        opts.serviceType ?? "SEND",
        opts.currency ?? "USD",
        opts.cost ?? 0,
        opts.price ?? 0,
        opts.commission ?? 0,
        opts.commissionModel,
        opts.isRefunded ?? 0,
      ).lastInsertRowid,
  );
}

function insertTxn(
  db: Database.Database,
  opts: {
    tenantId?: number;
    type: string;
    sourceId: number;
    profitUsd: number;
    profitLbp: number;
  },
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO transactions
           (tenant_id, type, source_table, source_id, profit_usd, profit_lbp)
         VALUES (?, ?, 'financial_services', ?, ?, ?)`,
      )
      .run(
        opts.tenantId ?? 1,
        opts.type,
        opts.sourceId,
        opts.profitUsd,
        opts.profitLbp,
      ).lastInsertRowid,
  );
}

function profitOf(
  db: Database.Database,
  txnId: number,
): { profit_usd: number; profit_lbp: number } {
  return db
    .prepare(`SELECT profit_usd, profit_lbp FROM transactions WHERE id = ?`)
    .get(txnId) as { profit_usd: number; profit_lbp: number };
}

describe("migration v161 — zero_commission_estimate_stamp_for_at_settlement_rows", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  it("exists and has a down()", () => {
    expect(V161).toBeDefined();
    expect(typeof V161.down).toBe("function");
  });

  it("case 1 — model-1 OMT SEND, USD, commission 0.50: stamp 0.50 -> 0.00", () => {
    const fsId = insertFs(db, {
      commission: 0.5,
      commissionModel: 1,
      currency: "USD",
    });
    const txnId = insertTxn(db, {
      type: "FINANCIAL_SERVICE",
      sourceId: fsId,
      profitUsd: 0.5,
      profitLbp: 0,
    });

    V161.up(db);

    expect(profitOf(db, txnId)).toEqual({ profit_usd: 0, profit_lbp: 0 });
  });

  it("case 2 — model-1 row WITH kept change: 0.50 commission + 2.00 kept -> stamp 2.50 becomes 2.00 (kept change survives)", () => {
    const fsId = insertFs(db, {
      commission: 0.5,
      commissionModel: 1,
      currency: "USD",
    });
    const txnId = insertTxn(db, {
      type: "FINANCIAL_SERVICE",
      sourceId: fsId,
      profitUsd: 2.5, // 0.50 commission + 2.00 kept change
      profitLbp: 0,
    });

    V161.up(db);

    expect(profitOf(db, txnId).profit_usd).toBe(2);
  });

  it("case 3 — model-1 LBP row: commission 30000 in profit_lbp -> 0; profit_usd (unrelated kept-change) untouched", () => {
    const fsId = insertFs(db, {
      commission: 30000,
      commissionModel: 1,
      currency: "LBP",
    });
    const txnId = insertTxn(db, {
      type: "FINANCIAL_SERVICE",
      sourceId: fsId,
      profitUsd: 1.25, // unrelated USD kept-change portion of the stamp
      profitLbp: 30000,
    });

    V161.up(db);

    expect(profitOf(db, txnId)).toEqual({ profit_usd: 1.25, profit_lbp: 0 });
  });

  it("case 4 — model-0 legacy row is completely untouched (D3 cutover): stamp is byte-identical", () => {
    const fsId = insertFs(db, {
      commission: 5,
      commissionModel: 0,
      currency: "USD",
    });
    const txnId = insertTxn(db, {
      type: "FINANCIAL_SERVICE",
      sourceId: fsId,
      profitUsd: 5,
      profitLbp: 0,
    });

    V161.up(db);

    expect(profitOf(db, txnId)).toEqual({ profit_usd: 5, profit_lbp: 0 });
  });

  it("case 5 — REFUND symmetry: original + its REFUND both land on 0, and SUM(profit_usd) over the pair is 0", () => {
    const fsId = insertFs(db, {
      commission: 0.75,
      commissionModel: 1,
      currency: "USD",
      isRefunded: 1,
    });
    const originalId = insertTxn(db, {
      type: "FINANCIAL_SERVICE",
      sourceId: fsId,
      profitUsd: 0.75,
      profitLbp: 0,
    });
    const refundId = insertTxn(db, {
      type: "REFUND",
      sourceId: fsId,
      profitUsd: -0.75, // negated stamp, per TransactionRepository's refund insert
      profitLbp: 0,
    });

    V161.up(db);

    expect(profitOf(db, originalId).profit_usd).toBe(0);
    expect(profitOf(db, refundId).profit_usd).toBe(0);

    const sum = db
      .prepare(
        `SELECT SUM(profit_usd) AS total FROM transactions WHERE id IN (?, ?)`,
      )
      .get(originalId, refundId) as { total: number };
    expect(sum.total).toBe(0);
  });

  it("case 6 — down() round-trip restores every case's original stamp exactly", () => {
    // Build one DB covering cases 1-5 at once.
    const fs1 = insertFs(db, { commission: 0.5, commissionModel: 1, currency: "USD" });
    const t1 = insertTxn(db, { type: "FINANCIAL_SERVICE", sourceId: fs1, profitUsd: 0.5, profitLbp: 0 });

    const fs2 = insertFs(db, { commission: 0.5, commissionModel: 1, currency: "USD" });
    const t2 = insertTxn(db, { type: "FINANCIAL_SERVICE", sourceId: fs2, profitUsd: 2.5, profitLbp: 0 });

    const fs3 = insertFs(db, { commission: 30000, commissionModel: 1, currency: "LBP" });
    const t3 = insertTxn(db, { type: "FINANCIAL_SERVICE", sourceId: fs3, profitUsd: 1.25, profitLbp: 30000 });

    const fs4 = insertFs(db, { commission: 5, commissionModel: 0, currency: "USD" });
    const t4 = insertTxn(db, { type: "FINANCIAL_SERVICE", sourceId: fs4, profitUsd: 5, profitLbp: 0 });

    const fs5 = insertFs(db, { commission: 0.75, commissionModel: 1, currency: "USD", isRefunded: 1 });
    const t5orig = insertTxn(db, { type: "FINANCIAL_SERVICE", sourceId: fs5, profitUsd: 0.75, profitLbp: 0 });
    const t5refund = insertTxn(db, { type: "REFUND", sourceId: fs5, profitUsd: -0.75, profitLbp: 0 });

    const before = {
      t1: profitOf(db, t1),
      t2: profitOf(db, t2),
      t3: profitOf(db, t3),
      t4: profitOf(db, t4),
      t5orig: profitOf(db, t5orig),
      t5refund: profitOf(db, t5refund),
    };

    V161.up(db);

    // Sanity: the forward direction did what cases 1-5 already assert.
    expect(profitOf(db, t1)).toEqual({ profit_usd: 0, profit_lbp: 0 });
    expect(profitOf(db, t2).profit_usd).toBe(2);
    expect(profitOf(db, t3)).toEqual({ profit_usd: 1.25, profit_lbp: 0 });
    expect(profitOf(db, t4)).toEqual({ profit_usd: 5, profit_lbp: 0 });
    expect(profitOf(db, t5orig).profit_usd).toBe(0);
    expect(profitOf(db, t5refund).profit_usd).toBe(0);

    V161.down!(db);

    expect(profitOf(db, t1)).toEqual(before.t1);
    expect(profitOf(db, t2)).toEqual(before.t2);
    expect(profitOf(db, t3)).toEqual(before.t3);
    expect(profitOf(db, t4)).toEqual(before.t4);
    expect(profitOf(db, t5orig)).toEqual(before.t5orig);
    expect(profitOf(db, t5refund)).toEqual(before.t5refund);
  });

  it("case 7 — zero matching rows: up() reports 0/0 changes and throws nothing", () => {
    // Only a model-0 row exists — nothing for v161 to touch.
    const fsId = insertFs(db, { commission: 5, commissionModel: 0, currency: "USD" });
    insertTxn(db, { type: "FINANCIAL_SERVICE", sourceId: fsId, profitUsd: 5, profitLbp: 0 });

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(() => V161.up(db)).not.toThrow();
      const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toMatch(/\b0 FINANCIAL_SERVICE row\(s\)/);
      expect(logged).toMatch(/\b0 paired REFUND row\(s\)/);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("case 8 — model-1 BILL row priced WITH a margin (cost/price branch) is left completely untouched, up() and down()", () => {
    // This is the case that distinguishes "margin earned at transaction
    // time" (FinancialServiceRepository.ts:1448-1450's useCostPriceFlow
    // branch: commission = price - cost whenever fs.cost > 0) from "supplier
    // commission deferred to settlement" (LIRA-158_COMMISSION_REPORTING_PLAN.md
    // §1.1b). Every real BILL row today ships cost === price, so this
    // fixture — cost=10, price=12, commission=2 — is deliberately NOT the
    // shape any current production row takes; no other fixture in this file
    // exercises it. Without the migration's `COALESCE(fs.cost, 0) = 0` guard,
    // this row's commission_model = 1 would wrongly qualify it as an
    // AT_SETTLEMENT estimate and its $2 margin would be zeroed out of
    // reported profit even though it was earned outright at transaction
    // time and nothing is deferred to a later settlement.
    const fsId = insertFs(db, {
      serviceType: "BILL",
      commissionModel: 1,
      currency: "USD",
      cost: 10,
      price: 12,
      commission: 2, // the margin (price - cost), not a commission estimate
    });
    const txnId = insertTxn(db, {
      type: "FINANCIAL_SERVICE",
      sourceId: fsId,
      profitUsd: 2,
      profitLbp: 0,
    });

    V161.up(db);
    expect(profitOf(db, txnId)).toEqual({ profit_usd: 2, profit_lbp: 0 });

    V161.down!(db);
    expect(profitOf(db, txnId)).toEqual({ profit_usd: 2, profit_lbp: 0 });
  });

  it("the tenant_id join is a real gate, not decoration: a transaction whose tenant_id disagrees with its source fs row's tenant is left untouched", () => {
    // financial_services.id is a single global AUTOINCREMENT primary key, so
    // two tenants can never legitimately share one id — under correct data
    // `source_id` alone already pins the row. The tenant match exists as a
    // defensive gate (CLAUDE.md tenant-scoping; precedent v130's
    // `sl.tenant_id = transactions.tenant_id`) against exactly the case a
    // bug or corrupted row would produce: a transaction whose own tenant_id
    // does not agree with its source row's tenant. Model 1 + a large
    // commission makes any leak impossible to miss.
    const fsId = insertFs(db, {
      tenantId: 2,
      commission: 999,
      commissionModel: 1,
      currency: "USD",
    });
    const txnId = insertTxn(db, {
      tenantId: 1, // deliberately mismatched vs. the fs row's tenant (2)
      type: "FINANCIAL_SERVICE",
      sourceId: fsId,
      profitUsd: 3,
      profitLbp: 0,
    });

    V161.up(db);

    expect(profitOf(db, txnId)).toEqual({ profit_usd: 3, profit_lbp: 0 });
  });

  it("up() and down() are no-ops (skip cleanly) when 'transactions' or 'financial_services' is absent", () => {
    const bareDb = new Database(":memory:");
    expect(() => V161.up(bareDb)).not.toThrow();
    expect(() => V161.down!(bareDb)).not.toThrow();
    bareDb.close();
  });

  it("up() and down() are no-ops when financial_services predates v150 (no commission_model column)", () => {
    const legacyDb = new Database(":memory:");
    legacyDb.exec(`
      CREATE TABLE financial_services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER DEFAULT 1,
        provider TEXT NOT NULL,
        commission REAL DEFAULT 0
      );
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER DEFAULT 1,
        type TEXT NOT NULL,
        source_table TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        profit_usd REAL NOT NULL DEFAULT 0,
        profit_lbp REAL NOT NULL DEFAULT 0
      );
    `);
    expect(() => V161.up(legacyDb)).not.toThrow();
    expect(() => V161.down!(legacyDb)).not.toThrow();
    legacyDb.close();
  });
});
