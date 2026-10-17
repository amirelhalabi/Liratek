/**
 * LIRA-331 (FR-016, rule 27): the shared money/rate display helpers must not
 * read the MACHINE's locale. On a Windows desktop with an Arabic regional
 * setting, `toLocaleString()` with no locale prints `١٬٥٠٠٬٠٠٠` — a
 * different-looking amount. They go through `@liratek/ui/i18n/format`
 * (pinned en-US) instead, so the output is the same on every machine and in
 * both languages.
 *
 * The spy makes any machine-locale call blow up, so a helper that still
 * calls it fails here.
 */
import { formatCurrencyAmount } from "../currencyUtils";
import { formatCurrency } from "../paymentUtils";
import { formatRate } from "../exchangeRates";
import { rechargeDetailLabel } from "@/shared/utils/rechargeLabels";

describe("display helpers never use the machine locale", () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest
      .spyOn(Number.prototype, "toLocaleString")
      .mockImplementation(() => {
        throw new Error("machine-locale toLocaleString called");
      });
  });

  afterEach(() => spy.mockRestore());

  it("formatCurrencyAmount", () => {
    expect(formatCurrencyAmount(89500, "LBP")).toBe("89,500");
    expect(formatCurrencyAmount(1.16, "USD")).toBe("1.16");
  });

  it("formatCurrency", () => {
    expect(formatCurrency(1500000, "LBP")).toBe("1,500,000 LBP");
    expect(formatCurrency(12, "USD")).toBe("$12.00");
  });

  it("formatRate", () => {
    expect(formatRate(89500)).toBe("1 USD = 89,500 LBP");
  });

  it("rechargeDetailLabel", () => {
    expect(rechargeDetailLabel("CREDIT", 1234.5)).toContain("$1,234.5");
  });
});
