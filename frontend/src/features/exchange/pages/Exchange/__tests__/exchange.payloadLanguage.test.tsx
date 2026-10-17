/** @jest-environment jsdom */

/**
 * LIRA-331 (T047, research R9): the Exchange page sends the SAME payload in
 * English and in Arabic. Translation must never reach a payload field (the
 * stored `note`, the currency names, a method code), an option value or a
 * comparison.
 *
 * Every mode the page books is walked (rule 28d): a USD → LBP walk-in paid
 * out on the sheet, a picked client with part of the customer's side on
 * their account, a forgiven shortfall, LBP → USD (swapped), a typed name
 * with no saved client, a cashier-typed rate, EUR → USD (from a lot-tracked
 * currency), and For Partner (no sheet, direct submit). Each scenario runs
 * at `en` and at `ar` through the real page; only test ids are used to
 * drive it, never English text. The two captured payloads must be
 * deep-equal, and each is parsed through the core schema (rule 24).
 *
 * The PaymentSheet and the client picker are stubbed (same stubs as
 * Exchange.customerPays.test.tsx) so the page's own closures build the
 * payload. Core's calculation is stubbed as in the other Exchange tests.
 *
 * Rule 17: not failing-first (guard against future drift).
 * Rule 25: `mockApi` is a stable module-level object.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";

jest.mock("@liratek/core", () => ({
  TAKE_USD: -1,
  SHORTFALL_MAX: { USD: 5, LBP: 450_000 },
  calculateAmountInForTarget: jest.fn(() => 0),
  computeOverrideLegProfitUsd: () => 0.25,
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

import { i18n, loadLanguage } from "@/i18n/setup";
import Exchange from "../index";
// Rule 24: field names come from the core schema (direct module path —
// @liratek/core itself is stubbed above).
import { exchangeSubmitSchema } from "../../../../../../../packages/core/src/validators/exchange";

const mockAddExchangeTransaction = jest.fn();
const mockGetRates = jest.fn();
const mockGetExchangeHistory = jest.fn();
const mockPreview = jest.fn();

const mockApi = {
  getRates: mockGetRates,
  getExchangeHistory: mockGetExchangeHistory,
  addExchangeTransaction: mockAddExchangeTransaction,
  exchangeLots: { preview: mockPreview },
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  DecimalInput: ({
    value,
    onChange,
    "data-testid": dataTestId,
  }: {
    value: number;
    onChange: (n: number) => void;
    "data-testid"?: string;
  }) => (
    <input
      data-testid={dataTestId ?? "amount-in"}
      type="text"
      value={value === 0 ? "" : String(value)}
      onChange={(e) =>
        onChange(parseFloat(e.target.value.replace(/,/g, "")) || 0)
      }
    />
  ),
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: ({
    value,
    onChange,
    onClientSelect,
  }: {
    value: string;
    onChange: (v: string) => void;
    onClientSelect?: (c: {
      id: number;
      full_name: string;
      phone_number: string;
    }) => void;
  }) => (
    <div>
      <input
        data-testid="stub-client-input"
        value={value}
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
  onChange: (lines: unknown[]) => void;
  onStateChange?: (s: Record<string, unknown>) => void;
};

jest.mock("@/features/recharge/components/PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    onConfirm: () => void;
    onKeptChange?: (k: { usd: number; lbp: number } | null) => void;
    counterFlow?: CounterFlowProp;
    children?: React.ReactNode;
  }) => {
    const cf = props.counterFlow;
    return props.open ? (
      <div data-testid="stub-payout-sheet">
        {props.children}
        <button
          data-testid="stub-payout-lines"
          onClick={() =>
            props.onPaymentChange([
              { id: "P1", method: "CASH", currencyCode: "LBP", amount: 8_900_000 },
            ])
          }
        />
        <button
          data-testid="stub-payout-kept"
          onClick={() => props.onKeptChange?.({ usd: 0, lbp: 500 })}
        />
        <button
          data-testid="stub-customer-account"
          onClick={() =>
            cf?.onChange([
              { id: "C1", method: "CASH", currencyCode: "USD", amount: 90 },
              {
                id: "C2",
                method: "CUSTOMER_ACCOUNT",
                currencyCode: "USD",
                amount: 10,
              },
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
          onClick={() =>
            cf?.onStateChange?.({
              paid: 90,
              owedToAccount: 10,
              forgiven: 0,
              balanced: true,
              overpaid: false,
              needsClient: false,
              unaccounted: 0,
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

const USD_LBP = [
  { code: "USD", name: "US Dollar" },
  { code: "LBP", name: "Lebanese Pound" },
];
const mockCurrencyContext: {
  activeCurrencies: Array<{ code: string; name: string }>;
  getDecimals: (c: string) => number;
} = {
  activeCurrencies: USD_LBP,
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
  methods: [
    { code: "CASH", label: "Cash", affects_drawer: 1 },
    { code: "WHISH", label: "Whish Wallet", affects_drawer: 1 },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account", affects_drawer: 0 },
  ],
  drawerAffectingMethods: [
    { code: "CASH", label: "Cash", affects_drawer: 1 },
    { code: "WHISH", label: "Whish Wallet", affects_drawer: 1 },
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
  CURRENCY_NAMES: { USD: "US Dollar", LBP: "Lebanese Pound", EUR: "Euro" },
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
jest.mock("../components/HistoryModal", () => ({ HistoryModal: () => null }));
jest.mock("../components/PositionsPanel", () => ({
  PositionsPanel: () => null,
}));
jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

type Lang = "en" | "ar";

async function setLang(lang: Lang) {
  if (lang === "ar") await loadLanguage("ar");
  await i18n.changeLanguage(lang);
}

async function renderPage(amount: string) {
  render(<Exchange />);
  await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
  fireEvent.change(screen.getByTestId("amount-in"), {
    target: { value: amount },
  });
}

async function submit() {
  const btn = screen.getByTestId("exchange-submit");
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
}

async function openSheet() {
  await submit();
  await screen.findByTestId("stub-payout-sheet");
}

async function confirmSheet() {
  fireEvent.click(screen.getByTestId("stub-confirm"));
}

interface Scenario {
  name: string;
  currencies?: Array<{ code: string; name: string }>;
  run: () => Promise<void>;
}

const SCENARIOS: Scenario[] = [
  {
    name: "USD → LBP walk-in, paid out on the sheet with kept change",
    run: async () => {
      await renderPage("100");
      await openSheet();
      fireEvent.click(screen.getByTestId("stub-payout-lines"));
      fireEvent.click(screen.getByTestId("stub-payout-kept"));
      await confirmSheet();
    },
  },
  {
    name: "picked client, part of the customer's side on their account",
    run: async () => {
      await renderPage("100");
      fireEvent.click(screen.getAllByTestId("stub-pick-client")[0]!);
      await openSheet();
      fireEvent.click(screen.getByTestId("stub-payout-lines"));
      fireEvent.click(screen.getByTestId("stub-customer-account"));
      fireEvent.click(screen.getByTestId("stub-state-balanced"));
      await confirmSheet();
    },
  },
  {
    name: "a short customer side, the shortfall forgiven",
    run: async () => {
      await renderPage("100");
      await openSheet();
      fireEvent.click(screen.getByTestId("stub-payout-lines"));
      fireEvent.click(screen.getByTestId("stub-customer-short"));
      fireEvent.click(screen.getByTestId("stub-state-forgiven"));
      await confirmSheet();
    },
  },
  {
    name: "LBP → USD (swapped)",
    run: async () => {
      render(<Exchange />);
      await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
      fireEvent.click(await screen.findByTestId("exchange-swap-button"));
      fireEvent.change(screen.getByTestId("amount-in"), {
        target: { value: "8900000" },
      });
      await openSheet();
      fireEvent.click(screen.getByTestId("stub-payout-lines"));
      await confirmSheet();
    },
  },
  {
    name: "a typed client name with no saved client",
    run: async () => {
      await renderPage("50");
      fireEvent.change(screen.getAllByTestId("stub-client-input")[0]!, {
        target: { value: "Walk-in Ali" },
      });
      await openSheet();
      fireEvent.click(screen.getByTestId("stub-payout-lines"));
      await confirmSheet();
    },
  },
  {
    name: "a cashier-typed rate",
    run: async () => {
      await renderPage("100");
      fireEvent.change(
        await screen.findByTestId("exchange-direct-rate-input"),
        { target: { value: "88000" } },
      );
      await openSheet();
      fireEvent.click(screen.getByTestId("stub-payout-lines"));
      await confirmSheet();
    },
  },
  {
    name: "EUR → USD (from a lot-tracked currency)",
    currencies: [
      { code: "EUR", name: "Euro" },
      { code: "USD", name: "US Dollar" },
    ],
    run: async () => {
      await renderPage("100");
      await openSheet();
      fireEvent.click(screen.getByTestId("stub-payout-lines"));
      await confirmSheet();
    },
  },
  {
    name: "For Partner: no sheet, direct submit",
    run: async () => {
      await renderPage("100");
      fireEvent.click(screen.getByTestId("exchange-for-partner-toggle"));
      fireEvent.click(screen.getByTestId("stub-pick-partner"));
      await submit();
    },
  },
];

async function runIn(lang: Lang, scenario: Scenario): Promise<unknown> {
  jest.clearAllMocks();
  mockAddExchangeTransaction.mockResolvedValue({ success: true, id: 1 });
  mockGetRates.mockResolvedValue([
    {
      to_code: "LBP",
      market_rate: 89_500,
      buy_rate: 89_000,
      sell_rate: 90_000,
      is_stronger: 1,
    },
  ]);
  mockGetExchangeHistory.mockResolvedValue([]);
  mockPreview.mockResolvedValue({ lotTracked: false });
  mockCurrencyContext.activeCurrencies = scenario.currencies ?? USD_LBP;
  window.alert = jest.fn();
  await setLang(lang);
  await scenario.run();
  await waitFor(() =>
    expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
  );
  expect(window.alert).not.toHaveBeenCalled();
  const raw = mockAddExchangeTransaction.mock.calls[0][0] as Record<
    string,
    unknown
  >;
  exchangeSubmitSchema.parse(raw);
  cleanup();
  return raw;
}

describe("Exchange — the payload is the same in English and Arabic (LIRA-331)", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      const en = await runIn("en", scenario);
      const ar = await runIn("ar", scenario);
      expect(ar).toEqual(en);
      // The stored note is data written in English whatever the screen
      // language (OD-2): it must never be translated.
      expect((ar as { note?: string }).note).toMatch(/^Exchange /);
    },
  );

  it("the ar run really renders Arabic (the comparison is not English vs English)", async () => {
    mockGetRates.mockResolvedValue([]);
    mockGetExchangeHistory.mockResolvedValue([]);
    mockCurrencyContext.activeCurrencies = USD_LBP;
    await setLang("ar");
    render(<Exchange />);
    await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
    expect(screen.getByTestId("exchange-submit")).toHaveTextContent(
      "المتابعة إلى الدفع",
    );
  });
});
