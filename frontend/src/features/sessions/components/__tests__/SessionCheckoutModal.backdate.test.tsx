/** @jest-environment jsdom */

/**
 * Bug #4 (TRANSACTION_DETAIL_AUDIT §3) — the session checkout window has a
 * "Set custom time": the time picked there rides on the checkout request as
 * `transaction_time` (the server stamps every row of the checkout with it);
 * nothing picked = no key, booked now.
 *
 * Not proven failing-first: written after the window gained the control.
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
const mockApi = {
  session: { checkout: mockCheckout },
  getAllSettings: jest.fn().mockResolvedValue([]),
  getClients: jest.fn().mockResolvedValue([]),
};

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
  // Rule 25: one stable object for the whole file.
  useApi: () => mockApi,
  // Stub — exposes a button that fires the real onChange prop so tests can
  // simulate "the operator picked CUSTOMER_ACCOUNT for the charge" without
  // reimplementing MultiPaymentInput's own internals.
  // Faithful to the real component on the two points this bug lives in:
  // on (re)mount it reports ONE line seeded with `initialMethod`, and the
  // operator can change that line's method. A remount (new `key`) therefore
  // re-reports the seed, exactly like MultiPaymentInput's own sync effect.
  MultiPaymentInput: (props: Record<string, unknown>) => {
    const React = require("react") as typeof import("react");
    const onChange = props.onChange as (lines: unknown[]) => void;
    const total = (props.totalAmount as number) ?? 134;
    React.useEffect(() => {
      mountCount += 1;
      onChange([
        {
          id: "l1",
          method: props.initialMethod as string,
          currencyCode: "USD",
          amount: total,
        },
      ]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="stub-multi-payment-input">
        <button
          type="button"
          data-testid="pick-cash"
          onClick={() =>
            onChange([
              { id: "l1", method: "CASH", currencyCode: "USD", amount: total },
            ])
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

describe("SessionCheckoutModal — Set custom time (bug #4)", () => {
  beforeEach(() => {
    mockCheckout.mockClear();
    mountCount = 0;
    mockActiveSession = {
      id: 3,
      customer_name: "Rana Aziz",
      customer_phone: undefined,
      started_at: "2026-10-11T00:00:00.000Z",
      started_by: "tester",
      is_active: 1,
    };
    mockCartItems = [
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

  async function confirm() {
    fireEvent.click(screen.getByRole("button", { name: /confirm checkout/i }));
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
    return mockCheckout.mock.calls[0][0] as Record<string, unknown>;
  }

  it("sends the picked time with the checkout", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => expect(mountCount).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("pick-cash"));

    fireEvent.click(screen.getByTestId("txn-time-toggle"));
    fireEvent.change(screen.getByTestId("txn-time-input"), {
      target: { value: "2026-10-14T09:30" },
    });

    const payload = await confirm();
    // The input is the cashier's local time; the request carries it as ISO.
    expect(payload.transaction_time).toBe(
      new Date("2026-10-14T09:30").toISOString(),
    );
  });

  it("a time picked for one checkout does not carry over to the next opening", async () => {
    const { rerender } = render(
      <SessionCheckoutModal isOpen={true} onClose={() => {}} />,
    );
    await waitFor(() => expect(mountCount).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("txn-time-toggle"));
    fireEvent.change(screen.getByTestId("txn-time-input"), {
      target: { value: "2026-10-14T09:30" },
    });
    // Closed without checking out, then opened again for the next basket.
    rerender(<SessionCheckoutModal isOpen={false} onClose={() => {}} />);
    rerender(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => expect(mountCount).toBeGreaterThan(1));
    fireEvent.click(screen.getByTestId("pick-cash"));
    const payload = await confirm();
    expect("transaction_time" in payload).toBe(false);
  });

  it("nothing picked: no time is sent (booked now)", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => expect(mountCount).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("pick-cash"));
    const payload = await confirm();
    expect("transaction_time" in payload).toBe(false);
  });
});
