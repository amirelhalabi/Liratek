/**
 * ProfitRepository.getByUser / getByClient — Round 2 adversarial review
 * (OWNER_NOTES_2026-09-21.md §6, Lane LCC). Guards every item the Round 2
 * review found NOT CLOSED or newly introduced in this lane's own Round 1
 * work: LCC-V1 (multi-walk-in over-count), LCC-V2 (PA-2.5/PA-2.6 "orphan
 * row" loss — H2/H2b/H3/H4 in the review's own scratch-probe numbering),
 * LCC-V3 (exchange profit on getByUser only), LCC-V4 (SUPPLIER_SETTLEMENT
 * revenue leak), LCC-V8 (walk-in REFUND name split), LCC-V10 (partner
 * coverage on the reattributed commission itself).
 *
 * Schema: the same v150+ shape as `ProfitRepository.getByClient.laneLCC
 * .test.ts` (rule 14 — copied, not re-derived), extended with
 * `exchange_transactions` for LCC-V3 (that file's own fixture omits it,
 * which is exactly why `_hasExchangeTransactionsTable()`'s schema-drift
 * guard exists — see ProfitRepository.ts's own doc comment).
 *
 * RULE 17 — failing-first proof, what was ACTUALLY run and seen this
 * session (from the agent shell, in this exact order: full suite GREEN
 * first, THEN each item below individually reverted via a targeted Edit to
 * ProfitRepository.ts — this lane's own code only — re-run with `-t` to
 * isolate it, the failure recorded VERBATIM below, then the Edit reverted
 * back byte-for-byte and the full suite re-run to confirm GREEN again
 * before moving to the next item):
 *
 *   1. LCC-V1 ("H1/H5" test): reverted `clientReattMatchMain` /
 *      `clientKeptMatchMain` to the pre-fix `` `ft.client_id IS t.client_id` ``
 *      / `` `kc.client_id IS t.client_id` `` (no name-key branch at all).
 *      `npx jest ProfitRepository.byUserByClient.round2 -t "H1/H5"`:
 *        1 failed. `expect(ali?.profit_usd ?? 0).toBeCloseTo(1, 5)` —
 *        Expected: 1, Received: 13 (the settlement's $12 leaked onto Ali's
 *        group on top of her own $1 recharge profit).
 *      Restored; re-ran the same command: 1 passed.
 *
 *   2. LCC-V2 getByUser ("LCC-V2" tests): reverted the orphan branch's own
 *      `WHERE NOT EXISTS (...)` to `WHERE 1 = 0 AND NOT EXISTS (...)`
 *      (unconditionally excludes every orphan row — behaviourally identical
 *      to "no UNION ALL branch at all" without touching the surrounding SQL
 *      shape). `npx jest ProfitRepository.byUserByClient.round2 -t "LCC-V2"`:
 *        2 failed (H2, H4), 3 passed (H2b, H3, the no-double-count test —
 *        getByClient untouched by this revert). H2:
 *        `expect(user7?.profit_usd).toBeCloseTo(12, 5)` — Matcher error:
 *        received value must be a number, Received has value: undefined
 *        (user 7 had no row at all). H4: identical shape for user 9.
 *      Restored; re-ran: 5 passed.
 *
 *   3. LCC-V2 getByClient: the SAME `WHERE 1 = 0 AND NOT EXISTS` revert
 *      applied to `getByClient`'s own orphan branch.
 *      `npx jest ProfitRepository.byUserByClient.round2 -t "LCC-V2"`:
 *        2 failed (H2b, H3), 3 passed (H2, H4, no-double-count — getByUser
 *        untouched this time). H2b: `expect(client5?.profit_usd)
 *        .toBeCloseTo(12, 5)` — Received has value: undefined. H3:
 *        `expect(client5?.profit_usd).toBe(7)` — Expected: 7, Received:
 *        undefined.
 *      Restored; re-ran: 5 passed.
 *
 *   4. LCC-V4 ("LCC-V4" test): reverted the `WHEN t.source_table =
 *      'supplier_ledger' THEN 0` branch out of `getByUser`'s `revenue_usd`
 *      CASE (falls through to the generic `ELSE t.amount_usd * ratio`).
 *      `npx jest ProfitRepository.byUserByClient.round2 -t "LCC-V4"`:
 *        1 failed. `expect(row?.revenue_usd ?? 0).toBeCloseTo(0, 5)` —
 *        Expected: 0, Received: 500 (the settlement's net-settled amount
 *        leaked straight into Revenue).
 *      Restored; re-ran: 1 passed.
 *
 *   5. LCC-V8 ("LCC-V8" test): reverted `CLIENT_NAME_KEY` to
 *      `COALESCE(t.client_name, '')` (dropping the `orig.client_name`
 *      fallback) and the display-name expression to plain
 *      `MAX(t.client_name)`, in `getByClient`.
 *      `npx jest ProfitRepository.byUserByClient.round2 -t "LCC-V8"`:
 *        1 failed. `expect(aliRows[0].profit_usd).toBeCloseTo(0, 5)` —
 *        Expected: 0, Received: 4 (the REFUND's client_name — NULL, not
 *        copied from the original — fell into a SEPARATE unnamed walk-in
 *        group instead of netting against Ali's +4, so Ali's own row kept
 *        the full, un-netted +4).
 *      Restored; re-ran: 1 passed.
 *
 * Final re-run of the WHOLE file after every restore, plus the pre-existing
 * `ProfitRepository.getByClient.laneLCC.test.ts` and
 * `ProfitRepository.cashlessSettlementDefersOnDebt.test.ts`: 34/34 GREEN.
 *
 * LCC-V3 (exchange arm) and LCC-V10 (partner-coverage-weighted
 * reattribution) are NEW additions, not reverts of existing wrong behavior
 * — their "red" is that the feature did not exist at all before this
 * session's Round 2 work (`exchangeProfitForUser`/the `matchCondition`
 * parametrization did not exist), so there is no "old, wrong" code path to
 * revert TO: reverting IS deleting the feature, and the resulting error
 * would be a TypeScript compile failure (an undefined export/removed
 * parameter), not a runtime assertion mismatch. This is reasoned, not
 * separately executed as a revert-run (LCC-V5's own corrected standard:
 * label what was actually run vs reasoned) — both are exercised end-to-end
 * below against the CURRENT (fixed) code and pass, which IS the executed
 * evidence that the new arms work; only the counterfactual "the old code
 * fails" is a reasoned claim here, not an observed one.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const FROM = "2026-07-01 00:00:00";
const TO = "2026-07-31 23:59:59";
const IN_RANGE = "2026-07-15 12:00:00";
const BEFORE_WINDOW = "2026-06-01 12:00:00";

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
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (5, 1, 'Client Five', '71000000')`,
  ).run();
}

/** A cashless (SEND) OMT settlement: FS transfer + its SUPPLIER_SETTLEMENT
 *  transaction + one allocation, wired the same way
 *  `SupplierRepository._bookCommissionAtSettlement` writes them atomically. */
function seedCashlessSettlement(
  db: Database.Database,
  opts: {
    settlementLedgerId: number;
    fsUserId: number | null;
    fsClientId?: number | null;
    fsClientName?: string | null;
    fsCreatedAt: string;
    settlerUserId: number;
    settlementCreatedAt: string;
    commissionUsd: number;
  },
): number {
  const fsId = Number(
    db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, commission_model, settlement_id, created_at)
         VALUES (1, 'OMT', 80, 'USD', 0, 0, 1, 1, ?, ?)`,
      )
      .run(opts.settlementLedgerId, opts.fsCreatedAt).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO transactions
      (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, client_name, created_at)
     VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, ?, 80, 0, 0, 0, ?, ?, ?)`,
  ).run(
    fsId,
    opts.fsUserId,
    opts.fsClientId ?? null,
    opts.fsClientName ?? null,
    opts.fsCreatedAt,
  );
  db.prepare(
    `INSERT INTO supplier_ledger (id, tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_at)
     VALUES (?, 1, 1, 'SETTLEMENT', 80, 0, ?)`,
  ).run(opts.settlementLedgerId, opts.settlementCreatedAt);
  db.prepare(
    `INSERT INTO transactions
      (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
     VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', ?, ?, 0, 0, ?, 0, NULL, ?)`,
  ).run(
    opts.settlementLedgerId,
    opts.settlerUserId,
    opts.commissionUsd,
    opts.settlementCreatedAt,
  );
  db.prepare(
    `INSERT INTO settlement_commission_allocations (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, commission_lbp, created_at)
     VALUES (1, ?, ?, 'SEND', 'OMT', ?, 0, ?)`,
  ).run(
    opts.settlementLedgerId,
    fsId,
    opts.commissionUsd,
    opts.settlementCreatedAt,
  );
  return fsId;
}

function seedRecharge(
  db: Database.Database,
  opts: {
    userId: number;
    clientId: number | null;
    clientName?: string | null;
    amountUsd?: number;
    profitUsd?: number;
    createdAt?: string;
  },
): number {
  const rechargeId = Number(
    db
      .prepare(
        `INSERT INTO recharges (tenant_id, carrier, price, cost, created_at) VALUES (1, 'Alfa', ?, 0, ?)`,
      )
      .run(opts.amountUsd ?? 10, opts.createdAt ?? IN_RANGE).lastInsertRowid,
  );
  const txnId = Number(
    db
      .prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, client_name, created_at)
         VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, ?, ?, 0, ?, 0, ?, ?, ?)`,
      )
      .run(
        rechargeId,
        opts.userId,
        opts.amountUsd ?? 10,
        opts.profitUsd ?? 2,
        opts.clientId,
        opts.clientName ?? null,
        opts.createdAt ?? IN_RANGE,
      ).lastInsertRowid,
  );
  return txnId;
}

describe("ProfitRepository.getByUser/getByClient — Round 2 (OWNER_NOTES_2026-09-21.md §6, Lane LCC)", () => {
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

  // ---------------------------------------------------------------------
  // LCC-V1 — walk-in over-count (H1/H5)
  // ---------------------------------------------------------------------
  describe("LCC-V1 — a client-less cashless commission lands on ONE walk-in group, not every one", () => {
    it("H1/H5: three walk-in groups exist ('Ali', 'Sara', unnamed) — only the unnamed one (the settlement's own client-less originator) receives the $12", () => {
      // Two NAMED walk-in groups with their own unrelated activity, so they
      // exist as output rows independent of the settlement below.
      seedRecharge(db, {
        userId: 1,
        clientId: null,
        clientName: "Ali",
        amountUsd: 10,
        profitUsd: 1,
      });
      seedRecharge(db, {
        userId: 1,
        clientId: null,
        clientName: "Sara",
        amountUsd: 10,
        profitUsd: 1,
      });
      // The cashless settlement's OWN originating FS transaction is
      // client-less AND nameless (client_id NULL, client_name NULL) — the
      // true "unnamed Walk-in" group.
      seedCashlessSettlement(db, {
        settlementLedgerId: 900,
        fsUserId: 1,
        fsClientId: null,
        fsClientName: null,
        fsCreatedAt: IN_RANGE,
        settlerUserId: 1,
        settlementCreatedAt: IN_RANGE,
        commissionUsd: 12,
      });

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      const ali = rows.find((r) => r.client_name === "Ali");
      const sara = rows.find((r) => r.client_name === "Sara");
      const unnamed = rows.find(
        (r) => r.client_id === null && r.client_name === "Walk-in",
      );

      expect(ali?.profit_usd ?? 0).toBeCloseTo(1, 5); // its own recharge profit only
      expect(sara?.profit_usd ?? 0).toBeCloseTo(1, 5); // its own recharge profit only
      // The settlement row itself contributes 0 (cashless, zeroed by
      // supplierSettlementProfitArm) + the $12 reattribution, since the
      // originator is ALSO nameless/client-less.
      expect(unnamed?.profit_usd).toBeCloseTo(12, 5);
    });
  });

  // ---------------------------------------------------------------------
  // LCC-V2 — orphan-row loss (H2/H2b/H3/H4)
  // ---------------------------------------------------------------------
  describe("LCC-V2 — a key with reattributed/kept-change money but no other window activity still gets a row", () => {
    it("H2 (getByUser): a transfer created by user 7 BEFORE the window, settled by user 1 INSIDE it, credits user 7 with the full commission", () => {
      seedCashlessSettlement(db, {
        settlementLedgerId: 910,
        fsUserId: 7,
        fsCreatedAt: BEFORE_WINDOW,
        settlerUserId: 1,
        settlementCreatedAt: IN_RANGE,
        commissionUsd: 12,
      });

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const user7 = rows.find((r) => r.user_id === 7);
      const totalProfit = rows.reduce((s, r) => s + r.profit_usd, 0);

      expect(user7?.profit_usd).toBeCloseTo(12, 5);
      expect(totalProfit).toBeCloseTo(12, 5);
    });

    it("H2b (getByClient): the SAME scenario, keyed by the transfer's client 5", () => {
      seedCashlessSettlement(db, {
        settlementLedgerId: 911,
        fsUserId: 1,
        fsClientId: 5,
        fsCreatedAt: BEFORE_WINDOW,
        settlerUserId: 1,
        settlementCreatedAt: IN_RANGE,
        commissionUsd: 12,
      });

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      const client5 = rows.find((r) => r.client_id === 5);
      const totalProfit = rows.reduce((s, r) => s + r.profit_usd, 0);

      expect(client5?.profit_usd).toBeCloseTo(12, 5);
      expect(totalProfit).toBeCloseTo(12, 5);
    });

    it("H4 (getByUser): a cashier whose ONLY window activity is a KEPT_CHANGE row still gets a row", () => {
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'KEPT_CHANGE', 'ACTIVE', 'customer_sessions', 1, 9, 0, 0, 4, 0, NULL, ?)`,
      ).run(IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const user9 = rows.find((r) => r.user_id === 9);

      expect(user9?.profit_usd).toBeCloseTo(4, 5);
      expect(user9?.transaction_count).toBe(0);
    });

    it("H3 (getByClient): a client whose ONLY window activity is a DEBT_REPAYMENT kept-change row still gets a row", () => {
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'DEBT_REPAYMENT', 'ACTIVE', 'debt_ledger', 1, 1, 0, 0, 7, 0, 5, ?)`,
      ).run(IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      const client5 = rows.find((r) => r.client_id === 5);

      expect(client5?.profit_usd).toBe(7);
      expect(client5?.transaction_count).toBe(0);
    });

    it("a key with BOTH main-row activity AND orphan-source money is counted exactly once (no double-count)", () => {
      // User 3 has a normal recharge IN the window...
      seedRecharge(db, {
        userId: 3,
        clientId: null,
        clientName: "Regular",
        amountUsd: 50,
        profitUsd: 6,
      });
      // ...AND originated a transfer settled (cashlessly) inside the SAME
      // window by someone else.
      seedCashlessSettlement(db, {
        settlementLedgerId: 912,
        fsUserId: 3,
        fsCreatedAt: IN_RANGE,
        settlerUserId: 1,
        settlementCreatedAt: IN_RANGE,
        commissionUsd: 8,
      });

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const user3Rows = rows.filter((r) => r.user_id === 3);
      expect(user3Rows).toHaveLength(1); // not split into a main row + an orphan row
      expect(user3Rows[0].profit_usd).toBeCloseTo(6 + 8, 5);
    });
  });

  // ---------------------------------------------------------------------
  // LCC-V3 — exchange profit on getByUser only
  // ---------------------------------------------------------------------
  describe("LCC-V3 — exchange profit reaches getByUser (via transactions.user_id), never getByClient", () => {
    it("an EXCHANGE row with no other PROFIT_TXN_TYPES activity credits the cashier who created it", () => {
      const exId = Number(
        db
          .prepare(
            `INSERT INTO exchange_transactions (tenant_id, amount_in, leg1_profit_usd, leg2_profit_usd, created_at)
             VALUES (1, 1000, 15, 0, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, client_name, created_at)
         VALUES (1, 'EXCHANGE', 'ACTIVE', 'exchange_transactions', ?, 11, 1000, 0, 15, 0, NULL, 'Some Walk-in', ?)`,
      ).run(exId, IN_RANGE);

      const userRows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const cashier = userRows.find((r) => r.user_id === 11);
      expect(cashier?.profit_usd).toBeCloseTo(15, 5);

      // getByClient never attributes it (no client_id on an exchange row) —
      // no client group anywhere carries this $15.
      const clientRows = runWithTenant(1, () =>
        repo.getByClient(FROM, TO, 50),
      );
      const totalClientProfit = clientRows.reduce(
        (s, r) => s + r.profit_usd,
        0,
      );
      expect(totalClientProfit).toBeCloseTo(0, 5);
    });

    it("a void's reversal leg (is_refunded) does not contribute exchange profit", () => {
      const exId = Number(
        db
          .prepare(
            `INSERT INTO exchange_transactions (tenant_id, amount_in, leg1_profit_usd, leg2_profit_usd, is_refunded, created_at)
             VALUES (1, 1000, 15, 0, 1, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, created_at)
         VALUES (1, 'EXCHANGE', 'ACTIVE', 'exchange_transactions', ?, 11, 1000, 0, 15, 0, ?)`,
      ).run(exId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const cashier = rows.find((r) => r.user_id === 11);
      expect(cashier?.profit_usd ?? 0).toBeCloseTo(0, 5);
    });
  });

  // ---------------------------------------------------------------------
  // LCC-V4 — SUPPLIER_SETTLEMENT revenue leak
  // ---------------------------------------------------------------------
  describe("LCC-V4 — a SUPPLIER_SETTLEMENT row's net-settled amount does not inflate Revenue", () => {
    it("getByUser: revenue_usd/revenue_lbp stay 0 for a settlement row with a non-zero amount_usd/amount_lbp", () => {
      db.prepare(
        `INSERT INTO supplier_ledger (id, tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_at)
         VALUES (920, 1, 1, 'SETTLEMENT', 500, 9000000, ?)`,
      ).run(IN_RANGE);
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', 920, 1, 500, 9000000, 3, 0, NULL, ?)`,
      ).run(IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const row = rows.find((r) => r.user_id === 1);
      expect(row?.revenue_usd ?? 0).toBeCloseTo(0, 5);
      expect(row?.revenue_lbp ?? 0).toBeCloseTo(0, 5);
      // Profit is unaffected by this fix — the settlement's own stamp still
      // counts (no allocations exist here, so supplierSettlementProfitArm
      // degrades to the bills-only/no-allocations ELSE — the plain stamp).
      expect(row?.profit_usd).toBeCloseTo(3, 5);
    });
  });

  // ---------------------------------------------------------------------
  // LCC-V8 — walk-in REFUND name split
  // ---------------------------------------------------------------------
  describe("LCC-V8 — a walk-in sale and its REFUND stay in ONE group", () => {
    it("REFUND's own client_name is NULL (only client_id is copied) — falls back to the original's name", () => {
      const originalId = seedRecharge(db, {
        userId: 1,
        clientId: null,
        clientName: "Ali",
        amountUsd: 20,
        profitUsd: 4,
        createdAt: IN_RANGE,
      });
      // client_name deliberately NULL (TransactionRepository.refundTransaction
      // copies client_id only) — client_id also NULL for a walk-in.
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, client_name, reverses_id, created_at)
         VALUES (1, 'REFUND', 'ACTIVE', 'recharges', 1, 1, -20, 0, -4, 0, NULL, NULL, ?, ?)`,
      ).run(originalId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      const aliRows = rows.filter((r) => r.client_name === "Ali");
      expect(aliRows).toHaveLength(1);
      expect(aliRows[0].profit_usd).toBeCloseTo(0, 5);
      expect(aliRows[0].revenue_usd).toBeCloseTo(0, 5);
      // No separate unnamed "Walk-in" row leaked the REFUND's -4 into a
      // second group.
      const unnamed = rows.find(
        (r) => r.client_id === null && r.client_name === "Walk-in",
      );
      expect(unnamed).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // LCC-V10 — partner coverage weights the reattributed commission itself
  // ---------------------------------------------------------------------
  describe("LCC-V10 — reattributedSettlementCommission is weighted by the allocation's own partner coverage", () => {
    function seedPartnerCoverage(
      fsId: number,
      amount: number,
      coveredAmount: number,
    ): void {
      db.prepare(
        `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, covered_amount, created_at)
         VALUES (1, 1, 'FOR_PARTNER_SEND', 'financial_services', ?, ?, 'USD', 'CREDIT', ?, ?)`,
      ).run(fsId, amount, coveredAmount, IN_RANGE);
    }

    it("getByUser: 0% partner coverage -> reattributed commission is 0", () => {
      const fsId = seedCashlessSettlement(db, {
        settlementLedgerId: 930,
        fsUserId: 4,
        fsCreatedAt: IN_RANGE,
        settlerUserId: 1,
        settlementCreatedAt: IN_RANGE,
        commissionUsd: 20,
      });
      seedPartnerCoverage(fsId, 100, 0);

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const user4 = rows.find((r) => r.user_id === 4);
      expect(user4?.profit_usd ?? 0).toBeCloseTo(0, 5);
    });

    it("getByUser: 50% partner coverage -> half the commission reattributes", () => {
      const fsId = seedCashlessSettlement(db, {
        settlementLedgerId: 931,
        fsUserId: 4,
        fsCreatedAt: IN_RANGE,
        settlerUserId: 1,
        settlementCreatedAt: IN_RANGE,
        commissionUsd: 20,
      });
      seedPartnerCoverage(fsId, 100, 50);

      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const user4 = rows.find((r) => r.user_id === 4);
      expect(user4?.profit_usd).toBeCloseTo(10, 5);
    });

    it("getByClient: 100% partner coverage -> the full commission reattributes", () => {
      const fsId = seedCashlessSettlement(db, {
        settlementLedgerId: 932,
        fsUserId: 1,
        fsClientId: 5,
        fsCreatedAt: IN_RANGE,
        settlerUserId: 1,
        settlementCreatedAt: IN_RANGE,
        commissionUsd: 20,
      });
      seedPartnerCoverage(fsId, 100, 100);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      const client5 = rows.find((r) => r.client_id === 5);
      expect(client5?.profit_usd).toBeCloseTo(20, 5);
    });
  });
});
