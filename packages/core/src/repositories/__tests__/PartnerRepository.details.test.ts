/**
 * LIRA-329 T034 — a partner entry keeps what the cashier entered on its own
 * transaction: the partner (by id), what kind of entry it is, the notes in
 * full (they lived only on the partner ledger), the type picked in the
 * Record Tx dropdown, a bundled discount as typed, and — bug #7, confirmed on
 * the test tenant — the discount / write-off REASON, which used to reach
 * only the partner statement and never the transaction.
 *
 * Driven through PartnerService (the reason travels service → repository).
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
import {
  PartnerRepository,
  resetPartnerRepository,
} from "../PartnerRepository";
import { PartnerService } from "../../services/PartnerService";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { buildDb, fundDrawer } from "../testHelpers/omtAccountDb";
import {
  partnerEntryDetailsSchema,
  paymentSnapshotSchema,
} from "../../validators/transactionDetails";
import { expectEverySnapshotMatchesPayments } from "../testHelpers/paymentSnapshotAssert";

const NOTES =
  "Settled at his shop in Dora; he paid part now and promised the rest after the holidays";

interface TxnRow {
  id: number;
  type: string;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  metadata_json: string;
}

function txnOfLedger(db: Database.Database, ledgerId: number): TxnRow {
  return db
    .prepare(
      `SELECT id, type, amount_usd, amount_lbp, profit_usd, metadata_json
         FROM transactions WHERE source_table = 'partner_ledger' AND source_id = ?`,
    )
    .get(ledgerId) as TxnRow;
}

function txnById(db: Database.Database, id: number): TxnRow {
  return db
    .prepare(
      `SELECT id, type, amount_usd, amount_lbp, profit_usd, metadata_json
         FROM transactions WHERE id = ?`,
    )
    .get(id) as TxnRow;
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

function expectDetails(row: TxnRow, expected: Record<string, unknown>): void {
  expect(partnerEntryDetailsSchema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

function expectSnapshot(row: TxnRow, expected: Record<string, unknown>): void {
  expect(paymentSnapshotSchema.parse(expected)).toEqual(expected);
  expect(meta(row).payment_snapshot).toEqual(expected);
}

describe("LIRA-329 — PartnerRepository: partner_entry details", () => {
  let db: Database.Database;
  let service: PartnerService;
  let partnerId: number;

  beforeEach(() => {
    resetPartnerRepository();
    resetTransactionRepository();
    resetPaymentMethodRepository();
    db = buildDb();
    initFixedTenantContext(1);
    fundDrawer(db, "General", "USD", 10000);
    fundDrawer(db, "General", "LBP", 100_000_000);
    service = new PartnerService(new PartnerRepository());
    partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name) VALUES (1, 'Dora Desk')`,
        )
        .run().lastInsertRowid,
    );
    // The partner owes the shop $100 (a paper entry).
    db.prepare(
      `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, amount, currency, direction)
       VALUES (1, ?, 'ADJUSTMENT', 100, 'USD', 'DEBIT')`,
    ).run(partnerId);
  });

  // LIRA-329 T036 — every payment snapshot saved by a case above equals
  // the payments rows it booked (method, currency, amount, direction).
  afterEach(() => {
    expectEverySnapshotMatchesPayments(db);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("a settlement keeps the notes, the typed discount and the lines; its discount keeps the reason (bug #7)", () => {
    const entry = service.settle({
      partnerId,
      amount: 60,
      currency: "USD",
      settlementMethod: "CASH",
      notes: NOTES,
      userId: 1,
      discount: { amount_usd: 4, amount_lbp: 0, reason: "late delivery" },
      payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
    });
    const row = txnOfLedger(db, entry.id);
    expect(row).toMatchObject({ type: "PARTNER_SETTLEMENT", amount_usd: 60 });
    expectDetails(row, {
      v: 1,
      kind: "partner_entry",
      partnerId,
      action: "SETTLE",
      note: NOTES,
      discount: { amount: 4, currency: "USD" },
    });
    expectSnapshot(row, {
      lines: [{ method: "CASH", currency: "USD", amount: 60, direction: "IN" }],
    });

    const discount = db
      .prepare(
        `SELECT t.id FROM transactions t
           JOIN partner_ledger pl ON pl.id = t.source_id AND t.source_table = 'partner_ledger'
          WHERE pl.transaction_type = 'DISCOUNT' AND pl.partner_id = ?`,
      )
      .get(partnerId) as { id: number };
    const discountRow = txnById(db, discount.id);
    expect(discountRow).toMatchObject({
      type: "COUNTERPARTY_DISCOUNT",
      amount_usd: 0,
      profit_usd: -4,
    });
    expectDetails(discountRow, {
      v: 1,
      kind: "partner_entry",
      partnerId,
      action: "WRITE_OFF",
      reason: "late delivery",
    });
  });

  it("a single-method settlement keeps its one line", () => {
    const entry = service.settle({
      partnerId,
      amount: 30,
      currency: "USD",
      settlementMethod: "CASH",
      userId: 1,
    });
    const row = txnOfLedger(db, entry.id);
    expectDetails(row, {
      v: 1,
      kind: "partner_entry",
      partnerId,
      action: "SETTLE",
    });
    expectSnapshot(row, {
      lines: [{ method: "CASH", currency: "USD", amount: 30, direction: "IN" }],
    });
  });

  it("a stand-alone write-off keeps its reason (bug #7)", () => {
    const result = service.writeOff({
      partnerId,
      amount_usd: 10,
      amount_lbp: 0,
      reason: "agreed at the end-of-month meeting",
      userId: 1,
    });
    expect(result.success).toBe(true);
    const row = txnById(db, result.id!);
    expect(row).toMatchObject({
      type: "COUNTERPARTY_DISCOUNT",
      amount_usd: 0,
      profit_usd: -10,
    });
    expectDetails(row, {
      v: 1,
      kind: "partner_entry",
      partnerId,
      action: "WRITE_OFF",
      reason: "agreed at the end-of-month meeting",
    });
  });

  it("a cash-moved payment keeps the type picked and the notes; a paper entry is an adjustment", () => {
    const paid = service.recordPartnerTransaction({
      partnerId,
      transactionType: "OMT_SEND",
      amount: 12,
      currency: "USD",
      direction: "CREDIT",
      notes: "he sent the OMT for us",
      userId: 1,
      moveCash: true,
    });
    const paidRow = txnOfLedger(db, paid.id);
    expect(paidRow).toMatchObject({ type: "PARTNER_PAYMENT", amount_usd: 12 });
    expectDetails(paidRow, {
      v: 1,
      kind: "partner_entry",
      partnerId,
      action: "PAYMENT",
      pickedType: "OMT_SEND",
      note: "he sent the OMT for us",
    });
    expectSnapshot(paidRow, {
      lines: [{ method: "CASH", currency: "USD", amount: 12, direction: "IN" }],
    });

    const paper = service.recordPartnerTransaction({
      partnerId,
      transactionType: "ADJUSTMENT",
      amount: 3,
      currency: "USD",
      direction: "DEBIT",
      notes: "rounding from last month",
      userId: 1,
    });
    const paperRow = txnOfLedger(db, paper.id);
    expect(paperRow).toMatchObject({
      type: "PARTNER_ADJUSTMENT",
      amount_usd: -3,
    });
    expectDetails(paperRow, {
      v: 1,
      kind: "partner_entry",
      partnerId,
      action: "ADJUSTMENT",
      pickedType: "ADJUSTMENT",
      note: "rounding from last month",
    });
    expect(meta(paperRow).payment_snapshot).toBeUndefined();
  });
});
