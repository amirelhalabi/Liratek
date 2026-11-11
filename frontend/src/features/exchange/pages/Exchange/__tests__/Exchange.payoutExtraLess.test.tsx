/** @jest-environment jsdom */

/**
 * Exchange page — the "− Less | + Extra" line on the payout, with the REAL
 * payment sheet (LIRA-382). Table-driven, the same cases as every other
 * payout screen; $100 in, 8,900,000 LBP owed. The payload is parsed through
 * `exchangeSubmitSchema` before its fields are read (rule 24).
 * Harness from Exchange.addedChange.test.tsx (real-sheet mode).
 * Rule 17: run against the box without the line first — see the task report.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

jest.mock("@liratek/core", () => ({
  // The real payment box (the real-sheet test below) imports these.
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
import {
  setPayoutLine,
  payoutLegAmounts,
  type PayoutLineSide,
} from "@/shared/testing/payoutExtraLess";

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

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input
      data-testid="stub-client-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// PaymentSheet is NOT stubbed: the real sheet and payment box render.

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

const mockSessionContext: {
  activeSession: { id: number; customer_name: string } | null;
  linkTransaction: jest.Mock;
} = {
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
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account", affects_drawer: 0 },
  ],
  drawerAffectingMethods: [{ code: "CASH", label: "Cash", affects_drawer: 1 }],
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

async function renderWithAmount() {
  render(<Exchange />);
  await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
  // USD → LBP (the first two active currencies), amountIn = $100.
  fireEvent.change(screen.getByTestId("amount-in"), {
    target: { value: "100" },
  });
}

type Parsed = ReturnType<typeof exchangeSubmitSchema.parse>;
const CASES: {
  name: string;
  side: PayoutLineSide;
  typed: string;
  leg: number;
  check: (p: Parsed) => void;
}[] = [
  {
    name: "+ Extra 5,000 on 8,900,000 LBP → pays 8,905,000, rounding_given_lbp 5000",
    side: "extra",
    typed: "5000",
    leg: 8_905_000,
    check: (p) => {
      expect(p.rounding_given_lbp).toBe(5_000);
      expect(p.kept_change_lbp).toBeUndefined();
    },
  },
  {
    name: "− Less 5,000 on 8,900,000 LBP → pays 8,895,000, kept_change_lbp 5000",
    side: "less",
    typed: "5000",
    leg: 8_895_000,
    check: (p) => {
      expect(p.kept_change_lbp).toBe(5_000);
      expect(p.rounding_given_lbp).toBeUndefined();
    },
  },
];

describe("Exchange page — payout '− Less | + Extra' line, real sheet (LIRA-382)", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    mockCurrencyContext.activeCurrencies = mockActiveCurrencies;
    mockSessionContext.activeSession = null;
  });

  it.each(CASES)("$name", async (c) => {
    await renderWithAmount();
    fireEvent.click(
      await screen.findByRole("button", { name: /Proceed to Payout/i }),
    );
    await screen.findByTestId("payout-extra-less");
    setPayoutLine(c.side, c.typed);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(payoutLegAmounts()).toEqual([c.leg]);
    const pay = screen.getByRole("button", { name: /^Pay / });
    await waitFor(() => expect(pay).toBeEnabled());
    fireEvent.click(pay);
    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );
    const p = exchangeSubmitSchema.parse(
      mockAddExchangeTransaction.mock.calls[0][0],
    );
    expect(p.payments).toEqual([
      expect.objectContaining({ currencyCode: "LBP", amount: c.leg }),
    ]);
    c.check(p);
  });
});
