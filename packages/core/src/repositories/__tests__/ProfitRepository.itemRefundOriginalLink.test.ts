/**
 * ProfitRepository.getByUser / getByClient — PA-2.11-itemrefund
 * (OWNER_NOTES_2026-09-21.md §6, Lane LCC round-2 follow-up).
 *
 * LCC-B1 (round 4) stopped a `reverses_id`-NULL sales REFUND (the exact
 * shape `SalesRepository.refundSaleItem` writes — its `createTransaction`
 * call never sets `reverses_id`, only `source_table`/`source_id`) from being
 * silently DROPPED from `getByUser`/`getByClient`. It did not fix where the
 * row landed once admitted: with no `orig` row to fall back to, the REFUND
 * was dated by its OWN `created_at` (not the original sale's), attributed to
 * its OWN `user_id` (the refunder, not the original seller — the opposite of
 * every other REFUND path in this file), and its walk-in `client_name`
 * fell to `''` (the unnamed "Walk-in" bucket) since `refundSaleItem` copies
 * `client_id` but never `client_name`.
 *
 * This file seeds the exact repro OWNER_NOTES_2026-09-21.md §6 measured: a
 * June SALE by Alice for walk-in 'Ali' ($30 revenue / $9 profit), and a July
 * item REFUND created by Bob (-$10 / -$3, `reverses_id` NULL). Pre-fix:
 * Overview's `getSalesProfit` reads June 6 / July 0 (it matches by
 * `source_id`, not `reverses_id`), but `getByUser`/`getByClient` read June 9
 * / July -3, attribute the REFUND to Bob, and split 'Ali' into two rows
 * ('Ali' 9, 'Walk-in' -3).
 *
 * Schema: the same shape as `ProfitRepository.round3.laneLCC.test.ts`'s own
 * `createSchema` (rule 14 — copied, not re-derived; that file's header notes
 * why this exact table set is required for `getByUser`/`getByClient` to run
 * at all without a "no such table" error killing every assertion).
 *
 * RULE 17 — this session confirmed `better-sqlite3`'s ABI by CONSTRUCTING a
 * database (`node -e "const D=require('better-sqlite3'); new D(':memory:').exec('CREATE TABLE t(x)'); console.log('OK')"`
 * printed `OK` under plain Node), then, with `refundOriginalJoin`'s second
 * disjunct (the `source_table`/`source_id` fallback) temporarily removed —
 * i.e. `refundOriginalJoin` reverted to the pre-round-2 `orig.id =
 * reverses_id`-only join — ran `npx jest ProfitRepository.itemRefundOriginalLink
 * --maxWorkers=1`: RED, both new tests failed. Observed output (see the
 * PA-2.11-itemrefund describe block below for the exact recorded numbers).
 * Reverted, re-ran the same command: GREEN, both tests passing, plus the
 * full `ProfitRepository` suite unaffected (see the report for the exact
 * counts).
 *
 * ROUND-2 ADDENDUM (tonight, NO-EXECUTION RULE — OWNER'S ORDER): the review
 * that followed the RULE 17 run above found this file's own fallback join
 * NOT one-to-one (LCC-itemrefund-fanout) — see the SECOND `describe` block
 * appended below this one, added tonight to guard the `MIN(o.id)` fix. Per
 * tonight's owner order, those NEW tests were written and NOT executed;
 * that block's own doc comment carries its own explicit NOT-RUN status —
 * this paragraph does not extend the RULE 17 claim above to it.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const JUNE_FROM = "2026-06-01 00:00:00";
const JUNE_TO = "2026-06-30 23:59:59";
const JULY_FROM = "2026-07-01 00:00:00";
const JULY_TO = "2026-07-31 23:59:59";
const JUNE_SALE_AT = "2026-06-15 12:00:00";
const JULY_REFUND_AT = "2026-07-05 09:00:00";

function createSchema(db: Database.Database): void {
  db.exec(`
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

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      provider TEXT,
      omt_service_type TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      omt_fee REAL,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      commission_model INTEGER NOT NULL DEFAULT 0,
      receive_fee_model INTEGER NOT NULL DEFAULT 0,
      settlement_id INTEGER,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier TEXT,
      currency_code TEXT DEFAULT 'USD',
      price REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
    );

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
      created_at TEXT,
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
      expense_date TEXT,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      amount_in REAL DEFAULT 0,
      leg1_profit_usd REAL DEFAULT 0,
      leg2_profit_usd REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
    );

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

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      supplier_id INTEGER NOT NULL,
      ledger_entry_id INTEGER NOT NULL,
      gross_usd REAL NOT NULL DEFAULT 0,
      gross_lbp REAL NOT NULL DEFAULT 0,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      entry_mode TEXT NOT NULL DEFAULT 'LUMP',
      model INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(
    `INSERT INTO users (id, tenant_id, username) VALUES (1, 1, 'Alice')`,
  ).run();
  db.prepare(
    `INSERT INTO users (id, tenant_id, username) VALUES (2, 1, 'Bob')`,
  ).run();
}

describe("ProfitRepository — PA-2.11-itemrefund (OWNER_NOTES_2026-09-21.md §6, round-2 LCC follow-up)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  /**
   * The exact shape `SalesRepository.refundSaleItem` writes: `reverses_id`
   * NULL, linked back only via `source_table`/`source_id` (the sale's own
   * pair) — see that method's own `createTransaction` call. The refund's
   * `client_id` is copied from the original (here NULL, a walk-in), but
   * `client_name` is never passed, so it lands NULL on the REFUND row —
   * exactly like production.
   */
  function seedJuneSaleAndJulyItemRefund(): void {
    db.prepare(
      `INSERT INTO sales (id, tenant_id, status, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, created_at)
       VALUES (1, 1, 'completed', 30, 30, 0, 90000, ?)`,
    ).run(JUNE_SALE_AT);
    db.prepare(
      `INSERT INTO transactions
        (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, client_name, created_at)
       VALUES (1, 'SALE', 'ACTIVE', 'sales', 1, 1, 30, 0, 9, 0, NULL, 'Ali', ?)`,
    ).run(JUNE_SALE_AT);
    // Item refund, created by Bob (user 2) a month later — reverses_id NULL,
    // client_name NULL (never set by refundSaleItem).
    db.prepare(
      `INSERT INTO transactions
        (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, client_name, reverses_id, created_at)
       VALUES (1, 'REFUND', 'ACTIVE', 'sales', 1, 2, -10, 0, -3, 0, NULL, NULL, NULL, ?)`,
    ).run(JULY_REFUND_AT);
  }

  it("getByUser: June sums to the Overview's getSalesProfit (20/6), July is empty, and Bob never gets a row", () => {
    seedJuneSaleAndJulyItemRefund();

    const overviewJune = runWithTenant(1, () =>
      repo.getSalesProfit(JUNE_FROM, JUNE_TO),
    );
    expect(overviewJune.profit_usd).toBeCloseTo(6, 5);

    const juneRows = runWithTenant(1, () =>
      repo.getByUser(JUNE_FROM, JUNE_TO),
    );
    const juneRevenue = juneRows.reduce((s, r) => s + r.revenue_usd, 0);
    const juneProfit = juneRows.reduce((s, r) => s + r.profit_usd, 0);
    expect(juneRevenue).toBeCloseTo(20, 5);
    expect(juneProfit).toBeCloseTo(overviewJune.profit_usd, 5);
    // The whole $6 net profit is Alice's (the original seller) — the REFUND
    // is no longer attributed to Bob (the refunder).
    const aliceJune = juneRows.find((r) => r.user_id === 1);
    expect(aliceJune?.profit_usd).toBeCloseTo(6, 5);
    expect(juneRows.find((r) => r.user_id === 2)).toBeUndefined();

    const julyRows = runWithTenant(1, () =>
      repo.getByUser(JULY_FROM, JULY_TO),
    );
    const julyProfit = julyRows.reduce((s, r) => s + r.profit_usd, 0);
    expect(julyProfit).toBeCloseTo(0, 5);
    expect(julyRows.find((r) => r.user_id === 2)).toBeUndefined();
  });

  it("getByClient: June has a SINGLE 'Ali' group (20/6), not a split 'Ali'/'Walk-in' pair", () => {
    seedJuneSaleAndJulyItemRefund();

    const juneRows = runWithTenant(1, () =>
      repo.getByClient(JUNE_FROM, JUNE_TO, 50),
    );
    const namedAli = juneRows.filter((r) => r.client_name === "Ali");
    expect(namedAli).toHaveLength(1);
    expect(namedAli[0].revenue_usd).toBeCloseTo(20, 5);
    expect(namedAli[0].profit_usd).toBeCloseTo(6, 5);
    // No stray unnamed "Walk-in" row carrying the refund's -$3/-$10 alone.
    const unnamedWalkin = juneRows.filter(
      (r) => r.client_id === null && r.client_name !== "Ali",
    );
    expect(unnamedWalkin).toHaveLength(0);

    const julyRows = runWithTenant(1, () =>
      repo.getByClient(JULY_FROM, JULY_TO, 50),
    );
    const julyProfit = julyRows.reduce((s, r) => s + r.profit_usd, 0);
    expect(julyProfit).toBeCloseTo(0, 5);
  });
});

/**
 * LCC-itemrefund-fanout (round-2 BLOCKER, caught before the round-1 fix
 * above shipped — OWNER_NOTES_2026-09-21.md §6) — the round-1 fallback
 * above matched `orig.source_table = 'sales' AND orig.source_id =
 * t.source_id AND orig.type = 'SALE'` with NO uniqueness guarantee. That is
 * not one-to-one: `SalesRepository.processSale` inserts a NEW `type =
 * 'SALE'` transactions row on EVERY call — a draft's autosave AND that same
 * draft's later completion both call it, with no status gate and nothing
 * voiding the earlier row (SalesRepository.ts:799) — so ONE `sales.id` can
 * legitimately own several `SALE` transactions rows
 * (`TransactionRepository.refundBySaleId`'s own `ORDER BY id DESC LIMIT 1`
 * already assumes this multiplicity). A plain equality LEFT JOIN fans a
 * single item REFUND out across EVERY one of them, so it is counted N times
 * in `revenue_usd`/`profit_usd`/`transaction_count` — a NEW mismatch
 * against the Overview's `getSalesProfit` (which has no such fan-out risk:
 * it joins `sales` directly by primary key, 1:1) — on top of the exact
 * failure this file's round-1 fix exists to close.
 *
 * `refundOriginalJoin` now resolves the fallback to
 * `orig.id = (SELECT MIN(o.id) FROM transactions o WHERE o.tenant_id =
 * t.tenant_id AND o.source_table = 'sales' AND o.source_id = t.source_id
 * AND o.type = 'SALE')` — `MIN()` guarantees the subquery returns at most
 * one row, so the LEFT JOIN can match `orig` to at most one row, exactly
 * like the `reverses_id` branch already does.
 *
 * NOT RUN tonight (NO-EXECUTION RULE, OWNER'S ORDER) — red/green proof
 * pending (tomorrow). Expected: RED (transaction_count jumps by 2, not 1,
 * and `totalProfit` overshoots `overview.profit_usd` by the REFUND's
 * profit_usd counted an extra time) against the pre-fix bare-equality
 * fallback; GREEN against the current `MIN(o.id)` join. This is a
 * DIFFERENT scenario from `ProfitRepository.round3.laneLCC.test.ts`'s own
 * LCC-B1 tests (single SALE row) and from this file's own PA-2.11-itemrefund
 * tests above (also single SALE row) — neither seeds a second `SALE`
 * transactions row for the SAME `sales.id`, so neither could have caught
 * this fan-out.
 */
describe("ProfitRepository — LCC-itemrefund-fanout (round-2 BLOCKER, refundOriginalJoin's own fan-out fix)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  const DRAFT_AT = "2026-06-15 11:00:00";

  /**
   * SALE_A = the draft's own autosave-created row (inserted FIRST, so it
   * gets the LOWER `id` — `refundOriginalJoin`'s `MIN(o.id)` fallback
   * resolves to this one, the oldest, per its own doc comment). The item
   * REFUND (`reverses_id` NULL, the `refundSaleItem` shape) is seeded
   * alongside it — with only ONE SALE row so far, this is structurally
   * identical to the file's own PA-2.11-itemrefund case above.
   */
  function seedSaleAWithRefund(): void {
    db.prepare(
      `INSERT INTO sales (id, tenant_id, status, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, created_at)
       VALUES (1, 1, 'completed', 30, 30, 0, 90000, ?)`,
    ).run(JUNE_SALE_AT);
    db.prepare(
      `INSERT INTO transactions
        (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
       VALUES (1, 'SALE', 'ACTIVE', 'sales', 1, 1, 0, 0, 0, 0, NULL, ?)`,
    ).run(DRAFT_AT);
    // Item refund created by Bob (user 2) — reverses_id NULL, matching only
    // by source_id, the exact refundSaleItem shape.
    db.prepare(
      `INSERT INTO transactions
        (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, reverses_id, created_at)
       VALUES (1, 'REFUND', 'ACTIVE', 'sales', 1, 2, -10, 0, -3, 0, NULL, NULL, ?)`,
    ).run(JULY_REFUND_AT);
  }

  /**
   * SALE_B = the SAME draft's completion — a SEPARATE `transactions` row
   * `processSale` inserts on top of SALE_A, sharing the SAME `source_id`
   * (1). Inserted SECOND, so it gets the HIGHER `id` — the fan-out case.
   */
  function seedSaleBCompletion(): void {
    db.prepare(
      `INSERT INTO transactions
        (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
       VALUES (1, 'SALE', 'ACTIVE', 'sales', 1, 1, 30, 0, 9, 0, NULL, ?)`,
    ).run(JUNE_SALE_AT);
  }

  it("getByUser: a second SALE row for the SAME sale grows transaction_count by exactly 1 (not 2), and Σ profit still equals the Overview's getSalesProfit", () => {
    seedSaleAWithRefund();
    const before = runWithTenant(1, () =>
      repo.getByUser(JUNE_FROM, JUNE_TO),
    );
    const aliceBefore = before.find((r) => r.user_id === 1);
    // SALE_A (draft, $0/$0 profit) + the REFUND ($-10/$-3, attached via
    // MIN to SALE_A — the only candidate so far) = 2 rows, same shape as
    // the single-SALE-row PA-2.11-itemrefund case above.
    expect(aliceBefore?.transaction_count).toBe(2);

    seedSaleBCompletion();
    const after = runWithTenant(1, () => repo.getByUser(JUNE_FROM, JUNE_TO));
    const aliceAfter = after.find((r) => r.user_id === 1);
    expect(aliceAfter).toBeDefined();
    // The whole point of this test: adding ONE new SALE row must grow the
    // count by exactly 1 (SALE_B's own row) — not by 2, which is what a
    // bare-equality fallback would do (SALE_B's own row PLUS a second,
    // duplicated match of the SAME REFUND against SALE_B).
    expect(
      aliceAfter!.transaction_count - aliceBefore!.transaction_count,
    ).toBe(1);
    expect(aliceAfter!.transaction_count).toBe(3);

    const overview = runWithTenant(1, () =>
      repo.getSalesProfit(JUNE_FROM, JUNE_TO),
    );
    // getSalesProfit has no orig-join fan-out risk (it joins `sales`
    // directly on the primary key, 1:1) — it sums all 3 rows' profit_usd
    // once each: 0 (SALE_A) + 9 (SALE_B) + -3 (REFUND) = 6.
    expect(overview.profit_usd).toBeCloseTo(6, 5);
    const totalProfit = after.reduce((s, r) => s + r.profit_usd, 0);
    expect(totalProfit).toBeCloseTo(overview.profit_usd, 5);
    // Bob (the refunder) still gets no row of his own — the REFUND
    // resolves to SALE_A's user (Alice, the MIN-id row's creator), exactly
    // as in the single-SALE-row case; adding SALE_B (also Alice's) doesn't
    // change that.
    expect(after.find((r) => r.user_id === 2)).toBeUndefined();
  });

  it("getByClient: a second SALE row for the SAME sale does not split or duplicate the walk-in 'Ali' group's totals", () => {
    // Give both SALE rows the SAME walk-in name (client_id NULL) so the
    // fan-out, if unfixed, would double the REFUND's -$3/-$10 inside the
    // SAME 'Ali' group rather than creating a second group — a strictly
    // harder case to notice than a stray extra row, which is exactly why
    // Σ profit vs the Overview (not row COUNT alone) is the assertion that
    // catches it.
    db.prepare(
      `INSERT INTO sales (id, tenant_id, status, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, created_at)
       VALUES (1, 1, 'completed', 30, 30, 0, 90000, ?)`,
    ).run(JUNE_SALE_AT);
    db.prepare(
      `INSERT INTO transactions
        (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, client_name, created_at)
       VALUES (1, 'SALE', 'ACTIVE', 'sales', 1, 1, 0, 0, 0, 0, NULL, 'Ali', ?)`,
    ).run(DRAFT_AT);
    db.prepare(
      `INSERT INTO transactions
        (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, client_name, reverses_id, created_at)
       VALUES (1, 'REFUND', 'ACTIVE', 'sales', 1, 2, -10, 0, -3, 0, NULL, NULL, NULL, ?)`,
    ).run(JULY_REFUND_AT);
    db.prepare(
      `INSERT INTO transactions
        (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, client_name, created_at)
       VALUES (1, 'SALE', 'ACTIVE', 'sales', 1, 1, 30, 0, 9, 0, NULL, 'Ali', ?)`,
    ).run(JUNE_SALE_AT);

    const juneRows = runWithTenant(1, () =>
      repo.getByClient(JUNE_FROM, JUNE_TO, 50),
    );
    const namedAli = juneRows.filter((r) => r.client_name === "Ali");
    // A single 'Ali' group, not split by which SALE row the REFUND happened
    // to attach its client_name fallback to.
    expect(namedAli).toHaveLength(1);
    expect(namedAli[0].profit_usd).toBeCloseTo(6, 5);
    expect(namedAli[0].transaction_count).toBe(3);

    const overview = runWithTenant(1, () =>
      repo.getSalesProfit(JUNE_FROM, JUNE_TO),
    );
    expect(overview.profit_usd).toBeCloseTo(6, 5);
    const totalProfit = juneRows.reduce((s, r) => s + r.profit_usd, 0);
    expect(totalProfit).toBeCloseTo(overview.profit_usd, 5);
  });
});
