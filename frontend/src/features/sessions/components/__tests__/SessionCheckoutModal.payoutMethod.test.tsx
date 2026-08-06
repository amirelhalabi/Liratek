/** @jest-environment jsdom */

/**
 * SessionCheckoutModal — operator-chosen payout method per currency
 * (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F).
 *
 * Pre-Phase-F, the payout OUT leg's method was hard-derived from
 * `payoutOnAccount` (CUSTOMER_ACCOUNT iff the basket's charge is already
 * being paid on account, else CASH — `SessionCheckoutModal.tsx:337-338`,
 * `:422` before this change) with no operator control: a Binance/OMT/Whish
 * cash-out could only ever be handed over as cash or credited to the
 * account, never paid out through a wallet. This drives the REAL component
 * (not a hand-built IPC payload — CLAUDE.md rule 15/layer-seam note) and
 * asserts:
 *
 *  1. A payout-only basket renders a per-currency method select, seeded with
 *     the pre-existing default (CASH — no client in session).
 *  2. Choosing a different method (WHISH) changes what gets submitted: the
 *     OUT leg's `method` AND its `kind: "PAYOUT"`, plus the matching cart
 *     item's `formData.cashoutMethod`.
 *  3. A mixed basket where the charge is paid CUSTOMER_ACCOUNT (lira-098)
 *     still defaults the payout select to CUSTOMER_ACCOUNT — untouched
 *     behavior is unchanged — and the client-only "Customer Account" option
 *     is offered because the session has a name+phone.
 *
 * Proven failing-first (rule 17): pre-fix, there is no
 * `payout-method-select-*` element at all (`queryByTestId` returns null) and
 * the emitted OUT leg carries no `kind` field — every assertion below fails
 * against the unfixed component.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionCheckoutModal } from "../SessionCheckoutModal";
import type { CartItem } from "../../types/cart";

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
  }),
  // Stub — exposes a button that fires the real onChange prop so tests can
  // simulate "the operator picked CUSTOMER_ACCOUNT for the charge" without
  // reimplementing MultiPaymentInput's own internals.
  MultiPaymentInput: (props: Record<string, unknown>) => (
    <div data-testid="stub-multi-payment-input">
      <button
        type="button"
        data-testid="set-customer-account-charge"
        onClick={() => {
          const onChange = props.onChange as (lines: unknown[]) => void;
          onChange([
            {
              id: "l1",
              method: "CUSTOMER_ACCOUNT",
              currencyCode: "USD",
              amount: 50,
            },
          ]);
        }}
      >
        pay by account
      </button>
    </div>
  ),
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

describe("SessionCheckoutModal — payout method select (BIDIRECTIONAL_PAYMENT_LEGS_PLAN §4 Phase F)", () => {
  beforeEach(() => {
    mockCheckout.mockClear();
  });

  describe("payout-only basket, no client in session", () => {
    beforeEach(() => {
      mockActiveSession = {
        id: 1,
        customer_name: "Walk-in",
        customer_phone: undefined,
        started_at: "2026-08-06T00:00:00.000Z",
        started_by: "tester",
        is_active: 1,
      };
      mockCartItems = [
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
    });

    it("renders a payout-method select seeded with the derived default (CASH) — Customer Account absent (no client)", () => {
      render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);

      const select = screen.getByTestId(
        "payout-method-select-USD",
      ) as HTMLSelectElement;
      expect(select.value).toBe("CASH");

      const optionLabels = Array.from(select.options).map((o) => o.label);
      expect(optionLabels).toEqual(
        expect.arrayContaining([
          "Cash",
          "OMT Wallet",
          "Whish Wallet",
          "Binance",
        ]),
      );
      expect(optionLabels).not.toContain("Customer Account");
    });

    it("choosing WHISH for the payout emits the OUT leg with method WHISH and kind PAYOUT, and stamps the item's cashoutMethod", async () => {
      render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);

      const select = screen.getByTestId(
        "payout-method-select-USD",
      ) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "WHISH" } });
      expect(select.value).toBe("WHISH");

      const confirmButton = screen.getByRole("button", {
        name: /confirm checkout/i,
      });
      expect(confirmButton).not.toBeDisabled();
      fireEvent.click(confirmButton);

      await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
      const payload = mockCheckout.mock.calls[0][0];

      expect(payload.payments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "WHISH",
            currency_code: "USD",
            amount: 100,
            direction: "OUT",
            kind: "PAYOUT",
          }),
        ]),
      );

      const payoutCartItem = payload.cartItems.find(
        (i: { id: string }) => i.id === "item-1",
      );
      expect(payoutCartItem.formData.cashoutMethod).toBe("WHISH");
    });
  });

  describe("mixed basket, session has a chargeable client (lira-098 default)", () => {
    beforeEach(() => {
      mockActiveSession = {
        id: 2,
        customer_name: "Jane Doe",
        customer_phone: "70123456",
        started_at: "2026-08-06T00:00:00.000Z",
        started_by: "tester",
        is_active: 1,
      };
      mockCartItems = [
        {
          id: "charge-1",
          module: "custom_service",
          label: "Custom Service",
          amount: 50,
          currency: "USD",
          formData: {},
          ipcChannel: "customServices:create",
        },
        {
          id: "payout-1",
          module: "omt_system",
          label: "OMT RECEIVE",
          amount: -100,
          currency: "USD",
          formData: {},
          ipcChannel: "financial:create",
        },
      ];
      // A client is in session (name+phone) — the sessionClientId lookup
      // effect fires and needs a window.api stub, unlike the no-client suite
      // above where customer_phone is undefined and the effect short-circuits.
      (globalThis as unknown as { window: { api: unknown } }).window.api = {
        clients: { getAll: jest.fn().mockResolvedValue([]) },
      };
    });

    it("defaults the payout select to CUSTOMER_ACCOUNT once the charge is paid by account, and offers Customer Account as an option", async () => {
      render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);

      // Before the operator picks a charge method, the derivation default
      // (no CUSTOMER_ACCOUNT charge line yet) is CASH — untouched behavior.
      expect(
        (screen.getByTestId("payout-method-select-USD") as HTMLSelectElement)
          .value,
      ).toBe("CASH");

      fireEvent.click(screen.getByTestId("set-customer-account-charge"));

      await waitFor(() => {
        expect(
          (screen.getByTestId("payout-method-select-USD") as HTMLSelectElement)
            .value,
        ).toBe("CUSTOMER_ACCOUNT");
      });

      const select = screen.getByTestId(
        "payout-method-select-USD",
      ) as HTMLSelectElement;
      const optionLabels = Array.from(select.options).map((o) => o.label);
      expect(optionLabels).toContain("Customer Account");
    });
  });
});
