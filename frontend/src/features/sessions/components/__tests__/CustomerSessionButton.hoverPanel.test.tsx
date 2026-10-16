/**
 * The session panel opens on CLICK, never on hover (owner decision
 * 2026-10-16). It hangs under the top-bar session button, so while open it
 * covers whatever is below (shop-day test: on Mobile Recharge it covered the
 * provider tabs). A cursor passing over the top bar must never open it.
 *
 *  - clicking the session button toggles the panel;
 *  - it closes on a click outside, on Escape, or on clicking the button
 *    again;
 *  - the session switcher (New Session / Walk-In / other sessions) moved to
 *    the small "Switch or start a session" button next to it;
 *  - button -> panel -> Checkout still opens the session checkout.
 *
 * Rule 17: "hover does NOT open the panel" was run against the hover version
 * first and seen failing (the panel opened after the 250 ms rest).
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

const sessionButton = () =>
  screen.getByRole("button", { name: /Customer Session/i });
const panelCheckout = () =>
  screen.queryByRole("button", { name: /Checkout \(1 items\)/ });

describe("CustomerSessionButton — session panel opens on click", () => {
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

  it("hovering the button (even resting on it) does NOT open the panel", () => {
    render(<CustomerSessionButton />);
    fireEvent.mouseEnter(sessionButton().parentElement!);
    fireEvent.mouseOver(sessionButton());
    act(() => {
      // Well past the old 250 ms rest + 200 ms grace.
      jest.advanceTimersByTime(2000);
    });
    expect(panelCheckout()).toBeNull();
  });

  it("clicking the button opens the panel; clicking it again closes it", () => {
    render(<CustomerSessionButton />);
    fireEvent.click(sessionButton());
    expect(panelCheckout()).not.toBeNull();
    expect(sessionButton().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(sessionButton());
    expect(panelCheckout()).toBeNull();
    expect(sessionButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("a click outside closes it; a click inside the panel does not", () => {
    render(
      <div>
        <CustomerSessionButton />
        <button type="button">Page tab</button>
      </div>,
    );
    fireEvent.click(sessionButton());
    fireEvent.mouseDown(screen.getByTestId("session-hover-panel"));
    expect(panelCheckout()).not.toBeNull();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Page tab" }));
    expect(panelCheckout()).toBeNull();
  });

  it("leaving the panel with the pointer does not close it", () => {
    render(<CustomerSessionButton />);
    fireEvent.click(sessionButton());
    fireEvent.mouseLeave(screen.getByTestId("session-hover-panel"), {
      relatedTarget: document.body,
    });
    fireEvent.mouseLeave(sessionButton().parentElement!);
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(panelCheckout()).not.toBeNull();
  });

  it("Escape closes the panel", () => {
    render(<CustomerSessionButton />);
    fireEvent.click(sessionButton());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panelCheckout()).toBeNull();
  });

  it("the switcher button opens the session list instead of the panel", () => {
    render(<CustomerSessionButton />);
    fireEvent.click(sessionButton());
    fireEvent.click(
      screen.getByRole("button", { name: /switch or start a session/i }),
    );
    expect(panelCheckout()).toBeNull();
    // The switcher's header (its New Session / Walk-In rows wait for the
    // client list to load).
    expect(screen.getByText("Customer Sessions")).toBeTruthy();
  });

  it("button -> panel -> Checkout still opens the session checkout", () => {
    render(<CustomerSessionButton />);
    fireEvent.click(sessionButton());
    fireEvent.click(panelCheckout()!);
    expect(
      screen.getByRole("button", { name: /Confirm Checkout/i }),
    ).toBeTruthy();
  });
});
