/** @jest-environment jsdom */

/**
 * LIRA-341 — the basket discount at the session checkout (screen half of
 * LIRA-341, whose core books the BASKET_DISCOUNT row).
 *
 *  - The pooled MultiPaymentInput shows its "- Discount | + Extra" line:
 *    `showDiscount` is no longer false and `onDiscountChange` is given.
 *  - The discount lowers what the payment must cover ($294 - $8 = $286).
 *  - It is sent as `discount_usd` (schema name, rule 24), parsed through the
 *    real core schema, never together with an extra or a waive.
 *  - No Waive is offered while a discount is set (the server refuses both).
 *  - A server refusal is shown.
 *
 * Drives the REAL component, stubbing only MultiPaymentInput.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { sessionCheckoutSchema } from "@liratek/core";
import type { SessionCheckoutInput } from "@liratek/core";
import { SessionCheckoutModal } from "../SessionCheckoutModal";
import type { CartItem } from "../../types/cart";

const DISCOUNT_USD: keyof SessionCheckoutInput = "discount_usd";
const DISCOUNT_LBP: keyof SessionCheckoutInput = "discount_lbp";
const EXTRA_USD: keyof SessionCheckoutInput = "extra_usd";
const WAIVED_USD: keyof SessionCheckoutInput = "waived_usd";
const WAIVED_LBP: keyof SessionCheckoutInput = "waived_lbp";

const mockClearCart = jest.fn();
const mockRefreshActiveSessions = jest.fn().mockResolvedValue(undefined);
const mockCheckout = jest
  .fn()
  .mockResolvedValue({ success: true, itemCount: 1 });

const mockActiveSession = {
  id: 1,
  customer_name: "Walk-in",
  customer_phone: undefined,
  started_at: "2026-10-11T00:00:00.000Z",
  started_by: "tester",
  is_active: 1 as const,
};

const CHARGE: CartItem = {
  id: "charge-1",
  module: "custom_service",
  label: "Phone case bundle",
  amount: 294,
  currency: "USD",
  formData: {},
  ipcChannel: "custom-services:add",
};

const mockCartItems: CartItem[] = [CHARGE];

jest.mock("../../context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockActiveSession,
    cartItems: mockCartItems,
    clearCart: mockClearCart,
    getCartTotals: () => ({
      usd: mockCartItems.reduce((s, i) => s + i.amount, 0),
      lbp: 0,
      usdt: 0,
    }),
    refreshActiveSessions: mockRefreshActiveSessions,
  }),
}));

// Rule 25: a STABLE useApi() reference, hoisted once.
const mockApi = {
  session: { checkout: mockCheckout },
  getAllSettings: jest.fn().mockResolvedValue([]),
  getClients: jest.fn().mockResolvedValue([]),
};

let lastMpiProps: Record<string, unknown> = {};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  MultiPaymentInput: (props: Record<string, unknown>) => {
    lastMpiProps = props;
    const pay = (amount: number) =>
      (props.onChange as (lines: unknown[]) => void)([
        { id: "l1", method: "CASH", currencyCode: "USD", amount },
      ]);
    return (
      <div data-testid="stub-multi-payment-input">
        <div data-testid="mpi-totals">{JSON.stringify(props.totals)}</div>
        <button type="button" data-testid="tender-285" onClick={() => pay(285)}>
          tender $285
        </button>
        <button type="button" data-testid="tender-286" onClick={() => pay(286)}>
          tender $286
        </button>
        <button type="button" data-testid="tender-294" onClick={() => pay(294)}>
          tender $294
        </button>
        <button type="button" data-testid="tender-296" onClick={() => pay(296)}>
          tender $296
        </button>
        <button
          type="button"
          data-testid="discount-8"
          onClick={() =>
            (props.onDiscountChange as ((x: number) => void) | undefined)?.(8)
          }
        >
          discount $8
        </button>
        <button
          type="button"
          data-testid="discount-0"
          onClick={() =>
            (props.onDiscountChange as ((x: number) => void) | undefined)?.(0)
          }
        >
          discount $0
        </button>
        <button
          type="button"
          data-testid="extra-2"
          onClick={() =>
            (props.onExtraChange as ((x: number) => void) | undefined)?.(2)
          }
        >
          extra $2
        </button>
        <button
          type="button"
          data-testid="waive"
          onClick={() =>
            (
              props.onWaiveRemaining as
                | ((
                    a: number,
                    m: Array<{ currency: string; amount: number }>,
                  ) => void)
                | undefined
            )?.(3, [{ currency: "USD", amount: 3 }])
          }
        >
          waive
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

function confirmButton(): HTMLElement {
  return screen.getByRole("button", { name: /confirm checkout/i });
}

async function confirmAndGetPayload(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(confirmButton()).not.toBeDisabled());
  fireEvent.click(confirmButton());
  await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
  return mockCheckout.mock.calls[0][0] as Record<string, unknown>;
}

describe("SessionCheckoutModal — basket discount (LIRA-341)", () => {
  beforeEach(() => {
    mockCheckout.mockClear();
    mockCheckout.mockResolvedValue({ success: true, itemCount: 1 });
    lastMpiProps = {};
  });

  it("shows the Discount | Extra line: discount not hidden, both callbacks given", () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    expect(lastMpiProps.showDiscount).not.toBe(false);
    expect(typeof lastMpiProps.onDiscountChange).toBe("function");
    expect(typeof lastMpiProps.onExtraChange).toBe("function");
  });

  it("$8 off a $294 basket: $285 does not cover it, $286 does", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("discount-8"));
    fireEvent.click(screen.getByTestId("tender-285"));
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(screen.getByTestId("tender-286"));
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
  });

  it("sends discount_usd 8 that the core schema accepts, with no extra or waive", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("discount-8"));
    fireEvent.click(screen.getByTestId("tender-286"));
    const payload = await confirmAndGetPayload();
    const parsed = sessionCheckoutSchema.parse(payload);
    expect(parsed[DISCOUNT_USD]).toBe(8);
    expect(parsed).not.toHaveProperty(DISCOUNT_LBP);
    expect(parsed).not.toHaveProperty(EXTRA_USD);
    expect(parsed).not.toHaveProperty(WAIVED_USD);
    expect(parsed).not.toHaveProperty(WAIVED_LBP);
  });

  it("switching to Extra drops the discount: only the extra is sent", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("discount-8"));
    // The input's switch clears the typed amount: it reports discount 0,
    // then the extra.
    fireEvent.click(screen.getByTestId("discount-0"));
    fireEvent.click(screen.getByTestId("extra-2"));
    fireEvent.click(screen.getByTestId("tender-286"));
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(screen.getByTestId("tender-296"));
    const payload = await confirmAndGetPayload();
    expect(payload[EXTRA_USD]).toBe(2);
    expect(payload).not.toHaveProperty(DISCOUNT_USD);
    expect(payload).not.toHaveProperty(DISCOUNT_LBP);
  });

  it("offers no Waive while a discount is set", () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    expect(typeof lastMpiProps.onWaiveRemaining).toBe("function");
    fireEvent.click(screen.getByTestId("discount-8"));
    expect(lastMpiProps.onWaiveRemaining).toBeUndefined();
    expect(lastMpiProps.waiveDisabled).toBe(true);
  });

  it("a discount drops an earlier waive", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("tender-285"));
    fireEvent.click(screen.getByTestId("waive"));
    fireEvent.click(screen.getByTestId("discount-8"));
    fireEvent.click(screen.getByTestId("tender-286"));
    const payload = await confirmAndGetPayload();
    expect(payload[DISCOUNT_USD]).toBe(8);
    expect(payload).not.toHaveProperty(WAIVED_USD);
  });

  it("sends no discount key without a discount", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("tender-294"));
    const payload = await confirmAndGetPayload();
    expect(payload).not.toHaveProperty(DISCOUNT_USD);
    expect(payload).not.toHaveProperty(DISCOUNT_LBP);
  });

  it("shows the server's refusal", async () => {
    mockCheckout.mockResolvedValueOnce({
      success: false,
      error:
        "The discount can't be more than the shop's profit on this basket.",
    });
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("discount-8"));
    fireEvent.click(screen.getByTestId("tender-286"));
    await confirmAndGetPayload();
    expect(
      await screen.findByText(/can't be more than the shop's profit/i),
    ).toBeInTheDocument();
  });
});
