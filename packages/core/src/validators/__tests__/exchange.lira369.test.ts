/**
 * LIRA-369 — the exchange schemas accept the customer's account on both sides
 * for every currency, an EUR (or other) payout in its own cash, and the typed
 * "1 <currency> = X USD" rates for amounts put on the account. Both schemas
 * (IPC and REST share them) apply the same rules (rule 14).
 */
import { describe, it, expect } from "@jest/globals";
import { createExchangeSchema, exchangeSubmitSchema } from "../exchange.js";

const SUBMIT_BASE = {
  fromCurrency: "USD",
  toCurrency: "EUR",
  amountIn: 110,
  amountOut: 100,
  leg1Rate: 1.1,
  leg1MarketRate: 1.18,
  leg1ProfitUsd: 5,
  totalProfitUsd: 5,
};
const CREATE_BASE = {
  fromCurrency: "USD",
  toCurrency: "EUR",
  amountIn: 110,
  amountOut: 100,
  rate: 1.1,
};

const SCHEMAS = [
  { name: "createExchangeSchema", schema: createExchangeSchema, base: CREATE_BASE },
  { name: "exchangeSubmitSchema", schema: exchangeSubmitSchema, base: SUBMIT_BASE },
] as const;

const messages = (r: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
  r.success ? [] : (r.error?.issues ?? []).map((i) => i.message);

describe.each(SCHEMAS)("$name — LIRA-369", ({ schema, base }) => {
  it("keeps both account-rate keys (none stripped)", () => {
    const r = schema.safeParse({
      ...base,
      fromCurrency: "EUR",
      toCurrency: "GBP",
      clientId: 1,
      customerPayments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 110 },
      ],
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "GBP", amount: 100 },
      ],
      customer_account_usd_rate: 1.18,
      payout_account_usd_rate: 1.3,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.customer_account_usd_rate).toBe(1.18);
      expect(r.data.payout_account_usd_rate).toBe(1.3);
    }
  });

  it("accepts an EUR payout in EUR cash", () => {
    const r = schema.safeParse({
      ...base,
      payments: [{ method: "CASH", currencyCode: "EUR", amount: 100 }],
    });
    expect(r.success).toBe(true);
  });

  it("refuses an EUR payout line in USD", () => {
    const r = schema.safeParse({
      ...base,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 110 }],
    });
    expect(messages(r).join(" ")).toMatch(/pays in EUR only/);
  });

  it("refuses an EUR payout by a wallet method", () => {
    const r = schema.safeParse({
      ...base,
      payments: [{ method: "OMT", currencyCode: "EUR", amount: 100 }],
    });
    expect(messages(r).join(" ")).toMatch(/cash or to the customer's account/);
  });

  it.each([
    ["kept_change_usd", 1],
    ["rounding_given_usd", 1],
    ["added_change_usd", 1],
    ["tender_exchange_rate", 89_500],
  ])("refuses %s on an EUR payout", (key, value) => {
    const r = schema.safeParse({
      ...base,
      payments: [{ method: "CASH", currencyCode: "EUR", amount: 100 }],
      [key]: value,
    });
    expect(r.success).toBe(false);
  });

  it("refuses a payout to the account without a client", () => {
    const r = schema.safeParse({
      ...base,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 100 },
      ],
      payout_account_usd_rate: 1.1,
    });
    expect(messages(r).join(" ")).toMatch(/client/i);
  });

  it("requires payout_account_usd_rate for EUR put on the account", () => {
    const r = schema.safeParse({
      ...base,
      clientId: 1,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 100 },
      ],
    });
    expect(messages(r).join(" ")).toMatch(/EUR → USD rate/);
  });

  it("refuses payout_account_usd_rate when nothing in EUR goes on the account", () => {
    const r = schema.safeParse({
      ...base,
      payments: [{ method: "CASH", currencyCode: "EUR", amount: 100 }],
      payout_account_usd_rate: 1.1,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a USD payout to the account with a client and no rate", () => {
    const r = schema.safeParse({
      ...base,
      fromCurrency: "LBP",
      toCurrency: "USD",
      clientId: 1,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 100 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts an EUR customer-side account line with a client and the rate", () => {
    const r = schema.safeParse({
      ...base,
      fromCurrency: "EUR",
      toCurrency: "USD",
      clientId: 1,
      customerPayments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 110 },
      ],
      customer_account_usd_rate: 1.05,
    });
    expect(r.success).toBe(true);
  });

  it("requires customer_account_usd_rate for an EUR customer-side account line", () => {
    const r = schema.safeParse({
      ...base,
      fromCurrency: "EUR",
      toCurrency: "USD",
      clientId: 1,
      customerPayments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 110 },
      ],
    });
    expect(messages(r).join(" ")).toMatch(/EUR → USD rate/);
  });

  it("refuses customer_account_usd_rate on a USD customer side", () => {
    const r = schema.safeParse({
      ...base,
      clientId: 1,
      customerPayments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 110 },
      ],
      customer_account_usd_rate: 1,
    });
    expect(r.success).toBe(false);
  });

  it("still refuses a discount (waived) when the customer pays in EUR", () => {
    const r = schema.safeParse({
      ...base,
      fromCurrency: "EUR",
      toCurrency: "USD",
      customerPayments: [{ method: "CASH", currencyCode: "EUR", amount: 109 }],
      customer_waived_amount: 1,
    });
    expect(r.success).toBe(false);
  });

  it("refuses the account-rate keys on a partner exchange", () => {
    const r = schema.safeParse({
      ...base,
      partnerId: 1,
      partnerMode: "FOR",
      payout_account_usd_rate: 1.1,
    });
    expect(r.success).toBe(false);
  });
});
