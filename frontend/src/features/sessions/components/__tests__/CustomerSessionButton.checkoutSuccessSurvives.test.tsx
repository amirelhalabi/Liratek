/** @jest-environment jsdom */
/**
 * The session checkout "Checkout Complete" view (with its Print button) must
 * survive the session closing.
 *
 * Checkout closes the session server-side (`recordCheckoutClose` sets
 * `is_active = 0`, shared core — both transports), so the modal's
 * `await refreshActiveSessions()` sets `activeSession` to null BEFORE the
 * modal gets to `setCheckoutSuccess(...)`. The modal's own guard
 * (`!activeSession && !checkoutSuccess`) is not enough: it used to be
 * rendered inside `SessionPopupPanel` (`if (!activeSession) return null`),
 * which `CustomerSessionButton` only mounts while `isHovered &&
 * hasActiveSession`. Both parents dropped it the moment the session went
 * null, so the success view never appeared on desktop or web.
 *
 * Unlike the other SessionCheckoutModal tests, this one renders the REAL
 * parent chain (CustomerSessionButton -> SessionPopupPanel -> modal) against
 * a STATEFUL useSession store whose refreshActiveSessions really clears the
 * active session — a static mock cannot reproduce the unmount.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { CustomerSessionButton } from "../CustomerSessionButton";
import type { CartItem } from "../../types/cart";

interface MockSessionState {
  activeSession: {
    id: number;
    customer_name?: string;
    customer_phone?: string;
    started_at: string;
    started_by: string;
    is_active: number;
  } | null;
  cartItems: CartItem[];
}

const mockInitialSession = {
  id: 7,
  customer_name: "Walk-in",
  started_at: "2026-10-10 10:00:00",
  started_by: "tester",
  is_active: 1,
};

// Payout-only basket: nothing to collect, so Confirm is enabled untouched.
const mockInitialCart: CartItem[] = [
  {
    id: "item-1",
    module: "omt_system",
    label: "OMT RECEIVE",
    amount: -100,
    currency: "USD",
    formData: {},
    ipcChannel: "financial:create",
  },
];

let mockState: MockSessionState = {
  activeSession: mockInitialSession,
  cartItems: mockInitialCart,
};
const mockListeners = new Set<() => void>();
function mockSetState(patch: Partial<MockSessionState>) {
  mockState = { ...mockState, ...patch };
  mockListeners.forEach((l) => l());
}
function mockSubscribe(l: () => void) {
  mockListeners.add(l);
  return () => mockListeners.delete(l);
}

// Stable module-level fns (rule 25).
const mockClearCart = jest.fn(() => mockSetState({ cartItems: [] }));
// Mirrors SessionContext.refreshActiveSessions after a checkout: the closed
// session is no longer in the active list, so activeSession goes null.
const mockRefreshActiveSessions = jest.fn(async () => {
  mockSetState({ activeSession: null, cartItems: [] });
});
const mockGetCartTotals = () =>
  mockState.cartItems.reduce(
    (t, i) => {
      if (i.currency === "USD") t.usd += i.amount;
      else if (i.currency === "LBP") t.lbp += i.amount;
      return t;
    },
    { usd: 0, lbp: 0, usdt: 0 },
  );
const mockNoop = jest.fn();

jest.mock("../../context/SessionContext", () => ({
  useSession: () => {
    const s = useSyncExternalStore(mockSubscribe, () => mockState);
    return {
      activeSession: s.activeSession,
      allActiveSessions: s.activeSession ? [s.activeSession] : [],
      allTodaySessions: s.activeSession ? [s.activeSession] : [],
      sessionTransactions: [],
      cartItems: s.cartItems,
      cartItemCount: s.cartItems.length,
      getCartTotals: mockGetCartTotals,
      clearCart: mockClearCart,
      refreshActiveSessions: mockRefreshActiveSessions,
      removeFromCart: mockNoop,
      closeCurrentSession: mockNoop,
      updateSessionInfo: mockNoop,
      switchToSession: mockNoop,
      closeSession: mockNoop,
      deleteSession: mockNoop,
      startSession: mockNoop,
    };
  },
}));

const mockCheckout = jest.fn(async () => ({ success: true, itemCount: 1 }));
// Stable identity across renders (rule 25).
const mockApi = {
  session: { checkout: mockCheckout },
  getAllSettings: jest.fn(async () => []),
  getClients: jest.fn(async () => []),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  MultiPaymentInput: () => <div data-testid="stub-multi-payment-input" />,
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "tester", role: "admin" } }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [],
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

describe("CustomerSessionButton — checkout success view survives the session closing", () => {
  beforeEach(() => {
    mockState = {
      activeSession: mockInitialSession,
      cartItems: mockInitialCart,
    };
    mockCheckout.mockClear();
    mockRefreshActiveSessions.mockClear();
  });

  it("shows 'Checkout Complete' after checkout even though activeSession goes null", async () => {
    render(<CustomerSessionButton />);

    // Hover the session button to mount the popup panel.
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: /Customer Session/i }).parentElement!,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Checkout \(1 items\)/ }),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Confirm Checkout/i }),
      );
    });

    // The checkout really ran and really closed the session client-side —
    // proves the assertion below is reached for the right reason.
    expect(mockCheckout).toHaveBeenCalledTimes(1);
    expect(mockRefreshActiveSessions).toHaveBeenCalledTimes(1);
    expect(mockState.activeSession).toBeNull();

    expect(await screen.findByText("Checkout Complete")).toBeTruthy();
  });
});
