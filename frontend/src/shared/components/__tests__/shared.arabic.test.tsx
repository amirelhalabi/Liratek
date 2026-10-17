/** @jest-environment jsdom */
/**
 * LIRA-331 (T026): shared components follow the UI language. English stays
 * byte-identical; amounts are formatted the same in both languages.
 */
import { render, screen } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import { PriceChangeWarning } from "../PriceChangeWarning";
import { SaveAsClientCheckbox } from "../SaveAsClientCheckbox";
import { TransactionTimeOverride } from "../TransactionTimeOverride";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("shared components language", () => {
  it("keeps the English text", () => {
    render(
      <>
        <PriceChangeWarning catalogPrice={1500000} currentPrice={2000000} currency="LBP" />
        <SaveAsClientCheckbox checked={false} onChange={() => {}} />
        <TransactionTimeOverride value={undefined} onChange={() => {}} />
      </>,
    );
    expect(screen.getByTestId("price-change-warning")).toHaveTextContent(
      "Price changed: catalog 1,500,000 LBP → 2,000,000 LBP",
    );
    expect(screen.getByText("Save as client")).toBeInTheDocument();
    expect(screen.getByText("Set custom time")).toBeInTheDocument();
  });

  it("shows Arabic with the same amounts", async () => {
    await loadLanguage("ar");
    await i18n.changeLanguage("ar");
    render(
      <>
        <PriceChangeWarning catalogPrice={1500000} currentPrice={2000000} currency="LBP" />
        <SaveAsClientCheckbox checked={false} onChange={() => {}} />
        <TransactionTimeOverride value={undefined} onChange={() => {}} />
      </>,
    );
    const warning = screen.getByTestId("price-change-warning");
    expect(warning).toHaveTextContent("تغيّر السعر");
    expect(warning).toHaveTextContent("1,500,000 LBP");
    expect(warning).toHaveTextContent("2,000,000 LBP");
    expect(screen.getByText("حفظ كزبون")).toBeInTheDocument();
    expect(screen.getByText("تحديد وقت مخصّص")).toBeInTheDocument();
  });
});
