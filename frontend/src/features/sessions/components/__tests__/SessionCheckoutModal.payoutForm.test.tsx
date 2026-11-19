/** @jest-environment jsdom */

/**
 * LIRA-402 — a payout basket gets the payment box (payout mode).
 *
 * Owner report 2026-11-19 (Corner Tech): Exchange 10 EUR → $10.50 + Whish
 * App receive $199 (fee taken from the payout) = the shop owes $209.50. The
 * checkout showed only a "Payout to customer" box with one Cash select per
 * currency — no Split, no second currency, no typed amount, no
 * "− Less | + Extra".
 *
 * Drives the REAL modal with a stub payment box that reports what a cashier
 * typed. Payload field names come from the schema: every payload is parsed
 * by `sessionCheckoutSchema` and the legs are compared with the screen's own
 * builder (`buildSessionCheckoutLegs`, rule 22/24).
 *
 * Rule 17 — run against the unfixed modal first (failure recorded in the
 * LIRA-402 report: no payout-mode payment box is rendered).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { buildSessionCheckoutLegs, sessionCheckoutSchema } from "@liratek/core";
import { SessionCheckoutModal } from "../SessionCheckoutModal";
import type { CartItem } from "../../types/cart";

const mockClearCart = jest.fn();
const mockRefreshActiveSessions = jest.fn().mockResolvedValue(undefined);
const mockCheckout = jest
  .fn()
  .mockResolvedValue({ success: true, itemCount: 2 });

const mockActiveSession = {
  id: 7,
  customer_name: "Walk-in",
  customer_phone: undefined as string | undefined,
  started_at: "2026-11-19T00:00:00.000Z",
  started_by: "tester",
  is_active: 1 as const,
};
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

// Rule 25 — one stable api identity.
const mockApi = {
  session: { checkout: mockCheckout },
  getAllSettings: jest.fn().mockResolvedValue([]),
  getClients: jest.fn().mockResolvedValue([]),
};

type Line = {
  id: string;
  method: string;
  currencyCode: string;
  amount: number;
};

// Stub payment box: one per mode (testid by payer), exposing what the
// cashier would type through the box's REAL callbacks.
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  MultiPaymentInput: (props: Record<string, unknown>) => {
    const payer = (props.payer as string | undefined) ?? "customer";
    const onChange = props.onChange as (lines: Line[]) => void;
    const onKept = props.onKeptChange as
      | ((
          k: {
            usd: number;
            lbp: number;
            exactUsd: number;
            exactLbp: number;
          } | null,
        ) => void)
      | undefined;
    const onRound = props.onRoundUpChange as
      | ((r: { usd: number; lbp: number } | null) => void)
      | undefined;
    return (
      <div data-testid={`mpi-${payer}`}>
        <div data-testid={`mpi-${payer}-totals`}>
          {JSON.stringify(props.totals)}
        </div>
        <div data-testid={`mpi-${payer}-methods`}>
          {JSON.stringify(
            (props.paymentMethods as Array<{ code: string }>).map(
              (m) => m.code,
            ),
          )}
        </div>
        <button
          type="button"
          data-testid={`mpi-${payer}-split`}
          onClick={() =>
            onChange([
              { id: "a", method: "CASH", currencyCode: "USD", amount: 200 },
              { id: "b", method: "CASH", currencyCode: "LBP", amount: 845_500 },
            ])
          }
        >
          split
        </button>
        <button
          type="button"
          data-testid={`mpi-${payer}-extra`}
          onClick={() => {
            onChange([
              { id: "a", method: "CASH", currencyCode: "USD", amount: 210 },
            ]);
            onRound?.({ usd: 0.5, lbp: 0 });
          }}
        >
          extra
        </button>
        <button
          type="button"
          data-testid={`mpi-${payer}-less`}
          onClick={() => {
            onChange([
              { id: "a", method: "CASH", currencyCode: "USD", amount: 209 },
            ]);
            onKept?.({ usd: 0.5, lbp: 0, exactUsd: 0.5, exactLbp: 0 });
          }}
        >
          less
        </button>
        <button
          type="button"
          data-testid={`mpi-${payer}-short`}
          onClick={() =>
            onChange([
              { id: "a", method: "CASH", currencyCode: "USD", amount: 150 },
            ])
          }
        >
          short
        </button>
        <button
          type="button"
          data-testid={`mpi-${payer}-pay50`}
          onClick={() =>
            onChange([
              { id: "a", method: "CASH", currencyCode: "USD", amount: 50 },
            ])
          }
        >
          pay 50
        </button>
      </div>
    );
  },
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "tester", role: "admin" } }),
}));

const METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "OMT", label: "OMT Wallet" },
  { code: "WHISH", label: "Whish Wallet" },
  { code: "BINANCE", label: "Binance" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
];
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: METHODS,
    drawerAffectingMethods: [],
    allMethods: METHODS,
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
jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({ baseSystem: "OMT" }),
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

/** The owner's basket: Exchange 10 EUR → $10.50 + Whish App receive $199. */
function ownerBasket(): CartItem[] {
  return [
    {
      id: "ex",
      module: "exchange",
      label: "Exchange 10 EUR → $10.50 @ 1.05",
      amount: -10.5,
      currency: "USD",
      ipcChannel: "exchange:add-transaction",
      formData: {
        fromCurrency: "EUR",
        toCurrency: "USD",
        amountIn: 10,
        amountOut: 10.5,
        leg1Rate: 1.05,
        leg1MarketRate: 1.06,
        leg1ProfitUsd: 0.1,
        totalProfitUsd: 0.1,
      },
    },
    {
      id: "w",
      module: "whish_app",
      label: "Whish App RECEIVE $201",
      amount: -199,
      currency: "USD",
      ipcChannel: "financial:create",
      formData: {
        provider: "WHISH_APP",
        serviceType: "RECEIVE",
        amount: 201,
        currency: "USD",
        commission: 2,
        whishFee: 2,
        includingFees: false,
        cashoutMethod: "CASH",
      },
    },
  ];
}

function confirm() {
  return screen.getByTestId("session-checkout-confirm");
}

async function submitted() {
  await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
  const payload = mockCheckout.mock.calls[0][0];
  // Rule 24 — the schema is the contract.
  return sessionCheckoutSchema.parse(payload);
}

const PAYOUT_LEG = (currency: string, amount: number) =>
  buildSessionCheckoutLegs({
    mode: "payout",
    collectLines: [],
    returnLines: [],
    payoutLines: [{ method: "CASH", currencyCode: currency, amount }],
    payoutMethod: { USD: "CASH", LBP: "CASH" },
    systemPayout: { usd: 0, lbp: 0 },
    exchangePayout: { usd: 0, lbp: 0 },
    generalPayoutLeg: { usd: 0, lbp: 0 },
  })[0];

describe("LIRA-402 — Session Checkout shows the payment box on a payout basket", () => {
  beforeEach(() => {
    mockCheckout.mockClear();
    mockCartItems = ownerBasket();
  });

  it("the owner's basket renders a payout-mode payment box for $209.50, with the payout methods and no per-currency select", () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId("mpi-payout")).toBeInTheDocument();
    expect(screen.queryByTestId("mpi-customer")).toBeNull();
    const totals = JSON.parse(
      screen.getByTestId("mpi-payout-totals").textContent || "[]",
    ) as Array<{ amount: number; currency: string }>;
    expect(totals).toEqual([{ amount: 209.5, currency: "USD" }]);
    expect(
      JSON.parse(screen.getByTestId("mpi-payout-methods").textContent || "[]"),
    ).toEqual(["CASH", "OMT", "WHISH", "BINANCE"]);
    expect(screen.queryByTestId("payout-method-select-USD")).toBeNull();
  });

  it("split $200 + 845,500 LBP: two OUT/PAYOUT/GENERAL legs, nothing else", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("mpi-payout-split"));
    expect(confirm()).not.toBeDisabled();
    fireEvent.click(confirm());
    const payload = await submitted();
    expect(payload.payments).toEqual([
      PAYOUT_LEG("USD", 200),
      PAYOUT_LEG("LBP", 845_500),
    ]);
    expect(payload.rounding_given_usd).toBeUndefined();
    expect(payload.kept_change_usd).toBeUndefined();
    // The Whish App item is stamped with the method the box paid it by.
    const whish = (
      payload.cartItems as Array<{
        id: string;
        formData: Record<string, unknown>;
      }>
    ).find((i) => i.id === "w");
    expect(whish?.formData.cashoutMethod).toBe("CASH");
  });

  it("+ Extra $0.50: lines pay $210 and the payload claims rounding_given_usd 0.5", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("mpi-payout-extra"));
    fireEvent.click(confirm());
    const payload = await submitted();
    expect(payload.payments).toEqual([PAYOUT_LEG("USD", 210)]);
    expect(payload.rounding_given_usd).toBe(0.5);
    expect(payload.kept_change_usd).toBeUndefined();
  });

  it("− Less $0.50: lines pay $209 and the payload claims kept_change_usd 0.5", async () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("mpi-payout-less"));
    fireEvent.click(confirm());
    const payload = await submitted();
    expect(payload.payments).toEqual([PAYOUT_LEG("USD", 209)]);
    expect(payload.kept_change_usd).toBe(0.5);
    expect(payload.rounding_given_usd).toBeUndefined();
  });

  it("a payout short of what is owed cannot be confirmed", () => {
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("mpi-payout-short"));
    expect(confirm()).toBeDisabled();
  });

  it("mixed, payout > charge: $20 charger + $100 Whish App receive → payout box for $80", () => {
    mockCartItems = [
      {
        id: "c",
        module: "custom_service",
        label: "Charger",
        amount: 20,
        currency: "USD",
        ipcChannel: "custom-services:add",
        formData: {},
      },
      { ...ownerBasket()[1], amount: -100 },
    ];
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    expect(screen.queryByTestId("mpi-customer")).toBeNull();
    expect(
      JSON.parse(screen.getByTestId("mpi-payout-totals").textContent || "[]"),
    ).toEqual([{ amount: 80, currency: "USD" }]);
  });

  it("mixed, charge > payout (unchanged): $150 charger + $100 receive → today's pay-in box for $50", async () => {
    mockCartItems = [
      {
        id: "c",
        module: "custom_service",
        label: "Charger",
        amount: 150,
        currency: "USD",
        ipcChannel: "custom-services:add",
        formData: {},
      },
      { ...ownerBasket()[1], amount: -100 },
    ];
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    expect(screen.queryByTestId("mpi-payout")).toBeNull();
    expect(
      JSON.parse(screen.getByTestId("mpi-customer-totals").textContent || "[]"),
    ).toEqual([{ amount: 50, currency: "USD" }]);
    fireEvent.click(screen.getByTestId("mpi-customer-pay50"));
    fireEvent.click(confirm());
    const payload = await submitted();
    expect(payload.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 50, direction: "IN" },
    ]);
  });

  it("SYSTEM payout present: the OMT receive keeps its own row + select, the box carries only the Whish App part", async () => {
    mockCartItems = [
      {
        id: "omt",
        module: "omt_system",
        label: "OMT RECEIVE",
        amount: -100,
        currency: "USD",
        ipcChannel: "financial:create",
        formData: { provider: "OMT", serviceType: "RECEIVE" },
      },
      ownerBasket()[1],
    ];
    render(<SessionCheckoutModal isOpen={true} onClose={() => {}} />);
    expect(
      JSON.parse(screen.getByTestId("mpi-payout-totals").textContent || "[]"),
    ).toEqual([{ amount: 199, currency: "USD" }]);
    expect(screen.getByTestId("payout-method-select-USD")).toBeInTheDocument();
  });
});
