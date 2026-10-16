/**
 * LIRA-329 T002 — the transaction details contract (data-model.md).
 *
 * One full sample per kind. Each must parse AND come back unchanged: a field
 * the schema does not know would be stripped (zod's default), so "parses to
 * itself" proves every field listed in data-model.md exists in the schema
 * with the expected type.
 *
 * Rule 17: written against a stub module (`z.never()` schemas, empty kind
 * list) and seen failing before the real schemas were written.
 */
import {
  TRANSACTION_DETAILS_KINDS,
  paymentSnapshotSchema,
  transactionDetailsSchema,
} from "../transactionDetails";

const partner = { id: 3, name: "Abu Ali", mode: "THROUGH" };

/** Every kind in data-model.md, every field filled. */
const FULL_SAMPLES: Record<string, Record<string, unknown>> = {
  omt_whish_transfer: {
    v: 1,
    kind: "omt_whish_transfer",
    provider: "OMT",
    direction: "SEND",
    serviceType: "CASH_TO_BUSINESS",
    reference: "R-123",
    sender: { name: "Ali", phone: "70123456" },
    receiver: { name: "Sara", phone: "71987654" },
    omtFee: 5,
    whishFee: 2,
    includingFees: true,
    paymentMethodFee: { amount: 1, rate: 0.01 },
    brokerage: { payFee: true, supplierItemKey: "BINANCE_X", fee: 0.37 },
    partner,
    note: "urgent",
  },
  custom_service: {
    v: 1,
    kind: "custom_service",
    description: "Visa form",
    category: "Insurance",
    productId: 9,
    fulfillmentStatus: "ORDERED",
    direction: "OUT",
    cost: { usd: 97, lbp: 0 },
    price: { usd: 100, lbp: 0 },
    partner: { id: 4, name: "Syria Desk", mode: "VIA" },
    note: "pick up Friday",
  },
  hold_money: {
    v: 1,
    kind: "hold_money",
    action: "CREATE",
    notes: "for the rent",
  },
  telecom_recharge: {
    v: 1,
    kind: "telecom_recharge",
    carrier: "ALFA",
    type: "ALFA_GIFT",
    phone: "03123456",
    amount: 10,
    days: 30,
    carrierLineId: 2,
    defaultPrice: 12,
    typed: { costUsd: 4, priceUsd: 5 },
    giftTier: { key: "GIFT_10", label: "10 GB" },
    smsExpenseTxnId: 55,
  },
  telecom_buyback: {
    v: 1,
    kind: "telecom_buyback",
    carrier: "MTC",
    credits: 20,
    phone: "70111222",
    payoutMethod: "CASH",
    carrierLineId: 1,
  },
  catalog_sale: {
    v: 1,
    kind: "catalog_sale",
    provider: "Katsh",
    items: [
      {
        key: "ALFA_7",
        category: "alfa",
        label: "Alfa 7.58",
        quantity: 2,
        unitPrice: 8,
        onlyDays: true,
        returnedCreditsUsd: 1.5,
      },
    ],
    currencyMode: "USD",
    discount: { amount: 1, currency: "USD" },
  },
  provider_bill: {
    v: 1,
    kind: "provider_bill",
    provider: "iPick",
    amount: 500000,
    currency: "LBP",
  },
  wallet_transfer: {
    v: 1,
    kind: "wallet_transfer",
    provider: "WHISH_APP",
    direction: "RECEIVE",
    counterparty: { name: "Rami", phone: "76000111" },
    providerFee: 1,
    feePaidBy: "SEPARATELY",
    cashoutMethod: "CASH",
  },
  crypto_transfer: {
    v: 1,
    kind: "crypto_transfer",
    direction: "SEND",
    amountUsdt: 100,
    fee: 1,
    feePaidBy: "SENDER",
    walletOrReference: "TXYZ",
    cashoutMethod: "CASH",
  },
  wallet_topup: {
    v: 1,
    kind: "wallet_topup",
    provider: "WHISH_APP",
    source: "CLIENT",
    includingFees: false,
    fee: 0.5,
  },
  wrong_number: {
    v: 1,
    kind: "wrong_number",
    cardId: 1,
    itemId: 2,
    wrongNumber: "70000000",
    rightNumber: "70000001",
    saleTransactionId: 3,
  },
  pos_sale: {
    v: 1,
    kind: "pos_sale",
    items: [
      {
        productId: 1,
        name: "iPhone",
        quantity: 1,
        unitPrice: 900,
        unitCost: 800,
        imei: "356000000000000",
        unitId: 7,
        warrantyMonths: 12,
      },
    ],
    giftCardCodes: ["GC-1"],
    paymentCurrency: "USD",
  },
  maintenance_job: {
    v: 1,
    kind: "maintenance_job",
    jobId: 4,
    device: "Samsung A52",
    issue: "Screen cracked on the left side, touch not working",
    status: "Delivered",
    repairCost: { usd: 20, lbp: 0 },
    price: { usd: 50, lbp: 0 },
    warrantyMonths: 3,
    warrantyUntil: "2027-01-16",
    parts: [
      {
        productId: 3,
        name: "Screen",
        quantity: 1,
        unitPrice: 30,
        unitCost: 20,
      },
    ],
  },
  warranty_claim: {
    v: 1,
    kind: "warranty_claim",
    claimId: 5,
    action: "REPLACE",
    unitId: 7,
    replacementUnitId: 8,
    notes: "dead on arrival",
    overrideReason: "owner ok",
    saleItemId: 11,
  },
  exchange: {
    v: 1,
    kind: "exchange",
    from: "USD",
    to: "LBP",
    via: "EUR",
    amountIn: 100,
    amountOut: 8950000,
    legs: [
      { rate: 89500, marketRate: 89000, overridden: true, profitUsd: 0.5 },
    ],
    payoutRate: 89500,
  },
  loto_sale: {
    v: 1,
    kind: "loto_sale",
    saleAmount: 100000,
    commissionRate: 0.1,
    ticketNumber: "T-77",
  },
  loto_prize: {
    v: 1,
    kind: "loto_prize",
    ticketNumber: "T-77",
    prizeDate: "2026-10-15",
  },
  expense: {
    v: 1,
    kind: "expense",
    category: "Rent",
    description: "October rent, paid to the landlord's son",
    billAmount: { amount: 200, currency: "USD" },
    expenseDate: "2026-10-16",
    stockUse: { source: "iPick", itemId: 4, quantity: 1 },
  },
  account_entry: {
    v: 1,
    kind: "account_entry",
    action: "REPAYMENT",
    targets: [{ type: "debt", id: 12, amount: 10, currency: "USD" }],
    note: "paid half",
  },
  supplier_entry: {
    v: 1,
    kind: "supplier_entry",
    supplierId: 2,
    action: "BATCH_SETTLE",
    commissionRate: 0.02,
    unitCount: 14,
    note: "October batch",
  },
  partner_entry: {
    v: 1,
    kind: "partner_entry",
    partnerId: 3,
    action: "WRITE_OFF",
    pickedType: "CASH",
    reason: "goodwill",
  },
  session_sibling: {
    v: 1,
    kind: "session_sibling",
    sessionId: 8,
    role: "KEPT_CHANGE",
    paidByMethod: "WHISH",
  },
  reversal: {
    v: 1,
    kind: "reversal",
    originalTransactionId: 99,
    reason: "typo",
    refundUnits: [{ unitId: 7, flags: ["DEFECTIVE"] }],
  },
};

describe("LIRA-329 transactionDetailsSchema", () => {
  it("covers exactly the kinds listed in data-model.md", () => {
    expect([...TRANSACTION_DETAILS_KINDS].sort()).toEqual(
      Object.keys(FULL_SAMPLES).sort(),
    );
  });

  it.each(Object.entries(FULL_SAMPLES))(
    "%s: a full sample parses back unchanged (every field is in the schema)",
    (_kind, sample) => {
      const parsed = transactionDetailsSchema.safeParse(sample);
      expect(parsed.success).toBe(true);
      expect(parsed.success ? parsed.data : null).toEqual(sample);
    },
  );

  it("strips an unknown key instead of failing", () => {
    const parsed = transactionDetailsSchema.safeParse({
      ...FULL_SAMPLES.hold_money,
      somethingNew: "x",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data : null).toEqual(
      FULL_SAMPLES.hold_money,
    );
  });

  it("fails without kind, without v, or with another version", () => {
    const { kind: _k, ...noKind } = FULL_SAMPLES.hold_money;
    const { v: _v, ...noV } = FULL_SAMPLES.hold_money;
    expect(transactionDetailsSchema.safeParse(noKind).success).toBe(false);
    expect(transactionDetailsSchema.safeParse(noV).success).toBe(false);
    expect(
      transactionDetailsSchema.safeParse({ ...FULL_SAMPLES.hold_money, v: 2 })
        .success,
    ).toBe(false);
    expect(
      transactionDetailsSchema.safeParse({ v: 1, kind: "no_such_kind" })
        .success,
    ).toBe(false);
  });

  it("refuses an empty string (an empty field is omitted, never saved blank)", () => {
    expect(
      transactionDetailsSchema.safeParse({
        ...FULL_SAMPLES.omt_whish_transfer,
        reference: "",
      }).success,
    ).toBe(false);
  });

  it("requires the starred fields of a kind (provider + direction on a transfer)", () => {
    expect(
      transactionDetailsSchema.safeParse({ v: 1, kind: "omt_whish_transfer" })
        .success,
    ).toBe(false);
    expect(
      transactionDetailsSchema.safeParse({
        v: 1,
        kind: "omt_whish_transfer",
        provider: "OMT",
        direction: "SEND",
      }).success,
    ).toBe(true);
  });
});

describe("LIRA-329 paymentSnapshotSchema", () => {
  it("accepts IN and OUT lines, change returned, kept change and a session id", () => {
    const snapshot = {
      lines: [
        { method: "CASH", currency: "USD", amount: 50, direction: "IN" },
        { method: "CASH", currency: "LBP", amount: 900000, direction: "IN" },
        {
          method: "CASH",
          currency: "LBP",
          amount: 100000,
          direction: "OUT",
          note: "change",
        },
      ],
      change_returned: [{ method: "CASH", currency: "LBP", amount: 100000 }],
      kept: { usd: 0.25 },
      session_id: 4,
    };
    const parsed = paymentSnapshotSchema.safeParse(snapshot);
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data : null).toEqual(snapshot);
  });

  it("refuses a line without a direction", () => {
    expect(
      paymentSnapshotSchema.safeParse({
        lines: [{ method: "CASH", currency: "USD", amount: 5 }],
      }).success,
    ).toBe(false);
  });
});
