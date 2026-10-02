/** @jest-environment jsdom */

/**
 * LIRA-185 display batch — exchange lane (audit journal wf_a89a1432-255,
 * verify:exchange, leads 3 and 4). Both are "the preview shows a different
 * profit from the one the books record".
 *
 * Lead 3 — NO_RATE_ANCHOR cross (exotic -> exotic via USD, neither side has
 * an `exchange_rates` row). The server skips lot tracking for the WHOLE
 * trade (`ExchangeRepository._applyExchangeLotEffects` returns
 * `touched: false`) and keeps leg 1's spread profit. The page zeroed leg 1
 * anyway ("buy books at sale"), so a GBP -> AED trade the books record as
 * +$100 previewed as +$0.
 *
 * Lead 4 — FIFO preview price denominator. The server prices the consume as
 * `amountIn / amountOut` with the ROUNDED amountOut it was sent; the page
 * divided by the raw, unrounded leg amount, so a USD -> EUR $100 sale
 * (86.2068... EUR raw, 86.21 submitted) previewed at 1.16 USD/EUR while the
 * books use 100 / 86.21.
 *
 * Rule 25: the `useApi()` mock returns ONE stable object.
 * Rule 17: written before the fix; the red run is recorded in the task report.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("@liratek/core", () => ({
  TAKE_USD: -1,
  calculateAmountInForTarget: jest.fn(() => 0),
  isLotTrackedCurrency: (code: string) => !["USD", "LBP"].includes(code),
  convertFromUSD: (usd: number) => ({ amountOut: usd * 89_000, rate: 89_000 }),
  computeOverrideLegProfitUsd: () => 0,
  calculateExchange: (from: string, to: string, amountIn: number) => {
    if (from === "GBP" && to === "AED") {
      // Cross via USD. Leg 1 GBP -> USD earns $100 of spread; leg 2 earns 0.
      const leg1Out = amountIn * 1.2;
      const leg2Out = leg1Out * 3.67;
      return {
        fromCurrency: from,
        toCurrency: to,
        amountIn,
        totalAmountOut: leg2Out,
        totalProfitUsd: 100,
        viaCurrency: "USD",
        legs: [
          {
            fromCurrency: from,
            toCurrency: "USD",
            amountIn,
            amountOut: leg1Out,
            rate: 1.2,
            marketRate: 1.3,
            profitUsd: 100,
          },
          {
            fromCurrency: "USD",
            toCurrency: to,
            amountIn: leg1Out,
            amountOut: leg2Out,
            rate: 3.67,
            marketRate: 3.67,
            profitUsd: 0,
          },
        ],
      };
    }
    if (from === "USD" && to === "EUR") {
      return {
        fromCurrency: from,
        toCurrency: to,
        amountIn,
        totalAmountOut: amountIn / 1.16,
        totalProfitUsd: 0.5,
        viaCurrency: null,
        legs: [
          {
            fromCurrency: from,
            toCurrency: to,
            amountIn,
            amountOut: amountIn / 1.16,
            rate: 1.16,
            marketRate: 1.18,
            profitUsd: 0.5,
          },
        ],
      };
    }
    throw new Error(`calculateExchange mock: unhandled pair ${from}->${to}`);
  },
}));

const mockPreview = jest.fn();
const mockGetRates = jest.fn();
const mockApi = {
  getRates: mockGetRates,
  getExchangeHistory: jest.fn().mockResolvedValue([]),
  addExchangeTransaction: jest.fn().mockResolvedValue({ success: true, id: 1 }),
  exchangeLots: { preview: mockPreview },
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  DecimalInput: ({
    value,
    onChange,
    placeholder,
    className,
    "data-testid": dataTestId,
  }: {
    value: number;
    onChange: (n: number) => void;
    placeholder?: string;
    className?: string;
    "data-testid"?: string;
  }) => (
    <input
      data-testid={dataTestId ?? "amount-in"}
      type="text"
      value={value === 0 ? "" : String(value)}
      placeholder={placeholder}
      className={className}
      onChange={(e) =>
        onChange(parseFloat(e.target.value.replace(/,/g, "")) || 0)
      }
    />
  ),
}));

jest.mock("@/features/recharge/components/PaymentSheet", () => ({
  PaymentSheet: () => null,
}));

// Mutable per describe (the page defaults from/to to the first two
// currencies); the context object itself stays one stable reference.
const mockCurrencyContext = {
  activeCurrencies: [] as Array<{ code: string; name: string }>,
  getDecimals: (c: string) => (c === "LBP" ? 0 : 2),
};
jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => mockCurrencyContext,
}));

const mockSessionContext = { activeSession: null, linkTransaction: jest.fn() };
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSessionContext,
}));

jest.mock("@/features/sessions/hooks/useSessionAutoFill", () => ({
  useSessionAutoFill: jest.fn(),
}));

const mockPaymentMethods = {
  methods: [{ code: "CASH", label: "Cash" }],
  drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => mockPaymentMethods,
}));

jest.mock("@/utils/liveExchangeRates", () => ({
  fetchLiveCurrencyRates: jest.fn().mockResolvedValue([]),
  fetchLiveRatesSnapshot: jest.fn().mockResolvedValue({
    raw: {},
    rates: [],
    marketRates: [],
    lastUpdatedUtc: "Thu, 01 Oct 2026 00:02:31 +0000",
    nextUpdateUnix: 1785543661,
  }),
  CURRENCY_NAMES: {
    USD: "US Dollar",
    LBP: "Lebanese Pound",
    EUR: "Euro",
    GBP: "British Pound",
    AED: "UAE Dirham",
  },
  EXCLUDED_CURRENCIES: new Set(["USD", "LBP", "EUR"]),
  getCurrencySymbol: (code: string) =>
    ({ USD: "$", LBP: "LBP", EUR: "€" })[code] ?? code,
}));

jest.mock("@/features/partners/components/ForPartnerToggle", () => ({
  ForPartnerToggle: () => null,
  ForPartnerNotice: () => null,
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("../components/HistoryModal", () => ({
  HistoryModal: () => null,
}));

jest.mock("../components/PositionsPanel", () => ({
  PositionsPanel: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import Exchange from "../index";

function signedAmount(el: HTMLElement): number {
  const text = el.textContent ?? "";
  const m = text.match(/([+-])\$([\d.]+)/);
  if (!m) throw new Error(`no signed amount in "${text}"`);
  return (m[1] === "-" ? -1 : 1) * parseFloat(m[2]);
}

describe("Exchange preview — NO_RATE_ANCHOR cross keeps leg 1's profit (LIRA-185 lead 3)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrencyContext.activeCurrencies = [
      { code: "GBP", name: "British Pound" },
      { code: "AED", name: "UAE Dirham" },
    ];
    // Only LBP is configured; GBP and AED have no exchange_rates row, which
    // is exactly the case the server reports as NO_RATE_ANCHOR.
    mockGetRates.mockResolvedValue([
      {
        to_code: "LBP",
        market_rate: 89_500,
        buy_rate: 89_000,
        sell_rate: 90_000,
        is_stronger: 1,
      },
    ]);
    mockPreview.mockResolvedValue({
      lotTracked: false,
      reason: "NO_RATE_ANCHOR",
    });
  });

  it("previews Total +$100.0000 (what the books record), not +$0.0000", async () => {
    render(<Exchange />);
    await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId("amount-in"), {
      target: { value: "1000" },
    });
    // The lot-preview call is behind a real 400ms setTimeout debounce (see
    // the `useEffect` in `features/exchange/pages/Exchange/index.tsx` around
    // "EXCHANGE_LOT_SETTLEMENT.md Q10"), not a mocked/fake timer. jsdom's
    // default `waitFor` timeout (1000ms) leaves only ~600ms of margin over
    // that debounce for the surrounding effect chain (rates load, calcResult,
    // consumingLeg) to settle, which CI's slower/coverage-instrumented run
    // ate into — hence the flake. Widen the margin rather than touch the
    // debounce itself.
    await waitFor(
      () =>
        expect(mockPreview).toHaveBeenCalledWith(
          expect.objectContaining({ currencyCode: "AED", fromCurrency: "GBP" }),
        ),
      { timeout: 5000 },
    );
    await screen.findByText(/Cost-basis tracking unavailable for this pair/i);

    const totalEl = await screen.findByTestId("exchange-cross-total-profit");
    await waitFor(() => expect(signedAmount(totalEl)).toBeCloseTo(100, 4));
    // No lot is opened for this trade, so the "books at sale" deferral note
    // would be untrue; leg 1 shows its real profit instead.
    expect(
      screen.queryByTestId("exchange-cross-deferred-1"),
    ).not.toBeInTheDocument();
    expect(
      signedAmount(screen.getByTestId("exchange-cross-leg-profit-1")),
    ).toBeCloseTo(100, 4);
  });
});

describe("Exchange preview — FIFO price uses the submitted (rounded) amountOut (LIRA-185 lead 4)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrencyContext.activeCurrencies = [
      { code: "USD", name: "US Dollar" },
      { code: "EUR", name: "Euro" },
    ];
    mockGetRates.mockResolvedValue([
      {
        to_code: "EUR",
        market_rate: 1.18,
        buy_rate: 1.16,
        sell_rate: 1.2,
        is_stronger: -1,
      },
    ]);
    mockPreview.mockResolvedValue({
      lotTracked: true,
      marketUnitCostUsd: 1.18,
      settlements: [],
      realizedProfitUsd: 0,
      coveredQty: 0,
      marketQty: 0,
    });
  });

  it("sends unitProceedsUsd = 100 / 86.21 (the server's pair), not 100 / 86.2068...", async () => {
    render(<Exchange />);
    await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId("amount-in"), {
      target: { value: "100" },
    });
    // Same 400ms real-timer debounce as the lead-3 case above; widen the
    // margin for the same reason (see comment there).
    await waitFor(() => expect(mockPreview).toHaveBeenCalled(), {
      timeout: 5000,
    });

    const call = mockPreview.mock.calls[mockPreview.mock.calls.length - 1][0] as {
      qty: number;
      unitProceedsUsd: number;
    };
    expect(call.qty).toBe(86.21);
    // Exactly what ExchangeRepository computes from the submitted payload
    // (amountIn / amountOut) — so preview and stamp see the same (qty, price).
    expect(call.unitProceedsUsd).toBe(100 / 86.21);
  });
});
