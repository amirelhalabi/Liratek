/**
 * LIRA-331 T006: the ONE place that formats numbers and dates for the UI
 * (research R4/R5, R13). Numbers never depend on the language (FR-016);
 * dates use Lebanese month names in Arabic (OD-5) with Western digits and
 * never shift the calendar day (FR-020).
 */
import { formatMoneyAmount } from "@liratek/core";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatTime,
} from "../format";
import { normalizeDigits } from "../digits";

const ARABIC_INDIC = /[٠-٩۰-۹]/;

describe("formatNumber", () => {
  it("is en-US in both languages", () => {
    expect(formatNumber(1234567.5)).toBe("1,234,567.5");
  });

  it("passes Intl options through", () => {
    expect(formatNumber(2.5, { minimumFractionDigits: 2 })).toBe("2.50");
  });
});

describe("formatMoney", () => {
  it.each([
    [1500000, "LBP", "1,500,000 LBP"],
    [1234.5, "USD", "$1,234.5"],
    [10, "EUR", "10 EUR"],
  ])("formats %p %s as %s, the same as core's stored summaries", (amount, currency, expected) => {
    expect(formatMoney(amount, currency)).toBe(expected);
    expect(formatMoney(amount, currency)).toBe(
      formatMoneyAmount(amount, currency).replace(
        /[\d,.]+/,
        new Intl.NumberFormat("en-US").format(amount),
      ),
    );
  });
});

describe("formatDate / formatTime / formatDateTime", () => {
  const jan15 = new Date(2026, 0, 15, 14, 5);

  it("Arabic uses the Lebanese month name and only Western digits", () => {
    const ar = formatDate(jan15, "ar");
    expect(ar).toContain("كانون الثاني");
    expect(ar).toContain("15");
    expect(ar).toContain("2026");
    expect(ar).not.toMatch(ARABIC_INDIC);
    expect(formatDateTime(jan15, "ar")).not.toMatch(ARABIC_INDIC);
    expect(formatTime(jan15, "ar")).not.toMatch(ARABIC_INDIC);
  });

  it("English is en-US", () => {
    expect(formatDate(jan15, "en")).toBe("Jan 15, 2026");
  });

  it("never shifts the calendar day between languages", () => {
    // 23:30 local: a UTC conversion would move it to the next/previous day.
    const lateNight = new Date(2026, 1, 28, 23, 30);
    expect(formatDate(lateNight, "en")).toContain("28");
    expect(formatDate(lateNight, "ar")).toContain("28");
    expect(formatDate(lateNight, "ar")).toContain("شباط");
  });

  it("accepts ISO strings and timestamps, and shows a dash for invalid input", () => {
    expect(formatDate("2026-01-15T10:00:00", "en")).toBe("Jan 15, 2026");
    expect(formatDate(jan15.getTime(), "en")).toBe("Jan 15, 2026");
    expect(formatDate("not a date", "en")).toBe("—");
    expect(formatDate(null, "ar")).toBe("—");
  });
});

describe("normalizeDigits", () => {
  it("maps Arabic-Indic and Persian digits and the Arabic decimal mark", () => {
    expect(normalizeDigits("١٢٣٫٥")).toBe("123.5");
    expect(normalizeDigits("۱۲۳")).toBe("123");
    expect(normalizeDigits("١٬٢٣٤")).toBe("1234");
  });

  it("leaves Western input untouched", () => {
    expect(normalizeDigits("1,234.50")).toBe("1,234.50");
    expect(normalizeDigits("")).toBe("");
  });
});
