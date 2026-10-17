/**
 * LIRA-331: useFormat binds the displayed language to the date formatters;
 * numbers and money stay en-US in both languages (FR-016).
 */
import { render, screen } from "@testing-library/react";
import { useFormat } from "../useFormat";

let mockLanguage: "en" | "ar" = "en";
jest.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ language: mockLanguage }),
}));

function Probe() {
  const f = useFormat();
  const d = new Date(2026, 0, 15, 14, 5);
  return (
    <div>
      <span data-testid="date">{f.formatDate(d)}</span>
      <span data-testid="money">{f.formatMoney(1500000, "LBP")}</span>
      <span data-testid="num">{f.formatNumber(1234.5)}</span>
    </div>
  );
}

it("English", () => {
  mockLanguage = "en";
  render(<Probe />);
  expect(screen.getByTestId("date")).toHaveTextContent("Jan 15, 2026");
  expect(screen.getByTestId("money")).toHaveTextContent("1,500,000 LBP");
});

it("Arabic: Lebanese month, same money and numbers", () => {
  mockLanguage = "ar";
  render(<Probe />);
  expect(screen.getByTestId("date")).toHaveTextContent("كانون الثاني");
  expect(screen.getByTestId("money")).toHaveTextContent("1,500,000 LBP");
  expect(screen.getByTestId("num")).toHaveTextContent("1,234.5");
});
