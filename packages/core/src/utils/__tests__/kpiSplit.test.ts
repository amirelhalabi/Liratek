/**
 * LIRA-364 — split counterparty balances into the two "owes" sides, per
 * currency on its own. RULE 17 — written before `splitBySign` existed.
 */
import { splitBySign } from "../kpiSplit.js";

describe("splitBySign (LIRA-364)", () => {
  it("adds positive balances to one side and negative ones to the other", () => {
    expect(
      splitBySign([
        { usd: 120, lbp: 900000 },
        { usd: -30, lbp: 0 },
      ]),
    ).toEqual({
      positive: { usd: 120, lbp: 900000 },
      negative: { usd: 30, lbp: 0 },
    });
  });

  it("judges each currency on its own", () => {
    expect(splitBySign([{ usd: 50, lbp: -450000 }])).toEqual({
      positive: { usd: 50, lbp: 0 },
      negative: { usd: 0, lbp: 450000 },
    });
  });

  it("treats dust as zero", () => {
    expect(splitBySign([{ usd: 0.004, lbp: -0.4 }])).toEqual({
      positive: { usd: 0, lbp: 0 },
      negative: { usd: 0, lbp: 0 },
    });
  });

  it("rounds sums to cents and whole lira", () => {
    expect(
      splitBySign([
        { usd: 0.1, lbp: 0 },
        { usd: 0.2, lbp: 0 },
      ]).positive.usd,
    ).toBe(0.3);
  });

  it("returns zeros for no rows", () => {
    expect(splitBySign([])).toEqual({
      positive: { usd: 0, lbp: 0 },
      negative: { usd: 0, lbp: 0 },
    });
  });
});
