/**
 * LIRA-329 T010 — an OMT / Whish system transfer from the Services page keeps
 * every field the cashier entered on its own transaction (User Story 1).
 *
 * For each case: every `omt_whish_transfer` field, the row's client name and
 * phone, and a `payment_snapshot` that matches the customer-facing payment
 * rows actually inserted (read back through `getRecent`, which applies the
 * shared customer-leg rule). The money columns are asserted at the values
 * today's code produces (FR-008) — those assertions passed on the pre-change
 * run, which is what proves the details change does not move money.
 *
 * Rule 24: expected details are run through the kind's own schema
 * (`expectDetails`), so a field name the schema does not have fails the
 * test instead of encoding a typo.
 *
 * Rule 17: run before `buildOmtWhishTransferDetails` existed and seen failing
 * (details / client phone / snapshot assertions); money assertions passed.
 *
 * Real schema: create_db.sql + migrations.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  FinancialServiceRepository,
  resetFinancialServiceRepository,
  type CreateFinancialServiceData,
} from "../FinancialServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { buildDb, fundDrawer, USER_ID } from "../testHelpers/omtAccountDb";
import {
  omtWhishTransferDetailsSchema,
  paymentSnapshotSchema,
} from "../../validators/transactionDetails";
import {
  expectEverySnapshotMatchesPayments,
  isProviderBookkeepingRow,
} from "../testHelpers/paymentSnapshotAssert";

interface TxnRow {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  client_id: number | null;
  client_name: string | null;
  client_phone: string | null;
  summary: string;
  metadata_json: string;
}

function txn(db: Database.Database, fsId: number): TxnRow {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id,
              client_name, client_phone, summary, metadata_json
         FROM transactions
        WHERE source_table = 'financial_services' AND source_id = ?
          AND type = 'FINANCIAL_SERVICE'`,
    )
    .get(fsId) as TxnRow;
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

/** Rule 24: the expected object must survive its own schema unchanged. */
function expectDetails(row: TxnRow, expected: Record<string, unknown>): void {
  expect(omtWhishTransferDetailsSchema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

/** The snapshot's lines equal the customer-facing payment rows inserted. */
function expectSnapshotMatchesPayments(row: TxnRow): void {
  const snapshot = paymentSnapshotSchema.parse(meta(row).payment_snapshot);
  const listed = getTransactionRepository()
    .getRecent(200)
    .find((t) => t.id === row.id);
  const legs = (
    (
      listed as unknown as {
        payments?: Array<{
          direction: "in" | "out";
          amount: number;
          currency_code: string;
          method: string;
        }>;
      }
    ).payments ?? []
  ).map((l) => ({
    method: l.method,
    currency: l.currency_code,
    amount: l.amount,
  }));
  for (const line of snapshot.lines) {
    expect(legs).toContainEqual({
      method: line.method,
      currency: line.currency,
      amount: line.amount,
    });
  }
}

describe("LIRA-329 — FinancialServiceRepository: OMT/Whish system transfer details", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;

  beforeEach(() => {
    resetFinancialServiceRepository();
    resetTransactionRepository();
    resetSupplierRepository();
    db = buildDb();
    initFixedTenantContext(1);
    for (const d of ["General", "OMT_System", "Whish_System", "Whish_App"]) {
      fundDrawer(db, d, "USD", 10000);
      fundDrawer(db, d, "LBP", 100_000_000);
    }
    repo = new FinancialServiceRepository();
  });

  // LIRA-329 T036 — every payment snapshot saved by a case above equals
  // the payments rows it booked (method, currency, amount, direction).
  afterEach(() => {
    // The provider's own balance, commission and payment-method-fee rows are
    // bookkeeping, not lines the customer paid or received.
    expectEverySnapshotMatchesPayments(db, {
      excludeRow: isProviderBookkeepingRow,
    });
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function create(data: CreateFinancialServiceData): TxnRow {
    const { id } = repo.createTransaction({ userId: USER_ID, ...data });
    return txn(db, id);
  }

  it("OMT send, every Services-page field: details, client name+phone, snapshot", () => {
    const row = create({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtServiceType: "CASH_TO_BUSINESS",
      omtFee: 5,
      includingFees: false,
      referenceNumber: "R-123",
      clientName: "Ali Saad",
      phoneNumber: "70123456",
      senderName: "Ali Saad",
      senderPhone: "70123456",
      receiverName: "Sara Khoury",
      receiverPhone: "71987654",
      note: "urgent, call before",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
    });

    // FR-008 — today's money for this input, asserted FIRST so the
    // pre-change run proved these values (unchanged by the details).
    expect(row).toMatchObject({
      amount_usd: 105,
      amount_lbp: 0,
      profit_usd: 0,
      profit_lbp: 0,
    });
    // Existing metadata keys are untouched.
    expect(meta(row)).toMatchObject({
      provider: "OMT",
      service_type: "SEND",
      amount: 100,
      currency: "USD",
    });

    expectDetails(row, {
      v: 1,
      kind: "omt_whish_transfer",
      provider: "OMT",
      direction: "SEND",
      serviceType: "CASH_TO_BUSINESS",
      reference: "R-123",
      sender: { name: "Ali Saad", phone: "70123456" },
      receiver: { name: "Sara Khoury", phone: "71987654" },
      omtFee: 5,
      includingFees: false,
      note: "urgent, call before",
    });
    expect(row.client_name).toBe("Ali Saad");
    expect(row.client_phone).toBe("70123456");
    expect(meta(row).payment_snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "USD", amount: 105, direction: "IN" },
      ],
    });
    expectSnapshotMatchesPayments(row);
  });

  it("Whish receive with a Whish fee and 'including fees' ticked keeps the fee and the choice", () => {
    db.prepare(
      `UPDATE system_settings SET value = 'WHISH' WHERE key_name = 'shop_base_system' AND tenant_id = 1`,
    ).run();
    const row = create({
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 200,
      currency: "USD",
      commission: 0,
      whishFee: 3,
      includingFees: true,
      referenceNumber: "W-77",
      clientName: "Maya Aoun",
      phoneNumber: "76555444",
      senderName: "Karim Aoun",
      senderPhone: "0033612345678",
      receiverName: "Maya Aoun",
      receiverPhone: "76555444",
      cashoutMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 197 }],
    });

    // FR-008 — today's money (asserted first; passed on the pre-change run).
    expect(row).toMatchObject({ amount_usd: 200, profit_usd: 3 });
    expectDetails(row, {
      v: 1,
      kind: "omt_whish_transfer",
      provider: "WHISH",
      direction: "RECEIVE",
      reference: "W-77",
      sender: { name: "Karim Aoun", phone: "0033612345678" },
      receiver: { name: "Maya Aoun", phone: "76555444" },
      whishFee: 3,
      includingFees: true,
    });
    expect(row.client_name).toBe("Maya Aoun");
    expect(row.client_phone).toBe("76555444");
    expectSnapshotMatchesPayments(row);
  });

  it("a transfer through a partner identifies the partner by id, name and mode", () => {
    const partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name, system_association) VALUES (1, 'Abu Ali', 'WHISH')`,
        )
        .run().lastInsertRowid,
    );
    const row = create({
      provider: "WHISH",
      serviceType: "SEND",
      amount: 50,
      currency: "USD",
      commission: 0,
      whishFee: 1,
      includingFees: false,
      senderName: "Hadi",
      senderPhone: "70999000",
      receiverName: "Lina",
      clientName: "Hadi",
      phoneNumber: "70999000",
      partnerId,
      partnerMode: "THROUGH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 51 }],
    });
    expectDetails(row, {
      v: 1,
      kind: "omt_whish_transfer",
      provider: "WHISH",
      direction: "SEND",
      sender: { name: "Hadi", phone: "70999000" },
      receiver: { name: "Lina" },
      whishFee: 1,
      includingFees: false,
      partner: { id: partnerId, name: "Abu Ali", mode: "THROUGH" },
    });
    expect(row.client_phone).toBe("70999000");
  });

  it("a For-Partner send keeps the partner label, adds no walk-in phone and no snapshot", () => {
    const partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name) VALUES (1, 'Office B')`,
        )
        .run().lastInsertRowid,
    );
    const row = create({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtServiceType: "INTRA",
      omtFee: 4,
      includingFees: false,
      senderName: "Walk In",
      senderPhone: "03111222",
      clientName: "Walk In",
      phoneNumber: "03111222",
      partnerId,
      partnerMode: "FOR",
      payments: [],
      paymentMethodFee: 0,
    });
    expectDetails(row, {
      v: 1,
      kind: "omt_whish_transfer",
      provider: "OMT",
      direction: "SEND",
      serviceType: "INTRA",
      sender: { name: "Walk In", phone: "03111222" },
      omtFee: 4,
      includingFees: false,
      partner: { id: partnerId, name: "Office B", mode: "FOR" },
    });
    expect(row.client_name).toBe("Office B [partner]");
    expect(row.client_phone).toBeNull();
    expect(meta(row).payment_snapshot).toBeUndefined();
  });

  it("a non-cash payment keeps the payment-method fee and its rate", () => {
    const row = create({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtServiceType: "INTRA",
      omtFee: 5,
      includingFees: false,
      senderName: "Nour",
      clientName: "Nour",
      paymentMethodFee: 1,
      paymentMethodFeeRate: 0.01,
      payments: [{ method: "WHISH", currencyCode: "USD", amount: 106 }],
    });
    expectDetails(row, {
      v: 1,
      kind: "omt_whish_transfer",
      provider: "OMT",
      direction: "SEND",
      serviceType: "INTRA",
      sender: { name: "Nour" },
      omtFee: 5,
      includingFees: false,
      paymentMethodFee: { amount: 1, rate: 0.01 },
    });
    expectSnapshotMatchesPayments(row);
  });

  it("Online Brokerage keeps the charge-the-fee choice, the supplier and the fee", () => {
    const row = create({
      provider: "OMT",
      serviceType: "SEND",
      amount: 37,
      currency: "USD",
      commission: 0,
      omtServiceType: "ONLINE_BROKERAGE",
      omtFee: 0.37,
      payFee: true,
      itemKey: "BINANCE",
      includingFees: false,
      senderName: "Tarek",
      clientName: "Tarek",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 37.37 }],
    });
    expectDetails(row, {
      v: 1,
      kind: "omt_whish_transfer",
      provider: "OMT",
      direction: "SEND",
      serviceType: "ONLINE_BROKERAGE",
      sender: { name: "Tarek" },
      omtFee: 0.37,
      includingFees: false,
      brokerage: { payFee: true, supplierItemKey: "BINANCE", fee: 0.37 },
    });
  });

  it("the page's placeholder note ('<provider> - <type>') is not saved as a note", () => {
    const row = create({
      provider: "OMT",
      serviceType: "SEND",
      amount: 10,
      currency: "USD",
      commission: 0,
      omtServiceType: "INTRA",
      omtFee: 1,
      senderName: "Ziad",
      clientName: "Ziad",
      note: "OMT - SEND",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 11 }],
    });
    expect((meta(row).details as Record<string, unknown>).note).toBeUndefined();
  });

  it("a session-basket item gets the same details but no payment snapshot (the basket owns the money)", () => {
    const row = create({
      provider: "OMT",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0,
      omtServiceType: "INTRA",
      omtFee: 1,
      senderName: "Basket Guy",
      clientName: "Basket Guy",
      deferPayment: true,
    });
    expect((meta(row).details as Record<string, unknown>).kind).toBe(
      "omt_whish_transfer",
    );
    expect(meta(row).payment_snapshot).toBeUndefined();
  });

  // Phase 3 asserted "no details yet" here; phase 4 (LIRA-329 T018) gives
  // the wallet apps their own kind — covered in full by
  // FinancialServiceRepository.mobileDetails.test.ts. What stays true: a
  // wallet-app transfer is never mistaken for an OMT/Whish system transfer.
  it("a wallet-app transfer gets its own kind, not omt_whish_transfer (phase 4)", () => {
    const row = create({
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 1,
      clientName: "App User",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 21 }],
    });
    expect((meta(row).details as Record<string, unknown>).kind).toBe(
      "wallet_transfer",
    );
  });
});
