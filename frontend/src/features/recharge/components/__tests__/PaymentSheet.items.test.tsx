/** @jest-environment jsdom */
/**
 * The payment window lists the items picked on a card grid: picture (or a
 * placeholder), name, group, quantity × unit price and line total.
 * Written before the change (rule 17).
 */
import { render, screen, within } from "@testing-library/react";
import { PaymentSheet, type PaymentSheetItem } from "../PaymentSheet";

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  MultiPaymentInput: () => <div data-testid="stub-payment-input" />,
}));

const ITEMS: PaymentSheetItem[] = [
  {
    key: "a",
    name: "DSL EXTRA VOLUME 5GB",
    group: "Terranet",
    image: "card.jpg",
    provider: "IPICK",
    quantity: 2,
    unitPrice: 207000,
    currency: "LBP",
  },
  {
    key: "b",
    name: "10 days",
    group: "Validity",
    provider: "KATSH",
    quantity: 1,
    unitPrice: 100000,
    currency: "LBP",
    note: "Only days",
  },
];

function renderSheet(items?: PaymentSheetItem[]) {
  return render(
    <PaymentSheet
      open
      onClose={() => {}}
      onConfirm={() => {}}
      totalAmount={514000}
      totalAmountCurrency="LBP"
      currency="LBP"
      paymentMethods={[{ code: "CASH", label: "Cash" }]}
      onPaymentChange={() => {}}
      {...(items ? { items } : {})}
    />,
  );
}

describe("PaymentSheet — picked items", () => {
  it("lists every item with picture, name, group, qty × price and line total", () => {
    renderSheet(ITEMS);
    const list = screen.getByTestId("payment-sheet-items");
    expect(within(list).getByText("Items (3)")).toBeInTheDocument();

    const first = within(list).getByText("DSL EXTRA VOLUME 5GB").closest("li");
    expect(first).not.toBeNull();
    const row = within(first as HTMLElement);
    expect(row.getByRole("img")).toHaveAttribute("src", "card.jpg");
    expect(row.getByText("Terranet")).toBeInTheDocument();
    expect(row.getByText("2 × 207,000 LBP")).toBeInTheDocument();
    expect(row.getByText("414,000 LBP")).toBeInTheDocument();

    const second = within(list).getByText("10 days").closest("li");
    const row2 = within(second as HTMLElement);
    // The artwork placeholder is not an image; the provider logo is decorative.
    expect(row2.queryByRole("img")).toBeNull();
    expect(row2.getByText("Validity · Only days")).toBeInTheDocument();
    expect(row2.getByText("100,000 LBP")).toBeInTheDocument();
  });

  it("groups items under a provider header with its subtotal", () => {
    renderSheet([
      ...ITEMS,
      {
        key: "c",
        name: "4.5",
        group: "Prepaid",
        provider: "IPICK",
        quantity: 1,
        unitPrice: 500000,
        currency: "LBP",
      },
    ]);
    const groups = screen.getAllByTestId("payment-sheet-item-group");
    expect(groups).toHaveLength(2);
    const ipick = within(groups[0] as HTMLElement);
    expect(ipick.getByText("iPick")).toBeInTheDocument();
    expect(
      (groups[0] as HTMLElement).querySelector(
        '[data-testid="provider-logo-ipick"]',
      ),
    ).not.toBeNull();
    // 2 × 207,000 + 500,000
    expect(ipick.getByText("914,000 LBP")).toBeInTheDocument();
    expect(ipick.getByText("DSL EXTRA VOLUME 5GB")).toBeInTheDocument();
    expect(ipick.getAllByText("4.5").length).toBeGreaterThan(0);
    const katsh = within(groups[1] as HTMLElement);
    expect(katsh.getByText("Katsh")).toBeInTheDocument();
    expect(katsh.getByText("10 days")).toBeInTheDocument();
  });

  it("scrolls the list inside the window; the sections below never shrink", () => {
    renderSheet(ITEMS);
    const box = screen.getByTestId("payment-sheet-items");
    // The box is the only body section allowed to shrink …
    expect(box).toHaveAttribute("data-shrinkable");
    // … and its rows scroll inside it, under a fixed "Items" header.
    const scroller = screen.getByTestId("payment-sheet-items-scroll");
    expect(scroller).toHaveClass("overflow-y-auto");
    expect(scroller).toHaveClass("min-h-0");
    // Every other body section keeps its height.
    expect(box.parentElement).toHaveClass(
      "[&>*:not([data-shrinkable])]:shrink-0",
    );
  });

  it("shows no list when no items are passed", () => {
    renderSheet();
    expect(screen.queryByTestId("payment-sheet-items")).toBeNull();
  });
});
