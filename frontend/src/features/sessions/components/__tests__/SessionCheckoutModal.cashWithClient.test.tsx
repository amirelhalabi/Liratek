/** @jest-environment jsdom */

/**
 * Session checkout — the cashier must be able to switch the payment to Cash
 * when the customer has an account (found live on the test shop,
 * 2026-10-11, while checking LIRA-304 drawer routing).
 *
 * The bug: choosing Cash removes the last Customer Account line, which flips
 * the derived payout default (`payoutOnAccount`) from CUSTOMER_ACCOUNT to
 * CASH; that change re-creates MultiPaymentInput (`paymentInputKey`), and the
 * new instance seeds its line from `initialMethod` — Customer Account again.
 * The line snaps back, so the basket could only be checked out on account.
 *
 * Failing-first (rule 17): seen failing on the unfixed component — the
 * submitted payment's method is CUSTOMER_ACCOUNT instead of CASH.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionCheckoutModal } from "../SessionCheckoutModal";
import type { CartItem } from "../../types/cart";

let mountCount = 0;

const mockClearCart = jest.fn();
const mockRefreshActiveSessions = jest.fn().mockResolvedValue(undefined);
const mockCheckout = jest
  .fn()
  .mockResolvedValue({ success: true, itemCount: 1 });

// Mutable fixtures the mocked `useSession()` reads at CALL time (i.e. every
// render), so each test/describe block can swap the session + cart without
// needing a fresh module graph (`SessionCheckoutModal` is a single static
// import at the top of this file).
let mockActiveSession: {
  id: number;
  customer_name?: string | undefined;
  customer_phone?: string | undefined;
  started_at: string;
  started_by: string;
  is_active: 1;
} | null = null;
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

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    session: { checkout: mockCheckout },
    getAllSettings: jest.fn().mockResolvedValue([]),
    // The sessionClientId-lookup effect (SessionCheckoutModal.tsx:276-277)
    // fires whenever a session has a phone number and calls this — rule 19
    // migrated it off raw `window.api.clients.getAll` onto `useApi()`.
    getClients: jest.fn().mockResolvedValue([]),
  }),
  // Stub — exposes a button that fires the real onChange prop so tests can
  // simulate "the operator picked CUSTOMER_ACCOUNT for the charge" without
  // reimplementing MultiPaymentInput's own internals.
  // Faithful to the real component on the two points this bug lives in:
  // on (re)mount it reports ONE line seeded with `initialMethod`, and the
  // operator can change that line's method. A remount (new `key`) therefore
  // re-reports the seed, exactly like MultiPaymentInput's own sync effect.
  MultiPaymentInput: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require("react") as typeof import("react");
    const onChange = props.onChange as (lines: unknown[]) => void;
    const total = (props.totalAmount as number) ?? 134;
    React.useEffect(() => {
      mountCount += 1;
      onChange([
        { id: "l1", method: props.initialMethod as string, currencyCode: "USD", amount: total },
      ]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="stub-multi-payment-input">
        <button
          type="button"
          data-testid="pick-cash"
          onClick={() =>
            onChange([{ id: "l1", method: "CASH", currencyCode: "USD", amount: total }])
          }
        >
          cash
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
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT Wallet" },
      { code: "WHISH", label: "Whish Wallet" },
      { code: "BINANCE", label: "Binance" },
      { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
    ],
    drawerAffectingMethods: [],
    allMethods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT Wallet" },
      { code: "WHISH", label: "Whish Wallet" },
      { code: "BINANCE", label: "Binance" },
      { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
    ],
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

describe("SessionCheckoutModal — Cash with a customer who has an account", () => {
  beforeEach(() => {
    mockCheckout.mockClear();
    mountCount = 0;
    mockActiveSession = {
      id: 3,
      customer_name: "Claude Demo 1012",
      customer_phone: "03101012",
      started_at: "2026-10-11T00:00:00.000Z",
      started_by: "tester",
      is_active: 1,
    };
    mockCartItems = [
      {
        id: "omt-1",
        module: "omt_system",
        label: "OMT SEND",
        amount: 101,
        currency: "USD",
        formData: {},
        ipcChannel: "financial:create",
      },
      {
        id: "pos-1",
        module: "pos",
        label: "POS Sale (2 items)",
        amount: 33,
        currency: "USD",
        formData: {},
        ipcChannel: "sales:process",
      },
    ];
  });

  it("starts on Customer Account but keeps Cash once the cashier picks it", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => expect(mountCount).toBeGreaterThan(0));

    fireEvent.click(screen.getByTestId("pick-cash"));
    // Let any remount settle before submitting.
    await new Promise((r) => setTimeout(r, 0));

    fireEvent.click(screen.getByRole("button", { name: /confirm checkout/i }));
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
    const payload = mockCheckout.mock.calls[0][0];
    const inLegs = payload.payments.filter(
      (p: { direction?: string }) => p.direction !== "OUT",
    );
    expect(inLegs).toEqual([
      expect.objectContaining({ method: "CASH", currency_code: "USD", amount: 134 }),
    ]);
  });
});
