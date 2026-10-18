/**
 * LIRA-334 — `resolveRoundingGiven`, the one check every payout flow runs
 * before booking a payout round-up as a "Change rounding" expense.
 *
 * Rule 17: written against a stub that threw
 * "resolveRoundingGiven: not implemented"; every case failed on the stub.
 */
import { resolveRoundingGiven } from "../roundingGiven";
import type { ReconciliationLeg } from "../moneyPosting";
import {
  ROUNDING_GIVEN_CURRENCY_MESSAGE,
  ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE,
  ROUNDING_GIVEN_OVER_CAP_MESSAGE,
  ROUNDING_GIVEN_WITH_KEPT_MESSAGE,
} from "../../validators/common";

const RATE = 89_500;

function leg(
  currencyCode: "USD" | "LBP",
  amount: number,
  extra: Partial<ReconciliationLeg> = {},
): ReconciliationLeg {
  return { method: "CASH", currencyCode, amount, ...extra };
}

const base = { exchangeRate: RATE, context: "TEST payout" } as const;

describe("resolveRoundingGiven", () => {
  it("no claim + exact legs → zero (and still reconciles)", () => {
    expect(
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 102.9)],
      }),
    ).toEqual({ usd: 0, lbp: 0 });
  });

  it("no claim + overpaid legs → today's refusal is unchanged", () => {
    expect(() =>
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 104)],
      }),
    ).toThrow("The payment is more than the total.");
  });

  it("USD: 103 handed on 102.90 with a 0.10 claim → 0.10", () => {
    expect(
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 103)],
        claimed: { usd: 0.1 },
      }),
    ).toEqual({ usd: 0.1, lbp: 0 });
  });

  it("LBP: 1,350,000 handed on 1,345,000 with a 5,000 claim → 5,000", () => {
    expect(
      resolveRoundingGiven({
        ...base,
        owed: 1_345_000,
        owedCurrency: "LBP",
        payoutLegs: [leg("LBP", 1_350_000)],
        claimed: { lbp: 5_000 },
      }),
    ).toEqual({ usd: 0, lbp: 5_000 });
  });

  it("USD payout topped up with an LBP note → USD claim accepted", () => {
    // owed 102.90; handed $102 + 89,500 LBP ($1.00) = $103.00 → 0.10 over
    expect(
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 102), leg("LBP", 89_500)],
        claimed: { usd: 0.1 },
      }),
    ).toEqual({ usd: 0.1, lbp: 0 });
  });

  it("the cap is inclusive: exactly $5 is accepted", () => {
    expect(
      resolveRoundingGiven({
        ...base,
        owed: 95,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 100)],
        claimed: { usd: 5 },
      }),
    ).toEqual({ usd: 5, lbp: 0 });
  });

  it("over the cap → refused", () => {
    expect(() =>
      resolveRoundingGiven({
        ...base,
        owed: 94,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 100)],
        claimed: { usd: 6 },
      }),
    ).toThrow(ROUNDING_GIVEN_OVER_CAP_MESSAGE);
  });

  it("together with kept change → refused", () => {
    expect(() =>
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 103)],
        claimed: { usd: 0.1 },
        claimedKept: { usd: 0.1 },
      }),
    ).toThrow(ROUNDING_GIVEN_WITH_KEPT_MESSAGE);
  });

  it("caller says not allowed (partner / session / account payout) → refused", () => {
    expect(() =>
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 103)],
        claimed: { usd: 0.1 },
        notAllowed: true,
      }),
    ).toThrow(ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE);
  });

  it("no legs → refused", () => {
    expect(() =>
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USD",
        payoutLegs: [],
        claimed: { usd: 0.1 },
      }),
    ).toThrow(ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE);
  });

  it("a non-drawer leg (customer account) → refused", () => {
    expect(() =>
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 103, { method: "CUSTOMER_ACCOUNT" })],
        claimed: { usd: 0.1 },
      }),
    ).toThrow(ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE);
  });

  it("an OUT leg → refused", () => {
    expect(() =>
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 103), leg("USD", 0.1, { direction: "OUT" })],
        claimed: { usd: 0.1 },
      }),
    ).toThrow(ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE);
  });

  it("claim in the other currency → refused", () => {
    expect(() =>
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 103)],
        claimed: { lbp: 8_950 },
      }),
    ).toThrow(ROUNDING_GIVEN_CURRENCY_MESSAGE);
  });

  it("a non USD/LBP payout → refused", () => {
    expect(() =>
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USDT",
        payoutLegs: [leg("USD", 103)],
        claimed: { usd: 0.1 },
      }),
    ).toThrow(ROUNDING_GIVEN_NOT_ALLOWED_MESSAGE);
  });

  it("claim that does not match the legs → reconcile refusal", () => {
    expect(() =>
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 103)],
        claimed: { usd: 2 },
      }),
    ).toThrow("The payment doesn't add up to the total.");
  });

  it("claim larger than the real overpay (within the 5¢ leg tolerance) → refused", () => {
    expect(() =>
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 103)],
        claimed: { usd: 0.14 },
      }),
    ).toThrow(/more than was handed out/);
  });

  it("legs not more than owed but a claim → refused", () => {
    expect(() =>
      resolveRoundingGiven({
        ...base,
        owed: 102.9,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 102.9)],
        claimed: { usd: 0.04 },
      }),
    ).toThrow(/nothing to round up/);
  });
});
