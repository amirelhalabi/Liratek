/**
 * LIRA-329 T033 — a supplier entry keeps what the cashier entered on its own
 * transaction: the supplier (by id), what kind of entry it is, the note in
 * full (it lived only on the supplier ledger and payments.note), a batch or
 * account settlement's commission rate and unit count (only on
 * `supplier_settlements`), a bundled discount as typed and its reason, and
 * how it was paid.
 *
 * Automatic sibling rows written through the same `addLedgerEntry` writer
 * (rule 26) carry no details: their parent transaction holds them.
 *
 * Money columns are asserted FIRST at today's values (FR-008). Expected
 * details go through the kind's own schema (rule 24). Rule 17: run before
 * the builder existed and seen failing.
 *
 * Real schema: create_db.sql + migrations.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SupplierRepository } from "../SupplierRepository";
import {
  buildDb,
  fundDrawer,
  omtAccount,
  resetAll,
  seedOmtSend,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";
import {
  paymentSnapshotSchema,
  supplierEntryDetailsSchema,
} from "../../validators/transactionDetails";
import { expectEverySnapshotMatchesPayments } from "../testHelpers/paymentSnapshotAssert";

const RATE = 89500;
const NOTE =
  "Paid Ali at their Hamra branch, he signed the paper receipt — copy in the blue folder";

interface TxnRow {
  id: number;
  type: string;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  metadata_json: string;
}

function txnById(db: Database.Database, id: number): TxnRow {
  return db
    .prepare(
      `SELECT id, type, amount_usd, amount_lbp, profit_usd, metadata_json
         FROM transactions WHERE id = ?`,
    )
    .get(id) as TxnRow;
}

function txnOfLedger(db: Database.Database, ledgerId: number): TxnRow {
  const { transaction_id } = db
    .prepare(`SELECT transaction_id FROM supplier_ledger WHERE id = ?`)
    .get(ledgerId) as { transaction_id: number };
  return txnById(db, transaction_id);
}

function latestOfType(db: Database.Database, type: string): TxnRow {
  const { id } = db
    .prepare(
      `SELECT id FROM transactions WHERE type = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(type) as { id: number };
  return txnById(db, id);
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

function expectDetails(row: TxnRow, expected: Record<string, unknown>): void {
  expect(supplierEntryDetailsSchema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

function expectSnapshot(row: TxnRow, expected: Record<string, unknown>): void {
  expect(paymentSnapshotSchema.parse(expected)).toEqual(expected);
  expect(meta(row).payment_snapshot).toEqual(expected);
}

const cashUsd = (amount: number, direction?: "OUT") => ({
  method: "CASH",
  currency_code: "USD",
  amount,
  ...(direction ? { direction } : {}),
});

describe("LIRA-329 — SupplierRepository: supplier_entry details", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let supplierId: number;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new SupplierRepository();
    for (const d of ["OMT_System", "General"]) {
      fundDrawer(db, d, "USD", 10000);
      fundDrawer(db, d, "LBP", 100_000_000);
    }
    db.prepare(
      `INSERT OR IGNORE INTO service_providers (tenant_id, code, label, drawer_name) VALUES (1, 'LIRA329PROV', 'Details Provider', 'General')`,
    ).run();
    supplierId = Number(
      db
        .prepare(
          `INSERT INTO suppliers (tenant_id, name, provider, is_active, is_system) VALUES (1, 'Charger Wholesale', 'LIRA329PROV', 1, 0)`,
        )
        .run().lastInsertRowid,
    );
  });

  // LIRA-329 T036 — every payment snapshot saved by a case above equals
  // the payments rows it booked (method, currency, amount, direction).
  afterEach(() => {
    expectEverySnapshotMatchesPayments(db);
  });

  afterEach(() => {
    resetTenantContext();
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("pay with change back and a discount: the note, the typed discount and the lines; the discount keeps its reason", () => {
    const ledgerId = repo.recordSupplierCashflow({
      supplier_id: supplierId,
      direction: "PAY",
      payments: [cashUsd(60), cashUsd(5, "OUT")],
      note: NOTE,
      discount: { amount_usd: 2, amount_lbp: 0, reason: "loyal customer" },
      exchange_rate: RATE,
      created_by: 1,
    }).id;
    const row = txnOfLedger(db, ledgerId);
    expect(row).toMatchObject({ type: "SUPPLIER_PAYMENT", amount_usd: 55 });
    expectDetails(row, {
      v: 1,
      kind: "supplier_entry",
      supplierId,
      action: "PAY",
      note: NOTE,
      discount: { amount: 2, currency: "USD" },
    });
    expectSnapshot(row, {
      lines: [
        { method: "CASH", currency: "USD", amount: 60, direction: "OUT" },
        { method: "CASH", currency: "USD", amount: 5, direction: "IN" },
      ],
      change_returned: [{ method: "CASH", currency: "USD", amount: 5 }],
    });

    const discount = latestOfType(db, "COUNTERPARTY_DISCOUNT");
    expect(discount).toMatchObject({ amount_usd: 0, profit_usd: 2 });
    expectDetails(discount, {
      v: 1,
      kind: "supplier_entry",
      supplierId,
      action: "DISCOUNT",
      note: "loyal customer",
    });
  });

  it("receive keeps the action and the note", () => {
    const ledgerId = repo.recordSupplierCashflow({
      supplier_id: supplierId,
      direction: "RECEIVE",
      payments: [cashUsd(25)],
      note: "refund for the broken cables",
      created_by: 1,
    }).id;
    const row = txnOfLedger(db, ledgerId);
    expect(row).toMatchObject({ type: "SUPPLIER_PAYMENT", amount_usd: 25 });
    expectDetails(row, {
      v: 1,
      kind: "supplier_entry",
      supplierId,
      action: "RECEIVE",
      note: "refund for the broken cables",
    });
  });

  it("a paper adjustment and a drawer payment keep their note; an automatic sibling carries none", () => {
    const adjId = repo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "ADJUSTMENT",
      amount_usd: 15,
      amount_lbp: 0,
      note: "price correction on invoice 4411",
      created_by: 1,
    }).id;
    const adj = txnOfLedger(db, adjId);
    expect(adj).toMatchObject({ type: "SUPPLIER_ADJUSTMENT", amount_usd: 15 });
    expectDetails(adj, {
      v: 1,
      kind: "supplier_entry",
      supplierId,
      action: "ADJUSTMENT",
      note: "price correction on invoice 4411",
    });

    const payId = repo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "PAYMENT",
      amount_usd: 10,
      amount_lbp: 0,
      drawer_name: "General",
      method: "CASH",
      note: "cash in hand to the driver",
      created_by: 1,
    }).id;
    const pay = txnOfLedger(db, payId);
    expect(pay).toMatchObject({ type: "SUPPLIER_PAYMENT", amount_usd: 10 });
    expectDetails(pay, {
      v: 1,
      kind: "supplier_entry",
      supplierId,
      action: "PAY",
      note: "cash in hand to the driver",
    });
    // LIRA-329 T036 — the drawer payment keeps its line (the flow's own leg:
    // IN in the snapshot, whatever way the drawer moved); the paper
    // adjustment moves no money and has none.
    expectSnapshot(pay, {
      lines: [
        { method: "CASH", currency: "USD", amount: 10, direction: "OUT" },
      ],
    });
    expect(meta(adj).payment_snapshot).toBeUndefined();

    const autoId = repo.addLedgerEntry({
      supplier_id: supplierId,
      entry_type: "TOP_UP",
      amount_usd: 30,
      amount_lbp: 0,
      note: "Auto: top-up for transfer #1",
      created_by: 1,
      is_auto: true,
      source_ref_table: "financial_services",
      source_ref_id: 1,
    }).id;
    const auto = txnOfLedger(db, autoId);
    expect(meta(auto).is_auto).toBe(true);
    expect(meta(auto).details).toBeUndefined();
  });

  it("a recorded debt keeps the typed note, never the default wording", () => {
    const typed = repo.recordDebt({
      supplier_id: supplierId,
      amount_usd: 40,
      amount_lbp: 0,
      note: "20 chargers, products to attach when the invoice arrives",
      created_by: 1,
    });
    expectDetails(txnById(db, typed.transactionId), {
      v: 1,
      kind: "supplier_entry",
      supplierId,
      action: "RECORDED_DEBT",
      note: "20 chargers, products to attach when the invoice arrives",
    });
    const untyped = repo.recordDebt({
      supplier_id: supplierId,
      amount_usd: 5,
      amount_lbp: 0,
      created_by: 1,
    });
    expectDetails(txnById(db, untyped.transactionId), {
      v: 1,
      kind: "supplier_entry",
      supplierId,
      action: "RECORDED_DEBT",
    });
  });

  it("a batch settlement keeps the note, the commission rate and the unit count, and the lines", () => {
    db.prepare(
      `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_by)
       VALUES (1, ?, 'TOP_UP', 100, 0, 1)`,
    ).run(supplierId);
    const fsId = Number(
      db
        .prepare(
          `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, commission, commission_model, is_settled)
           VALUES (1, 'LIRA329PROV', 'SEND', 100, 'USD', 0, 0, 0)`,
        )
        .run().lastInsertRowid,
    );
    const ledgerId = repo.settleTransactions({
      supplier_id: supplierId,
      financial_service_ids: [fsId],
      amount_usd: 100,
      amount_lbp: 0,
      commission_usd: 3,
      commission_lbp: 0,
      entry_mode: "RATE",
      commission_rate: 1.5,
      commission_unit_count: 2,
      payments: [cashUsd(100)],
      note: NOTE,
      exchange_rate: RATE,
      created_by: 1,
    }).id;
    const row = txnOfLedger(db, ledgerId);
    expect(row).toMatchObject({ type: "SUPPLIER_SETTLEMENT", amount_usd: 100 });
    expectDetails(row, {
      v: 1,
      kind: "supplier_entry",
      supplierId,
      action: "BATCH_SETTLE",
      note: NOTE,
      commissionRate: 1.5,
      unitCount: 2,
    });
    expectSnapshot(row, {
      lines: [
        { method: "CASH", currency: "USD", amount: 100, direction: "OUT" },
      ],
    });
  });

  describe("OMT account", () => {
    let acc: OmtAccount;
    let sendId: number;

    beforeEach(() => {
      acc = omtAccount(db);
      sendId = seedOmtSend(db, acc.omtId, { amount: 100 });
    });

    it("a selection settlement keeps the note and the lines", () => {
      const anchorId = repo.settleAccount({
        account_supplier_id: acc.omtId,
        direction: "PAY",
        selections: [{ kind: "FINANCIAL_SERVICE", id: sendId }],
        amount_usd: 100,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        payments: [cashUsd(100)],
        note: NOTE,
        created_by: 1,
      }).id;
      const row = txnOfLedger(db, anchorId);
      expect(row).toMatchObject({
        type: "SUPPLIER_SETTLEMENT",
        amount_usd: 100,
      });
      expectDetails(row, {
        v: 1,
        kind: "supplier_entry",
        supplierId: acc.omtId,
        action: "ACCOUNT_SETTLE",
        note: NOTE,
      });
      expectSnapshot(row, {
        lines: [
          { method: "CASH", currency: "USD", amount: 100, direction: "OUT" },
        ],
      });
    });

    it("an amount-first settlement keeps the typed note and the lines", () => {
      const anchorId = repo.settleAccount({
        account_supplier_id: acc.omtId,
        per_currency: { USD: { direction: "PAY", payments: [cashUsd(100)] } },
        expected_owed: { usd: 100, lbp: 0 },
        note: NOTE,
        created_by: 1,
      }).id;
      const row = txnOfLedger(db, anchorId);
      expect(row).toMatchObject({
        type: "SUPPLIER_SETTLEMENT",
        amount_usd: 100,
      });
      expectDetails(row, {
        v: 1,
        kind: "supplier_entry",
        supplierId: acc.omtId,
        action: "ACCOUNT_SETTLE",
        note: NOTE,
      });
      expectSnapshot(row, {
        lines: [
          { method: "CASH", currency: "USD", amount: 100, direction: "OUT" },
        ],
      });
    });
  });
});
