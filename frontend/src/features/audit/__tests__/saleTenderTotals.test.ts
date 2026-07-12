/**
 * saleTenderTotals — SALE rows display TENDER (IN legs), not value + tender.
 *
 * A $5 sale paid with 450,000 LBP used to render "$5 + 450,000 LBP" in the
 * transactions table (the row's amount_usd carried the sale's USD value AND
 * amount_lbp carried the LBP tender). The Amount column / cash-flow badge now
 * show what the customer actually handed over, from the IN payment legs;
 * rows without IN legs fall back to the value fields (return null here).
 */
import { saleTenderTotals } from "../cashFlow";

const leg = (
  direction: "in" | "out",
  amount: number,
  currency_code: string,
) => ({ direction, amount, currency_code });

describe("saleTenderTotals", () => {
  it("LBP-paid sale shows the LBP tender only (the reported bug)", () => {
    expect(saleTenderTotals("SALE", [leg("in", 450_000, "LBP")])).toEqual({
      usd: 0,
      lbp: 450_000,
    });
  });

  it("mixed tender sums per currency", () => {
    expect(
      saleTenderTotals("SALE", [
        leg("in", 3, "USD"),
        leg("in", 180_000, "LBP"),
      ]),
    ).toEqual({ usd: 3, lbp: 180_000 });
  });

  it("ignores OUT (change) legs — gross paid, change shown by the legs line", () => {
    expect(
      saleTenderTotals("SALE", [leg("in", 10, "USD"), leg("out", 5, "USD")]),
    ).toEqual({ usd: 10, lbp: 0 });
  });

  it("sums same-currency legs (split cash payments)", () => {
    expect(
      saleTenderTotals("SALE", [leg("in", 2, "USD"), leg("in", 3, "USD")]),
    ).toEqual({ usd: 5, lbp: 0 });
  });

  it("falls back to value fields when there are no IN legs (deferred/debt sales, legacy rows)", () => {
    expect(saleTenderTotals("SALE", undefined)).toBeNull();
    expect(saleTenderTotals("SALE", [])).toBeNull();
    expect(saleTenderTotals("SALE", [leg("out", 5, "USD")])).toBeNull();
  });

  it("applies to SALE rows only — other types keep their amount fields", () => {
    expect(
      saleTenderTotals("RECHARGE", [leg("in", 450_000, "LBP")]),
    ).toBeNull();
    expect(saleTenderTotals("REFUND", [leg("out", 5, "USD")])).toBeNull();
  });
});
