/**
 * PA-0.1 (OWNER_NOTES_2026-09-21.md §6.2, "Batch 0 — fix before committing") —
 * a model-1 (AT_SETTLEMENT, D3) financial-service row's profit STAMP
 * (`transactions.profit_usd`/`profit_lbp` on its FINANCIAL_SERVICE row, never
 * `financial_services.commission`) is recognised the instant the row is
 * created, not gated behind `fs.is_settled = 1`.
 *
 * Why the stamp is already safe to recognise immediately (see
 * `FinancialServiceRepository.createTransaction`'s own doc comment,
 * ~:2120-2153, D14/option C): for a plain model-1 SEND/RECEIVE the commission
 * TERM is force-zeroed at write time — what survives is kept change and the
 * D1 Whish RECEIVE fee, both money already in the drawer, never a deferred
 * supplier estimate. For a model-1 BILL (cost/price flow, e.g. Katsh) the
 * term IS `price - cost`, but that is a margin earned the moment the customer
 * paid at the counter, not a supplier-commission estimate deferred to
 * settlement — the supplier's real cut is a SEPARATE figure booked later on
 * the SUPPLIER_SETTLEMENT transaction. So gating the STAMP on
 * `is_settled = 1` hid real, already-collected money until an unrelated,
 * later event (the supplier settling) happened, and mislabeled it "pending
 * commission" (`getFinancialPendingByCurrency`) in the meantime.
 *
 * A model-0 (legacy EMBEDDED) row is NOT covered by the new predicate: its
 * `commission` term genuinely IS the settled truth only once `is_settled = 1`
 * (`embeddedCommission`'s own doc comment), so it keeps needing that gate —
 * every assertion below also proves a legacy unsettled row still does NOT
 * count as recognised anywhere.
 *
 * RULE 17 / PROVENANCE (corrected — L0-3, Round 2 adversarial pass): the
 * original header here claimed all six of the first describe block's cases
 * were freshly observed RED in one run and cited "the implementation
 * commit". Neither was accurate — nothing in this lane has been committed,
 * and only FOUR of the six were actually re-run RED in the session that
 * wrote this file (`getFinancialSettledByProvider`, `getByDate`, `getByUser`,
 * `getByClient` — at that point in the session `getFinancialSettledByCurrency`
 * and `getFinancialPendingByCurrency` had already been wired to
 * `fsStampRecognized`/`embeddedCommission`, so their assertions were already
 * GREEN, not RED, when this file's suite was run). The two by-currency
 * failure messages below are DERIVED from the pre-fix diff (`git diff` of
 * this file's own implementation edit — both methods read a bare
 * `fs.is_settled = 1`/no model gate before that edit), not captured from a
 * live run:
 *
 *   getFinancialSettledByCurrency › toHaveLength(1)  [derived from the diff]
 *     Expected length: 1   Received length: 0 (Received array: [])
 *   getFinancialPendingByCurrency › rows[0].commission toBe(5)  [derived]
 *     Expected: 5   Received: 7
 *     (pre-fix this bucket summed the WHISH row's $2 stamp alongside the
 *     legacy row's $5, mislabeling real money "pending commission")
 *   getFinancialSettledByProvider › whish?.profit_usd toBe(2)  [OBSERVED RED]
 *     Expected: 2   Received: undefined
 *     (the WHISH/Katsh rows were entirely absent from the result set —
 *     `fs.is_settled = 1` filtered them out of the WHERE clause before
 *     GROUP BY ever ran)
 *   getByDate (daily_commissions) › rows[0].profit_usd toBe(12)  [OBSERVED RED]
 *     Expected: 12   Received: 0
 *   getByUser › wrUser?.profit_usd toBe(2)  [OBSERVED RED]
 *     Expected: 2   Received: 0
 *   getByClient › wrClient?.profit_usd toBe(2)  [OBSERVED RED]
 *     Expected: 2   Received: 0
 *
 * All six fail for the same root cause: every arm's `CASE WHEN
 * fs.is_settled = 1` (or bare `WHERE fs.is_settled = 1`) excludes a model-1
 * row born `is_settled = 0` regardless of what its stamp actually contains —
 * the diff-derived pair is a correct prediction of that same mechanism, just
 * not a value this run captured live. All six pass GREEN today, on the
 * currently uncommitted source.
 *
 * Fixture pattern copied from ProfitRepository.commissionGates.test.ts
 * (in-memory better-sqlite3 + __LIRATEK_TEST_DB__ + runWithTenant), extended
 * with the `commission_model` column so `_hasCommissionModelColumn()` sees
 * the real (non-schema-drift) branch.
 *
 * L0-1 / L0-2 (Round 2 adversarial pass, same OWNER_NOTES section) — the
 * `describe("void reversal ...")`, `describe("refund pair ...")` and
 * `describe("degraded schema ...")` blocks below were added BEFORE
 * `isVoidReversalRow` was wired into the SQL (only the function itself
 * existed, unused, at that point) and RUN first (`npx jest
 * ProfitRepository.fsStampModel1Recognition --maxWorkers=1`, this session).
 * The two void-reversal cases were OBSERVED RED — `expect(user?.revenue_usd)
 * .toBe(0)` reported `Expected: 0, Received: 100` for BOTH `getByUser` and
 * `getByClient` (the `revenue_lbp` assertion on the very next line was never
 * reached — `toBe` throws on the first failing expectation — so only
 * `revenue_usd`'s 100 is an observed value; `revenue_lbp` was 0 once the
 * fix let the test proceed past it, not independently confirmed to have
 * failed on its own). All ten other cases in this run — the six pre-existing
 * plus the refund-pair and degraded-schema additions — passed on this SAME
 * first run; no code path changed for any of them, so they are coverage
 * additions, not regression proofs. After wiring `isVoidReversalRow` into
 * both methods' `revenue_usd` CASE arm, all twelve passed GREEN
 * (re-run, same command).
 *
 * The `revenue`/`revenue_usd`/`revenue_lbp` assertions added to the six
 * PRE-EXISTING cases above (`getFinancialSettledByCurrency`,
 * `getFinancialPendingByCurrency`, `getFinancialSettledByProvider`,
 * `getByDate`) are likewise coverage additions, not regression proofs — that
 * revenue math was already correct pre-Round-2 (only `getByUser`/
 * `getByClient`'s revenue arm had the void-reversal bug); the gap was that
 * nothing asserted it, which is exactly how L0-1 went unnoticed (L0-2).
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-07-01 10:00:00";
const FROM_DATE = "2026-07-01";
const FROM = "2026-07-01 00:00:00";
const TO = "2026-07-01 23:59:59";

/**
 * `withCommissionModel: false` (L0-2 Round 2 — the degraded-schema case)
 * omits the `financial_services.commission_model` column entirely, so
 * `hasCommissionModelColumn`'s PRAGMA probe reports `false` and every
 * `fsStampRecognized`/`embeddedCommission` call degrades to its pre-PA-0.1
 * fallback (bare `is_settled = 1`) — reproducing a fixture/tenant that
 * predates migration v148, matching {@link embeddedCommission}'s and
 * {@link fsStampRecognized}'s own doc comments.
 */
function createSchema(
  db: Database.Database,
  opts: { withCommissionModel?: boolean } = {},
): void {
  const withCommissionModel = opts.withCommissionModel ?? true;
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      full_name TEXT,
      phone_number TEXT
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      name TEXT
    );

    -- getByDate/getByUser/getByClient join every module's own source table
    -- unconditionally (LEFT JOIN chain / CTE-per-module) even when this
    -- fixture seeds nothing into it — each must exist and be empty, matching
    -- ProfitRepository.tenantIsolation.test.ts's own full schema.
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      paid_usd REAL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000,
      created_at TEXT
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_id INTEGER,
      product_id INTEGER,
      sold_price_usd REAL DEFAULT 0,
      cost_price_snapshot_usd REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      is_refunded INTEGER DEFAULT 0
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      reverses_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      provider TEXT,
      service_type TEXT,
      omt_service_type TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      ${withCommissionModel ? "commission_model INTEGER DEFAULT 0," : ""}
      omt_fee REAL,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier TEXT,
      currency_code TEXT DEFAULT 'USD',
      price REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      price_usd REAL DEFAULT 0,
      price_lbp REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      final_amount_lbp REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    ,
  parts_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
  parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0
);

    CREATE TABLE loto_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT DEFAULT 'active',
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      expense_date TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      amount_in REAL DEFAULT 0,
      leg1_profit_usd REAL DEFAULT 0,
      leg2_profit_usd REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    -- Referenced by partnerCoverageRatio/txnPartnerCoverageRatio (PFT-6).
    -- Empty in this fixture — every row is fully shop-owned (ratio 1.0).
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL,
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER,
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
    );

    -- Referenced by notDebtPending (DBT-1). Empty — nothing in this fixture
    -- is CUSTOMER_ACCOUNT-charged.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      due_date TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      session_id INTEGER,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    , refunded_at TEXT DEFAULT NULL);
  `);
}

/** Insert an FS row + its FINANCIAL_SERVICE transaction, stamp = `profit`. */
function seedFs(
  db: Database.Database,
  row: {
    provider: string;
    serviceType: string;
    amount: number;
    cost?: number;
    price?: number;
    commissionModel: number;
    isSettled: number;
    profitUsd: number;
    userId: number;
    clientName: string;
  },
): { fsId: number; txnId: number } {
  const fs = db
    .prepare(
      `INSERT INTO financial_services
         (tenant_id, provider, service_type, amount, currency, commission,
          commission_model, cost, price, is_settled, is_refunded, created_at)
       VALUES (1, ?, ?, ?, 'USD', 0, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      row.provider,
      row.serviceType,
      row.amount,
      row.commissionModel,
      row.cost ?? 0,
      row.price ?? 0,
      row.isSettled,
      D,
    );
  const fsId = Number(fs.lastInsertRowid);
  const txn = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, user_id,
          client_name, amount_usd, profit_usd, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, ?, ?, ?, ?, ?)`,
    )
    .run(fsId, row.userId, row.clientName, row.amount, row.profitUsd, D);
  return { fsId, txnId: Number(txn.lastInsertRowid) };
}

/**
 * L0-1 (Round 2) — simulate `TransactionRepository.voidTransaction`'s two
 * writes (~:1516-1541) for an FS row `seedFs` already created: mark the
 * original VOIDED, then INSERT its reversal — SAME `type`, `reverses_id`
 * pointing at the original, `amount_usd` negated, and `profit_usd`/
 * `profit_lbp` left UN-set (0 default) exactly like the real INSERT, whose
 * column list never names either. Only the reversal is `status = 'ACTIVE'`
 * afterwards — every query here filters on that — so it alone is what
 * getByUser/getByClient will see.
 */
function voidFs(
  db: Database.Database,
  seeded: { fsId: number; txnId: number },
  row: { amount: number; userId: number; clientName: string },
): { reversalId: number } {
  db.prepare(`UPDATE transactions SET status = 'VOIDED' WHERE id = ?`).run(
    seeded.txnId,
  );
  const reversal = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, user_id,
          client_name, amount_usd, reverses_id, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, ?, ?, ?, ?, ?)`,
    )
    .run(seeded.fsId, row.userId, row.clientName, -row.amount, seeded.txnId, D);
  return { reversalId: Number(reversal.lastInsertRowid) };
}

/**
 * L0-2 (Round 2) — insert a REFUND row reversing an FS row `seedFs` already
 * created. Unlike {@link voidFs}'s reversal, a REFUND keeps the ORIGINAL row
 * `ACTIVE` and negates BOTH `amount_usd` and `profit_usd` on its OWN row
 * (`type = 'REFUND'`), matching `TransactionRepository.refundTransaction`'s
 * shape — both rows are counted and must cancel out exactly.
 */
function refundFs(
  db: Database.Database,
  seeded: { fsId: number; txnId: number },
  row: {
    amount: number;
    profitUsd: number;
    userId: number;
    clientName: string;
  },
): { refundId: number } {
  const refund = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, user_id,
          client_name, amount_usd, profit_usd, reverses_id, created_at)
       VALUES (1, 'REFUND', 'ACTIVE', 'financial_services', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      seeded.fsId,
      row.userId,
      row.clientName,
      -row.amount,
      -row.profitUsd,
      seeded.txnId,
      D,
    );
  return { refundId: Number(refund.lastInsertRowid) };
}

describe("PA-0.1 — model-1 FS profit-stamp recognition (does not wait for supplier settlement)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  // (wr) WHISH RECEIVE, model-1, UNSETTLED — the D1 Whish RECEIVE fee ($2),
  //      already in the drawer, never a supplier estimate.
  // (bill) Katsh BILL, model-1, UNSETTLED, cost/price flow — $10 margin
  //      (price 90 - cost 80), earned when the customer paid at the counter.
  //      Katsh is NOT in COMMISSION_PROVIDERS, so it never appears in
  //      getFinancialSettledByCurrency/getFinancialPendingByCurrency (those
  //      two are provider-filtered) but DOES appear in the other four arms
  //      (no provider filter there) — proving the BILL check-first caveat
  //      resolves to "recognise it", not "exclude it".
  // (legacy) OMT SEND, model-0 (legacy EMBEDDED), UNSETTLED, real commission
  //      $5 — the negative control: must NEVER be recognised anywhere below,
  //      is_settled = 1 is still the only door for a model-0 row.
  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);

    seedFs(db, {
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 100,
      commissionModel: 1,
      isSettled: 0,
      profitUsd: 2,
      userId: 1,
      clientName: "Wr Client",
    });

    seedFs(db, {
      provider: "Katsh",
      serviceType: "BILL",
      amount: 90,
      cost: 80,
      price: 90,
      commissionModel: 1,
      isSettled: 0,
      profitUsd: 10,
      userId: 2,
      clientName: "Bill Client",
    });

    seedFs(db, {
      provider: "OMT",
      serviceType: "SEND",
      amount: 50,
      commissionModel: 0,
      isSettled: 0,
      profitUsd: 5,
      userId: 3,
      clientName: "Legacy Client",
    });

    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  it("getFinancialSettledByCurrency recognises the Whish RECEIVE fee immediately, never the legacy row", () => {
    // Katsh is outside COMMISSION_PROVIDERS, so only the WHISH row ($2) is
    // in scope here — proving the settlement gate no longer blocks it.
    const rows = runWithTenant(1, () =>
      repo.getFinancialSettledByCurrency(FROM, TO),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe("USD");
    expect(rows[0].commission).toBe(2);
    expect(rows[0].count).toBe(1);
    // L0-2 (Round 2): revenue was implemented (fsRevenue(fs)) but never
    // asserted here — WHISH RECEIVE amount = 100, cost = 0, so revenue =
    // fsRevenue = amount.
    expect(rows[0].revenue).toBe(100);
  });

  it("getFinancialPendingByCurrency no longer shows the model-1 Whish row as pending commission, but still shows the legacy row", () => {
    const rows = runWithTenant(1, () =>
      repo.getFinancialPendingByCurrency(FROM, TO),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe("USD");
    expect(rows[0].commission).toBe(5); // legacy row only
    expect(rows[0].count).toBe(1);
    // L0-2 (Round 2): legacy OMT SEND amount = 50, cost = 0 → revenue = 50.
    expect(rows[0].revenue).toBe(50);
  });

  it("getFinancialSettledByProvider recognises both unsettled model-1 rows by provider, never the legacy row", () => {
    const rows = runWithTenant(1, () =>
      repo.getFinancialSettledByProvider(FROM, TO),
    );
    const whish = rows.find((r) => r.provider === "WHISH");
    const katsh = rows.find((r) => r.provider === "Katsh");
    const omt = rows.find((r) => r.provider === "OMT");
    expect(whish?.profit_usd).toBe(2);
    expect(katsh?.profit_usd).toBe(10);
    expect(omt).toBeUndefined(); // legacy unsettled row: dropped entirely, not zeroed
    // L0-2 (Round 2): revenue_usd/revenue_lbp were implemented but never
    // asserted here. WHISH: cost = 0 → revenue = amount = 100. Katsh: cost =
    // 80 > 0 → revenue = price = 90. Both are USD-only, so revenue_lbp = 0.
    expect(whish?.revenue_usd).toBe(100);
    expect(whish?.revenue_lbp).toBe(0);
    expect(katsh?.revenue_usd).toBe(90);
    expect(katsh?.revenue_lbp).toBe(0);
  });

  it("getByDate (daily_commissions) attributes both model-1 rows' profit to their day, never the legacy row's", () => {
    const rows = runWithTenant(1, () => repo.getByDate(FROM_DATE, FROM_DATE, FROM, TO));
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe(FROM_DATE);
    // profit_usd on getByDate's final row also includes daily_sales_profit
    // (0 here — no sales seeded), so 2 + 10 = 12 is the whole contribution.
    expect(rows[0].profit_usd).toBe(12);
    // L0-2 (Round 2): revenue_usd was implemented but never asserted here —
    // 100 (WHISH) + 90 (Katsh) = 190, the daily_commissions CTE's whole
    // contribution to the combined revenue_usd column (no sales/recharges/
    // other modules seeded in this fixture).
    expect(rows[0].revenue_usd).toBe(190);
    expect(rows[0].revenue_lbp).toBe(0);
  });

  it("getByUser recognises each model-1 user's profit, legacy user reads 0", () => {
    const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
    const wrUser = rows.find((r) => r.user_id === 1);
    const billUser = rows.find((r) => r.user_id === 2);
    const legacyUser = rows.find((r) => r.user_id === 3);
    expect(wrUser?.profit_usd).toBe(2);
    expect(billUser?.profit_usd).toBe(10);
    // The legacy row's transaction still exists (COUNT includes it) but its
    // CASE arm must contribute 0 — is_settled = 0 and commission_model = 0.
    expect(legacyUser?.profit_usd).toBe(0);
    expect(legacyUser?.transaction_count).toBe(1);
    // L0-2 (Round 2): revenue_usd was implemented (fsRevenue(fs)) but never
    // asserted — the gap that let L0-1's void-reversal double-count slip
    // through. WHISH RECEIVE: cost = 0, so fsRevenue = amount = 100. Katsh
    // BILL: cost = 80 > 0, so fsRevenue = price = 90. The legacy row is
    // unrecognised, so its revenue contributes 0 same as its profit.
    expect(wrUser?.revenue_usd).toBe(100);
    expect(wrUser?.revenue_lbp).toBe(0);
    expect(billUser?.revenue_usd).toBe(90);
    expect(billUser?.revenue_lbp).toBe(0);
    expect(legacyUser?.revenue_usd).toBe(0);
    expect(legacyUser?.revenue_lbp).toBe(0);
  });

  it("getByClient recognises each model-1 client's profit, legacy client reads 0", () => {
    const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
    const wrClient = rows.find((r) => r.client_name === "Wr Client");
    const billClient = rows.find((r) => r.client_name === "Bill Client");
    const legacyClient = rows.find((r) => r.client_name === "Legacy Client");
    expect(wrClient?.profit_usd).toBe(2);
    expect(billClient?.profit_usd).toBe(10);
    expect(legacyClient?.profit_usd).toBe(0);
    // L0-2 (Round 2): see getByUser's own comment for the fsRevenue values.
    expect(wrClient?.revenue_usd).toBe(100);
    expect(wrClient?.revenue_lbp).toBe(0);
    expect(billClient?.revenue_usd).toBe(90);
    expect(billClient?.revenue_lbp).toBe(0);
    expect(legacyClient?.revenue_usd).toBe(0);
    expect(legacyClient?.revenue_lbp).toBe(0);
  });
});

describe("L0-1 (Round 2) — void reversal of a model-1 FS row must not double the voided principal into revenue", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  // A voided, UNSETTLED model-1 OMT SEND: a plain transfer, so its stamp is
  // force-zeroed (profitUsd: 0) even before the void. voidFs marks the
  // original VOIDED and inserts a reversal with the SAME type, reverses_id
  // at the original, amount negated, profit left at its 0 default. Only the
  // reversal is ACTIVE afterwards, so getByUser/getByClient see exactly one
  // row — the reversal — for this fs row.
  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);

    const seeded = seedFs(db, {
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      commissionModel: 1,
      isSettled: 0,
      profitUsd: 0,
      userId: 1,
      clientName: "Void Client",
    });
    voidFs(db, seeded, { amount: 100, userId: 1, clientName: "Void Client" });

    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  it("getByUser: a voided model-1 transfer contributes 0 revenue, not its principal", () => {
    const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
    const user = rows.find((r) => r.user_id === 1);
    // Pre-fix this read 100 (fsRevenue(fs), re-derived from the fs row a
    // second time for the reversal) instead of 0 — see this file's header.
    expect(user?.revenue_usd).toBe(0);
    expect(user?.revenue_lbp).toBe(0);
    expect(user?.profit_usd).toBe(0);
    // The reversal row still exists and is counted — voiding removes the
    // MONEY, not the row.
    expect(user?.transaction_count).toBe(1);
  });

  it("getByClient: a voided model-1 transfer contributes 0 revenue, not its principal", () => {
    const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
    const client = rows.find((r) => r.client_name === "Void Client");
    expect(client?.revenue_usd).toBe(0);
    expect(client?.revenue_lbp).toBe(0);
    expect(client?.profit_usd).toBe(0);
    expect(client?.transaction_count).toBe(1);
  });
});

describe("L0-2 (Round 2) — a REFUND pair on a model-1 FS row nets to 0 (already worked pre-fix; now explicitly covered)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  // Unlike a void, a refund keeps the ORIGINAL row ACTIVE and adds a
  // SEPARATE 'REFUND' row with negated amount AND profit — both rows are
  // counted, and must cancel out exactly.
  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);

    const seeded = seedFs(db, {
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 100,
      commissionModel: 1,
      isSettled: 0,
      profitUsd: 2,
      userId: 1,
      clientName: "Refund Client",
    });
    refundFs(db, seeded, {
      amount: 100,
      profitUsd: 2,
      userId: 1,
      clientName: "Refund Client",
    });

    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  it("getByUser: original + refund net to 0 revenue and 0 profit, both rows counted", () => {
    const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
    const user = rows.find((r) => r.user_id === 1);
    expect(user?.revenue_usd).toBe(0);
    expect(user?.profit_usd).toBe(0);
    expect(user?.transaction_count).toBe(2);
  });

  it("getByClient: original + refund net to 0 revenue and 0 profit, both rows counted", () => {
    const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
    const client = rows.find((r) => r.client_name === "Refund Client");
    expect(client?.revenue_usd).toBe(0);
    expect(client?.profit_usd).toBe(0);
    expect(client?.transaction_count).toBe(2);
  });
});

describe("L0-2 (Round 2) — degraded schema (no commission_model column): a model-1-shaped row still needs is_settled = 1", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  // No commission_model column at all (pre-migration-v148 tenant) —
  // hasCommissionModelColumn's PRAGMA probe reports false, so every
  // fsStampRecognized/embeddedCommission call degrades to its pre-PA-0.1
  // fallback. This row is unsettled — if the degrade path were broken (e.g.
  // fell through to "always recognised"), it would wrongly show up below.
  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db, { withCommissionModel: false });

    db.prepare(
      `INSERT INTO financial_services
         (tenant_id, provider, service_type, amount, currency, commission,
          cost, price, is_settled, is_refunded, created_at)
       VALUES (1, 'WHISH', 'RECEIVE', 100, 'USD', 0, 0, 0, 0, 0, ?)`,
    ).run(D);
    db.prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, user_id,
          client_name, amount_usd, profit_usd, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', 1, 1, 'Degraded Client', 100, 2, ?)`,
    ).run(D);

    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  it("getFinancialSettledByCurrency: excluded while unsettled — no commission_model column to recognise it early", () => {
    const rows = runWithTenant(1, () =>
      repo.getFinancialSettledByCurrency(FROM, TO),
    );
    expect(rows).toHaveLength(0);
  });

  it("getByUser: contributes 0 revenue/profit while unsettled — no commission_model column to recognise it early", () => {
    const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
    const user = rows.find((r) => r.user_id === 1);
    expect(user?.revenue_usd).toBe(0);
    expect(user?.profit_usd).toBe(0);
    // Row still counted — only its money is gated.
    expect(user?.transaction_count).toBe(1);
  });
});
