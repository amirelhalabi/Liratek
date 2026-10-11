/** @jest-environment jsdom */

/**
 * CheckoutModal — a sale the server REFUSES left the checkout stuck on
 * "Processing..." forever (found live on the test tenant, 2026-10-11:
 * re-selling a phone line that had just sold returned
 * `{success:false, error:"Not enough stock ... (0 available)"}`).
 *
 * The POS's `handleCompleteSale` handles a `{success:false}` result itself —
 * it shows a "Sale failed: ..." toast and RETURNS NORMALLY, leaving the modal
 * open so the cashier can fix the basket. `handleComplete`/`handleSaveDraft`
 * only reset `isLoading` inside their `catch`, so on that normal return the
 * Complete Sale / Save Draft buttons stayed disabled with "Processing...".
 *
 * Here `onComplete`/`onSaveDraft` resolve without the modal being closed —
 * exactly what the POS does on a refused sale — and the buttons must come
 * back. `totalAmount={0}` skips the payment-completeness guards so the click
 * reaches `onComplete` unconditionally (same trick as
 * CheckoutModal.submitErrorSurfaced.test.tsx).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CheckoutModal from "../CheckoutModal";

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  const api = {
    getClients: jest.fn().mockResolvedValue([]),
    getAllSettings: jest.fn().mockResolvedValue([]),
  };
  return {
    ...actual,
    // Stable reference (rule 25).
    useApi: () => api,
    appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    MultiPaymentInput: () => <div data-testid="mock-multi-payment-input" />,
  };
});

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: null }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 90500, buyRate: 90000, isLoading: false }),
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

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

describe("CheckoutModal — a refused sale does not leave the buttons stuck", () => {
  it("Complete Sale comes back after onComplete returns without closing the modal", async () => {
    const onComplete = jest.fn().mockResolvedValue(undefined);

    render(
      <CheckoutModal
        totalAmount={0}
        onComplete={onComplete}
        onSaveDraft={jest.fn()}
      />,
    );

    await screen.findByTestId("mock-multi-payment-input");
    const btn = screen.getByTestId("checkout-complete-btn");
    fireEvent.click(btn);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(btn).toHaveTextContent("Complete Sale");
    expect(btn).not.toHaveTextContent("Processing...");
  });

  it("Save Draft comes back after onSaveDraft returns without closing the modal", async () => {
    const onSaveDraft = jest.fn().mockResolvedValue(undefined);

    render(
      <CheckoutModal
        totalAmount={0}
        onComplete={jest.fn()}
        onSaveDraft={onSaveDraft}
      />,
    );

    await screen.findByTestId("mock-multi-payment-input");
    fireEvent.click(screen.getByTestId("checkout-save-draft-btn"));

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("checkout-complete-btn")).not.toBeDisabled(),
    );
    expect(screen.getByTestId("checkout-save-draft-btn")).not.toBeDisabled();
  });
});
