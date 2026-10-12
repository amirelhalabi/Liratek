import { usdLbpTotals } from "../usdLbpTotals";

// LIRA-314 — not proven failing-first (written with the helper, rule 17).
describe("usdLbpTotals", () => {
  type Row = { usd: number; lbp: number; is_refunded?: number };
  const pick = (r: Row) => ({ usd: r.usd, lbp: r.lbp });
  const rows = (list: Row[]) => list;

  it("sums USD and LBP separately", () => {
    expect(
      usdLbpTotals(
        rows([
          { usd: 10, lbp: 0 },
          { usd: 2.5, lbp: 450000 },
          { usd: 0, lbp: 50000 },
        ]),
        pick,
      ),
    ).toEqual({ usd: 12.5, lbp: 500000 });
  });

  it("leaves refunded rows out", () => {
    expect(
      usdLbpTotals(
        rows([
          { usd: 10, lbp: 100, is_refunded: 0 },
          { usd: 99, lbp: 999, is_refunded: 1 },
        ]),
        pick,
      ),
    ).toEqual({ usd: 10, lbp: 100 });
  });

  it("is zero for no rows", () => {
    expect(usdLbpTotals(rows([]), pick)).toEqual({ usd: 0, lbp: 0 });
  });
});
