import { telecomSaleTotal } from "../telecomHistoryRow";
import type { FinancialTransaction } from "../../types";

// LIRA-314 — not proven failing-first (written with the helper, rule 17).
function row(over: Partial<FinancialTransaction>): FinancialTransaction {
  return {
    id: 1,
    provider: "MTC",
    service_type: "SEND",
    amount: 10,
    currency: "USD",
    cost: 9,
    commission: 1.5,
    created_at: "2026-10-12 10:00:00",
    ...over,
  };
}

describe("telecomSaleTotal", () => {
  it("counts the customer price (cost + profit) in the row's currency", () => {
    expect(telecomSaleTotal(row({}))).toEqual({ usd: 10.5, lbp: 0 });
    expect(
      telecomSaleTotal(
        row({ currency: "LBP", cost: 800000, commission: 100000 }),
      ),
    ).toEqual({ usd: 0, lbp: 900000 });
  });

  it("counts 0 for top-ups, buy-backs and shop-line use", () => {
    for (const recharge_type of ["TOP_UP", "CREDIT_BUYBACK", "SHOP_LINE_USE"]) {
      expect(telecomSaleTotal(row({ recharge_type }))).toEqual({
        usd: 0,
        lbp: 0,
      });
    }
  });
});
