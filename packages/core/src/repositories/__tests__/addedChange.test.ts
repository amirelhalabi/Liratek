/**
 * LIRA-336 T006 — `resolveAddedChange` (addedChange.ts, research R3): the
 * ONE rule for "money the customer adds on a payout raises what the shop
 * pays out". Pure — it measures the customer's lines, converts the money
 * above what they owe into the payout currency at the payout's reconcile
 * rate, checks the cap and the claim, and returns the claim plus the
 * measured lines for the caller to write later.
 *
 * Rule 17 — run on 2026-10-18 BEFORE addedChange.ts existed: the suite
 * failed at import ("Cannot find module '../addedChange'"), every case red.
 */
import { resolveAddedChange } from "../addedChange";
import {
  ADDED_CHANGE_ACCOUNT_MESSAGE,
  ADDED_CHANGE_MISMATCH_MESSAGE,
  ADDED_CHANGE_NOT_ALLOWED_MESSAGE,
  ADDED_CHANGE_OVER_CAP_MESSAGE,
} from "../../validators/common";
import type { ReconciliationLeg } from "../moneyPosting";

const RATE = 89_500;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&");
const msg = (s: string) => new RegExp(escape(s));

const cash = (currencyCode: string, amount: number): ReconciliationLeg => ({
  method: "CASH",
  currencyCode,
  amount,
});

const base = {
  expected: { amount: 0, currency: "USD" },
  payoutCurrency: "USD",
  exchangeRate: RATE,
  context: "Test payout",
};

describe("resolveAddedChange", () => {
  it("no claim and no lines → zero, nothing measured", () => {
    const r = resolveAddedChange({ ...base, legs: [] });
    expect(r).toEqual({ usd: 0, lbp: 0, measured: null });
  });

  it("no claim on a flow where the customer owes something → zero, legacy path untouched", () => {
    const r = resolveAddedChange({
      ...base,
      expected: { amount: 100, currency: "USD" },
      legs: [cash("USD", 103)],
    });
    expect(r).toEqual({ usd: 0, lbp: 0, measured: null });
  });

  it("customer lines with nothing owed and no claim → refused", () => {
    expect(() =>
      resolveAddedChange({ ...base, legs: [cash("USD", 3)] }),
    ).toThrow(msg(ADDED_CHANGE_MISMATCH_MESSAGE));
  });

  it("a USD claim of 3 with $3 cash and nothing owed → 3", () => {
    const r = resolveAddedChange({
      ...base,
      legs: [cash("USD", 3)],
      claimed: { usd: 3 },
    });
    expect(r.usd).toBe(3);
    expect(r.lbp).toBe(0);
    expect(r.measured?.drawerLegs).toHaveLength(1);
  });

  it("an LBP line of 268,500 on a USD payout at 89,500 → USD claim 3 accepted", () => {
    const r = resolveAddedChange({
      ...base,
      legs: [cash("LBP", 268_500)],
      claimed: { usd: 3 },
    });
    expect(r.usd).toBe(3);
  });

  it("the screen's double rounding is accepted: 270,000 LBP at 89,500 → claim $3.02", () => {
    // The payment box rounds the extra in its own currency, converts it at
    // the sheet (tender) rate and rounds again: 270,000 / 89,500 = 3.0167 →
    // $3.02. Mixed currencies → the leg epsilon applies.
    const r = resolveAddedChange({
      ...base,
      exchangeRate: 90_000,
      tenderExchangeRate: 89_500,
      legs: [cash("LBP", 270_000)],
      claimed: { usd: 3.02 },
    });
    expect(r.usd).toBe(3.02);
  });

  it("an empty line list with no claim keeps the legacy path (zero, nothing measured)", () => {
    expect(resolveAddedChange({ ...base, legs: [cash("USD", 0)] })).toEqual({
      usd: 0,
      lbp: 0,
      measured: null,
    });
    expect(resolveAddedChange({ ...base, legs: undefined })).toEqual({
      usd: 0,
      lbp: 0,
      measured: null,
    });
  });

  it("the tender rate wins over the server rate (the OUT reconcile rate)", () => {
    const r = resolveAddedChange({
      ...base,
      exchangeRate: 90_000,
      tenderExchangeRate: 89_500,
      legs: [cash("LBP", 268_500)],
      claimed: { usd: 3 },
    });
    expect(r.usd).toBe(3);
  });

  it("a USD line on an LBP payout → LBP claim at the rate", () => {
    const r = resolveAddedChange({
      ...base,
      expected: { amount: 0, currency: "LBP" },
      payoutCurrency: "LBP",
      legs: [cash("USD", 1)],
      claimed: { lbp: 89_500 },
    });
    expect(r).toMatchObject({ usd: 0, lbp: 89_500 });
  });

  it("customer owes $100 in USD, payout in LBP: $101 handed → 1 USD at the rate", () => {
    const r = resolveAddedChange({
      ...base,
      expected: { amount: 100, currency: "USD" },
      payoutCurrency: "LBP",
      tenderExchangeRate: 89_530,
      legs: [cash("USD", 101)],
      claimed: { lbp: 89_530 },
    });
    expect(r.lbp).toBe(89_530);
  });

  it("over the cap → refused", () => {
    expect(() =>
      resolveAddedChange({
        ...base,
        legs: [cash("USD", 6)],
        claimed: { usd: 6 },
      }),
    ).toThrow(msg(ADDED_CHANGE_OVER_CAP_MESSAGE));
  });

  it("an LBP claim over 450,000 → refused", () => {
    expect(() =>
      resolveAddedChange({
        ...base,
        expected: { amount: 0, currency: "LBP" },
        payoutCurrency: "LBP",
        legs: [cash("LBP", 500_000)],
        claimed: { lbp: 500_000 },
      }),
    ).toThrow(msg(ADDED_CHANGE_OVER_CAP_MESSAGE));
  });

  it("a claim that doesn't match the lines → refused", () => {
    expect(() =>
      resolveAddedChange({
        ...base,
        legs: [cash("USD", 3)],
        claimed: { usd: 2 },
      }),
    ).toThrow(msg(ADDED_CHANGE_MISMATCH_MESSAGE));
  });

  it("a claim with no customer lines → refused", () => {
    expect(() =>
      resolveAddedChange({ ...base, legs: [], claimed: { usd: 3 } }),
    ).toThrow(msg(ADDED_CHANGE_MISMATCH_MESSAGE));
  });

  it("a claim with an account line → refused", () => {
    expect(() =>
      resolveAddedChange({
        ...base,
        clientId: 1,
        legs: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 3 }],
        claimed: { usd: 3 },
      }),
    ).toThrow(msg(ADDED_CHANGE_ACCOUNT_MESSAGE));
  });

  it("a claim with a forgiven amount → refused", () => {
    expect(() =>
      resolveAddedChange({
        ...base,
        expected: { amount: 100, currency: "USD" },
        legs: [cash("USD", 103)],
        waived: 1,
        claimed: { usd: 3 },
      }),
    ).toThrow(msg(ADDED_CHANGE_ACCOUNT_MESSAGE));
  });

  it("notAllowed → refused", () => {
    expect(() =>
      resolveAddedChange({
        ...base,
        legs: [cash("USD", 3)],
        claimed: { usd: 3 },
        notAllowed: true,
      }),
    ).toThrow(msg(ADDED_CHANGE_NOT_ALLOWED_MESSAGE));
  });

  it("a claim in the other currency → refused", () => {
    expect(() =>
      resolveAddedChange({
        ...base,
        legs: [cash("LBP", 268_500)],
        claimed: { lbp: 268_500 },
      }),
    ).toThrow(msg(ADDED_CHANGE_MISMATCH_MESSAGE));
  });

  it("a payout in a third currency → refused", () => {
    expect(() =>
      resolveAddedChange({
        ...base,
        expected: { amount: 0, currency: "EUR" },
        payoutCurrency: "EUR",
        legs: [cash("EUR", 3)],
        claimed: { usd: 3 },
      }),
    ).toThrow(msg(ADDED_CHANGE_NOT_ALLOWED_MESSAGE));
  });

  it("a negative claim → refused", () => {
    expect(() =>
      resolveAddedChange({
        ...base,
        legs: [cash("USD", 3)],
        claimed: { usd: -3 },
      }),
    ).toThrow(msg(ADDED_CHANGE_NOT_ALLOWED_MESSAGE));
  });
});
