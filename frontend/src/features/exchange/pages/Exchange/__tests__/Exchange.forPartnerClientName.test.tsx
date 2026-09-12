/** @jest-environment jsdom */

/**
 * Exchange page — Client Name is captured on For-Partner exchanges too
 * (owner decision, 2026-09-12, closing FOR_PARTNER_AND_COST_UNIFICATION_PLAN
 * §4's last checkbox: "On a For-Partner transaction, the walk-in customer's
 * identity SHOULD still be captured — everywhere.").
 *
 * Before this fix, the Client Name input was REPLACED by the ForPartnerNotice
 * under For Partner, even though `clientName` was (and still is) submitted
 * ungated at ~:952. That was a silent UI/payload mismatch: a name typed
 * before ticking the toggle kept being sent while invisible on screen. The
 * fix renders BOTH the notice and the input under For Partner; this test
 * proves the input is unconditional (present + editable in both states) and
 * that the notice only shows under For Partner.
 *
 * ForPartnerToggle/ForPartnerNotice are stubbed with tiny interactive
 * replacements (not the real components) so the test never has to satisfy
 * PartnerSelector's `useApi().partners.getAll()` call — same reasoning as
 * every other Exchange page test in this directory that stubs this module.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Same stub rationale as Exchange.splitPayout.test.tsx: @liratek/core's full
// index chains db imports that don't resolve under jsdom.
jest.mock("@liratek/core", () => ({
  TAKE_USD: -1,
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

jest.mock("@/features/recharge/components/PaymentSheet", () => ({
  PaymentSheet: () => null,
}));

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
  CURRENCY_NAMES: { USD: "US Dollar", LBP: "Lebanese Pound" },
  EXCLUDED_CURRENCIES: new Set(["USD", "LBP", "EUR"]),
  getCurrencySymbol: (code: string) =>
    ({ USD: "$", LBP: "LBP", EUR: "€" })[code] ?? code,
}));

// Interactive stubs — NOT the real ForPartnerToggle/ForPartnerNotice, so the
// test never touches PartnerSelector's `useApi().partners.getAll()` call.
// The checkbox drives the page's real `forPartner` state via `onChange`; the
// notice stub renders its children behind the SAME testId the real component
// uses, so this test exercises the page's own conditional rendering, not the
// shared component's internals.
jest.mock("@/features/partners/components/ForPartnerToggle", () => ({
  ForPartnerToggle: ({
    checked,
    onChange,
    testId,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    testId: string;
  }) => (
    <input
      type="checkbox"
      data-testid={testId}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  ),
  ForPartnerNotice: ({
    testId,
    children,
  }: {
    testId: string;
    children: React.ReactNode;
  }) => <div data-testid={testId}>{children}</div>,
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

async function renderExchange() {
  render(<Exchange />);
  await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
}

describe("Exchange page — Client Name capture under For Partner", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
  });

  it("For Partner OFF: Client Name input is present and editable, notice is absent", async () => {
    await renderExchange();

    const input = screen.getByPlaceholderText(
      "Walk-in Client",
    ) as HTMLInputElement;
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Jane Doe" } });
    expect(input.value).toBe("Jane Doe");

    expect(
      screen.queryByTestId("exchange-partner-no-payment-notice"),
    ).not.toBeInTheDocument();
  });

  it("For Partner ON: Client Name input is STILL present and editable, AND the notice is shown", async () => {
    await renderExchange();

    fireEvent.click(screen.getByTestId("exchange-for-partner-toggle"));

    // The notice must appear.
    expect(
      await screen.findByTestId("exchange-partner-no-payment-notice"),
    ).toBeInTheDocument();

    // The input must ALSO be present and still editable — this is the
    // assertion that fails on the pre-fix code (where the input was
    // replaced by the notice, not joined by it).
    const input = screen.getByPlaceholderText(
      "Walk-in Client",
    ) as HTMLInputElement;
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "John Partner-Customer" } });
    expect(input.value).toBe("John Partner-Customer");
  });
});
