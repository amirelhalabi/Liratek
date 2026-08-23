/** @jest-environment jsdom */

/**
 * Exchange page — payout sheet `totalAmount` rounding.
 *
 * Owner-reported bug: "when proceeding to pay customer 113 I can see
 * 129.9999 but the payment is 113" / "EUR to USD is failing in all forms"
 * (same Exchange screen, confirmed by the reporter).
 *
 * Root cause: the page passes the RAW, unrounded `effectiveResult.totalAmountOut`
 * float (e.g. 131.07999999999998 for a clean 113 EUR input, because EUR's
 * rate isn't round) straight into `PaymentSheet`'s `totalAmount` prop.
 * `MultiPaymentInput`'s `prefillAmountFor` then surfaces that noisy float
 * verbatim in the operator-facing payment-amount field. The calculator card
 * above the sheet looks fine because it reads a SEPARATE, already-rounded
 * `amountOut` string state — a different variable from what feeds the sheet.
 *
 * This test mirrors the harness in Exchange.splitPayout.test.tsx (same
 * mocks/stub pattern) but drives an EUR → USD conversion whose mocked
 * `totalAmountOut` carries float noise, and asserts the sheet actually
 * receives the rounded 2-decimal value.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Same rationale as Exchange.splitPayout.test.tsx: @liratek/core's full index
// chains db imports that can't resolve under jsdom, so stub the runtime
// exports the page actually uses. `calculateExchange` returns a FIXED noisy
// totalAmountOut regardless of input — the test always types amountIn=113
// (the reporter's own repro number).
jest.mock("@liratek/core", () => ({
  TAKE_USD: -1,
  // EXCHANGE_LOT_SETTLEMENT.md Q1 — this suite exercises EUR→USD (toCurrency
  // USD is exempt), so the lot-preview path is never reached, but
  // Exchange/index.tsx calls this unconditionally every render.
  isLotTrackedCurrency: (code: string) => !["USD", "LBP"].includes(code),
  convertFromUSD: (usd: number) => ({
    amountOut: usd * 1.16,
    rate: 1.16,
  }),
  calculateExchange: (from: string, to: string, amountIn: number) => ({
    fromCurrency: from,
    toCurrency: to,
    amountIn,
    // Float noise from a non-round EUR rate — the exact shape of the bug.
    totalAmountOut: 131.07999999999998,
    totalProfitUsd: 0.5,
    viaCurrency: null,
    legs: [
      {
        fromCurrency: from,
        toCurrency: to,
        amountIn,
        amountOut: 131.07999999999998,
        rate: 1.1601,
        marketRate: 1.16,
        profitUsd: 0.5,
      },
    ],
  }),
}));

const mockAddExchangeTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetRates = jest.fn().mockResolvedValue([
  {
    to_code: "EUR",
    market_rate: 1.16,
    buy_rate: 1.1601,
    sell_rate: 1.17,
    is_stronger: -1,
  },
]);
const mockGetExchangeHistory = jest.fn().mockResolvedValue([]);

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getRates: mockGetRates,
    getExchangeHistory: mockGetExchangeHistory,
    addExchangeTransaction: mockAddExchangeTransaction,
  }),
  DecimalInput: ({
    value,
    onChange,
    placeholder,
    className,
  }: {
    value: number;
    onChange: (n: number) => void;
    placeholder?: string;
    className?: string;
  }) => (
    <input
      data-testid="amount-in"
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

// PaymentSheet stub: captures every render's props so the test can assert
// exactly what `totalAmount` the sheet receives.
let lastSheetProps: Record<string, unknown> = {};
jest.mock("@/features/recharge/components/PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    totalAmount: number;
    onConfirm: () => void;
  }) => {
    lastSheetProps = props as unknown as Record<string, unknown>;
    return props.open ? (
      <div data-testid="stub-payout-sheet">
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null;
  },
}));

// EUR listed before USD so the page's "pick the first two active
// currencies" default effect lands on the reported EUR → USD pairing.
const mockActiveCurrencies = [
  { code: "EUR", name: "Euro" },
  { code: "USD", name: "US Dollar" },
];
const mockGetDecimals = (c: string) => (c === "LBP" ? 0 : 2);
const mockCurrencyContext = {
  activeCurrencies: mockActiveCurrencies,
  getDecimals: mockGetDecimals,
};
jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => mockCurrencyContext,
}));

const mockSessionContext = {
  activeSession: null,
  linkTransaction: jest.fn(),
};
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
    lastUpdatedUtc: "Fri, 31 Jul 2026 00:02:31 +0000",
    nextUpdateUnix: 1785543661,
  }),
  CURRENCY_NAMES: { USD: "US Dollar", LBP: "Lebanese Pound", EUR: "Euro" },
  EXCLUDED_CURRENCIES: new Set(["USD", "LBP", "EUR"]),
  // Called during render — an undefined mock throws before any assertion.
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

// The Exchange page now always renders PositionsPanel (Q16) — stubbed here
// since this suite doesn't exercise the lot-positions read and the page's
// `useApi()` mock above doesn't stub `exchangeLots` at all.
jest.mock("../components/PositionsPanel", () => ({
  PositionsPanel: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import Exchange from "../index";

describe("Exchange page — payout sheet totalAmount rounding", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    lastSheetProps = {};
  });

  it("rounds the noisy raw totalAmountOut float before handing it to PaymentSheet", async () => {
    render(<Exchange />);
    await waitFor(() => expect(mockGetRates).toHaveBeenCalled());

    // EUR → USD (the context's currency order), amountIn = 113 — the
    // reporter's own repro number.
    fireEvent.change(screen.getByTestId("amount-in"), {
      target: { value: "113" },
    });

    const btn = await screen.findByRole("button", {
      name: /Proceed to Payout/i,
    });
    fireEvent.click(btn);
    await screen.findByTestId("stub-payout-sheet");

    // The mocked calculation result carries float noise
    // (131.07999999999998). The sheet must receive the rounded 2-decimal
    // USD value, not the raw float.
    expect(lastSheetProps.totalAmount).toBe(131.08);
    expect(lastSheetProps.totalAmount).not.toBe(131.07999999999998);
  });
});
