/** @jest-environment jsdom */

/**
 * SessionCheckoutModal — kept change (G42, FEATURE_GUIDE §4.1).
 *
 *  - The pooled MultiPaymentInput declares `payer="customer"` explicitly
 *    (the customer pays the shop: change kept = shop profit).
 *  - A kept claim is sent with the schema's own field names.
 *  - A kept claim is NOT sent once the basket has no net charge left (the
 *    payment input is hidden then, so a value reported by an earlier render
 *    is stale — and the server, which now verifies kept change against the
 *    tender, would refuse the checkout).
 *
 * Rule 17: NOT proven failing-first — written after the modal change (the
 * change was not reverted to prove it, per the owner's rule). The server
 * half (core `SessionCheckoutService.keptChangeReconcile.test.ts`) was.
 *
 * Drives the REAL component, stubbing only MultiPaymentInput (buttons fire
 * its real `onChange` / `onKeptChange` props) — same seam as
 * SessionCheckoutModal.nettedCheckout.test.tsx.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SessionCheckoutInput } from "@liratek/core";
import { SessionCheckoutModal } from "../SessionCheckoutModal";
import type { CartItem } from "../../types/cart";

// Rule 24: field names come from the shared schema's input type.
const KEPT_USD: keyof SessionCheckoutInput = "kept_change_usd";
const KEPT_LBP: keyof SessionCheckoutInput = "kept_change_lbp";

const mockClearCart = jest.fn();
const mockRefreshActiveSessions = jest.fn().mockResolvedValue(undefined);
const mockCheckout = jest
  .fn()
  .mockResolvedValue({ success: true, itemCount: 1 });

const mockActiveSession = {
  id: 1,
  customer_name: "Walk-in",
  customer_phone: undefined,
  started_at: "2026-10-07T00:00:00.000Z",
  started_by: "tester",
  is_active: 1 as const,
};

const CHARGE: CartItem = {
  id: "charge-1",
  module: "custom_service",
  label: "Screen protector",
  amount: 100,
  currency: "USD",
  formData: {},
  ipcChannel: "custom-services:add",
};
const PRIZE: CartItem = {
  id: "prize-1",
  module: "loto_prize",
  label: "Loto Cash Prize",
  amount: -100,
  currency: "USD",
  formData: {},
  ipcChannel: "loto:cash-prize:create",
};

let mockCartItems: CartItem[] = [CHARGE];

function cartTotalsOf(items: CartItem[]) {
  return items.reduce(
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
    activeSession: mockActiveSession,
    cartItems: mockCartItems,
    clearCart: mockClearCart,
    getCartTotals: () => cartTotalsOf(mockCartItems),
    refreshActiveSessions: mockRefreshActiveSessions,
  }),
}));

// Rule 25: a STABLE useApi() reference, hoisted once.
const mockApi = {
  session: { checkout: mockCheckout },
  getAllSettings: jest.fn().mockResolvedValue([]),
  getClients: jest.fn().mockResolvedValue([]),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  MultiPaymentInput: (props: Record<string, unknown>) => (
    <div data-testid="stub-multi-payment-input">
      <div data-testid="mpi-payer">{String(props.payer)}</div>
      <button
        type="button"
        data-testid="tender-105-keep-5"
        onClick={() => {
          (props.onChange as (lines: unknown[]) => void)([
            { id: "l1", method: "CASH", currencyCode: "USD", amount: 105 },
          ]);
          (props.onKeptChange as (k: { usd: number; lbp: number }) => void)({
            usd: 5,
            lbp: 0,
          });
        }}
      >
        tender $105, keep $5
      </button>
    </div>
  ),
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
  useSellRate: () => ({ sellRate: 90000, buyRate: 89000, isLoading: false }),
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

function confirm() {
  fireEvent.click(screen.getByRole("button", { name: /confirm checkout/i }));
}

describe("SessionCheckoutModal — kept change (G42)", () => {
  beforeEach(() => {
    mockCheckout.mockClear();
    mockCartItems = [CHARGE];
  });

  it('declares payer="customer" on the pooled payment input', () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId("mpi-payer").textContent).toBe("customer");
  });

  it("sends the kept claim with the schema's field names", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("tender-105-keep-5"));
    confirm();

    await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
    const payload = mockCheckout.mock.calls[0][0] as Record<string, unknown>;
    expect(payload[KEPT_USD]).toBe(5);
    expect(payload[KEPT_LBP]).toBe(0);
  });

  it("does not send a stale kept claim once the basket has no net charge", async () => {
    const { rerender } = render(
      <SessionCheckoutModal isOpen={true} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("tender-105-keep-5"));

    // A $100 cash prize now cancels the $100 charge: nothing left to
    // collect, the payment input disappears.
    mockCartItems = [CHARGE, PRIZE];
    rerender(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    expect(screen.queryByTestId("stub-multi-payment-input")).toBeNull();

    confirm();
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
    const payload = mockCheckout.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty(KEPT_USD);
    expect(payload).not.toHaveProperty(KEPT_LBP);
  });
});
