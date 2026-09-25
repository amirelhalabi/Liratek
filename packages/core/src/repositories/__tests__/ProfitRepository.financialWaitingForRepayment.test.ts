/**
 * OWNER DECISION (h), 2026-09-24 afternoon (OWNER_NOTES_2026-09-21.md §6.9):
 * "FS commission waiting for a customer's account repayment (L0-4): ADD a
 * 'waiting for repayment' line to the Financial Services card, kept out of
 * profit until repaid."
 *
 * `getFinancialWaitingForRepaymentByCurrency` has TWO arms:
 *   - the STAMP arm (`t.profit_usd`/`t.profit_lbp`) — the whole story for a
 *     LEGACY (`commission_model = 0`) row.
 *   - the CASHLESS-ALLOCATION arm (PFU-h-1, verifier round-1 fix) — a
 *     NEW-MODEL (`commission_model = 1`) OMT/WHISH row's real writer
 *     (`FinancialServiceRepository.ts` ~:2158) always stamps `profit_usd`/
 *     `profit_lbp` = 0 on the FINANCIAL_SERVICE transaction itself; its real
 *     commission only exists once the shop SETTLES the batch with the
 *     supplier, as a `settlement_commission_allocations` row
 *     (`SupplierRepository.settleTransactions`). A CASHLESS settlement's
 *     allocation is itself deferred a second time
 *     ({@link allocationNotDebtPending}, D17) until the CLIENT repays the
 *     underlying transfer — this is the exact population this arm adds.
 *
 * Fixture realism (the bug this rewrite fixes in the test itself): the
 * ORIGINAL version of this file stamped `profitUsd: 5` directly on a
 * `commission_model = 1` FINANCIAL_SERVICE transaction — a shape the real
 * writer never produces (a model-1 row's own transaction always stamps 0;
 * see the doc comment above). That let the pre-fix, stamp-only
 * implementation pass the test by construction, without ever exercising the
 * cashless-allocation population the owner actually asked for. Every model-1
 * fixture below now stamps `profitUsd: 0` on the FINANCIAL_SERVICE
 * transaction (matching the real writer) and books its commission ONLY via
 * a `settlement_commission_allocations` row (matching
 * `SupplierRepository.settleTransactions`), using the SAME raw-SQL seed
 * helpers `ProfitRepository.cashlessSettlementDefersOnDebt.test.ts` already
 * established for this exact mechanism (driving the full
 * `FinancialServiceRepository`/`SupplierRepository` writer chain end-to-end
 * needs drawers/payment_methods/sessions/suppliers fixtures unrelated to the
 * SQL this test proves; the schema shape written here is byte-identical to
 * what those repositories actually persist to `financial_services`,
 * `transactions` and `settlement_commission_allocations`).
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import { SupplierRepository, resetSupplierRepository } from "../SupplierRepository";
import { initFixedTenantContext, resetTenantContext } from "../../db/tenantContext";

const TXN_DAY = "2026-07-01 10:00:00";
const SETTLE_DAY = "2026-07-05 09:00:00";
const FROM = "2026-07-01 00:00:00";
const TO = "2026-07-31 23:59:59";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, username TEXT NOT NULL);
    CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, full_name TEXT, phone_number TEXT);

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL, source_id INTEGER NOT NULL, user_id INTEGER, client_id INTEGER, client_name TEXT,
      client_phone TEXT, amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0, profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0, reverses_id INTEGER, created_at TEXT
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0, id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      provider TEXT, service_type TEXT, omt_service_type TEXT, amount REAL DEFAULT 0, currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0, commission_model INTEGER DEFAULT 0, omt_fee REAL, cost REAL DEFAULT 0,
      price REAL DEFAULT 0, is_settled INTEGER DEFAULT 0, is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0, settlement_id INTEGER, created_at TEXT, refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE settlement_commission_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, settlement_ledger_id INTEGER NOT NULL,
      financial_service_id INTEGER NOT NULL, service_type TEXT NOT NULL, provider TEXT NOT NULL,
      commission_usd REAL NOT NULL DEFAULT 0, commission_lbp REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Referenced by partnerCoverageRatio (PFT-6). Empty — every row is
    -- fully shop-owned (ratio 1.0).
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, partner_id INTEGER NOT NULL,
      transaction_type TEXT, reference_table TEXT, reference_id INTEGER, amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD', direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT, user_id INTEGER, settlement_method TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
    );

    -- Referenced by notDebtPending (DBT-1) — this file's whole point.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL, amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER, due_date TEXT, note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER, is_refunded INTEGER DEFAULT 0, session_id INTEGER, covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0, refunded_at TEXT DEFAULT NULL
    );
  `);
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (1, 1, 'Account Client', '71000000')`,
  ).run();
}

function seedFs(
  db: Database.Database,
  row: {
    provider: string;
    serviceType: string;
    amount: number;
    currency: "USD" | "LBP";
    commissionModel: number;
    isSettled: number;
    profitUsd: number;
    profitLbp: number;
    userId: number;
    clientId?: number | null;
    settlementId?: number | null;
    createdAt?: string;
  },
): { fsId: number; txnId: number } {
  const fs = db
    .prepare(
      `INSERT INTO financial_services
         (tenant_id, provider, service_type, amount, currency, commission,
          commission_model, cost, price, is_settled, settlement_id, is_refunded, created_at)
       VALUES (1, ?, ?, ?, ?, 0, ?, 0, 0, ?, ?, 0, ?)`,
    )
    .run(
      row.provider,
      row.serviceType,
      row.amount,
      row.currency,
      row.commissionModel,
      row.isSettled,
      row.settlementId ?? null,
      row.createdAt ?? TXN_DAY,
    );
  const fsId = Number(fs.lastInsertRowid);
  const txn = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, user_id, client_id,
          amount_usd, profit_usd, profit_lbp, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fsId,
      row.userId,
      row.clientId ?? null,
      row.amount,
      row.profitUsd,
      row.profitLbp,
      row.createdAt ?? TXN_DAY,
    );
  return { fsId, txnId: Number(txn.lastInsertRowid) };
}

/** Book a 'Service Debt' charge against the FS transaction, fully uncovered
 *  (matching `notDebtPending`'s own doc comment: CUSTOMER_ACCOUNT-charged,
 *  still owed) unless `coveredUsd` says otherwise. */
function bookServiceDebt(
  db: Database.Database,
  txnId: number,
  amountUsd: number,
  coveredUsd = 0,
): void {
  db.prepare(
    `INSERT INTO debt_ledger
       (tenant_id, client_id, transaction_type, amount_usd, amount_lbp,
        transaction_id, covered_usd, covered_lbp, is_refunded, created_at)
     VALUES (1, 1, 'Service Debt', ?, 0, ?, ?, 0, 0, ?)`,
  ).run(amountUsd, txnId, coveredUsd, TXN_DAY);
}

/** The SUPPLIER_SETTLEMENT transaction a real `settleTransactions` batch
 *  writes — model-1's own stamp is 0/0 here too (the real commission lives
 *  only in the allocation row below), matching
 *  `SupplierRepository.ts`'s own model-1 stamping. */
function seedSettlementTxn(db: Database.Database, settlementLedgerId: number): void {
  db.prepare(
    `INSERT INTO transactions
       (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
     VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', ?, 0, 0, ?)`,
  ).run(settlementLedgerId, SETTLE_DAY);
}

function seedAllocation(
  db: Database.Database,
  opts: {
    settlementLedgerId: number;
    financialServiceId: number;
    serviceType: string;
    provider: string;
    commissionUsd?: number;
    commissionLbp?: number;
  },
): void {
  db.prepare(
    `INSERT INTO settlement_commission_allocations
       (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, commission_lbp, created_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.settlementLedgerId,
    opts.financialServiceId,
    opts.serviceType,
    opts.provider,
    opts.commissionUsd ?? 0,
    opts.commissionLbp ?? 0,
    SETTLE_DAY,
  );
}

describe("ProfitRepository.getFinancialWaitingForRepaymentByCurrency (owner decision h) — STAMP arm", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);

    // (control) WHISH RECEIVE, model-1, unsettled, $2 stamp — NOT
    // debt-pending. Must appear in the SETTLED bucket, never in "waiting
    // for repayment".
    seedFs(db, {
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commissionModel: 1,
      isSettled: 0,
      profitUsd: 2,
      profitLbp: 0,
      userId: 1,
      clientId: null,
    });

    // (debt-pending, USD) OMT SEND, model-1, unsettled, $5 commission,
    // charged to the client's account and still fully owed.
    const omt = seedFs(db, {
      provider: "OMT",
      serviceType: "SEND",
      amount: 200,
      currency: "USD",
      commissionModel: 1,
      isSettled: 0,
      profitUsd: 5,
      profitLbp: 0,
      userId: 1,
      clientId: 1,
    });
    bookServiceDebt(db, omt.txnId, 200);

    // (debt-pending, LBP) WHISH_APP RECEIVE, model-1, unsettled, 30,000 LBP
    // commission, charged to the client's account and still fully owed.
    const whishApp = seedFs(db, {
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 3_000_000,
      currency: "LBP",
      commissionModel: 1,
      isSettled: 0,
      profitUsd: 0,
      profitLbp: 30_000,
      userId: 1,
      clientId: 1,
    });
    bookServiceDebt(db, whishApp.txnId, 30); // debt booked in USD-equivalent; presence alone is what notDebtPending checks

    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  it("returns ONLY the debt-pending rows, grouped by currency, never the non-debt-pending WHISH row", () => {
    const rows = runWithTenant(1, () =>
      repo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    const usd = rows.find((r) => r.currency === "USD");
    const lbp = rows.find((r) => r.currency === "LBP");

    expect(usd?.commission).toBe(5);
    expect(usd?.count).toBe(1);
    expect(lbp?.commission).toBe(30_000);
    expect(lbp?.count).toBe(1);

    // Exactly 2 currency groups — the non-debt-pending WHISH row ($2) never
    // contributes to either.
    expect(rows).toHaveLength(2);
  });

  it("getFinancialSettledByCurrency (the gross bucket) shows ONLY the non-debt-pending WHISH row — proves the two buckets partition the same population, not double-count it", () => {
    const rows = runWithTenant(1, () =>
      repo.getFinancialSettledByCurrency(FROM, TO),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe("USD");
    expect(rows[0].commission).toBe(2);
  });

  it("a fully-covered (repaid) debt no longer counts as waiting for repayment", () => {
    db.prepare(
      `UPDATE debt_ledger SET covered_usd = amount_usd WHERE transaction_type = 'Service Debt' AND amount_usd = 200`,
    ).run();

    const rows = runWithTenant(1, () =>
      repo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    const usd = rows.find((r) => r.currency === "USD");
    expect(usd).toBeUndefined();
  });

  // PFU-h-count-residual (verifier round 3) — a zero-commission model-1 row
  // (ratio > 0, but its OWN commission is 0 pre-settlement) must never
  // inflate `count`, even when the group's SUM(commission) is nonzero
  // because ANOTHER row in the same currency has a real stamp. The existing
  // beforeEach's `omt` row ($5, USD) already gives this currency group a
  // nonzero group-level sum; this test adds a SECOND, zero-commission,
  // debt-pending USD row alongside it — the exact case the group-level
  // HAVING (`SUM(commission) != 0`) cannot catch, because it only ever sees
  // the whole group's total, never each row's own contribution.
  it("a zero-commission model-1 row sharing a currency group with a real stamp does not inflate count", () => {
    const zeroStamp = seedFs(db, {
      provider: "OMT",
      serviceType: "SEND",
      amount: 50,
      currency: "USD",
      commissionModel: 1,
      isSettled: 0,
      profitUsd: 0,
      profitLbp: 0,
      userId: 1,
      clientId: 1,
    });
    bookServiceDebt(db, zeroStamp.txnId, 50);

    const rows = runWithTenant(1, () =>
      repo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    const usd = rows.find((r) => r.currency === "USD");

    // Commission is unaffected (the zero row contributes 0 either way) —
    // only `count` was wrong.
    expect(usd?.commission).toBe(5);
    // Only the ORIGINAL $5 row has a nonzero own commission; the new
    // zero-stamp row must not add to `count`.
    expect(usd?.count).toBe(1);
  });
});

describe("ProfitRepository.getFinancialWaitingForRepaymentByCurrency — CASHLESS-ALLOCATION arm (PFU-h-1)", () => {
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

  it("an OMT SEND fully on CUSTOMER_ACCOUNT (model-1, real writer's 0/0 stamp, commission booked only via a cashless settlement allocation) shows up as USD waiting-for-repayment, NOT as 0/0", () => {
    const settlementLedgerId = 9001;
    // Real writer shape: commission_model = 1, the FS transaction's OWN
    // stamp is 0/0 (FinancialServiceRepository.ts ~:2158) — the $5
    // commission only exists via the allocation below, written at
    // settlement (SupplierRepository.settleTransactions).
    const omt = seedFs(db, {
      provider: "OMT",
      serviceType: "SEND",
      amount: 200,
      currency: "USD",
      commissionModel: 1,
      isSettled: 1,
      profitUsd: 0,
      profitLbp: 0,
      userId: 1,
      clientId: 1,
      settlementId: settlementLedgerId,
    });
    // Charged to the client's account, still fully owed.
    bookServiceDebt(db, omt.txnId, 200, 0);
    seedSettlementTxn(db, settlementLedgerId);
    // A cashless batch: service_type 'SEND' (!= 'BILL') makes
    // cashlessCommissionBatch true.
    seedAllocation(db, {
      settlementLedgerId,
      financialServiceId: omt.fsId,
      serviceType: "SEND",
      provider: "OMT",
      commissionUsd: 5,
    });

    const rows = runWithTenant(1, () =>
      repo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    const usd = rows.find((r) => r.currency === "USD");
    expect(usd?.commission).toBe(5);
    // PFU-h-count (verifier round 2): exactly 1, not merely >= 1 — this row's
    // own FINANCIAL_SERVICE stamp is 0/0 (real writer shape), so the stamp
    // arm must NOT also contribute a zero-commission "ghost" row here; only
    // the cashless arm's one real allocation counts.
    expect(usd?.count).toBe(1);

    // Never counted in the settled (gross) bucket while debt-pending —
    // partition proof, mirroring the stamp arm's own sibling test.
    const settled = runWithTenant(1, () =>
      repo.getFinancialSettledByCurrency(FROM, TO),
    );
    expect(settled.find((r) => r.currency === "USD")?.commission ?? 0).toBe(
      0,
    );
  });

  it("the SAME cashless-allocation commission is realized (settled bucket), not waiting, once the client's debt is covered", () => {
    const settlementLedgerId = 9002;
    const whish = seedFs(db, {
      provider: "WHISH",
      serviceType: "SEND",
      amount: 150,
      currency: "USD",
      commissionModel: 1,
      isSettled: 1,
      profitUsd: 0,
      profitLbp: 0,
      userId: 1,
      clientId: 1,
      settlementId: settlementLedgerId,
    });
    bookServiceDebt(db, whish.txnId, 150, 0);
    seedSettlementTxn(db, settlementLedgerId);
    seedAllocation(db, {
      settlementLedgerId,
      financialServiceId: whish.fsId,
      serviceType: "SEND",
      provider: "WHISH",
      commissionUsd: 3.5,
    });

    let rows = runWithTenant(1, () =>
      repo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    expect(rows.find((r) => r.currency === "USD")?.commission).toBe(3.5);

    // Cover the debt.
    db.prepare(
      `UPDATE debt_ledger SET covered_usd = amount_usd WHERE transaction_id = ?`,
    ).run(whish.txnId);

    rows = runWithTenant(1, () =>
      repo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    expect(rows.find((r) => r.currency === "USD")).toBeUndefined();

    // getFinancialSettledByCurrency is OUT OF SCOPE for this fix (owner
    // decision h only asked for the waiting-for-repayment line) — it still
    // reads the STAMP only, which stays 0 for a model-1 row regardless of
    // debt status; the real commission is realized via
    // reattributedSettlementCommission (getByUser/getByClient), proven by
    // that fragment's own sibling tests. This assertion only pins that this
    // fix did not change THAT method's shape.
    const settled = runWithTenant(1, () =>
      repo.getFinancialSettledByCurrency(FROM, TO),
    );
    expect(settled.find((r) => r.currency === "USD")?.commission ?? 0).toBe(
      0,
    );
  });

  it("a BILLS-ONLY batch never contributes to waiting-for-repayment, even when its underlying charge is CUSTOMER_ACCOUNT and uncovered — bills-only is never client-debt-gated (D17)", () => {
    const settlementLedgerId = 9003;
    const katsh = seedFs(db, {
      provider: "Katsh",
      serviceType: "BILL",
      amount: 50,
      currency: "LBP",
      commissionModel: 1,
      isSettled: 1,
      profitUsd: 0,
      profitLbp: 20_000,
      userId: 1,
      clientId: 1,
      settlementId: settlementLedgerId,
    });
    bookServiceDebt(db, katsh.txnId, 50, 0);
    seedSettlementTxn(db, settlementLedgerId);
    seedAllocation(db, {
      settlementLedgerId,
      financialServiceId: katsh.fsId,
      serviceType: "BILL",
      provider: "Katsh",
      commissionLbp: 20_000,
    });

    const rows = runWithTenant(1, () =>
      repo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    // Katsh isn't even a COMMISSION_PROVIDERS member, so the stamp arm's own
    // `fs.provider IN (...)` gate already excludes it — this test's real
    // job is proving the CASHLESS arm doesn't independently sweep it in
    // regardless of provider.
    expect(rows.find((r) => r.currency === "LBP")).toBeUndefined();
  });
});

/**
 * PFU-h-test (verifier round 2) — the two describe blocks above hand-seed
 * `financial_services`/`transactions`/`settlement_commission_allocations`
 * rows directly with SQL. That proved the QUERY's own predicates in
 * isolation, but never exercised the writer-to-query SEAM that caused the
 * original 0/0 bug (PFU-h-1): a real `FinancialServiceRepository
 * .createTransaction` OMT SEND on CUSTOMER_ACCOUNT, settled for real via
 * `SupplierRepository.settleTransactions`, then repaid for real by covering
 * the `debt_ledger` row it created.
 *
 * Schema is the SAME full fixture `FinancialServiceRepository
 * .omtCommissionModelGate.test.ts` already proved drives a full OMT SEND +
 * `settleTransactions` round trip (commission_model/supplier_settlements/
 * settlement_commission_allocations, v150 shape), plus `debt_ledger` (this
 * file's own `notDebtPending`/`allocationNotDebtPending` target) and a
 * `clients` row for the CUSTOMER_ACCOUNT charge to land against. No
 * `jest.mock('../../db/connection')` needed — `getDatabase()` itself already
 * honors `globalThis.__LIRATEK_TEST_DB__` (same hook the two describe blocks
 * above use), so the real `FinancialServiceRepository`/`SupplierRepository`/
 * `ProfitRepository` instances all share the one in-memory db.
 */
describe("ProfitRepository.getFinancialWaitingForRepaymentByCurrency — REAL WRITER seam (PFU-h-test)", () => {
  let db: Database.Database;
  let profitRepo: ProfitRepository;
  let fsRepo: FinancialServiceRepository;
  let supplierRepo: SupplierRepository;

  beforeEach(() => {
    db = new Database(":memory:");
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
        receive_fee_model INTEGER NOT NULL DEFAULT 0,
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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        covered_amount REAL NOT NULL DEFAULT 0
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
      INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);

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

      -- Referenced by notDebtPending/allocationNotDebtPending — this
      -- describe block's whole point.
      CREATE TABLE debt_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, client_id INTEGER NOT NULL,
        transaction_type TEXT NOT NULL, amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0,
        transaction_id INTEGER, due_date TEXT, note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER, is_refunded INTEGER DEFAULT 0, session_id INTEGER, covered_usd REAL NOT NULL DEFAULT 0,
        covered_lbp REAL NOT NULL DEFAULT 0, refunded_at TEXT DEFAULT NULL
      );
    `);

    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      db;
    initFixedTenantContext(1);
    resetSupplierRepository();
    profitRepo = new ProfitRepository();
    fsRepo = new FinancialServiceRepository();
    supplierRepo = new SupplierRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    resetTenantContext();
    resetSupplierRepository();
    db.close();
  });

  it("createTransaction (OMT SEND on CUSTOMER_ACCOUNT) then settleTransactions books the commission as waiting (1), then covering the debt realizes it (waiting 0, commission_at_settlement 1)", () => {
    const supplierId = (
      db.prepare(`SELECT id FROM suppliers WHERE provider = 'OMT'`).get() as {
        id: number;
      }
    ).id;

    // Real writer: OMT SEND, $100 + $5 fee, $1 commission, funded entirely by
    // the client's account (no drawer moves — CASE 7,
    // OmtSystemFeeCharacterization.test.ts) — `bookClientDebtCharge` books
    // 'Service Debt' for real, not hand-seeded.
    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      paidByMethod: "CUSTOMER_ACCOUNT",
      clientName: "Waiting Test Client",
      phoneNumber: "71234567",
      includingFees: false,
      exchangeRate: 90000,
    });

    // Pin both rows' timestamps into the FROM/TO query window (the real
    // writer stamps `CURRENT_TIMESTAMP`, i.e. today — outside this file's
    // fixed 2026-07 window every other describe block in this file uses).
    db.prepare(
      `UPDATE financial_services SET created_at = ? WHERE id = ?`,
    ).run(TXN_DAY, fsId);
    db.prepare(
      `UPDATE transactions SET created_at = ? WHERE source_table = 'financial_services' AND source_id = ?`,
    ).run(TXN_DAY, fsId);

    // Born commission_model = 1 (Phase 2, D1) — is_settled unconditionally 0.
    const created = db
      .prepare(
        `SELECT commission_model, is_settled FROM financial_services WHERE id = ?`,
      )
      .get(fsId) as {
      commission_model: number;
      is_settled: number;
    };
    expect(created.commission_model).toBe(1);
    expect(created.is_settled).toBe(0);

    // The FINANCIAL_SERVICE transaction's own stamp (the stamp arm's source)
    // is 0/0 for a model-1 row (real writer never stamps commission on it
    // directly — see this file's own header).
    const txnStamp = db
      .prepare(
        `SELECT profit_usd, profit_lbp FROM transactions WHERE source_table = 'financial_services' AND source_id = ? AND type = 'FINANCIAL_SERVICE'`,
      )
      .get(fsId) as { profit_usd: number; profit_lbp: number };
    expect(txnStamp.profit_usd).toBe(0);

    // BEFORE settlement: the FINANCIAL_SERVICE transaction's own stamp is
    // 0/0 for a model-1 row (real writer never stamps commission on it) —
    // this fix's own point (PFU-h-count): a zero-commission model-1 row must
    // NOT appear in "waiting" (no "1 txns, $0" reading).
    let waiting = runWithTenant(1, () =>
      profitRepo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    expect(waiting.find((r) => r.currency === "USD")).toBeUndefined();

    // Settle exactly like the real UI: net pay = gross owed - entered
    // commission (mirrors FinancialServiceRepository.omtCommissionModelGate
    // .test.ts's own settleTransactions call).
    const fs = fsRepo.findById(fsId)!;
    const netPay = fs.supplier_owed - 1;
    supplierRepo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [fsId],
      amount_usd: netPay,
      amount_lbp: 0,
      commission_usd: 1,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: netPay }],
    });
    db.prepare(
      `UPDATE settlement_commission_allocations SET created_at = ? WHERE financial_service_id = ?`,
    ).run(SETTLE_DAY, fsId);

    // Debt still fully owed (client hasn't repaid) — the commission is now
    // booked (settlement_commission_allocations) but deferred a SECOND time
    // by allocationNotDebtPending: shows as waiting-for-repayment, exactly
    // ONE row (the fix: no stamp-arm double count from the zero-commission
    // row above).
    waiting = runWithTenant(1, () =>
      profitRepo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    const usdWaiting = waiting.find((r) => r.currency === "USD");
    expect(usdWaiting?.commission).toBeCloseTo(1, 6);
    expect(usdWaiting?.count).toBe(1);

    // Not yet realized on the settlement-commission card either.
    let supplierCommission = runWithTenant(1, () =>
      profitRepo.getSupplierCommissionTotals(FROM, TO),
    );
    expect(supplierCommission.cashless_profit_usd).toBeCloseTo(0, 6);

    // Cover the debt for real (the client repays).
    db.prepare(
      `UPDATE debt_ledger SET covered_usd = amount_usd WHERE transaction_type = 'Service Debt'`,
    ).run();

    // Waiting drops to 0 (empty)...
    waiting = runWithTenant(1, () =>
      profitRepo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    expect(waiting.find((r) => r.currency === "USD")).toBeUndefined();

    // ...and the commission is realized on the settlement-commission card
    // (`ProfitService.getSummary`'s `finSvc.commission_at_settlement_usd`
    // reads straight from this field).
    supplierCommission = runWithTenant(1, () =>
      profitRepo.getSupplierCommissionTotals(FROM, TO),
    );
    expect(supplierCommission.cashless_profit_usd).toBeCloseTo(1, 6);
  });

  /**
   * REV-5 (verifier round-1 fix, 2026-09-24, optional) — owner spec: "a
   * model-1 OMT row on CUSTOMER_ACCOUNT + a stamped on-account row +
   * settleTransactions; count 1 before settlement, 2 after". The "stamped"
   * row is NOT reachable through `fsRepo.createTransaction`: this file's own
   * header ("Fixture realism") establishes that every real OMT/WHISH writer
   * stamps `profit_usd = 0` on a `commission_model = 1` row, full stop — a
   * nonzero real-writer stamp on a model-1 row is not a shape this codebase
   * produces today. It IS, however, a shape the STAMP arm's own fixture
   * exercises directly (this file's "STAMP arm" describe block above seeds a
   * `commissionModel: 1, profitLbp: 30_000` WHISH_APP RECEIVE row) — the
   * reviewer's point stands that "stamped" and "model 0" are independent
   * axes, not the same thing. So the stamped row here is seeded the SAME way
   * (the module-level `seedFs`/`bookServiceDebt` helpers the STAMP arm uses,
   * which target the exact `financial_services`/`transactions`/`debt_ledger`
   * columns this describe block's OWN schema also defines), placed ALONGSIDE
   * a genuine real-writer cashless OMT SEND — proving the STAMP arm and the
   * CASHLESS-ALLOCATION arm's counts combine (1 -> 2) without either
   * double-counting the other or dropping one.
   */
  it("REV-5: a stamped model-1 row (count 1) plus a real-writer cashless OMT SEND settling in (count 2) — the STAMP arm and CASHLESS-ALLOCATION arm combine without double-counting", () => {
    const supplierId = (
      db.prepare(`SELECT id FROM suppliers WHERE provider = 'OMT'`).get() as {
        id: number;
      }
    ).id;

    // The "stamped on-account row" — seeded directly (see doc comment
    // above), not through the real writer, which cannot produce this shape.
    const stamped = seedFs(db, {
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 50,
      currency: "USD",
      commissionModel: 1,
      isSettled: 0,
      profitUsd: 3,
      profitLbp: 0,
      userId: 1,
      clientId: null,
    });
    bookServiceDebt(db, stamped.txnId, 50);

    // BEFORE any settlement: only the stamped row is debt-pending with a
    // nonzero stamp — count 1.
    let waiting = runWithTenant(1, () =>
      profitRepo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    let usdWaiting = waiting.find((r) => r.currency === "USD");
    expect(usdWaiting?.count).toBe(1);
    expect(usdWaiting?.commission).toBeCloseTo(3, 6);

    // The real-writer half — OMT SEND on CUSTOMER_ACCOUNT (model-1, defers
    // to settlement — 0/0 stamp, same as the file's main REAL WRITER test).
    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtFee: 5,
      paidByMethod: "CUSTOMER_ACCOUNT",
      clientName: "Waiting Test Client 2",
      phoneNumber: "71234568",
      includingFees: false,
      exchangeRate: 90000,
    });
    db.prepare(
      `UPDATE financial_services SET created_at = ? WHERE id = ?`,
    ).run(TXN_DAY, fsId);
    db.prepare(
      `UPDATE transactions SET created_at = ? WHERE source_table = 'financial_services' AND source_id = ?`,
    ).run(TXN_DAY, fsId);

    // Still count 1 — the OMT SEND's own transaction stamps 0/0 pre-settlement.
    waiting = runWithTenant(1, () =>
      profitRepo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    usdWaiting = waiting.find((r) => r.currency === "USD");
    expect(usdWaiting?.count).toBe(1);

    // Settle the cashless OMT SEND for real.
    const fs = fsRepo.findById(fsId)!;
    const netPay = fs.supplier_owed - 1;
    supplierRepo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [fsId],
      amount_usd: netPay,
      amount_lbp: 0,
      commission_usd: 1,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: netPay }],
    });
    db.prepare(
      `UPDATE settlement_commission_allocations SET created_at = ? WHERE financial_service_id = ?`,
    ).run(SETTLE_DAY, fsId);

    // AFTER settlement: the cashless-allocation arm now ALSO contributes —
    // count 2 (the stamped row + the newly-allocated cashless row), summed
    // commission 3 + 1 = 4.
    waiting = runWithTenant(1, () =>
      profitRepo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    usdWaiting = waiting.find((r) => r.currency === "USD");
    expect(usdWaiting?.count).toBe(2);
    expect(usdWaiting?.commission).toBeCloseTo(4, 6);
  });
});

// PFU-h-count-residual (verifier round 3) — the cashless arm's `count` was a
// SINGLE aggregate (`COUNT(DISTINCT fs WHERE ratio > 0)`, regardless of
// currency) added to BOTH the USD and LBP buckets whenever a batch produced
// commission in both currencies. Two DIFFERENT fs rows — one contributing to
// USD only, one to LBP only, matching how `SupplierRepository.
// settleTransactions`'s currency-filtered `allocateProportional` actually
// splits a batch (rule 14: same currency-filtering behaviour this file's own
// header describes) — must each count ONCE, in their OWN currency's bucket
// only, not once per currency the batch as a whole touched.
describe("ProfitRepository.getFinancialWaitingForRepaymentByCurrency — cashless arm counts per-currency, not per-batch (PFU-h-count-residual)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);

    // Row A: USD-denominated, debt-pending, settled — its allocation only
    // ever carries a USD commission share (commission_lbp = 0, matching
    // `lbpShareById`'s `?? 0` default for a row absent from the LBP weight
    // array).
    const rowA = seedFs(db, {
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commissionModel: 1,
      isSettled: 1,
      profitUsd: 0,
      profitLbp: 0,
      userId: 1,
      clientId: 1,
      settlementId: 501,
    });
    bookServiceDebt(db, rowA.txnId, 100);
    seedSettlementTxn(db, 501);
    seedAllocation(db, {
      settlementLedgerId: 501,
      financialServiceId: rowA.fsId,
      serviceType: "SEND",
      provider: "OMT",
      commissionUsd: 1,
      commissionLbp: 0,
    });

    // Row B: LBP-denominated, debt-pending, settled — its allocation only
    // ever carries an LBP commission share (commission_usd = 0), same
    // currency-filtered-split reasoning as Row A.
    const rowB = seedFs(db, {
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 1_000_000,
      currency: "LBP",
      commissionModel: 1,
      isSettled: 1,
      profitUsd: 0,
      profitLbp: 0,
      userId: 1,
      clientId: 1,
      settlementId: 502,
    });
    bookServiceDebt(db, rowB.txnId, 30); // USD-equivalent debt booking; presence alone is what notDebtPending checks
    seedSettlementTxn(db, 502);
    seedAllocation(db, {
      settlementLedgerId: 502,
      financialServiceId: rowB.fsId,
      serviceType: "RECEIVE",
      provider: "WHISH_APP",
      commissionUsd: 0,
      commissionLbp: 10_000,
    });

    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  it("counts Row A once in USD and Row B once in LBP — never both rows in both currencies", () => {
    const rows = runWithTenant(1, () =>
      repo.getFinancialWaitingForRepaymentByCurrency(FROM, TO),
    );
    const usd = rows.find((r) => r.currency === "USD");
    const lbp = rows.find((r) => r.currency === "LBP");

    expect(usd?.commission).toBeCloseTo(1, 6);
    expect(usd?.count).toBe(1);
    expect(lbp?.commission).toBeCloseTo(10_000, 6);
    expect(lbp?.count).toBe(1);
  });
});
