/** @jest-environment jsdom */

/**
 * LIRA-310 T032 — Waive at the session basket checkout.
 *
 *  - The pooled MultiPaymentInput gets `onWaiveRemaining`; a click stores
 *    the per-currency remainder it reports (no client-side re-derivation).
 *  - The waived amount comes off the totals the payment input must cover,
 *    so its Remaining row (and the Waive with it) goes away, and Confirm
 *    is enabled for the short payment.
 *  - The claim is sent with the schema's own field names (rule 24), only
 *    when there is one; the server verifies it against the real gap.
 *  - A stale waive (the cashier changes the payment afterwards, so the gap
 *    no longer equals the waived amount) is dropped, never sent.
 *
 * Drives the REAL component, stubbing only MultiPaymentInput.
 * Rule 17: run against the unchanged modal first; see tasks.md T032.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SessionCheckoutInput } from "@liratek/core";
import { SessionCheckoutModal } from "../SessionCheckoutModal";
import type { CartItem } from "../../types/cart";

// Rule 24: field names come from the shared schema's input type.
const WAIVED_USD: keyof SessionCheckoutInput = "waived_usd";
const WAIVED_LBP: keyof SessionCheckoutInput = "waived_lbp";

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
        <button type="button" data-testid="tender-17" onClick={() => pay(17)}>
          tender $17
        </button>
        <button type="button" data-testid="tender-18" onClick={() => pay(18)}>
          tender $18
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

describe("SessionCheckoutModal — Waive (LIRA-310)", () => {
  beforeEach(() => {
    mockCheckout.mockClear();
    lastMpiProps = {};
  });

  it("gives the payment input an onWaiveRemaining handler", () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    expect(typeof lastMpiProps.onWaiveRemaining).toBe("function");
  });

  it("$17 on a $20 basket: Confirm is blocked until Waive, then the $3 leaves the totals", () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("tender-17"));
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(screen.getByTestId("waive"));
    expect(JSON.parse(screen.getByTestId("mpi-totals").textContent ?? "[]")).toEqual([
      { amount: 17, currency: "USD" },
    ]);
    expect(confirmButton()).not.toBeDisabled();
  });

  it("sends the waived claim with the schema's field names", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("tender-17"));
    fireEvent.click(screen.getByTestId("waive"));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
    const payload = mockCheckout.mock.calls[0][0] as Record<string, unknown>;
    expect(payload[WAIVED_USD]).toBe(3);
    expect(payload).not.toHaveProperty(WAIVED_LBP);
  });

  it("drops a stale waive when the payment changes afterwards", () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("tender-17"));
    fireEvent.click(screen.getByTestId("waive"));
    // The customer finds another dollar: the gap is now $2, not the $3
    // waived — the waive is dropped and the full total is due again.
    fireEvent.click(screen.getByTestId("tender-18"));
    expect(JSON.parse(screen.getByTestId("mpi-totals").textContent ?? "[]")).toEqual([
      { amount: 20, currency: "USD" },
    ]);
    expect(confirmButton()).toBeDisabled();
  });

  it("sends no waived key without a waive", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("tender-17"));
    fireEvent.click(screen.getByTestId("tender-18"));
    // ($18 still short: pay in full to confirm)
    (lastMpiProps.onChange as (l: unknown[]) => void)([
      { id: "l1", method: "CASH", currencyCode: "USD", amount: 20 },
    ]);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
    const payload = mockCheckout.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty(WAIVED_USD);
    expect(payload).not.toHaveProperty(WAIVED_LBP);
  });
});
