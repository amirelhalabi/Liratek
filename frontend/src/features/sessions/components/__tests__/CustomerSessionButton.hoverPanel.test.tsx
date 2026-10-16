/** @jest-environment jsdom */
/**
 * The session hover panel must not sit over the page by accident
 * (shop-day test 2026-10-16: on Mobile Recharge it covered the provider
 * tabs, so clicks on MTC/Alfa/... landed on the panel instead).
 *
 * The panel hangs under the top-bar session button, so while it is open it
 * covers whatever is below. It now:
 *  - opens only after the pointer RESTS on the button (a cursor passing
 *    through the top bar on its way into the page no longer opens it);
 *  - keeps a short grace only for crossing from the button to the panel;
 *  - closes as soon as the pointer leaves the panel itself;
 *  - closes on Escape.
 * Trigger -> panel -> Checkout still opens the checkout.
 *
 * Harness copied from CustomerSessionButton.checkoutSuccessSurvives.test.tsx
 * (stateful useSession store, stable useApi — rule 25).
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

const trigger = () =>
  screen.getByRole("button", { name: /Customer Session/i }).parentElement!;
const panelCheckout = () =>
  screen.queryByRole("button", { name: /Checkout \(1 items\)/ });

describe("CustomerSessionButton — hover panel", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockState = {
      activeSession: mockInitialSession,
      cartItems: mockInitialCart,
    };
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("a pointer passing over the button does not open the panel", () => {
    render(<CustomerSessionButton />);
    fireEvent.mouseEnter(trigger());
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(panelCheckout()).toBeNull();
    fireEvent.mouseLeave(trigger());
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(panelCheckout()).toBeNull();
  });

  it("resting on the button opens the panel", () => {
    render(<CustomerSessionButton />);
    fireEvent.mouseEnter(trigger());
    expect(panelCheckout()).toBeNull();
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(panelCheckout()).not.toBeNull();
  });

  it("leaving the panel into the page closes it at once", () => {
    render(<CustomerSessionButton />);
    fireEvent.mouseEnter(trigger());
    act(() => {
      jest.advanceTimersByTime(300);
    });
    const panel = screen.getByTestId("session-hover-panel");
    fireEvent.mouseLeave(panel, { relatedTarget: document.body });
    expect(panelCheckout()).toBeNull();
  });

  it("Escape closes the panel", () => {
    render(<CustomerSessionButton />);
    fireEvent.mouseEnter(trigger());
    act(() => {
      jest.advanceTimersByTime(300);
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panelCheckout()).toBeNull();
  });

  it("button -> panel -> Checkout still opens the session checkout", () => {
    render(<CustomerSessionButton />);
    fireEvent.mouseEnter(trigger());
    act(() => {
      jest.advanceTimersByTime(300);
    });
    // Crossing the gap: leave the button, enter the panel within the grace.
    fireEvent.mouseLeave(trigger());
    act(() => {
      jest.advanceTimersByTime(100);
    });
    fireEvent.mouseEnter(trigger());
    act(() => {
      jest.advanceTimersByTime(500);
    });
    fireEvent.click(panelCheckout()!);
    expect(
      screen.getByRole("button", { name: /Confirm Checkout/i }),
    ).toBeTruthy();
  });
});
