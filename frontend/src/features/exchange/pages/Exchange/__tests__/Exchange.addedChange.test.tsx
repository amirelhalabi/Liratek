/** @jest-environment jsdom */

/**
 * Exchange page — customer adds change on the payout (LIRA-336, T017).
 *
 * USD → LBP at 89,000: the customer owes $100 and hands over $101 so the
 * shop can pay out a round 8,989,000 LBP. The existing "Customer pays"
 * section takes the extra dollar (`counterFlow.allowAddedChange`) only when
 * BOTH currencies are USD/LBP, never for a partner and never inside a
 * customer session (FR-010). The page sends `added_change_*` (payout
 * currency, reported by `onAddedChange`) next to the payout legs, in the ONE
 * payload (rule 22). Re-opening the sheet clears a stale claim.
 *
 * Harness from Exchange.customerPays.test.tsx (PaymentSheet stubbed with an
 * opt-in REAL sheet, @liratek/core stubbed). Payload parsed through the core
 * schema module (rule 24). Rule 17: run against the unwired page first — see
 * the task report.
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

type Pair = { usd: number; lbp: number } | null;
type CounterFlowProp = {
  totalAmount: number;
  currency: string;
  onChange: (lines: unknown[]) => void;
  onStateChange?: (s: Record<string, unknown>) => void;
  allowAddedChange?: boolean;
};

let lastSheetProps: Record<string, unknown> = {};
/** When true the PaymentSheet stub renders the REAL sheet (real payment box). */
let mockUseRealSheet = false;
const sheetCounterFlow = (): CounterFlowProp | undefined =>
  lastSheetProps.counterFlow as CounterFlowProp | undefined;

jest.mock("@/features/recharge/components/PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    onAddedChange?: (a: Pair) => void;
    onClose: () => void;
    onConfirm: () => void;
    counterFlow?: CounterFlowProp;
  }) => {
    lastSheetProps = props as unknown as Record<string, unknown>;
    if (mockUseRealSheet) {
      const { PaymentSheet: RealSheet } = jest.requireActual(
        "@/features/recharge/components/PaymentSheet",
      );
      return <RealSheet {...props} />;
    }
    const cf = props.counterFlow;
    return props.open ? (
      <div data-testid="stub-payout-sheet">
        {/* $101 handed over on $100 owed → $1 added = 89,000 LBP;
            the shop pays out 8,989,000 LBP. A 0 line rides along (dropped). */}
        <button
          data-testid="stub-added"
          onClick={() => {
            cf?.onChange([
              { id: "C1", method: "CASH", currencyCode: "USD", amount: 101 },
              { id: "C2", method: "CASH", currencyCode: "USD", amount: 0 },
            ]);
            props.onPaymentChange([
              {
                id: "P1",
                method: "CASH",
                currencyCode: "LBP",
                amount: 8_989_000,
              },
            ]);
            props.onAddedChange?.({ usd: 0, lbp: 89_000 });
          }}
        />
        {/* Exact: $100 in, 8,900,000 out, nothing added. */}
        <button
          data-testid="stub-exact"
          onClick={() => {
            cf?.onChange([
              { id: "C1", method: "CASH", currencyCode: "USD", amount: 100 },
            ]);
            props.onPaymentChange([
              {
                id: "P1",
                method: "CASH",
                currencyCode: "LBP",
                amount: 8_900_000,
              },
            ]);
            props.onAddedChange?.(null);
          }}
        />
        <button data-testid="stub-close" onClick={props.onClose} />
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

async function openSheet() {
  fireEvent.click(
    await screen.findByRole("button", { name: /Proceed to Payout/i }),
  );
  await screen.findByTestId("stub-payout-sheet");
}

async function confirmAndParse() {
  fireEvent.click(screen.getByTestId("stub-confirm"));
  await waitFor(() =>
    expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
  );
  return exchangeSubmitSchema.parse(
    mockAddExchangeTransaction.mock.calls[0][0],
  );
}

describe("Exchange page — customer adds change (LIRA-336)", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    lastSheetProps = {};
    mockUseRealSheet = false;
    mockCurrencyContext.activeCurrencies = mockActiveCurrencies;
    mockSessionContext.activeSession = null;
  });

  it("USD → LBP: the customer section allows added change and the sheet gets onAddedChange", async () => {
    await renderWithAmount();
    await openSheet();
    expect(sheetCounterFlow()?.allowAddedChange).toBe(true);
    expect(typeof lastSheetProps.onAddedChange).toBe("function");
  });

  it("$101 on $100 owed → sends added_change_lbp 89,000 next to the payout legs, customer lines without 0 lines", async () => {
    await renderWithAmount();
    await openSheet();
    fireEvent.click(screen.getByTestId("stub-added"));
    const parsed = await confirmAndParse();
    expect(parsed.added_change_lbp).toBe(89_000);
    expect(parsed.added_change_usd ?? 0).toBe(0);
    expect(parsed.customerPayments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 101 },
    ]);
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "LBP", amount: 8_989_000 }),
    ]);
    expect(parsed.rounding_given_lbp).toBeUndefined();
  });

  it("nothing added → no added_change_* in the payload", async () => {
    await renderWithAmount();
    await openSheet();
    fireEvent.click(screen.getByTestId("stub-exact"));
    const parsed = await confirmAndParse();
    expect(parsed.added_change_usd).toBeUndefined();
    expect(parsed.added_change_lbp).toBeUndefined();
  });

  it("a claim from a closed sheet is not sent after the sheet is re-opened", async () => {
    await renderWithAmount();
    await openSheet();
    fireEvent.click(screen.getByTestId("stub-added"));
    fireEvent.click(screen.getByTestId("stub-close"));
    await openSheet();
    // Lines only — the stale onAddedChange value must not survive.
    const cf = sheetCounterFlow();
    const onPay = lastSheetProps.onPaymentChange as (l: unknown[]) => void;
    act(() => {
      cf?.onChange([
        { id: "C1", method: "CASH", currencyCode: "USD", amount: 100 },
      ]);
      onPay([
        { id: "P1", method: "CASH", currencyCode: "LBP", amount: 8_900_000 },
      ]);
    });
    const parsed = await confirmAndParse();
    expect(parsed.added_change_usd).toBeUndefined();
    expect(parsed.added_change_lbp).toBeUndefined();
  });

  it("EUR → USD (exotic side): no added change on the customer section", async () => {
    mockCurrencyContext.activeCurrencies = [
      { code: "EUR", name: "Euro" },
      { code: "USD", name: "US Dollar" },
    ];
    await renderWithAmount();
    await openSheet();
    const cf = sheetCounterFlow();
    expect(cf).toBeDefined();
    expect(cf!.currency).toBe("EUR");
    expect(cf!.allowAddedChange).toBeFalsy();
  });

  it("inside a customer session: no added change (FR-010)", async () => {
    mockSessionContext.activeSession = { id: 5, customer_name: "Rami" };
    await renderWithAmount();
    await openSheet();
    expect(sheetCounterFlow()).toBeDefined();
    expect(sheetCounterFlow()!.allowAddedChange).toBeFalsy();
  });

  it("REAL sheet: typing $101 in Customer pays raises Shop pays to 8,989,000 and sends added_change_lbp 89,000", async () => {
    mockUseRealSheet = true;
    await renderWithAmount();
    fireEvent.click(
      await screen.findByRole("button", { name: /Proceed to Payout/i }),
    );
    await screen.findByTestId("counter-flow-section");
    const cfAmount = document.querySelector<HTMLInputElement>(
      '[data-testid^="counter-flow-amount-"]',
    );
    expect(cfAmount).not.toBeNull();
    fireEvent.change(cfAmount!, { target: { value: "101" } });
    expect(
      await screen.findByTestId("payout-added-change-summary"),
    ).toBeInTheDocument();
    const pay = screen.getByRole("button", { name: /^Pay / });
    await waitFor(() => expect(pay).toBeEnabled());
    fireEvent.click(pay);
    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );
    const parsed = exchangeSubmitSchema.parse(
      mockAddExchangeTransaction.mock.calls[0][0],
    );
    expect(parsed.added_change_lbp).toBe(89_000);
    expect(parsed.customerPayments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 101 },
    ]);
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "LBP", amount: 8_989_000 }),
    ]);
  });
});
