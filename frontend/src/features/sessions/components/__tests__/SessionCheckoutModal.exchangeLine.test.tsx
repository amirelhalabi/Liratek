/** @jest-environment jsdom */

/**
 * LIRA-380 — the session checkout with an exchange line.
 *
 * A $20 charger + a $100 → 8,950,000 LBP exchange: the customer gives $120
 * (the charge) and receives 8,950,000 LBP (the exchange's payout). The
 * exchange's payout is NEVER netted against the charge at the checkout's
 * editable rate (owner 2026-11-11: the session rate must not re-price the
 * exchange) — it goes out as its own gross General PAYOUT leg of exactly
 * 8,950,000 LBP, whatever rate the cashier types at checkout.
 *
 * Rule 17: NOT proven failing-first — written after the modal change; the
 * same rule is proven failing-first one level down
 * (binanceCart.exchangeLine.test.ts: `payoutLbp` expected 8950000, received 0).
 * Harness copied from SessionCheckoutModal.nettedCheckout.test.tsx.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionCheckoutModal } from "../SessionCheckoutModal";
import type { CartItem } from "../../types/cart";

const mockClearCart = jest.fn();
const mockRefreshActiveSessions = jest.fn().mockResolvedValue(undefined);
const mockCheckout = jest
  .fn()
  .mockResolvedValue({ success: true, itemCount: 2 });

const mockActiveSession: {
  id: number;
  customer_name?: string | undefined;
  customer_phone?: string | undefined;
  started_at: string;
  started_by: string;
  is_active: 1;
} | null = {
  id: 1,
  customer_name: "Walk-in",
  customer_phone: undefined,
  started_at: "2026-09-24T00:00:00.000Z",
  started_by: "tester",
  is_active: 1,
};

// LIRA-380: a $20 charger and a $100 → 8,950,000 LBP exchange line.
const EXCHANGE_FORM = {
  fromCurrency: "USD",
  toCurrency: "LBP",
  amountIn: 100,
  amountOut: 8_950_000,
  leg1Rate: 89_500,
  leg1MarketRate: 89_750,
  leg1ProfitUsd: 0.28,
  totalProfitUsd: 0.28,
};
let mockCartItems: CartItem[] = [];

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

// Rule 25 (CLAUDE.md) / fix-round finding #9 (2026-09-24): `useApi()` must
// return a STABLE reference across renders, exactly like the real
// `ApiProvider` (backed by the module-level `backendApiAdapter` singleton) —
// a `jest.mock` factory returning a fresh object literal on every call hides
// the exact identity churn production code must tolerate. Hoisted once,
// module-level, and returned as-is (never rebuilt inside the mock factory
// below).
const mockApi = {
  session: { checkout: mockCheckout },
  getAllSettings: jest.fn().mockResolvedValue([]),
  getClients: jest.fn().mockResolvedValue([]),
};

// Stub MultiPaymentInput — exposes buttons that fire the REAL onChange /
// onReturnChange props with exactly what the owner typed ("$50 cash" then
// "40$ + 10,000 LBP" change), and prints the `totals` prop it was given so
// the test can assert the NET (not gross) charge reached the widget.
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  MultiPaymentInput: (props: Record<string, unknown>) => (
    <div data-testid="stub-multi-payment-input">
      <div data-testid="mpi-totals">{JSON.stringify(props.totals)}</div>
      <button
        type="button"
        data-testid="tender-120-usd-cash"
        onClick={() => {
          const onChange = props.onChange as (lines: unknown[]) => void;
          onChange([
            { id: "l1", method: "CASH", currencyCode: "USD", amount: 120 },
          ]);
        }}
      >
        tender $120 cash
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

describe("LIRA-380 — SessionCheckoutModal with an exchange line", () => {
  beforeEach(() => {
    mockCheckout.mockClear();
    mockCartItems = [
      {
        id: "charger",
        module: "custom_service",
        label: "Charger",
        amount: 20,
        currency: "USD",
        formData: {},
        ipcChannel: "custom-services:add",
      },
      {
        id: "ex",
        module: "exchange",
        label: "Exchange $100 → 8,950,000 LBP @ 89,500",
        amount: 100,
        currency: "USD",
        formData: EXCHANGE_FORM,
        ipcChannel: "exchange:add-transaction",
      },
    ];
  });

  it("the customer pays $120 — the exchange's lira are not netted into the charge", () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    const totals = JSON.parse(
      screen.getByTestId("mpi-totals").textContent || "[]",
    ) as Array<{ amount: number; currency: string }>;
    expect(totals.find((t) => t.currency === "USD")?.amount).toBe(120);
    expect(totals.find((t) => t.currency === "LBP")).toBeUndefined();
  });

  it("submits IN $120 and ONE gross General payout of exactly 8,950,000 LBP", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("tender-120-usd-cash"));
    const confirmButton = screen.getByRole("button", {
      name: /confirm checkout/i,
    });
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
    const payments = mockCheckout.mock.calls[0][0].payments as Array<
      Record<string, unknown>
    >;
    expect(payments).toEqual([
      expect.objectContaining({
        method: "CASH",
        currency_code: "USD",
        amount: 120,
        direction: "IN",
      }),
      {
        method: "CASH",
        currency_code: "LBP",
        amount: 8_950_000,
        direction: "OUT",
        kind: "PAYOUT",
        payoutOrigin: "GENERAL",
      },
    ]);
  });
});
