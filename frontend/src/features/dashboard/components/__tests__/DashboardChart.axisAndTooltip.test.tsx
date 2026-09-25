/**
 * DashboardChart — DC-5/DC-6 (OWNER_NOTES_2026-09-21.md §7.1).
 *
 * Both fixes are pure functions living in `../utils/chartFormat` (moved out
 * of this component file by LINT-1, a round-2 verifier finding —
 * react-refresh/only-export-components forbids a component file from also
 * exporting plain functions) specifically so they can be unit-tested
 * without rendering `recharts` (which needs real layout measurement and is
 * slow/flaky under jsdom).
 *
 * DC-5: the pre-fix Y-axis tick formatter was `${(value/1000).toFixed(0)}k`
 * for EVERY value, so a shop under ~$500/day saw ticks collapse to "0k"/
 * "1k" — e.g. $250 -> (250/1000).toFixed(0) = "0" -> "0k", and $500 ->
 * (0.5).toFixed(0) = "1" -> "1k" (JS rounds .5 away from zero here), the
 * exact "0k 0k 1k 1k" the owner reported. `formatUsdAxisTick` renders the
 * plain dollar amount below $1,000 instead.
 *
 * DC-6: the pre-fix tooltip formatter matched on the line's DISPLAYED
 * `name` string ("USD Sales" / "LBP Sales" / "Profit"), so "USD Sales"
 * fell through to a bare `toLocaleString()` — no `$`, no cents. It also
 * meant relabeling the series (DC-4) would have silently broken the
 * currency match. `formatTooltipValue` keys off the stable Recharts
 * `dataKey` ("usd"/"lbp"/"profit") instead, so it survives any display-name
 * change.
 */

import {
  formatUsdAxisTick,
  formatLbpAxisTick,
  formatTooltipValue,
} from "../../utils/chartFormat";

describe("formatUsdAxisTick (DC-5)", () => {
  it("renders a plain dollar amount below $1,000 (no 'k' collapse)", () => {
    expect(formatUsdAxisTick(0)).toBe("$0");
    expect(formatUsdAxisTick(250)).toBe("$250");
    expect(formatUsdAxisTick(420)).toBe("$420");
    expect(formatUsdAxisTick(999)).toBe("$999");
  });

  it("distinguishes values that pre-fix all collapsed to the same '0k'/'1k' label", () => {
    // Pre-fix: (250/1000).toFixed(0) = "0" and (480/1000).toFixed(0) = "0"
    // -> both rendered "0k". Post-fix these are visibly different labels.
    expect(formatUsdAxisTick(250)).not.toBe(formatUsdAxisTick(480));
    expect(formatUsdAxisTick(250)).toBe("$250");
    expect(formatUsdAxisTick(480)).toBe("$480");
  });

  it("keeps the 'k' shorthand, with one decimal, at/above $1,000", () => {
    expect(formatUsdAxisTick(1000)).toBe("$1.0k");
    expect(formatUsdAxisTick(1200)).toBe("$1.2k");
    expect(formatUsdAxisTick(15000)).toBe("$15.0k");
  });

  // CHART-m1 (verifier finding, round 1) — the Profit axis's domain is
  // `['auto','auto']` (a day's gross profit can be negative), and the
  // pre-fix formatter compared the SIGNED value against 1000, so every
  // negative tick fell to the `$Math.round(value)` branch regardless of
  // its magnitude and rendered the sign after the `$` (e.g. "$-1500").
  it("is sign-aware: puts the sign before the '$' and still engages 'k' by magnitude", () => {
    expect(formatUsdAxisTick(-250)).toBe("-$250");
    expect(formatUsdAxisTick(-1500)).toBe("-$1.5k");
    expect(formatUsdAxisTick(0)).toBe("$0");
  });

  // CHART-V2-m2 (verifier finding, round 2) — the bucket decision ran
  // against the UNROUNDED magnitude, so a value whose rounded display
  // reaches $1,000 still printed as a bare 4-digit "$1000" instead of
  // engaging 'k', and a magnitude that rounds down to 0 printed a
  // meaningless "-$0". Pre-fix (confirmed): formatUsdAxisTick(999.6) ===
  // "$1000"; formatUsdAxisTick(-0.4) === "-$0".
  it("buckets on the ROUNDED magnitude, not the raw one (CHART-V2-m2)", () => {
    expect(formatUsdAxisTick(999.6)).toBe("$1.0k");
    expect(formatUsdAxisTick(-0.4)).toBe("$0");
  });
});

describe("formatLbpAxisTick (CHART-m1)", () => {
  // Pre-fix, DashboardChart.tsx inlined
  // `${(value/1_000_000).toFixed(1)}M` unconditionally for the LBP axis.
  // A day's LBP GROSS PROFIT realistically sits in the 0–100,000 range, so
  // every one of those ticks divides to well under 0.15 and `toFixed(1)`
  // collapses several distinct values to the same "0.0M"/"0.1M" label —
  // the DC-5 symptom, reproduced on the new axis.
  it("renders a plain amount below 1,000 (no premature 'M'/'k' collapse)", () => {
    expect(formatLbpAxisTick(0)).toBe("0");
    expect(formatLbpAxisTick(250)).toBe("250");
    expect(formatLbpAxisTick(999)).toBe("999");
  });

  it("distinguishes realistic daily-profit LBP values that pre-fix all read '0.0M'/'0.1M'", () => {
    // Pre-fix: (25000/1_000_000).toFixed(1) = "0.0" and
    // (55000/1_000_000).toFixed(1) = "0.1" — two of five distinct daily
    // figures already collide, and 0/25,000/50,000 all read "0.0M".
    expect(formatLbpAxisTick(25_000)).not.toBe(formatLbpAxisTick(55_000));
    expect(formatLbpAxisTick(25_000)).toBe("25.0k");
    expect(formatLbpAxisTick(55_000)).toBe("55.0k");
  });

  it("keeps the 'k' shorthand from 1,000 up to 1,000,000", () => {
    expect(formatLbpAxisTick(1_000)).toBe("1.0k");
    expect(formatLbpAxisTick(450_000)).toBe("450.0k");
  });

  it("switches to the 'M' shorthand at/above 1,000,000", () => {
    expect(formatLbpAxisTick(1_000_000)).toBe("1.0M");
    expect(formatLbpAxisTick(2_805_000)).toBe("2.8M");
  });

  it("is sign-aware: puts the sign before the value at every magnitude", () => {
    expect(formatLbpAxisTick(-25_000)).toBe("-25.0k");
    expect(formatLbpAxisTick(-1_500_000)).toBe("-1.5M");
    expect(formatLbpAxisTick(-500)).toBe("-500");
  });

  // CHART-V2-m2 (verifier finding, round 2) — a value under the raw
  // 1,000,000 'M' threshold can still have its own one-decimal 'k' DISPLAY
  // round up to "1000.0k" — a 4-digit 'k' value one step past where 'M'
  // should have taken over. Pre-fix (confirmed): formatLbpAxisTick(999_950)
  // === "1000.0k".
  it("escalates to 'M' when the rounded 'k' display would itself reach 1000 (CHART-V2-m2)", () => {
    expect(formatLbpAxisTick(999_950)).toBe("1.0M");
  });
});

describe("formatTooltipValue (DC-6)", () => {
  const formatAmount = jest.fn(
    (value: number, currency: string) =>
      `${currency === "USD" ? "$" : ""}${value.toFixed(2)}${currency === "LBP" ? " LBP" : ""}`,
  );

  beforeEach(() => {
    formatAmount.mockClear();
  });

  it("formats a 'usd' dataKey through formatAmount(value, 'USD') — the DC-6 gap", () => {
    const [text] = formatTooltipValue(
      75.5,
      "Product & Telecom Sales (USD)",
      "usd",
      formatAmount,
    );
    expect(formatAmount).toHaveBeenCalledWith(75.5, "USD");
    expect(text).toBe("$75.50");
  });

  it("formats a 'lbp' dataKey through formatAmount(value, 'LBP')", () => {
    const [text] = formatTooltipValue(
      1_170_000,
      "Product & Telecom Sales (LBP)",
      "lbp",
      formatAmount,
    );
    expect(formatAmount).toHaveBeenCalledWith(1_170_000, "LBP");
    expect(text).toBe("1170000.00 LBP");
  });

  it("formats a 'profit' dataKey through formatAmount(value, 'USD')", () => {
    const [text] = formatTooltipValue(400, "Profit", "profit", formatAmount);
    expect(formatAmount).toHaveBeenCalledWith(400, "USD");
    expect(text).toBe("$400.00");
  });

  it("is driven by dataKey, not the display name — survives the DC-4 relabel", () => {
    // Same dataKey ("usd"), two different display names: both must resolve
    // to the USD formatter. This is the exact hazard DC-6's fix avoids —
    // the pre-fix version matched on `name === "USD Sales"` literally.
    const [withOldName] = formatTooltipValue(10, "USD Sales", "usd", formatAmount);
    const [withNewName] = formatTooltipValue(
      10,
      "Product & Telecom Sales (USD)",
      "usd",
      formatAmount,
    );
    expect(withOldName).toBe("$10.00");
    expect(withNewName).toBe("$10.00");
  });

  it("falls back to a plain locale string for an unrecognized dataKey", () => {
    const [text] = formatTooltipValue(1234, "Something else", undefined, formatAmount);
    expect(formatAmount).not.toHaveBeenCalled();
    expect(text).toBe("1,234");
  });
});
