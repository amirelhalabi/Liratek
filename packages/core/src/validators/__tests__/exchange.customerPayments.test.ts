/**
 * LIRA-321 T016 — "Customer pays" on the Exchange write schemas.
 *
 * Both exchange schemas (`createExchangeSchema`, `exchangeSubmitSchema`)
 * carry the shared `customerPaymentsField` keys plus `clientId`, with three
 * refines:
 *  - `clientId` is required when any `customerPayments` line is
 *    CUSTOMER_ACCOUNT;
 *  - every line's `currencyCode` must equal `fromCurrency` (the section is
 *    locked to the currency the customer hands over);
 *  - refused together with `partnerMode === "FOR"` (a partner exchange takes
 *    no counter cash).
 * `payments` (the payout legs) is unchanged.
 *
 * Field names are taken from the schemas' own shapes (rule 24): the fixture
 * is parsed through the schema and the parsed output is what is asserted.
 */
import {
  createExchangeSchema,
  exchangeSubmitSchema,
} from "../exchange";

const BASE_CREATE = {
  fromCurrency: "LBP",
  toCurrency: "USD",
  amountIn: 89_500_000,
  amountOut: 1_000,
  rate: 89_500,
};

const BASE_SUBMIT = {
  fromCurrency: "LBP",
  toCurrency: "USD",
  amountIn: 89_500_000,
  amountOut: 1_000,
  leg1Rate: 89_500,
  leg1MarketRate: 89_500,
  leg1ProfitUsd: 0,
  totalProfitUsd: 0,
};

const SCHEMAS = [
  { name: "createExchangeSchema", schema: createExchangeSchema, base: BASE_CREATE },
  { name: "exchangeSubmitSchema", schema: exchangeSubmitSchema, base: BASE_SUBMIT },
] as const;

const PART_ON_ACCOUNT = [
  { method: "CASH", currencyCode: "LBP", amount: 87_600_000 },
  { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 1_900_000 },
];

describe.each(SCHEMAS)("$name — customer pays", ({ schema, base }) => {
  it("keeps customerPayments, customer_waived_amount and clientId (none stripped)", () => {
    const payload = {
      ...base,
      clientId: 7,
      customerPayments: PART_ON_ACCOUNT,
      customer_waived_amount: 0,
    };
    const r = schema.safeParse(payload);
    expect(r.success).toBe(true);
    if (!r.success) return;
    const out = r.data as Record<string, unknown>;
    expect(out.clientId).toBe(7);
    expect(out.customerPayments).toEqual(PART_ON_ACCOUNT);
    expect(out.customer_waived_amount).toBe(0);
  });

  it("requires clientId when a line is CUSTOMER_ACCOUNT", () => {
    const payload = { ...base, customerPayments: PART_ON_ACCOUNT };
    const r = schema.safeParse(payload);
    expect(r.success).toBe(false);
  });

  it("accepts lines with no account line and no client", () => {
    const payload = {
      ...base,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 89_500_000 },
      ],
    };
    expect(schema.safeParse(payload).success).toBe(true);
  });

  it("refuses a line whose currency is not fromCurrency", () => {
    const payload = {
      ...base,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 80_000_000 },
        { method: "CASH", currencyCode: "USD", amount: 106 },
      ],
    };
    expect(schema.safeParse(payload).success).toBe(false);
  });

  it("refuses customerPayments with partnerMode FOR", () => {
    const payload = {
      ...base,
      partnerId: 3,
      partnerMode: "FOR" as const,
      customerPayments: [
        { method: "CASH", currencyCode: "LBP", amount: 89_500_000 },
      ],
    };
    expect(schema.safeParse(payload).success).toBe(false);
  });

  it("partnerMode FOR without customerPayments is still accepted", () => {
    const payload = { ...base, partnerId: 3, partnerMode: "FOR" as const };
    expect(schema.safeParse(payload).success).toBe(true);
  });

  it("payout legs (`payments`) are unchanged", () => {
    const payments = [
      { method: "CASH", currencyCode: "USD", amount: 1_000 },
    ];
    const r = schema.safeParse({ ...base, payments });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as { payments?: unknown }).payments).toEqual(payments);
    }
  });

  it("a payload without the new keys parses exactly as before", () => {
    const r = schema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      const out = r.data as Record<string, unknown>;
      expect(out.customerPayments).toBeUndefined();
      expect(out.clientId).toBeUndefined();
    }
  });
});

/**
 * LIRA-321 follow-up (owner decision 2026-10-14): owing or forgiving is
 * blocked when the customer pays in a currency other than USD/LBP. The lot
 * code records the full amountIn as bought while the drawer only got what
 * was paid, so a later sale would oversell. All-cash EUR stays allowed.
 */
const EUR_CREATE = {
  fromCurrency: "EUR",
  toCurrency: "USD",
  amountIn: 100,
  amountOut: 116.12,
  rate: 1.1612,
};
const EUR_SUBMIT = {
  fromCurrency: "EUR",
  toCurrency: "USD",
  amountIn: 100,
  amountOut: 116.12,
  leg1Rate: 1.1612,
  leg1MarketRate: 1.18,
  leg1ProfitUsd: 1.88,
  totalProfitUsd: 1.88,
};
const EUR_SCHEMAS = [
  { name: "createExchangeSchema", schema: createExchangeSchema, base: EUR_CREATE },
  { name: "exchangeSubmitSchema", schema: exchangeSubmitSchema, base: EUR_SUBMIT },
] as const;
const BLOCKED = /Owing or forgiving isn't available yet when the customer pays in EUR/;

describe.each(EUR_SCHEMAS)("$name — EUR owing/forgive blocked (2026-10-14)", ({ schema, base }) => {
  const messages = (r: ReturnType<typeof schema.safeParse>) =>
    r.success ? [] : r.error.issues.map((i) => i.message);

  it("refuses a CUSTOMER_ACCOUNT line even with a client", () => {
    const r = schema.safeParse({
      ...base,
      clientId: 7,
      customerPayments: [
        { method: "CASH", currencyCode: "EUR", amount: 95 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 5 },
      ],
    });
    expect(r.success).toBe(false);
    expect(messages(r).some((m) => BLOCKED.test(m))).toBe(true);
  });

  it("refuses a forgiven amount", () => {
    const r = schema.safeParse({
      ...base,
      customerPayments: [{ method: "CASH", currencyCode: "EUR", amount: 99 }],
      customer_waived_amount: 1,
    });
    expect(r.success).toBe(false);
    expect(messages(r).some((m) => BLOCKED.test(m))).toBe(true);
  });

  it("still accepts an all-cash EUR payment (positive control)", () => {
    const r = schema.safeParse({
      ...base,
      customerPayments: [{ method: "CASH", currencyCode: "EUR", amount: 100 }],
    });
    expect(r.success).toBe(true);
  });
});
