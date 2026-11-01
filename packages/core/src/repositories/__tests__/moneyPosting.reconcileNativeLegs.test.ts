/**
 * LIRA-369 — reconcileNativeLegs: a payout in a currency other than USD/LBP
 * (EUR, GBP…) is reconciled in that currency. Every line is in the payout
 * currency, paid in cash or to the customer's account, and the lines add up
 * to the amount owed.
 */
import { describe, it, expect } from "@jest/globals";
import { reconcileNativeLegs } from "../moneyPosting.js";

const run = (
  legs: Array<{ method: string; currencyCode: string; amount: number }>,
  expected = 100,
) =>
  reconcileNativeLegs({ legs, currency: "EUR", expected, context: "Exchange payout" });

describe("reconcileNativeLegs", () => {
  it("accepts EUR cash + EUR account adding up to 100", () => {
    expect(() =>
      run([
        { method: "CASH", currencyCode: "EUR", amount: 60 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 40 },
      ]),
    ).not.toThrow();
  });

  it("accepts a cent of rounding", () => {
    expect(() =>
      run([{ method: "CASH", currencyCode: "EUR", amount: 99.995 }]),
    ).not.toThrow();
  });

  it("refuses lines short of the total", () => {
    expect(() =>
      run([{ method: "CASH", currencyCode: "EUR", amount: 90 }]),
    ).toThrow(/doesn't add up/);
  });

  it("refuses lines above the total", () => {
    expect(() =>
      run([{ method: "CASH", currencyCode: "EUR", amount: 110 }]),
    ).toThrow(/more than the total/);
  });

  it("refuses a line in another currency", () => {
    expect(() =>
      run([{ method: "CASH", currencyCode: "USD", amount: 100 }]),
    ).toThrow(/EUR/);
  });

  it("refuses a wallet method", () => {
    expect(() =>
      run([{ method: "OMT", currencyCode: "EUR", amount: 100 }]),
    ).toThrow(/cash or to the customer's account/);
  });
});
