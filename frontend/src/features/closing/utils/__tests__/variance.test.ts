import {
  getVarianceStatus,
  getDateVarianceStatus,
  formatCurrencyAmount,
  formatDayVariance,
} from "../variance";

describe("getVarianceStatus", () => {
  it("reports a match when physical equals expected", () => {
    expect(getVarianceStatus(100, 100)).toEqual({
      status: "match",
      variance: 0,
    });
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

// Carrier-line validity (checkpoint Phase 3) — the ONE definition of "did the
// counted SIM expiry differ", shared by the checkpoint card and the timeline.
describe("getDateVarianceStatus", () => {
  it("treats an uncounted expiry as a match, not a variance", () => {
    expect(getDateVarianceStatus(null, "2026-09-01")).toEqual({
      status: "match",
      days: 0,
    });
    expect(getDateVarianceStatus("", "2026-09-01")).toEqual({
      status: "match",
      days: 0,
    });
  });

  it("matches when the counted date equals the stored one", () => {
    expect(getDateVarianceStatus("2026-09-01", "2026-09-01")).toEqual({
      status: "match",
      days: 0,
    });
  });

  it("reports the signed calendar-day difference, across a month boundary", () => {
    expect(getDateVarianceStatus("2026-09-10", "2026-08-31")).toEqual({
      status: "diff",
      days: 10,
    });
    expect(getDateVarianceStatus("2026-08-25", "2026-09-01")).toEqual({
      status: "diff",
      days: -7,
    });
  });

  it("flags a counted date on a line that had none, with no day count", () => {
    expect(getDateVarianceStatus("2026-09-01", null)).toEqual({
      status: "diff",
      days: 0,
    });
  });
});

describe("formatDayVariance", () => {
  it("signs the day count and renders an unmeasurable one as a dash", () => {
    expect(formatDayVariance(10)).toBe("+10d");
    expect(formatDayVariance(-3)).toBe("-3d");
    expect(formatDayVariance(0)).toBe("—");
  });
});
