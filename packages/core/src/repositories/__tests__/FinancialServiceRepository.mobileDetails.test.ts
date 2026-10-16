/**
 * LIRA-329 T018 / T022 — Mobile Recharge sales booked as financial services
 * keep every field the cashier entered on their own transaction: Katsh /
 * iPick / Whish App catalog sales (`catalog_sale`), Katsh / iPick bills
 * (`provider_bill`), OMT App / Whish App transfers (`wallet_transfer`) and
 * Binance (`crypto_transfer`), including a For-Partner order unit and a
 * session-basket item.
 *
 * For each case: every field of the kind, the row's client name and phone,
 * and a `payment_snapshot` that matches the legs. The money columns are
 * asserted FIRST, at the values today's code produces (FR-008) — those
 * assertions passed on the pre-change run.
 *
 * Rule 24: expected details are run through the kind's own schema.
 * Rule 17: run before the builders existed and seen failing (details absent
 * / client name and phone empty); money assertions passed.
 *
 * Real schema: create_db.sql + migrations.
 */
import Database from "better-sqlite3";
import type { ZodTypeAny } from "zod";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  FinancialServiceRepository,
  resetFinancialServiceRepository,
  type CreateFinancialServiceData,
} from "../FinancialServiceRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { buildDb, fundDrawer, USER_ID } from "../testHelpers/omtAccountDb";
import {
  catalogSaleDetailsSchema,
  cryptoTransferDetailsSchema,
  providerBillDetailsSchema,
  walletTransferDetailsSchema,
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
  client_name: string | null;
  client_phone: string | null;
  metadata_json: string;
}

function txn(db: Database.Database, fsId: number): TxnRow {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp,
              client_name, client_phone, metadata_json
         FROM transactions
        WHERE source_table = 'financial_services' AND source_id = ?
          AND type = 'FINANCIAL_SERVICE'`,
    )
    .get(fsId) as TxnRow;
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

function expectDetails(
  row: TxnRow,
  schema: ZodTypeAny,
  expected: Record<string, unknown>,
): void {
  expect(schema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

describe("LIRA-329 — FinancialServiceRepository: Mobile Recharge details", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;

  beforeEach(() => {
    resetFinancialServiceRepository();
    resetTransactionRepository();
    resetSupplierRepository();
    resetPartnerRepository();
    db = buildDb();
    initFixedTenantContext(1);
    for (const d of [
      "General",
      "Katsh",
      "iPick",
      "Whish_App",
      "OMT_App",
      "Binance",
    ]) {
      fundDrawer(db, d, "USD", 10_000);
      fundDrawer(db, d, "LBP", 500_000_000);
    }
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
       VALUES (1, 'Binance', 'USDT', 10000)
       ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET balance = excluded.balance`,
    ).run();
    repo = new FinancialServiceRepository();
  });

  // LIRA-329 T036 — every payment snapshot saved by a case above equals
  // the payments rows it booked (method, currency, amount, direction). The
  // provider's own balance, commission and payment-method-fee rows are
  // bookkeeping, not lines the customer paid or received.
  afterEach(() => {
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

  it("Katsh cart: every item with key, category, label, quantity and price; discount as typed; client name + phone", () => {
    const row = create({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 2_050_000,
      cost: 1_980_000,
      currency: "LBP",
      commission: 70_000,
      paidByMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 2_050_000 }],
      checkoutTotal: { usd: 0, lbp: 2_050_000 },
      clientName: "Hassan Ali",
      phoneNumber: "76000111",
      note: "Alfa: $22 card (Prepaid), PUBG: 60 UC",
      catalogItems: [
        {
          key: "alfa-22",
          category: "Alfa",
          label: "$22 card",
          quantity: 1,
          unitPrice: 2_000_000,
        },
        {
          key: "pubg-60",
          category: "PUBG",
          label: "60 UC",
          quantity: 1,
          unitPrice: 100_000,
        },
      ],
      typedDiscount: { amount: 50_000, currency: "LBP" },
    });

    expect(row).toMatchObject({
      amount_usd: 0,
      amount_lbp: 2_050_000,
      profit_lbp: 70_000,
    });
    expectDetails(row, catalogSaleDetailsSchema, {
      v: 1,
      kind: "catalog_sale",
      provider: "Katsh",
      items: [
        {
          key: "alfa-22",
          category: "Alfa",
          label: "$22 card",
          quantity: 1,
          unitPrice: 2_000_000,
        },
        {
          key: "pubg-60",
          category: "PUBG",
          label: "60 UC",
          quantity: 1,
          unitPrice: 100_000,
        },
      ],
      currencyMode: "LBP",
      discount: { amount: 50_000, currency: "LBP" },
    });
    expect(row.client_name).toBe("Hassan Ali");
    expect(row.client_phone).toBe("76000111");
    expect(meta(row).payment_snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "LBP", amount: 2_050_000, direction: "IN" },
      ],
    });
  });

  it("Whish App catalog unit: the item key and category (no combined list sent)", () => {
    const row = create({
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 150_000,
      cost: 120_000,
      price: 150_000,
      currency: "LBP",
      commission: 30_000,
      paidByMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 150_000 }],
      itemKey: "anghami-1m",
      itemCategory: "Anghami",
      note: "Anghami: 1 Month",
    });

    expect(row).toMatchObject({ amount_lbp: 150_000, profit_lbp: 30_000 });
    expectDetails(row, catalogSaleDetailsSchema, {
      v: 1,
      kind: "catalog_sale",
      provider: "WHISH_APP",
      items: [
        {
          key: "anghami-1m",
          category: "Anghami",
          quantity: 1,
          unitPrice: 150_000,
        },
      ],
      currencyMode: "LBP",
    });
  });

  it("iPick bill: provider, amount and currency", () => {
    const row = create({
      provider: "iPick",
      serviceType: "BILL",
      amount: 500_000,
      cost: 500_000,
      price: 500_000,
      currency: "LBP",
      commission: 0,
      paidByMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 500_000 }],
    });

    expect(row).toMatchObject({ amount_lbp: 500_000, profit_lbp: 0 });
    expectDetails(row, providerBillDetailsSchema, {
      v: 1,
      kind: "provider_bill",
      provider: "iPick",
      amount: 500_000,
      currency: "LBP",
    });
    expect(meta(row).payment_snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "LBP", amount: 500_000, direction: "IN" },
      ],
    });
  });

  it("OMT App send: the customer, the OMT fee and who pays it", () => {
    const row = create({
      provider: "OMT_APP",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 2,
      omtFee: 2,
      includingFees: false,
      feePaidBy: "SENDER",
      clientName: "Lina Khoury",
      phoneNumber: "03111222",
      referenceNumber: "",
      note: "SEND transfer via OMT App",
      paidByMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 102 }],
      checkoutTotal: { usd: 102, lbp: 0 },
    });

    expect(row).toMatchObject({ amount_usd: 102, profit_usd: 2 });
    expectDetails(row, walletTransferDetailsSchema, {
      v: 1,
      kind: "wallet_transfer",
      provider: "OMT_APP",
      direction: "SEND",
      counterparty: { name: "Lina Khoury", phone: "03111222" },
      providerFee: 2,
      feePaidBy: "SENDER",
    });
    expect(row.client_name).toBe("Lina Khoury");
    expect(row.client_phone).toBe("03111222");
  });

  it("Whish App cash-out with the fee deducted: fee, who pays it, cash-out method", () => {
    const row = create({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      whishFee: 1,
      includingFees: true,
      feePaidBy: "DEDUCTED",
      cashoutMethod: "CASH",
      clientName: "Omar Said",
      phoneNumber: "70333444",
      note: "RECEIVE transfer via Whish App",
      paidByMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 99 }],
    });

    expect(row).toMatchObject({ amount_usd: 100, profit_usd: 1 });
    expectDetails(row, walletTransferDetailsSchema, {
      v: 1,
      kind: "wallet_transfer",
      provider: "WHISH_APP",
      direction: "RECEIVE",
      counterparty: { name: "Omar Said", phone: "70333444" },
      providerFee: 1,
      feePaidBy: "DEDUCTED",
      cashoutMethod: "CASH",
    });
    expect(row.client_name).toBe("Omar Said");
    expect(row.client_phone).toBe("70333444");
    expect(meta(row).payment_snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "USD", amount: 99, direction: "OUT" },
      ],
    });
  });

  it("Binance send: USDT amount, fee, who pays it, wallet / reference", () => {
    const row = create({
      provider: "BINANCE",
      serviceType: "SEND",
      amount: 50,
      currency: "USDT",
      commission: 1,
      feePaidBy: "SENDER",
      referenceNumber: "TRX-0x99",
      clientName: "Karim",
      paidByMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 51 }],
      checkoutTotal: { usd: 51, lbp: 0 },
      typedDiscount: { amount: 0.5, currency: "USD" },
    });

    expect(meta(row)).toMatchObject({ provider: "BINANCE", amount: 50 });
    expectDetails(row, cryptoTransferDetailsSchema, {
      v: 1,
      kind: "crypto_transfer",
      direction: "SEND",
      amountUsdt: 50,
      fee: 1,
      feePaidBy: "SENDER",
      walletOrReference: "TRX-0x99",
      discount: { amount: 0.5, currency: "USD" },
    });
    expect(row.client_name).toBe("Karim");
  });

  it("For-Partner order unit: the partner by id, name and mode; no payment lines", () => {
    const partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name, system_association) VALUES (1, 'Abu Ali', 'WHISH')`,
        )
        .run().lastInsertRowid,
    );
    const row = create({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 100_000,
      cost: 80_000,
      currency: "LBP",
      commission: 20_000,
      payments: [],
      partnerId,
      partnerMode: "FOR",
      itemKey: "pubg-60",
      itemCategory: "PUBG",
      note: "PUBG: 60 UC",
    });

    expect(row.client_name).toBe("Abu Ali [partner]");
    expect(meta(row).details).toMatchObject({
      kind: "catalog_sale",
      provider: "Katsh",
      partner: { id: partnerId, name: "Abu Ali", mode: "FOR" },
    });
    expect(meta(row).payment_snapshot).toBeUndefined();
  });

  // Shop-day fix: a single catalog unit (a basket unit, a Whish App grid
  // item, a partner order line) sends only its key and category — the item's
  // label is read back from the catalog key ("provider/category/sub/label").
  // Written before the fix and seen failing (no label on the item).
  it("a Katsh basket unit keeps the item's label from its catalog key", () => {
    const row = create({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 500_000,
      cost: 462_075,
      currency: "LBP",
      commission: 37_925,
      deferPayment: true,
      paid_in_session: 94,
      itemKey: "Katsh/alfa/Prepaid/4.5",
      itemCategory: "alfa",
      note: "alfa: 4.5 (Prepaid)",
    });

    expect(row).toMatchObject({ amount_lbp: 500_000, profit_lbp: 37_925 });
    expect(catalogSaleDetailsSchema.parse(meta(row).details).items).toEqual([
      {
        key: "Katsh/alfa/Prepaid/4.5",
        category: "alfa",
        label: "4.5",
        quantity: 1,
        unitPrice: 500_000,
      },
    ]);
  });

  it("a session-basket item says it was paid in that session", () => {
    const row = create({
      provider: "iPick",
      serviceType: "SEND",
      amount: 100_000,
      cost: 80_000,
      currency: "LBP",
      commission: 20_000,
      deferPayment: true,
      paid_in_session: 9,
      itemKey: "pubg-60",
      itemCategory: "PUBG",
      clientName: "Session Sam",
      note: "PUBG: 60 UC",
    });

    expect(row).toMatchObject({ amount_lbp: 100_000, profit_lbp: 20_000 });
    expect(meta(row).details).toMatchObject({
      kind: "catalog_sale",
      paid_in_session: 9,
    });
    expect(meta(row).payment_snapshot).toEqual({ lines: [], session_id: 9 });
    expect(row.client_name).toBe("Session Sam");
  });
});
