/** @jest-environment jsdom */

/**
 * SessionCheckoutModal — a For-Partner (FOR) OMT/Whish transfer in the basket
 * is not the walk-in customer's to pay (FEATURE_GUIDE §8.1.0: obligations
 * only, the partner owes the shop). The Services page carts it with the
 * customer total as `amount` (SEND: +(x + f)); a basket persisted before the
 * fix still carries that amount, so the modal must apply the shared rule
 * itself.
 *
 *  - walk-in $20 + FOR SEND (amount 105): amount due is $20, not $125;
 *  - FOR SEND alone: nothing to collect, Confirm is enabled and the checkout
 *    goes out with no payment legs (the item still books the partner).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionCheckoutModal } from "../SessionCheckoutModal";
import type { CartItem } from "../../types/cart";

const mockClearCart = jest.fn();
const mockRefreshActiveSessions = jest.fn().mockResolvedValue(undefined);
const mockCheckout = jest
  .fn()
  .mockResolvedValue({ success: true, itemCount: 1 });
const mockTotals: Array<Array<{ amount: number; currency: string }>> = [];

const walkIn: CartItem = {
  id: "walk-in",
  module: "custom_service",
  label: "Screen protector",
  amount: 20,
  currency: "USD",
  formData: { description: "Screen protector", price_usd: 20 },
  ipcChannel: "custom-services:add",
};

const forSend: CartItem = {
  id: "for-send",
  module: "omt_system",
  label: "OMT SEND - Walk-in - $100.00 + $5.00 fees",
  amount: 105,
  currency: "USD",
  formData: {
    provider: "OMT",
    serviceType: "SEND",
    amount: 100,
    currency: "USD",
    omtServiceType: "INTRA",
    omtFee: 5,
    includingFees: false,
    payments: [],
    paymentMethodFee: 0,
    partnerId: 7,
    partnerMode: "FOR",
  },
  ipcChannel: "financial:create",
};

let cartItems: CartItem[] = [];

function getCartTotals() {
  return cartItems.reduce(
    (totals, item) => {
      if (item.currency === "USD") totals.usd += item.amount;
      else if (item.currency === "LBP") totals.lbp += item.amount;
      else if (item.currency === "USDT") totals.usdt += item.amount;
      return totals;
    },
    { usd: 0, lbp: 0, usdt: 0 },
  );
}

jest.mock("../../context/SessionContext", () => ({
  useSession: () => ({
    activeSession: {
      id: 1,
      customer_name: "Walk-in",
      customer_phone: undefined,
      started_at: "2026-08-06T00:00:00.000Z",
      started_by: "tester",
      is_active: 1 as const,
    },
    cartItems,
    clearCart: mockClearCart,
    getCartTotals,
    refreshActiveSessions: mockRefreshActiveSessions,
  }),
}));

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    session: { checkout: mockCheckout },
    getAllSettings: jest.fn().mockResolvedValue([]),
  }),
  // Stub — records the per-currency amount due the modal hands it.
  MultiPaymentInput: (props: {
    totals: Array<{ amount: number; currency: string }>;
  }) => {
    mockTotals.push(props.totals);
    return <div data-testid="stub-multi-payment-input" />;
  },
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "tester", role: "admin" } }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
    allMethods: [{ code: "CASH", label: "Cash" }],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Test Shop", phone: "", location: "", logo: "" }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/shared/utils/printReceipt", () => ({
  printReceipt: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("SessionCheckoutModal — a For-Partner transfer is not charged to the walk-in customer", () => {
  beforeEach(() => {
    mockTotals.length = 0;
    mockCheckout.mockClear();
  });

  it("walk-in $20 + FOR SEND: the amount due is $20", () => {
    cartItems = [walkIn, forSend];
    render(<SessionCheckoutModal isOpen={true} onClose={jest.fn()} />);
    expect(screen.getByTestId("stub-multi-payment-input")).toBeInTheDocument();
    expect(mockTotals[mockTotals.length - 1]).toEqual([
      { amount: 20, currency: "USD" },
    ]);
  });

  it("FOR SEND alone: nothing to collect, Confirm checks out with no payment legs", async () => {
    cartItems = [forSend];
    render(<SessionCheckoutModal isOpen={true} onClose={jest.fn()} />);
    expect(screen.queryByTestId("stub-multi-payment-input")).toBeNull();
    const confirm = screen.getByRole("button", { name: /Confirm Checkout/ });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
    const req = mockCheckout.mock.calls[0][0] as {
      payments: unknown[];
      cartItems: Array<{ id: string; formData: Record<string, unknown> }>;
    };
    expect(req.payments).toEqual([]);
    expect(req.cartItems).toHaveLength(1);
    expect(req.cartItems[0].formData.partnerMode).toBe("FOR");
  });
});
