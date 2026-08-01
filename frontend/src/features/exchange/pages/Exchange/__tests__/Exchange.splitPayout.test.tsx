/** @jest-environment jsdom */

/**
 * Exchange page — split payout contract (owner-requested 2026-07-30).
 *
 * A USD/LBP-target walk-in exchange confirms through the PaymentSheet
 * (always-open, owner decision), and the submit payload must carry the
 * sheet's lines as `payments` plus the rate the sheet ACTUALLY converted at
 * as `tender_exchange_rate` — the repository reconciles the legs hard-reject
 * against `amountOut` at that rate. The sheet is cash-only in v1 and is
 * seeded with the exchange's OWN effective rate, not the server rate.
 *
 * The PaymentSheet is stubbed (donor: OmtWhishAppTransferForm.legsGate) and
 * its props captured, so the test drives the page's real closures.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// The page needs only the currency-converter exports from @liratek/core;
// the package's full index chains db imports that cannot resolve under
// jsdom (and cross-package requireActual stalls ts-jest), so stub the three
// runtime exports with a fixed USD→LBP result at rate 89,000. Type-only
// imports (CurrencyRate, CurrencyExchangeResult) are erased at compile time.
jest.mock("@liratek/core", () => ({
  TAKE_USD: -1,
  convertFromUSD: (usd: number) => ({
    amountOut: usd * 89_000,
    rate: 89_000,
  }),
  calculateExchange: (from: string, to: string, amountIn: number) => ({
    fromCurrency: from,
    toCurrency: to,
    amountIn,
    totalAmountOut: amountIn * 89_000,
    totalProfitUsd: 0.5,
    viaCurrency: null,
    legs: [
      {
        fromCurrency: from,
        toCurrency: to,
        amountIn,
        amountOut: amountIn * 89_000,
        rate: 89_000,
        marketRate: 89_500,
        profitUsd: 0.5,
      },
    ],
  }),
}));

import Exchange from "../index";

const mockAddExchangeTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetRates = jest.fn().mockResolvedValue([
  {
    to_code: "LBP",
    market_rate: 89_500,
    buy_rate: 89_000,
    sell_rate: 90_000,
    is_stronger: 1,
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
// the seed rate / method list, and exposes buttons to inject lines, edit the
// sheet rate, and confirm.
let lastSheetProps: Record<string, unknown> = {};
jest.mock("@/features/recharge/components/PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    exchangeRate?: number;
    paymentMethods: Array<{ code: string }>;
    onPaymentChange: (lines: unknown[]) => void;
    onExchangeRateChange?: (rate: number) => void;
    onConfirm: () => void;
  }) => {
    lastSheetProps = props as unknown as Record<string, unknown>;
    return props.open ? (
      <div data-testid="stub-payout-sheet">
        <button
          data-testid="stub-inject-split"
          onClick={() =>
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 50 },
              {
                id: "L2",
                method: "CASH",
                currencyCode: "LBP",
                amount: 4_450_000,
              },
            ])
          }
        />
        <button
          data-testid="stub-edit-rate"
          onClick={() => props.onExchangeRateChange?.(89_000)}
        />
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null;
  },
}));

// IMPORTANT: every value these context mocks return must be REFERENTIALLY
// STABLE across renders. `getDecimals` is a dependency of the page's
// `recalculate` callback, whose effect sets state — a fresh closure per
// render loops the component forever (burned 18 minutes of CPU before this
// comment existed).
const mockActiveCurrencies = [
  { code: "USD", name: "US Dollar" },
  { code: "LBP", name: "Lebanese Pound" },
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
  // Includes a wallet method on purpose — the sheet must receive CASH only.
  methods: [
    { code: "CASH", label: "Cash" },
    { code: "WHISH", label: "Whish Wallet" },
  ],
  drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => mockPaymentMethods,
}));

jest.mock("@/utils/liveExchangeRates", () => ({
  fetchLiveCurrencyRates: jest.fn().mockResolvedValue([]),
  // The page reads the whole snapshot now (rates for the selector,
  // marketRates + publish time for the market-reference panel).
  fetchLiveRatesSnapshot: jest.fn().mockResolvedValue({
    raw: {},
    rates: [],
    marketRates: [],
    lastUpdatedUtc: "Fri, 31 Jul 2026 00:02:31 +0000",
    nextUpdateUnix: 1785543661,
  }),
  CURRENCY_NAMES: { USD: "US Dollar", LBP: "Lebanese Pound" },
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

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

async function renderAndCalculate() {
  render(<Exchange />);
  await waitFor(() => expect(mockGetRates).toHaveBeenCalled());

  // USD → LBP (the context's currency order), amountIn = 100.
  fireEvent.change(screen.getByTestId("amount-in"), {
    target: { value: "100" },
  });

  // The confirm button flips to "Proceed to Payout" once a result exists.
  const btn = await screen.findByRole("button", {
    name: /Proceed to Payout/i,
  });
  return btn;
}

describe("Exchange page — split payout contract", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    lastSheetProps = {};
  });

  it("submits the sheet's lines as payments + the edited sheet rate as tender_exchange_rate", async () => {
    const btn = await renderAndCalculate();

    fireEvent.click(btn);
    await screen.findByTestId("stub-payout-sheet");

    fireEvent.click(screen.getByTestId("stub-edit-rate")); // sheet reports 89,000
    fireEvent.click(screen.getByTestId("stub-inject-split"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );

    const payload = mockAddExchangeTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.fromCurrency).toBe("USD");
    expect(payload.toCurrency).toBe("LBP");
    expect(payload.payments).toEqual([
      expect.objectContaining({
        method: "CASH",
        currencyCode: "USD",
        amount: 50,
      }),
      expect.objectContaining({
        method: "CASH",
        currencyCode: "LBP",
        amount: 4_450_000,
      }),
    ]);
    expect(payload.tender_exchange_rate).toBe(89_000);
  });

  it("seeds the sheet with the exchange's OWN effective rate and CASH as the only method", async () => {
    const btn = await renderAndCalculate();
    fireEvent.click(btn);
    await screen.findByTestId("stub-payout-sheet");

    // Seed = the LBP leg's effective rate — the SAME rate stamped as
    // leg1Rate on submit (owner decision: the exchange's own rate, never an
    // independent server lookup).
    fireEvent.click(screen.getByTestId("stub-inject-split"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );
    const payload = mockAddExchangeTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(lastSheetProps.exchangeRate).toBe(payload.leg1Rate);

    // Cash-only v1: the wallet method from usePaymentMethods must NOT reach
    // the sheet.
    expect(lastSheetProps.paymentMethods).toEqual([
      { code: "CASH", label: "Cash" },
    ]);

    // No edit → the seed itself travels as the tender rate.
    expect(payload.tender_exchange_rate).toBe(payload.leg1Rate);
  });
});
