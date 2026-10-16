import { render, screen } from "@testing-library/react";
import { BrandedLabel } from "@/shared/components/BrandedLabel";

describe("BrandedLabel", () => {
  it.each([
    ["Whish_App", "Whish App", "whish"],
    ["WHISH", "Whish", "whish"],
    ["OMT_System", "OMT Cash Drawer", "omt"],
    ["OMT_WALLET", "OMT Wallet", "omt"],
    ["iPick", "iPick", "ipick"],
    ["Katsh", "Katsh", "katsh"],
    ["MTC", "MTC", "mtc"],
    ["Alfa", "Alfa", "alfa"],
    ["BINANCE", "Binance", "binance"],
  ])("shows the %s brand icon before the unchanged label", (code, label, b) => {
    const { container } = render(<BrandedLabel code={code} label={label} />);
    const icon = screen.getByTestId(`provider-logo-${b}`);
    const text = screen.getByText(label);
    expect(icon).toHaveAttribute("aria-hidden", "true");
    // icon comes first, label text is untouched
    expect(icon.compareDocumentPosition(text)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(container.textContent).toBe(label);
  });

  it.each([["General"], ["CASH"], [""], [null], [undefined]])(
    "renders the plain label with no icon for code %p",
    (code) => {
      const { container } = render(
        <BrandedLabel code={code} label="Cash Drawer" />,
      );
      expect(screen.queryByTestId(/provider-logo/)).toBeNull();
      expect(container.innerHTML).toBe("Cash Drawer");
    },
  );
});
