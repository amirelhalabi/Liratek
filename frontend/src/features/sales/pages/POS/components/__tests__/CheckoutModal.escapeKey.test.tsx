/**
 * CheckoutModal — LIRA-245 guard.
 *
 * Bug: pressing Escape in checkout — even with ONLY the receipt preview
 * submodal open — closed the whole checkout (calling onClose ?? onCancel)
 * via a document-level keydown listener that ignored `showReceiptPreview`.
 * On POS (frontend/src/features/sales/pages/POS/index.tsx) the modal is
 * wired with `onCancel={handleCancelOrder}` and no `onClose`, so that
 * fallback landed on `handleCancelOrder`, which empties the cart
 * (`setCartItems([])`) with no confirmation — an accidental Escape press
 * threw away the whole order.
 *
 * Fix under test (LIRA-245): Escape closes only the topmost panel.
 *   - Receipt preview open -> Escape closes JUST the preview; neither
 *     onClose nor onCancel fires, and the checkout modal (with the cart
 *     summary) stays open.
 *   - No submodal open -> Escape closes the checkout modal itself via
 *     onClose (a non-destructive "return to cart" close), never onCancel
 *     (which clears the cart) — onCancel is only used as a fallback when a
 *     host wires no onClose at all.
 *
 * `MultiPaymentInput` is stubbed exactly as in
 * CheckoutModal.extraTotalsInert.test.tsx — it isn't under test here.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import CheckoutModal from "../CheckoutModal";

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      getClients: jest.fn().mockResolvedValue([]),
      getAllSettings: jest.fn().mockResolvedValue([]),
    }),
    MultiPaymentInput: () => (
      <div data-testid="mock-multi-payment-input" />
    ),
  };
});

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: null }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({
    sellRate: 90500,
    buyRate: 90000,
    isLoading: false,
  }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [],
    allMethods: [{ id: 1, code: "CASH", label: "Cash", is_active: 1 }],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Shop", phone: "", location: "", logo: "" }),
}));

function pressEscape() {
  fireEvent.keyDown(document, { key: "Escape" });
}

describe("CheckoutModal — Escape key (LIRA-245)", () => {
  it("with the receipt preview open, Escape closes ONLY the preview — onClose/onCancel never fire, cart summary stays mounted", async () => {
    const onClose = jest.fn();
    const onCancel = jest.fn();
    render(
      <CheckoutModal
        items={[
          {
            id: 1,
            name: "Widget",
            barcode: "123",
            retail_price: 10,
            quantity: 1,
            category: "",
            cost_price: 0,
            stock_quantity: 5,
            min_stock_level: 0,
            is_active: 1,
          } as any,
        ]}
        totalAmount={10}
        onComplete={jest.fn()}
        onSaveDraft={jest.fn()}
        onClose={onClose}
        onCancel={onCancel}
      />,
    );

    await screen.findByTestId("mock-multi-payment-input");
    fireEvent.click(screen.getByText("Preview"));
    expect(await screen.findByText("Receipt Preview")).toBeInTheDocument();

    pressEscape();

    expect(screen.queryByText("Receipt Preview")).not.toBeInTheDocument();
    // The checkout modal itself (identifiable by its cart summary) must
    // still be open — Escape must not have cancelled the whole order.
    expect(screen.getByTestId("checkout-modal")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("with no submodal open, Escape calls onClose (never onCancel) when onClose is provided", async () => {
    const onClose = jest.fn();
    const onCancel = jest.fn();
    render(
      <CheckoutModal
        totalAmount={10}
        onComplete={jest.fn()}
        onSaveDraft={jest.fn()}
        onClose={onClose}
        onCancel={onCancel}
      />,
    );

    await screen.findByTestId("mock-multi-payment-input");
    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
