/** @jest-environment jsdom */
/**
 * LIRA-260: one shared amber, non-blocking warning shown when a cashier edits
 * a selling price away from its saved catalog/preset price.
 */
import { render, screen } from "@testing-library/react";
import { PriceChangeWarning } from "../PriceChangeWarning";

describe("PriceChangeWarning (LIRA-260)", () => {
  it("renders nothing when the price equals the catalog price", () => {
    const { container } = render(
      <PriceChangeWarning catalogPrice={10} currentPrice={10} currency="USD" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("ignores sub-cent float noise on USD", () => {
    const { container } = render(
      <PriceChangeWarning
        catalogPrice={0.3}
        currentPrice={0.1 + 0.2}
        currency="USD"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows catalog vs new USD price when they differ", () => {
    render(
      <PriceChangeWarning catalogPrice={10} currentPrice={8.5} currency="USD" />,
    );
    const warning = screen.getByTestId("price-change-warning");
    expect(warning).toHaveAttribute("role", "status");
    expect(warning).toHaveTextContent("Price changed: catalog $10.00 → $8.50");
  });

  it("formats LBP without decimals and ignores sub-unit noise", () => {
    const { rerender, container } = render(
      <PriceChangeWarning
        catalogPrice={500000}
        currentPrice={450000}
        currency="LBP"
      />,
    );
    expect(screen.getByTestId("price-change-warning")).toHaveTextContent(
      `Price changed: catalog ${(500000).toLocaleString()} LBP → ${(450000).toLocaleString()} LBP`,
    );
    rerender(
      <PriceChangeWarning
        catalogPrice={500000}
        currentPrice={500000.2}
        currency="LBP"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without a catalog price or a current price", () => {
    const { container, rerender } = render(
      <PriceChangeWarning catalogPrice={null} currentPrice={5} currency="USD" />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <PriceChangeWarning
        catalogPrice={5}
        currentPrice={undefined}
        currency="USD"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("disappears when the price is restored to the catalog price", () => {
    const { rerender, container } = render(
      <PriceChangeWarning catalogPrice={10} currentPrice={12} currency="USD" />,
    );
    expect(screen.getByTestId("price-change-warning")).toBeInTheDocument();
    rerender(
      <PriceChangeWarning catalogPrice={10} currentPrice={10} currency="USD" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
