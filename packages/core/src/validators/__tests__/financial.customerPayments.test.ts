/**
 * LIRA-321 T033 — "Customer pays" lines on the financial-service write schema
 * (specs/321-customer-pays-in-side/contracts/write-payloads.md).
 *
 * `customerPayments` / `customer_waived_amount` / `feeCollectedSeparately`
 * are accepted only on a walk-in RECEIVE through WHISH_APP, OMT_APP or
 * BINANCE; never together with the old `feePayments`; never For-Partner.
 * OMT App RECEIVE still takes no fee at all (D1), so it refuses
 * `feeCollectedSeparately`. Field names come from the schema itself
 * (rule 24): a stripped key would make `parsed.data[key]` undefined.
 */
import {
  createFinancialServiceSchema,
  OMT_RECEIVE_NO_FEE_MESSAGE,
} from "../financial";

const LINES = [
  { method: "WHISH", currencyCode: "USD", amount: 100 },
  { method: "CASH", currencyCode: "USD", amount: 5 },
];

const WHISH_APP_RECEIVE = {
  provider: "WHISH_APP",
  serviceType: "RECEIVE",
  amount: 100,
  currency: "USD",
  commission: 5,
  whishFee: 5,
  includingFees: false,
  payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
  cashoutMethod: "CASH",
};

function parse(over: Record<string, unknown>) {
  return createFinancialServiceSchema.safeParse({
    ...WHISH_APP_RECEIVE,
    ...over,
  });
}

function messages(r: ReturnType<typeof parse>): string[] {
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe("createFinancialServiceSchema — customerPayments (LIRA-321)", () => {
  it("keeps customerPayments, customer_waived_amount and feeCollectedSeparately on a Whish App RECEIVE", () => {
    const r = parse({
      customerPayments: LINES,
      customer_waived_amount: 2,
      feeCollectedSeparately: true,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.customerPayments).toEqual(LINES);
    expect(r.data.customer_waived_amount).toBe(2);
    expect(r.data.feeCollectedSeparately).toBe(true);
  });

  it.each(["WHISH_APP", "BINANCE"])(
    "accepts customerPayments on a %s RECEIVE",
    (provider) => {
      expect(parse({ provider, customerPayments: LINES }).success).toBe(true);
    },
  );

  it("accepts customerPayments on an OMT App RECEIVE with no fee", () => {
    const r = parse({
      provider: "OMT_APP",
      commission: 0,
      whishFee: undefined,
      customerPayments: [{ method: "OMT", currencyCode: "USD", amount: 100 }],
    });
    expect(r.success).toBe(true);
  });

  it.each(["OMT", "WHISH", "iPick", "Katsh"])(
    "refuses customerPayments on %s",
    (provider) => {
      const r = parse({ provider, customerPayments: LINES });
      expect(r.success).toBe(false);
    },
  );

  it("refuses customerPayments on a SEND", () => {
    const r = parse({ serviceType: "SEND", customerPayments: LINES });
    expect(r.success).toBe(false);
  });

  it("refuses customerPayments together with feePayments", () => {
    const r = parse({
      customerPayments: LINES,
      feePayments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
    });
    expect(r.success).toBe(false);
    expect(messages(r).join(" | ")).toMatch(/customerPayments/);
  });

  it("refuses customerPayments For-Partner", () => {
    const r = parse({
      customerPayments: LINES,
      partnerId: 3,
      partnerMode: "FOR",
    });
    expect(r.success).toBe(false);
    expect(messages(r).join(" | ")).toMatch(/customerPayments/);
  });

  it("refuses customer_waived_amount without customerPayments", () => {
    expect(parse({ customer_waived_amount: 2 }).success).toBe(false);
  });

  it("refuses feeCollectedSeparately without customerPayments", () => {
    expect(parse({ feeCollectedSeparately: true }).success).toBe(false);
  });

  it("refuses feeCollectedSeparately with includingFees", () => {
    const r = parse({
      customerPayments: LINES,
      feeCollectedSeparately: true,
      includingFees: true,
    });
    expect(r.success).toBe(false);
    expect(messages(r).join(" | ")).toMatch(/includingFees/);
  });

  it("refuses feeCollectedSeparately on an OMT App RECEIVE (D1 — no fee)", () => {
    const r = parse({
      provider: "OMT_APP",
      commission: 0,
      whishFee: undefined,
      customerPayments: [{ method: "OMT", currencyCode: "USD", amount: 100 }],
      feeCollectedSeparately: true,
    });
    expect(r.success).toBe(false);
  });

  it("still refuses any fee on an OMT App RECEIVE with the D1 message", () => {
    const r = parse({
      provider: "OMT_APP",
      commission: 2,
      whishFee: undefined,
      customerPayments: [{ method: "OMT", currencyCode: "USD", amount: 100 }],
    });
    expect(r.success).toBe(false);
    expect(messages(r)[0]).toBe(OMT_RECEIVE_NO_FEE_MESSAGE);
  });

  it("a payload without customerPayments parses exactly as before (FR-018)", () => {
    const r = parse({});
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.customerPayments).toBeUndefined();
    expect(r.data.customer_waived_amount).toBeUndefined();
    expect(r.data.feeCollectedSeparately).toBeUndefined();
  });
});
