/** @jest-environment jsdom */

/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule, 2026-09-24
 * batch: build first, verify once at the end).
 *
 * SessionCheckoutModal — netted session checkout (owner decision #11-A,
 * OWNER_NOTES_REMAINING_BUILD.md, 2026-09-24).
 *
 * The owner's case: a loto ticket charge (1,280,000 LBP) and a loto cash
 * prize payout (400,000 LBP) in the SAME basket, rate 89,000. Pre-#11-A the
 * checkout sent the GROSS 1,280,000 LBP charge into MultiPaymentInput AND a
 * separate 400,000 LBP PAYOUT leg — but the prize was never physically
 * handed over as LBP cash (it was absorbed into what the customer still
 * owed), so that PAYOUT leg debited General for money that never left the
 * drawer: a 390,000 LBP gap by closing (400,000 recorded vs the true
 * 10,000 LBP physical difference on a $50 tender).
 *
 * This drives the REAL component (CLAUDE.md rule 15/layer-seam note),
 * stubbing only MultiPaymentInput (exposes buttons that fire its real
 * `onChange`/`onReturnChange` props, mirroring what a cashier who typed
 * "$50" then "40$ + 10,000 LBP" would produce) so the assertions are on
 * SessionCheckoutModal's OWN netting computation, not the payment widget's
 * internals (covered separately in MultiPaymentInput.test.tsx).
 *
 * Proven failing-first (rule 17): reverting SessionCheckoutModal.tsx's
 * `netChargeUsd/Lbp`/`excessPayoutUsd/Lbp` construction back to the raw
 * `chargeUsd`/`chargeLbp`/`payoutUsd`/`payoutLbp` (the pre-#11-A shape)
 * makes the payments assertion below fail: a GROSS
 * `{method:"CASH", currency_code:"LBP", amount:400000, kind:"PAYOUT"}` leg
 * appears (the 390,000 LBP gap), and the `totals` prop MultiPaymentInput
 * receives no longer matches the owner's 880,000 LBP net.
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

// A loto ticket charge (1,280,000 LBP) + a loto cash prize payout
// (-400,000 LBP) — the owner's exact #11-A case.
let mockCartItems: CartItem[] = [
  {
    id: "ticket-1",
    module: "loto_ticket",
    label: "Loto Ticket",
    amount: 1_280_000,
    currency: "LBP",
    formData: {},
    ipcChannel: "loto:sellTicket",
  },
  {
    id: "prize-1",
    module: "loto_prize",
    label: "Loto Cash Prize",
    amount: -400_000,
    currency: "LBP",
    formData: {},
    ipcChannel: "loto:recordCashPrize",
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
      <div data-testid="mpi-totals">
        {JSON.stringify(props.totals)}
      </div>
      <button
        type="button"
        data-testid="tender-50-usd-cash"
        onClick={() => {
          const onChange = props.onChange as (lines: unknown[]) => void;
          onChange([
            { id: "l1", method: "CASH", currencyCode: "USD", amount: 50 },
          ]);
          const onReturnChange = props.onReturnChange as (
            legs: unknown[],
          ) => void;
          onReturnChange([
            {
              id: "r1",
              method: "CASH",
              currencyCode: "USD",
              amount: 40,
              direction: "OUT",
            },
            {
              id: "r2",
              method: "CASH",
              currencyCode: "LBP",
              amount: 10_000,
              direction: "OUT",
            },
          ]);
        }}
      >
        tender $50 cash, take 40$ + 10,000 LBP change
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

describe("SessionCheckoutModal — netted session checkout (owner decision #11-A)", () => {
  beforeEach(() => {
    mockCheckout.mockClear();
    mockCartItems = [
      {
        id: "ticket-1",
        module: "loto_ticket",
        label: "Loto Ticket",
        amount: 1_280_000,
        currency: "LBP",
        formData: {},
        ipcChannel: "loto:sellTicket",
      },
      {
        id: "prize-1",
        module: "loto_prize",
        label: "Loto Cash Prize",
        amount: -400_000,
        currency: "LBP",
        formData: {},
        ipcChannel: "loto:recordCashPrize",
      },
    ];
  });

  it("MultiPaymentInput receives the NET charge (880,000 LBP), not the gross 1,280,000", () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);

    const totals = JSON.parse(
      screen.getByTestId("mpi-totals").textContent || "[]",
    ) as Array<{ amount: number; currency: string }>;
    const lbpTotal = totals.find((t) => t.currency === "LBP")?.amount;
    expect(lbpTotal).toBe(880_000);
  });

  it("submits IN $50 + OUT change 40$/10,000 LBP, and NO gross 400,000 LBP payout leg", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("tender-50-usd-cash"));

    const confirmButton = screen.getByRole("button", {
      name: /confirm checkout/i,
    });
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
    const payload = mockCheckout.mock.calls[0][0];
    const payments = payload.payments as Array<{
      method: string;
      currency_code: string;
      amount: number;
      direction: string;
      kind?: string;
    }>;

    expect(payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "CASH",
          currency_code: "USD",
          amount: 50,
          direction: "IN",
        }),
        expect.objectContaining({
          method: "CASH",
          currency_code: "USD",
          amount: 40,
          direction: "OUT",
          kind: "CHANGE",
        }),
        expect.objectContaining({
          method: "CASH",
          currency_code: "LBP",
          amount: 10_000,
          direction: "OUT",
          kind: "CHANGE",
        }),
      ]),
    );

    // The 390,000 LBP gap this fixes: no leg at all carries the gross
    // 400,000 LBP prize — it was absorbed into the net charge, never
    // physically posted.
    expect(
      payments.some((p) => p.kind === "PAYOUT" && p.amount === 400_000),
    ).toBe(false);
    expect(payments.some((p) => p.kind === "PAYOUT")).toBe(false);
  });
});
