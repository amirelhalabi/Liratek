/** @jest-environment jsdom */

/**
 * LIRA-329 T028 — the Exchange page sends what the transaction's details
 * need, in its ONE payload (rule 22):
 *  - `leg1RateOverridden` (and `leg2RateOverridden` on a cross) — whether
 *    the cashier typed their own rate, by the SAME predicate the page uses
 *    to apply that rate;
 *  - `clientPhone` when a saved client is picked (the phone is the picked
 *    client's; typing a name by hand clears it).
 * Field names are read off `exchangeSubmitSchema.parse` (rule 24), and every
 * key the page sends must survive the parse (rule 23 — Zod strips unknown
 * keys silently).
 *
 * Harness copied from Exchange.customerPays.test.tsx (PaymentSheet and
 * client picker stubbed, their props captured).
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
    return {
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
let mockUseRealSheet = false;

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
  // USD → LBP, amountIn = 100.
  fireEvent.change(screen.getByTestId("amount-in"), {
    target: { value: "100" },
  });
}

async function submitThroughSheet() {
  const btn = await screen.findByRole("button", {
    name: /Proceed to Payout/i,
  });
  await waitFor(() => expect(btn).not.toBeDisabled());
  fireEvent.click(btn);
  fireEvent.click(await screen.findByTestId("stub-confirm"));
  await waitFor(() =>
    expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
  );
}

function lastPayload(): Record<string, unknown> {
  expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1);
  return mockAddExchangeTransaction.mock.calls[0][0] as Record<string, unknown>;
}

/** Parse through the schema and prove no sent key was stripped. */
function parseKeepingEveryKey(raw: Record<string, unknown>) {
  const parsed = exchangeSubmitSchema.parse(raw);
  const sent = Object.keys(raw).filter((k) => raw[k] !== undefined);
  expect(Object.keys(parsed)).toEqual(expect.arrayContaining(sent));
  return parsed;
}

describe("LIRA-329 — Exchange page payload for the transaction's details", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    mockAddExchangeTransaction.mockResolvedValue({ success: true, id: 1 });
    mockUseRealSheet = false;
  });

  it("an overridden rate and a picked client send leg1RateOverridden: true and the client's phone", async () => {
    await renderWithAmount();
    fireEvent.click(screen.getByTestId("stub-pick-client"));
    const rateInput = await screen.findByTestId("exchange-direct-rate-input");
    fireEvent.change(rateInput, { target: { value: "90200" } });

    await submitThroughSheet();
    const parsed = parseKeepingEveryKey(lastPayload());

    expect(parsed.leg1Rate).toBe(90_200);
    expect(parsed.leg1RateOverridden).toBe(true);
    expect(parsed.leg2RateOverridden).toBeUndefined();
    expect(parsed.clientId).toBe(42);
    expect(parsed.clientName).toBe("Rami Haddad");
    expect(parsed.clientPhone).toBe("03111222");
  });

  it("the shop's own rate sends leg1RateOverridden: false; a typed name sends no phone", async () => {
    await renderWithAmount();
    fireEvent.change(screen.getByTestId("stub-client-input"), {
      target: { value: "Walk In" },
    });

    await submitThroughSheet();
    const parsed = parseKeepingEveryKey(lastPayload());

    expect(parsed.leg1Rate).toBe(89_000);
    expect(parsed.leg1RateOverridden).toBe(false);
    expect(parsed.clientName).toBe("Walk In");
    expect(parsed.clientId).toBeUndefined();
    expect(parsed.clientPhone).toBeUndefined();
  });

  it("a picked client then a hand-typed name: the phone is not sent", async () => {
    await renderWithAmount();
    fireEvent.click(screen.getByTestId("stub-pick-client"));
    fireEvent.change(screen.getByTestId("stub-client-input"), {
      target: { value: "Someone Else" },
    });

    await submitThroughSheet();
    const parsed = parseKeepingEveryKey(lastPayload());

    expect(parsed.clientName).toBe("Someone Else");
    expect(parsed.clientPhone).toBeUndefined();
  });
});
