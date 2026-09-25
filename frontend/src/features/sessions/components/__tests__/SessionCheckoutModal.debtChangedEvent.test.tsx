/** @jest-environment jsdom */
/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule, 2026-09-24
 * batch: build first, verify once at the end).
 *
 * LIRA-212 Tier A — session checkout can book a 'Session Debt' row on the
 * client's account (FEATURE_GUIDE §11), so it must also emit "debt:changed"
 * on success, the same event every Debts-page account write now emits, so
 * TopBar's session balance badge (`TopBar.balanceBadge.test.tsx`) refreshes
 * live instead of only on the next "sale:completed".
 *
 * Pre-fix (rule 17): before this change, a successful checkout only emitted
 * "notification:show" — temporarily removing the
 * `appEvents.emit("debt:changed")` call added alongside this test makes the
 * assertion below fail.
 *
 * Scaffold reused from `SessionCheckoutModal.payoutMethod.test.tsx` (see
 * that file for why each mock exists).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { appEvents } from "@liratek/ui";
import { SessionCheckoutModal } from "../SessionCheckoutModal";
import type { CartItem } from "../../types/cart";

const mockClearCart = jest.fn();
const mockRefreshActiveSessions = jest.fn().mockResolvedValue(undefined);
const mockCheckout = jest
  .fn()
  .mockResolvedValue({ success: true, itemCount: 1 });

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
  started_at: "2026-08-06T00:00:00.000Z",
  started_by: "tester",
  is_active: 1,
};

// Payout-only basket (no charge line), mirroring
// SessionCheckoutModal.payoutMethod.test.tsx's simplest scenario — Confirm
// Checkout is enabled with no MultiPaymentInput interaction needed, since
// there is nothing to collect payment for. What's under test here is only
// the post-success emit, not the payment-collection gate (covered
// elsewhere).
const mockCartItems: CartItem[] = [
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

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    session: { checkout: mockCheckout },
    getAllSettings: jest.fn().mockResolvedValue([]),
    getClients: jest.fn().mockResolvedValue([]),
  }),
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
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

describe("SessionCheckoutModal — 'debt:changed' on checkout success (LIRA-212 Tier A)", () => {
  beforeEach(() => {
    mockCheckout.mockClear();
    mockCheckout.mockResolvedValue({ success: true, itemCount: 1 });
  });

  it("emits 'debt:changed' alongside the existing 'notification:show' after a successful checkout", async () => {
    const emitSpy = jest.spyOn(appEvents, "emit");

    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);

    const confirmButton = screen.getByRole("button", {
      name: /confirm checkout/i,
    });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(emitSpy).toHaveBeenCalledWith("debt:changed");
    });
    expect(emitSpy).toHaveBeenCalledWith(
      "notification:show",
      expect.any(String),
      "success",
    );

    emitSpy.mockRestore();
  });
});
