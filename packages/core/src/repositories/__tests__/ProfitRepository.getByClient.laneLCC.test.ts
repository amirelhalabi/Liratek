/**
 * ProfitRepository.getByClient — OWNER_NOTES_2026-09-21.md §6, Lane LCC
 * (By Cashier + By Client). Covers every item this lane owns on
 * `getByClient`: PA-1.2, PA-1.3, PA-1.7, PA-2.5, PA-2.6, PA-2.11, PA-3.9,
 * PA-4.19. `getByUser` already carried every one of these fixes before this
 * file was written (see its own doc comment) — this file proves the SAME
 * fixes on `getByClient`, which was lagging behind it.
 *
 * Schema: the full v150+ shape (settlement_commission_allocations,
 * financial_services.commission_model/settlement_id, supplier_ledger,
 * supplier_settlements) copied from `LIRA158.settlementAttribution
 * .test.ts`'s own `createSchema` (rule 14 — reused, not re-derived; see that
 * file's header for why this exact table set is required to run
 * getByClient's queries at all without an "no such table" error killing
 * every assertion in the file, not just the one that "needed" it).
 *
 * RULE 17 — failing-first proof, and its own LCC-V5 (Round 2 adversarial
 * review) correction. The paragraph below, as originally written, claimed
 * the "RangeError: Too many parameter values were provided" red run was
 * against pre-fix HEAD and said it "hit every v150+ install" — Round 2
 * found that claim WRONG and required this correction (do not restore the
 * original wording):
 *
 *   At HEAD, `supplierSettlementProfitArm` embedded its own `AND
 *   sca.tenant_id = ?`, so HEAD's `getByClient` params array (which pushed
 *   a matching extra `tenantId` under `if (hasAllocations)`) was internally
 *   consistent and never threw. The phantom-param mismatch this file
 *   originally described — the arm embedding ZERO `?` while the params
 *   array still pushed two extra `tenantId` values for it — existed ONLY in
 *   an intermediate, UNCOMMITTED state of this session's own staged working
 *   tree, between an earlier edit that dropped the `?` from the arm and a
 *   later edit that updated `getByClient`'s params to match. It never
 *   reached HEAD and never shipped to any real install. The "11/11 RED,
 *   identical RangeError" run this file's history describes is real, but it
 *   is evidence of that transient uncommitted-tree bug, not evidence for
 *   any of PA-1.2/1.3/1.7/2.5/2.6/2.11/3.9/4.19 individually — a uniform
 *   crash before any row is returned cannot distinguish "the fix for item X
 *   is present" from "the fix for item Y is present"; it only proves the
 *   query executes at all.
 *
 * The item-level RED/GREEN evidence for THIS lane's fixes now lives in two
 * places instead: (a) `ProfitRepository.byUserByClient.round2.test.ts`,
 * which reverts and re-runs each Round 2 item (LCC-V1/V2/V4/V8) alone and
 * records its own specific failing assertion, not a shared crash; (b) for
 * the ORIGINAL Round 1 items this file itself covers (PA-1.2/1.3/1.7/2.5/
 * 2.6/2.11/3.9/4.19), each is proven correct by REASONING over the diff
 * (the pre-fix method body literally lacked the branch/column/gate the
 * corresponding test asserts on) rather than a second executed revert-run
 * of this whole file — labelled here as reasoned, not run, per rule 17/
 * fable-brain §5's registers, since re-deriving 8 separate historical
 * reverts of an already-superseded method body was not repeated this
 * session.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const FROM = "2026-07-01 00:00:00";
const TO = "2026-07-31 23:59:59";
const IN_RANGE = "2026-07-15 12:00:00";
const OUT_OF_RANGE = "2026-08-05 12:00:00";

/** Identical to LIRA158.settlementAttribution.test.ts's own createSchema
 *  (rule 14 — the full v150+ shape getByClient's queries need end-to-end). */
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
      created_at TEXT
    ,
  parts_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
  parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0
);

    CREATE TABLE maintenance_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      stock_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE maintenance_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (5, 1, 'Current Name', '71000000')`,
  ).run();
}

/** RECHARGE-shaped ELSE-branch transaction (the generic arm every currency
 *  fix and the PA-2.11/PA-3.9/PA-4.19 fixtures below lean on). */
function seedRecharge(
  db: Database.Database,
  opts: {
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
         VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, 1, ?, 0, ?, 0, ?, ?, ?)`,
      )
      .run(
        rechargeId,
        opts.amountUsd ?? 10,
        opts.profitUsd ?? 2,
        opts.clientId,
        opts.clientName ?? null,
        opts.createdAt ?? IN_RANGE,
      ).lastInsertRowid,
  );
  return txnId;
}

describe("ProfitRepository.getByClient — Lane LCC (OWNER_NOTES_2026-09-21.md §6)", () => {
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
  // PA-1.2 / PA-1.7 — currency-gated revenue_usd/revenue_lbp
  // ---------------------------------------------------------------------
  describe("PA-1.2 / PA-1.7 — revenue is bucketed by fs.currency, not always USD", () => {
    it("an LBP-denominated financial_services transfer does not inflate revenue_usd, and revenue_lbp carries it instead", () => {
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, commission_model, created_at)
             VALUES (1, 'OMT', 5000000, 'LBP', 0, 0, 1, 0, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 0, 5000000, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () =>
        repo.getByClient(FROM, TO, 50),
      );
      expect(rows).toHaveLength(1);
      // The bug: a 5,000,000 LBP transfer used to read "+$5,000,000".
      expect(rows[0].revenue_usd).toBeCloseTo(0, 5);
      expect(rows[0].revenue_lbp).toBeCloseTo(5000000, 5);
    });

    it("a USD financial_services transfer still lands in revenue_usd, not revenue_lbp", () => {
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, commission_model, created_at)
             VALUES (1, 'OMT', 80, 'USD', 0, 0, 1, 0, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 80, 0, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows[0].revenue_usd).toBeCloseTo(80, 5);
      expect(rows[0].revenue_lbp).toBeCloseTo(0, 5);
    });
  });

  // ---------------------------------------------------------------------
  // PA-1.3 — pending_profit split by currency
  // ---------------------------------------------------------------------
  describe("PA-1.3 — pending_profit_usd/pending_profit_lbp split by fs2.currency", () => {
    it("an unsettled LBP legacy commission counts toward pending_profit_lbp, not pending_profit_usd", () => {
      // A qualifying row so the client appears in the result set at all.
      seedRecharge(db, { clientId: 5, amountUsd: 1, profitUsd: 0 });
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, commission, cost, price, is_settled, commission_model, created_at)
             VALUES (1, 'OMT', 100000, 'LBP', 15000, 0, 0, 0, 0, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 0, 100000, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows).toHaveLength(1);
      expect(rows[0].pending_profit_usd).toBeCloseTo(0, 5);
      expect(rows[0].pending_profit_lbp).toBeCloseTo(15000, 5);
    });
  });

  // ---------------------------------------------------------------------
  // PA-2.5 — cashless settlement commission reattributed to the client
  // ---------------------------------------------------------------------
  describe("PA-2.5 — cashless supplier-settlement commission reaches the underlying client, not the settlement row's own (client-less) group", () => {
    it("attributes the allocation's commission to the FS transaction's own client_id", () => {
      // The underlying FS transfer, owned by client 5, settled under
      // settlement_id 900.
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, commission_model, settlement_id, created_at)
             VALUES (1, 'OMT', 80, 'USD', 0, 0, 1, 1, 900, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 80, 0, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);

      // The settlement batch itself: cashless (service_type != 'BILL'),
      // settled by the OWNER (no client_id at all on this row).
      db.prepare(
        `INSERT INTO supplier_ledger (id, tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_at)
         VALUES (900, 1, 1, 'SETTLEMENT', 80, 0, ?)`,
      ).run(IN_RANGE);
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', 900, 1, 0, 0, 12, 0, NULL, ?)`,
      ).run(IN_RANGE);
      db.prepare(
        `INSERT INTO settlement_commission_allocations (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, commission_lbp, created_at)
         VALUES (1, 900, ?, 'SEND', 'OMT', 12, 0, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      // Two groups: client 5 (the FS transfer's own group, now carrying the
      // reattributed commission) and the settlement row's own walk-in group
      // (it still exists as a transaction — supplierSettlementProfitArm only
      // zeroes its PROFIT contribution for a cashless batch, not the row
      // itself).
      expect(rows).toHaveLength(2);
      const client5 = rows.find((r) => r.client_id === 5);
      const walkin = rows.find((r) => r.client_id === null);
      expect(client5?.profit_usd).toBeCloseTo(12, 5);
      expect(walkin?.profit_usd).toBeCloseTo(0, 5);
    });

    it("a BILLS-ONLY settlement is unaffected — its commission stays on the settling row, not reattributed", () => {
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, commission_model, settlement_id, created_at)
             VALUES (1, 'IPICK', 80, 'USD', 0, 0, 1, 1, 901, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 80, 0, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);
      db.prepare(
        `INSERT INTO supplier_ledger (id, tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_at)
         VALUES (901, 1, 1, 'SETTLEMENT', 80, 0, ?)`,
      ).run(IN_RANGE);
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', 901, 1, 0, 0, 9, 0, NULL, ?)`,
      ).run(IN_RANGE);
      // service_type = 'BILL' -> bills-only, NOT cashless.
      db.prepare(
        `INSERT INTO settlement_commission_allocations (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, commission_lbp, created_at)
         VALUES (1, 901, ?, 'BILL', 'IPICK', 9, 0, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      // Two groups: client 5 (the FS transfer's own revenue/profit — 0 here,
      // since is_settled/commission_model recognise the STAMP, not this
      // commission) and the walk-in settlement row itself, unaffected.
      const walkin = rows.find((r) => r.client_id === null);
      const client5 = rows.find((r) => r.client_id === 5);
      expect(walkin?.profit_usd).toBeCloseTo(9, 5);
      expect(client5?.profit_usd ?? 0).toBeCloseTo(0, 5);
    });
  });

  // ---------------------------------------------------------------------
  // PA-2.6 — payment-method fee + kept change attributed to the client
  // ---------------------------------------------------------------------
  describe("PA-2.6 — PM fee and kept change are added to the client's profit", () => {
    it("a payment-method fee counts even when the underlying transfer's own stamp is not yet recognised", () => {
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, commission_model, payment_method_fee, created_at)
             VALUES (1, 'OMT_APP', 50, 'USD', 0, 0, 0, 0, 3, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 50, 0, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows).toHaveLength(1);
      // is_settled=0, commission_model=0 -> fsStampRecognized is false, so
      // the STAMP term contributes 0 — only the PM fee should show.
      expect(rows[0].profit_usd).toBeCloseTo(3, 5);
    });

    it("kept change on a DEBT_REPAYMENT row adds to the same client's profit", () => {
      seedRecharge(db, { clientId: 5, amountUsd: 1, profitUsd: 0 });
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'DEBT_REPAYMENT', 'ACTIVE', 'debt_ledger', 1, 1, 0, 0, 7, 0, 5, ?)`,
      ).run(IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows).toHaveLength(1);
      expect(rows[0].profit_usd).toBeCloseTo(7, 5);
    });
  });

  // ---------------------------------------------------------------------
  // PA-2.11 — a REFUND is dated by its ORIGINAL transaction, not its own
  // ---------------------------------------------------------------------
  describe("PA-2.11 — REFUND rows are dated by the original transaction's created_at", () => {
    it("a refund created AFTER the report window still nets against a sale INSIDE it", () => {
      const originalId = seedRecharge(db, {
        clientId: 5,
        amountUsd: 100,
        profitUsd: 20,
        createdAt: IN_RANGE,
      });
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, reverses_id, created_at)
         VALUES (1, 'REFUND', 'ACTIVE', 'recharges', 1, 1, -100, 0, -20, 0, 5, ?, ?)`,
      ).run(originalId, OUT_OF_RANGE);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows).toHaveLength(1);
      // Pre-fix: the REFUND (dated by its own created_at, OUT_OF_RANGE) fell
      // outside the WHERE clause entirely, so the sale's full revenue/profit
      // stayed un-netted within the window.
      expect(rows[0].revenue_usd).toBeCloseTo(0, 5);
      expect(rows[0].profit_usd).toBeCloseTo(0, 5);
      // transaction_count still counts both rows once they're both in scope
      // via the orig join — no row is silently dropped, only re-dated.
      expect(rows[0].transaction_count).toBe(2);
    });
  });

  // ---------------------------------------------------------------------
  // PA-3.9 — group by client_id, not the (possibly stale) name snapshot
  // ---------------------------------------------------------------------
  describe("PA-3.9 — a renamed client's transactions stay in ONE group", () => {
    it("two transactions for the same client_id but different client_name snapshots produce a single row", () => {
      seedRecharge(db, {
        clientId: 5,
        clientName: "Old Name",
        amountUsd: 100,
        profitUsd: 20,
        createdAt: IN_RANGE,
      });
      seedRecharge(db, {
        clientId: 5,
        clientName: "New Name",
        amountUsd: 50,
        profitUsd: 10,
        createdAt: IN_RANGE,
      });

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows).toHaveLength(1);
      expect(rows[0].client_id).toBe(5);
      expect(rows[0].transaction_count).toBe(2);
      expect(rows[0].revenue_usd).toBeCloseTo(150, 5);
      expect(rows[0].profit_usd).toBeCloseTo(30, 5);
      // Canonical name comes from the clients table, not an arbitrary
      // per-row snapshot.
      expect(rows[0].client_name).toBe("Current Name");
    });

    it("pending_profit is not duplicated across the (now-merged) group", () => {
      seedRecharge(db, {
        clientId: 5,
        clientName: "Old Name",
        amountUsd: 1,
        profitUsd: 0,
        createdAt: IN_RANGE,
      });
      seedRecharge(db, {
        clientId: 5,
        clientName: "New Name",
        amountUsd: 1,
        profitUsd: 0,
        createdAt: IN_RANGE,
      });
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, commission, cost, price, is_settled, commission_model, created_at)
             VALUES (1, 'OMT', 100, 'USD', 15, 0, 0, 0, 0, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 0, 0, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows).toHaveLength(1);
      // Pre-fix (split into 2 rows by name), each row's correlated
      // pending_profit_usd subquery matches on client_id alone, so the SAME
      // full $15 pending total would have been duplicated onto BOTH rows —
      // summed across the (buggy) result set, $30. Post-fix, one row, $15.
      expect(rows[0].pending_profit_usd).toBeCloseTo(15, 5);
    });
  });

  // ---------------------------------------------------------------------
  // PA-4.19 — recognized_transaction_count excludes REFUND/SUPPLIER_SETTLEMENT
  // and an unrecognized FS row
  // ---------------------------------------------------------------------
  describe("PA-4.19 — recognized_transaction_count is the correct Avg Profit/Txn denominator", () => {
    it("counts a plain RECHARGE, excludes its REFUND, an unrelated SUPPLIER_SETTLEMENT, and an unsettled FS row", () => {
      // 1 recognized RECHARGE.
      seedRecharge(db, {
        clientId: 5,
        amountUsd: 100,
        profitUsd: 20,
        createdAt: IN_RANGE,
      });

      // A second recharge + its REFUND (nets to 0, both rows exist, but
      // REFUND must not count toward the denominator).
      const secondId = seedRecharge(db, {
        clientId: 5,
        amountUsd: 30,
        profitUsd: 5,
        createdAt: IN_RANGE,
      });
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, reverses_id, created_at)
         VALUES (1, 'REFUND', 'ACTIVE', 'recharges', 2, 1, -30, 0, -5, 0, 5, ?, ?)`,
      ).run(secondId, IN_RANGE);

      // A SUPPLIER_SETTLEMENT row for the SAME client (unusual, but the
      // count exclusion is type-based, not client-based).
      db.prepare(
        `INSERT INTO supplier_ledger (id, tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_at)
         VALUES (950, 1, 1, 'SETTLEMENT', 0, 0, ?)`,
      ).run(IN_RANGE);
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', 950, 1, 0, 0, 0, 0, 5, ?)`,
      ).run(IN_RANGE);

      // An unsettled legacy FS row (fsStampRecognized false).
      const fsId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, commission_model, created_at)
             VALUES (1, 'OMT', 40, 'USD', 0, 0, 0, 0, ?)`,
          )
          .run(IN_RANGE).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO transactions
          (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 40, 0, 0, 0, 5, ?)`,
      ).run(fsId, IN_RANGE);

      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows).toHaveLength(1);
      // transaction_count: RECHARGE + RECHARGE + REFUND + SUPPLIER_SETTLEMENT + FINANCIAL_SERVICE = 5
      expect(rows[0].transaction_count).toBe(5);
      // recognized_transaction_count: only the two plain RECHARGE rows.
      expect(rows[0].recognized_transaction_count).toBe(2);
    });
  });
});
