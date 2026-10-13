/** @jest-environment jsdom */

/**
 * LIRA-319 T051 — the extra at the session basket checkout.
 *
 *  - The pooled MultiPaymentInput gets `onExtraChange` (extra-only line:
 *    `showDiscount` stays false — a basket takes no discount).
 *  - The extra the input reports is owed on top of the basket: Confirm stays
 *    blocked until the payment covers items + extra.
 *  - It is sent with the schema's own field names (rule 24), in the basket's
 *    currency, only when there is one.
 *  - No Waive is offered while an extra is set (a discount or an extra,
 *    not both).
 *
 * Drives the REAL component, stubbing only MultiPaymentInput.
 * Not proven failing-first (rule 17): written after the modal change.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SessionCheckoutInput } from "@liratek/core";
import { SessionCheckoutModal } from "../SessionCheckoutModal";
import type { CartItem } from "../../types/cart";

// Rule 24: field names come from the shared schema's input type.
const EXTRA_USD: keyof SessionCheckoutInput = "extra_usd";
const EXTRA_LBP: keyof SessionCheckoutInput = "extra_lbp";
const WAIVED_USD: keyof SessionCheckoutInput = "waived_usd";

const mockClearCart = jest.fn();
const mockRefreshActiveSessions = jest.fn().mockResolvedValue(undefined);
const mockCheckout = jest
  .fn()
  .mockResolvedValue({ success: true, itemCount: 1 });

const mockActiveSession = {
  id: 1,
  customer_name: "Walk-in",
  customer_phone: undefined,
  started_at: "2026-10-11T00:00:00.000Z",
  started_by: "tester",
  is_active: 1 as const,
};

const CHARGE: CartItem = {
  id: "charge-1",
  module: "custom_service",
  label: "Screen protector",
  amount: 20,
  currency: "USD",
  formData: {},
  ipcChannel: "custom-services:add",
};

const mockCartItems: CartItem[] = [CHARGE];

jest.mock("../../context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockActiveSession,
    cartItems: mockCartItems,
    clearCart: mockClearCart,
    getCartTotals: () => ({
      usd: mockCartItems.reduce((s, i) => s + i.amount, 0),
      lbp: 0,
      usdt: 0,
    }),
    refreshActiveSessions: mockRefreshActiveSessions,
  }),
}));

// Rule 25: a STABLE useApi() reference, hoisted once.
const mockApi = {
  session: { checkout: mockCheckout },
  getAllSettings: jest.fn().mockResolvedValue([]),
  getClients: jest.fn().mockResolvedValue([]),
};

let lastMpiProps: Record<string, unknown> = {};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  MultiPaymentInput: (props: Record<string, unknown>) => {
    lastMpiProps = props;
    const pay = (amount: number) =>
      (props.onChange as (lines: unknown[]) => void)([
        { id: "l1", method: "CASH", currencyCode: "USD", amount },
      ]);
    return (
      <div data-testid="stub-multi-payment-input">
        <div data-testid="mpi-totals">{JSON.stringify(props.totals)}</div>
        <button type="button" data-testid="tender-20" onClick={() => pay(20)}>
          tender $20
        </button>
        <button type="button" data-testid="tender-22" onClick={() => pay(22)}>
          tender $22
        </button>
        <button
          type="button"
          data-testid="extra-2"
          onClick={() =>
            (props.onExtraChange as ((x: number) => void) | undefined)?.(2)
          }
        >
          extra $2
        </button>
        <button
          type="button"
          data-testid="waive"
          onClick={() =>
            (
              props.onWaiveRemaining as
                | ((a: number, m: Array<{ currency: string; amount: number }>) => void)
                | undefined
            )?.(3, [{ currency: "USD", amount: 3 }])
          }
        >
          waive
        </button>
      </div>
    );
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

function confirmButton(): HTMLElement {
  return screen.getByRole("button", { name: /confirm checkout/i });
}

describe("SessionCheckoutModal — extra (LIRA-319)", () => {
  beforeEach(() => {
    mockCheckout.mockClear();
    lastMpiProps = {};
  });

  it("turns on the extra-only line: onExtraChange given, discount still hidden", () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    expect(typeof lastMpiProps.onExtraChange).toBe("function");
    expect(lastMpiProps.showDiscount).toBe(false);
  });

  it("$2 extra on a $20 basket: $20 no longer covers it, $22 does", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("extra-2"));
    fireEvent.click(screen.getByTestId("tender-20"));
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(screen.getByTestId("tender-22"));
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
  });

  it("sends the extra with the schema's field names (USD basket → extra_usd)", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("extra-2"));
    fireEvent.click(screen.getByTestId("tender-22"));
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
    const payload = mockCheckout.mock.calls[0][0] as Record<string, unknown>;
    expect(payload[EXTRA_USD]).toBe(2);
    expect(payload).not.toHaveProperty(EXTRA_LBP);
    expect(payload).not.toHaveProperty(WAIVED_USD);
  });

  it("offers no Waive while an extra is set", () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    expect(typeof lastMpiProps.onWaiveRemaining).toBe("function");
    fireEvent.click(screen.getByTestId("extra-2"));
    expect(lastMpiProps.onWaiveRemaining).toBeUndefined();
  });

  it("sends no extra key without an extra", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("tender-20"));
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
    const payload = mockCheckout.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty(EXTRA_USD);
    expect(payload).not.toHaveProperty(EXTRA_LBP);
  });
});
