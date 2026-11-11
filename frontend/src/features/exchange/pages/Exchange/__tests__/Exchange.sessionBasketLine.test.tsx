/** @jest-environment jsdom */

/**
 * LIRA-380 — with a customer session open, the Exchange page adds a basket
 * line instead of booking: Confirm calls `addToCart` with the exchange
 * payload (no payment lines — the basket's one payment pays it) and NEVER
 * `addExchangeTransaction` or `session.linkTransaction` (rule 24: the old
 * book-then-link path is guarded as NOT taken). The line's label shows the
 * exchange's own rate; the payment window — home of the exchange-only
 * Discount, account, keep-change, round-up and added-change controls — is
 * never opened. Field names come from `exchangeSubmitSchema` (rule 24).
 *
 * Rule 17: run against the unfixed page first (it opened the payment
 * window, then booked and linked). Harness copied from
 * Exchange.lira366Note.test.tsx.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("@liratek/core", () => ({
  // The real payment box (used by the US1.3 test below) imports these.
  ...(() => {
    const band = jest.requireActual(
      "../../../../../../../packages/core/src/constants/tenderRateBand",
    );
    const ex = jest.requireActual(
      "../../../../../../../packages/core/src/validators/exchange",
    );
    // LIRA-380: the real basket-line rule (the page's basket builder reads it).
    const line = jest.requireActual(
      "../../../../../../../packages/core/src/utils/sessionExchangeLine",
    );
    return {
      EXCHANGE_CART_CHANNEL: line.EXCHANGE_CART_CHANNEL,
      sessionExchangeCartAmount: line.sessionExchangeCartAmount,
      TENDER_RATE_BAND_PCT: band.TENDER_RATE_BAND_PCT,
      tenderRateDeviationPct: band.tenderRateDeviationPct,
      isWithinShortfallMax: ex.isWithinShortfallMax,
    };
  })(),
  TAKE_USD: -1,
  SHORTFALL_MAX: { USD: 5, LBP: 450_000 },
  calculateAmountInForTarget: jest.fn(() => 0),
  // Faithful mirror of currencyConverter.ts's computeOverrideLegProfitUsd
  // (donor: Exchange.overrideSign.test.tsx) — the override path calls it.
  computeOverrideLegProfitUsd: (
    marketOut: number,
    actualOut: number,
    outCurrencyRate: { market_rate: number; is_stronger: 1 | -1 } | null,
  ) => {
    const usdPerOutUnit = outCurrencyRate
      ? outCurrencyRate.is_stronger === 1
        ? 1 / outCurrencyRate.market_rate
        : outCurrencyRate.market_rate
      : 1;
    return (marketOut - actualOut) * usdPerOutUnit;
  },
  isLotTrackedCurrency: (code: string) => !["USD", "LBP"].includes(code),
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
// Rule 24: field names come from the core schema (direct module path —
// @liratek/core itself is stubbed above).
import { exchangeSubmitSchema } from "../../../../../../../packages/core/src/validators/exchange";

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

// Rule 25: a STABLE useApi() reference.
const mockApi = {
  getRates: mockGetRates,
  getExchangeHistory: mockGetExchangeHistory,
  addExchangeTransaction: mockAddExchangeTransaction,
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

// Client picker stub: a text input (typed-name fallback) plus a button that
// "picks" a saved client, exactly as the real dropdown does (onChange with
// the full name, then onClientSelect).
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: ({
    value,
    onChange,
    onClientSelect,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    onClientSelect?: (c: {
      id: number;
      full_name: string;
      phone_number: string;
    }) => void;
    placeholder?: string;
  }) => (
    <div>
      <input
        data-testid="stub-client-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        data-testid="stub-pick-client"
        onClick={() => {
          onChange("Rami Haddad");
          onClientSelect?.({
            id: 42,
            full_name: "Rami Haddad",
            phone_number: "03111222",
          });
        }}
      />
    </div>
  ),
}));

type CounterFlowProp = {
  label: string;
  totalAmount: number;
  currency: string;
  onChange: (lines: unknown[]) => void;
  paymentMethods?: Array<{ code: string; label: string }>;
  requiresClient?: boolean;
  hasClient?: boolean;
  seedLines?: Array<{ method: string; currencyCode: string; amount: number }>;
  lockCurrency?: boolean;
  maxForgive?: number;
  onStateChange?: (s: Record<string, unknown>) => void;
};

/** When true the PaymentSheet stub renders the REAL sheet (real payment box). */
const mockUseRealSheet = false;

const BALANCED = {
  paid: 90,
  owedToAccount: 10,
  forgiven: 0,
  balanced: true,
  overpaid: false,
  needsClient: false,
  unaccounted: 0,
};

jest.mock("@/features/recharge/components/PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    onConfirm: () => void;
    counterFlow?: CounterFlowProp;
  }) => {
    if (mockUseRealSheet) {
      const { PaymentSheet: RealSheet } = jest.requireActual(
        "@/features/recharge/components/PaymentSheet",
      );
      return <RealSheet {...props} />;
    }
    const cf = props.counterFlow;
    return props.open ? (
      <div data-testid="stub-payout-sheet">
        <button
          data-testid="stub-payout-lines"
          onClick={() =>
            props.onPaymentChange([
              {
                id: "P1",
                method: "CASH",
                currencyCode: "LBP",
                amount: 8_900_000,
              },
            ])
          }
        />
        <button
          data-testid="stub-customer-lines"
          onClick={() =>
            cf?.onChange([
              { id: "C1", method: "CASH", currencyCode: "USD", amount: 90 },
              {
                id: "C2",
                method: "CUSTOMER_ACCOUNT",
                currencyCode: "USD",
                amount: 10,
              },
              { id: "C3", method: "CASH", currencyCode: "USD", amount: 0 },
            ])
          }
        />
        <button
          data-testid="stub-customer-short"
          onClick={() =>
            cf?.onChange([
              { id: "S1", method: "CASH", currencyCode: "USD", amount: 98 },
            ])
          }
        />
        <button
          data-testid="stub-state-balanced"
          onClick={() => cf?.onStateChange?.(BALANCED)}
        />
        <button
          data-testid="stub-state-needs-client"
          onClick={() =>
            cf?.onStateChange?.({ ...BALANCED, needsClient: true })
          }
        />
        <button
          data-testid="stub-state-unbalanced"
          onClick={() =>
            cf?.onStateChange?.({
              ...BALANCED,
              owedToAccount: 0,
              balanced: false,
              unaccounted: 10,
            })
          }
        />
        <button
          data-testid="stub-state-overpaid"
          onClick={() =>
            cf?.onStateChange?.({
              ...BALANCED,
              balanced: false,
              overpaid: true,
            })
          }
        />
        <button
          data-testid="stub-state-forgiven"
          onClick={() =>
            cf?.onStateChange?.({
              paid: 98,
              owedToAccount: 0,
              forgiven: 2,
              balanced: true,
              overpaid: false,
              needsClient: false,
              unaccounted: 0,
            })
          }
        />
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null;
  },
}));

const mockActiveCurrencies = [
  { code: "USD", name: "US Dollar" },
  { code: "LBP", name: "Lebanese Pound" },
];
const mockGetDecimals = (c: string) => (c === "LBP" ? 0 : 2);
const mockCurrencyContext: {
  activeCurrencies: Array<{ code: string; name: string }>;
  getDecimals: (c: string) => number;
} = {
  activeCurrencies: mockActiveCurrencies,
  getDecimals: mockGetDecimals,
};
jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => mockCurrencyContext,
}));

// LIRA-380: a customer session is open on this device.
const mockAddToCart = jest.fn().mockResolvedValue(true);
const mockLinkTransaction = jest.fn();
const mockSessionContext = {
  activeSession: { id: 12, customer_name: "Rana Aziz", is_active: 1 },
  addToCart: mockAddToCart,
  linkTransaction: mockLinkTransaction,
};
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSessionContext,
}));

jest.mock("@/features/sessions/hooks/useSessionAutoFill", () => ({
  useSessionAutoFill: jest.fn(),
}));

const mockPaymentMethods = {
  methods: [
    { code: "CASH", label: "Cash", affects_drawer: 1 },
    { code: "WHISH", label: "Whish Wallet", affects_drawer: 1 },
    { code: "GIFT_CARD", label: "Gift Card", affects_drawer: 1 },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account", affects_drawer: 0 },
  ],
  drawerAffectingMethods: [
    { code: "CASH", label: "Cash", affects_drawer: 1 },
    { code: "WHISH", label: "Whish Wallet", affects_drawer: 1 },
    { code: "GIFT_CARD", label: "Gift Card", affects_drawer: 1 },
  ],
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
  CURRENCY_NAMES: { USD: "US Dollar", LBP: "Lebanese Pound" },
  EXCLUDED_CURRENCIES: new Set(["USD", "LBP", "EUR"]),
  getCurrencySymbol: (code: string) =>
    ({ USD: "$", LBP: "LBP", EUR: "€" })[code] ?? code,
}));

jest.mock("@/features/partners/components/ForPartnerToggle", () => ({
  ForPartnerToggle: ({
    checked,
    onChange,
    onPartnerChange,
    testId,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    onPartnerChange: (id: number | null) => void;
    testId: string;
  }) => (
    <div>
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <button
        data-testid="stub-pick-partner"
        onClick={() => onPartnerChange(7)}
      />
    </div>
  ),
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


async function renderWithAmount() {
  render(<Exchange />);
  await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
  // USD → LBP, amountIn = 100 (the stubbed calculator: 89,000 per dollar).
  fireEvent.change(screen.getByTestId("amount-in"), {
    target: { value: "100" },
  });
}

/** Keys a basket line must never carry — the basket's payment owns them. */
const PAYMENT_SIDE_KEYS = [
  "payments",
  "customerPayments",
  "customer_waived_amount",
  "kept_change_usd",
  "kept_change_lbp",
  "rounding_given_usd",
  "rounding_given_lbp",
  "added_change_usd",
  "added_change_lbp",
  "tender_exchange_rate",
  "customer_account_usd_rate",
  "payout_account_usd_rate",
  "partnerId",
  "partnerMode",
] as const;

describe("LIRA-380 — Exchange page in a customer session", () => {
  beforeEach(() => {
    mockAddToCart.mockClear();
    mockLinkTransaction.mockClear();
    mockAddExchangeTransaction.mockClear();
  });

  it("Confirm adds a basket line with the schema payload and books nothing", async () => {
    await renderWithAmount();
    const btn = await screen.findByRole("button", { name: /Add to basket/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));
    // The old path — book now, link afterwards — is NOT taken.
    expect(mockAddExchangeTransaction).not.toHaveBeenCalled();
    expect(mockLinkTransaction).not.toHaveBeenCalled();
    // No payment window: the exchange-only payment controls never show.
    expect(screen.queryByTestId("stub-payout-sheet")).toBeNull();

    const line = mockAddToCart.mock.calls[0][0];
    expect(line).toMatchObject({
      module: "exchange",
      ipcChannel: "exchange:add-transaction",
      amount: 100,
      currency: "USD",
    });
    // The line shows its own rate, read-only.
    expect(line.label).toContain("@ 89,000");
    expect(line.label).toContain("8,900,000 LBP");

    // Rule 24: the payload is exactly what the exchange schema accepts.
    const parsed = exchangeSubmitSchema.parse(line.formData);
    expect(parsed).toMatchObject({
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 8_900_000,
      leg1Rate: 89_000,
    });
    for (const key of PAYMENT_SIDE_KEYS) {
      expect(line.formData).not.toHaveProperty(key);
    }
  });

  it("the page returns to empty after the line is added", async () => {
    await renderWithAmount();
    const btn = await screen.findByRole("button", { name: /Add to basket/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        (screen.getByTestId("amount-in") as HTMLInputElement).value,
      ).toBe(""),
    );
  });

  it("a refused basket line keeps the amount on screen", async () => {
    mockAddToCart.mockResolvedValueOnce(false);
    await renderWithAmount();
    const btn = await screen.findByRole("button", { name: /Add to basket/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));
    expect((screen.getByTestId("amount-in") as HTMLInputElement).value).toBe(
      "100",
    );
  });
});
