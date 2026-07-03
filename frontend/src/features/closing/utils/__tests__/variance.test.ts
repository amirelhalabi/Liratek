import {
  getVarianceStatus,
  formatCurrencyAmount,
} from "../variance";

describe("getVarianceStatus", () => {
  it("reports a match when physical equals expected", () => {
    expect(getVarianceStatus(100, 100)).toEqual({ status: "match", variance: 0 });
  });

  it("treats sub-epsilon rounding noise as a match", () => {
    expect(getVarianceStatus(100.005, 100)).toEqual({
      status: "match",
      variance: 0,
    });
  });

  it("flags any positive difference (overage) with no tolerance", () => {
    expect(getVarianceStatus(105, 100)).toEqual({
      status: "diff",
      variance: 5,
    });
  });

  it("flags any negative difference (shortage) with no tolerance", () => {
    expect(getVarianceStatus(90, 100)).toEqual({
      status: "diff",
      variance: -10,
    });
  });

  it("flags a tiny difference just above the epsilon", () => {
    const info = getVarianceStatus(100.02, 100);
    expect(info.status).toBe("diff");
    expect(info.variance).toBeCloseTo(0.02);
  });

  it("flags a difference even when expected is zero", () => {
    expect(getVarianceStatus(5, 0)).toEqual({ status: "diff", variance: 5 });
  });
});

describe("formatCurrencyAmount", () => {
  it("renders LBP as whole numbers", () => {
    expect(formatCurrencyAmount(1234567.89, "LBP")).toBe(
      (1234568).toLocaleString(),
    );
  });

  it("renders non-LBP with two decimals", () => {
    expect(formatCurrencyAmount(12.5, "USD")).toBe(
      (12.5).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    );
  });
});
