/** @jest-environment jsdom */

/**
 * SessionCheckoutModal — payment widget render-gate must key off the GROSS
 * charge buckets, never the NET total (P0, BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md
 * §2 bug 2).
 *
 * Pre-fix, the widget was gated on `totals.usd > 0 || totals.lbp > 0` — the
 * NET of charges against payouts (`getCartTotals()`). A basket with a $50
 * charge (custom service) and a $100 same-currency payout (an OMT/Whish
 * system RECEIVE) nets to -$50, so the gate evaluated false, the
 * MultiPaymentInput never mounted, `paymentLines` stayed `[]`, and
 * `isPaymentValid` — which compares against the GROSS `combinedTotalUSD`
 * ($50, from `splitBasketCashSides`) — could never be satisfied. Confirm
 * Checkout stayed permanently disabled; the $50 charge could never be
 * collected.
 *
 * This test drives the real component (not a hand-built IPC payload — see
 * CLAUDE.md rule 15/layer-seam note) with exactly that basket and asserts the
 * payment widget IS rendered.
 *
 * Proven failing-first (rule 17): run against the unfixed gate
 * (`totals.usd > 0 || totals.lbp > 0`) — the widget is absent
 * (`queryByTestId` returns null). After the fix (`chargeUsd > 0 || chargeLbp
 * > 0`), it renders.
 */

import { render, screen } from "@testing-library/react";
import { SessionCheckoutModal } from "../SessionCheckoutModal";
import type { CartItem } from "../../types/cart";

const mockClearCart = jest.fn();
const mockRefreshActiveSessions = jest.fn().mockResolvedValue(undefined);
const mockCheckout = jest
  .fn()
  .mockResolvedValue({ success: true, itemCount: 2 });

// $50 charge (custom service) + $100 same-currency payout (OMT system
// RECEIVE, amount negative per isCashoutItem). Net = -$50 (net-negative);
// GROSS charge = $50, GROSS payout = $100 — the exact §2 bug-2 scenario.
const cartItems: CartItem[] = [
  {
    id: "item-1",
    module: "custom_service",
    label: "Custom Service",
    amount: 50,
    currency: "USD",
    formData: {},
    ipcChannel: "customServices:create",
  },
  {
    id: "item-2",
    module: "omt_system",
    label: "OMT RECEIVE",
    amount: -100,
    currency: "USD",
    formData: {},
    ipcChannel: "financial:create",
  },
];

// Mirrors SessionContext.getCartTotals — nets currency buckets across the
// whole basket (the thing the pre-fix gate incorrectly keyed off).
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
  // Stub — only render-presence is asserted, no interaction needed here.
  MultiPaymentInput: () => <div data-testid="stub-multi-payment-input" />,
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

describe("SessionCheckoutModal — payment widget gate (BIDIRECTIONAL_PAYMENT_LEGS_PLAN §2 bug 2)", () => {
  it("renders the payment widget for a same-currency net-negative basket ($50 charge, $100 payout)", () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);

    expect(screen.getByTestId("stub-multi-payment-input")).toBeInTheDocument();
  });
});
