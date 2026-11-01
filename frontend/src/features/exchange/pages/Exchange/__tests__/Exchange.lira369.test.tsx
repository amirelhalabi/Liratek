/** @jest-environment jsdom */

/**
 * LIRA-369 — Exchange: payment window for every currency, customer account
 * both ways.
 *
 *  - The window opens for EVERY walk-in exchange (USD → EUR used to save
 *    straight away); For Partner keeps the direct save.
 *  - A payout in a currency other than USD/LBP ("native"): Cash + Customer
 *    account only, the sheet works in that currency, no keep / round-up /
 *    added change, no USD↔LBP tender rate.
 *  - USD/LBP payout: today's methods plus Customer account.
 *  - The customer side offers Customer account for every currency; the
 *    discount cap stays USD/LBP-only.
 *  - A payout account line needs a picked client (Confirm off otherwise).
 *  - The typed account rate is seeded at the exchange's own rate and sent
 *    only when a non-USD/LBP account line exists.
 *  - The lot-loss confirmation runs from the window's Confirm (R8).
 *
 * The PaymentSheet and client picker are stubbed and their props captured,
 * so the test drives the page's real closures. Payload field names come from
 * the core schema (rule 24); useApi returns a stable object (rule 25).
 */

import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";

jest.mock("@liratek/core", () => ({
  TAKE_USD: -1,
  SHORTFALL_MAX: { USD: 5, LBP: 450_000 },
  calculateAmountInForTarget: jest.fn(() => 0),
  isLotTrackedCurrency: (code: string) => !["USD", "LBP"].includes(code),
  convertFromUSD: (usd: number) => ({
    amountOut: usd * 89_000,
    rate: 89_000,
  }),
  // USD → EUR at 1.10 USD per EUR, EUR → USD at 1.10, USD ↔ LBP at 89,000.
  calculateExchange: (from: string, to: string, amountIn: number) => {
    const out =
      to === "EUR"
        ? amountIn / 1.1
        : from === "EUR"
          ? amountIn * 1.1
          : to === "LBP"
            ? amountIn * 89_000
            : amountIn / 89_000;
    const rate = to === "EUR" || from === "EUR" ? 1.1 : 89_000;
    return {
      fromCurrency: from,
      toCurrency: to,
      amountIn,
      totalAmountOut: out,
      totalProfitUsd: 0.5,
      viaCurrency: null,
      legs: [
        {
          fromCurrency: from,
          toCurrency: to,
          amountIn,
          amountOut: out,
          rate,
          marketRate: rate,
          profitUsd: 0.5,
        },
      ],
    };
  },
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
  {
    to_code: "EUR",
    market_rate: 1.1,
    buy_rate: 1.09,
    sell_rate: 1.1,
    is_stronger: -1,
  },
]);
const mockGetExchangeHistory = jest.fn().mockResolvedValue([]);
const PREVIEW_PROFIT = {
  lotTracked: true,
  marketUnitCostUsd: 1.05,
  settlements: [],
  realizedProfitUsd: 2,
  coveredQty: 100,
  marketQty: 0,
};
const mockPreview = jest.fn().mockResolvedValue(PREVIEW_PROFIT);

// Rule 25: a STABLE useApi() reference.
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

type Line = {
  id: string;
  method: string;
  currencyCode: string;
  amount: number;
};
type AccountRate = {
  currency: string;
  value: number;
  onChange: (rate: number) => void;
};
type CounterFlowProp = {
  currency: string;
  onChange: (lines: Line[]) => void;
  paymentMethods?: Array<{ code: string; label: string }>;
  maxForgive?: number;
  allowAddedChange?: boolean;
  accountRate?: AccountRate;
  onStateChange?: (s: Record<string, unknown>) => void;
};
type SheetProps = {
  open: boolean;
  onPaymentChange: (lines: Line[]) => void;
  onConfirm: () => void;
  onClose: () => void;
  confirmDisabled?: boolean;
  paymentMethods: Array<{ code: string; label: string }>;
  currency?: string;
  totalAmountCurrency?: string;
  currencies?: Array<{ code: string; symbol: string }>;
  accountRate?: AccountRate;
  hasClient?: boolean;
  exchangeRate?: number;
  onKeptChange?: unknown;
  onRoundUpChange?: unknown;
  onAddedChange?: unknown;
  counterFlow?: CounterFlowProp;
};

let lastSheetProps: SheetProps | null = null;
const sheet = (): SheetProps => {
  expect(lastSheetProps).not.toBeNull();
  return lastSheetProps!;
};

const BALANCED = {
  paid: 0,
  owedToAccount: 0,
  forgiven: 0,
  balanced: true,
  overpaid: false,
  needsClient: false,
  unaccounted: 0,
};

jest.mock("@/features/recharge/components/PaymentSheet", () => ({
  PaymentSheet: (props: SheetProps) => {
    lastSheetProps = props;
    return props.open ? (
      <div data-testid="stub-payout-sheet">
        <button
          data-testid="stub-confirm"
          onClick={() => {
            // The real sheet calls onConfirm, then onClose.
            props.onConfirm();
            props.onClose();
          }}
        />
      </div>
    ) : null;
  },
}));

const USD_EUR = [
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
];
const EUR_USD = [
  { code: "EUR", name: "Euro" },
  { code: "USD", name: "US Dollar" },
];
const mockCurrencyContext: {
  activeCurrencies: Array<{ code: string; name: string }>;
  getDecimals: (c: string) => number;
} = {
  activeCurrencies: USD_EUR,
  getDecimals: (c: string) => (c === "LBP" ? 0 : 2),
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
    lastUpdatedUtc: "Sun, 01 Nov 2026 00:02:31 +0000",
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

const PROCEED = /Proceed to Payout/i;

async function renderWithAmount(amount: string) {
  render(<Exchange />);
  await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
  fireEvent.change(screen.getByTestId("amount-in"), {
    target: { value: amount },
  });
}

/** Waits for the (debounced) lot preview so the main button is enabled. */
async function mainButton(name: RegExp = PROCEED) {
  const btn = await screen.findByRole("button", { name });
  await waitFor(() => expect(btn).not.toBeDisabled());
  return btn;
}

async function openSheet() {
  fireEvent.click(await mainButton());
  await screen.findByTestId("stub-payout-sheet");
}

function payout(lines: Array<Omit<Line, "id">>) {
  act(() => {
    sheet().onPaymentChange(lines.map((l, i) => ({ id: `P${i}`, ...l })));
  });
}
function customer(lines: Array<Omit<Line, "id">>) {
  act(() => {
    const cf = sheet().counterFlow!;
    cf.onChange(lines.map((l, i) => ({ id: `C${i}`, ...l })));
    cf.onStateChange?.(BALANCED);
  });
}

async function confirmAndParse() {
  fireEvent.click(screen.getByTestId("stub-confirm"));
  await waitFor(() =>
    expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
  );
  const raw = mockAddExchangeTransaction.mock.calls[0][0] as Record<
    string,
    unknown
  >;
  return { raw, parsed: exchangeSubmitSchema.parse(raw) };
}

describe("Exchange page — LIRA-369 window for every currency + account both ways", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    mockPreview.mockClear();
    mockPreview.mockResolvedValue(PREVIEW_PROFIT);
    lastSheetProps = null;
    mockCurrencyContext.activeCurrencies = USD_EUR;
  });

  it("USD → EUR opens the payment window instead of saving straight away", async () => {
    await renderWithAmount("110");
    await openSheet();
    expect(mockAddExchangeTransaction).not.toHaveBeenCalled();
  });

  it("EUR payout: exactly Cash + Customer account, in EUR, no keep / round-up / added change, no USD↔LBP rate", async () => {
    await renderWithAmount("110");
    await openSheet();
    const p = sheet();
    expect(p.paymentMethods.map((m) => m.code)).toEqual([
      "CASH",
      "CUSTOMER_ACCOUNT",
    ]);
    expect(p.currency).toBe("EUR");
    expect(p.totalAmountCurrency).toBe("EUR");
    expect(p.currencies).toEqual([{ code: "EUR", symbol: "€" }]);
    expect(p.onKeptChange).toBeUndefined();
    expect(p.onRoundUpChange).toBeUndefined();
    expect(p.onAddedChange).toBeUndefined();
    expect(p.exchangeRate).toBeUndefined();
    expect(p.counterFlow?.allowAddedChange).toBeUndefined();
  });

  it("USD → LBP payout keeps cash and adds Customer account; no account rate box", async () => {
    mockCurrencyContext.activeCurrencies = [
      { code: "USD", name: "US Dollar" },
      { code: "LBP", name: "Lebanese Pound" },
    ];
    await renderWithAmount("100");
    await openSheet();
    const p = sheet();
    expect(p.paymentMethods.map((m) => m.code)).toEqual([
      "CASH",
      "CUSTOMER_ACCOUNT",
    ]);
    expect(p.accountRate).toBeUndefined();
    expect(p.counterFlow?.accountRate).toBeUndefined();
    expect(typeof p.onKeptChange).toBe("function");
  });

  it("For Partner still saves directly, with no window", async () => {
    await renderWithAmount("110");
    fireEvent.click(screen.getByTestId("exchange-for-partner-toggle"));
    fireEvent.click(screen.getByTestId("stub-pick-partner"));
    fireEvent.click(await mainButton(/Submit to Partner/i));
    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByTestId("stub-payout-sheet")).toBeNull();
  });

  it("a lot loss shows the loss confirmation from the window's Confirm, before saving", async () => {
    mockPreview.mockResolvedValue({ ...PREVIEW_PROFIT, realizedProfitUsd: -5 });
    await renderWithAmount("110");
    await openSheet();
    payout([{ method: "CASH", currencyCode: "EUR", amount: 100 }]);
    fireEvent.click(screen.getByTestId("stub-confirm"));

    expect(await screen.findByText(/Confirm Loss/i)).toBeInTheDocument();
    expect(mockAddExchangeTransaction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));
    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );
    const parsed = exchangeSubmitSchema.parse(
      mockAddExchangeTransaction.mock.calls[0][0],
    );
    expect(parsed.payments).toEqual([
      expect.objectContaining({
        method: "CASH",
        currencyCode: "EUR",
        amount: 100,
      }),
    ]);
  });

  it("payout to the account needs a picked client: Confirm off until one is picked", async () => {
    await renderWithAmount("110");
    await openSheet();
    expect(sheet().hasClient).toBe(false);
    payout([{ method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 100 }]);
    await waitFor(() => expect(sheet().confirmDisabled).toBe(true));

    fireEvent.click(screen.getAllByTestId("stub-pick-client")[0]!);
    await waitFor(() => expect(sheet().hasClient).toBe(true));
    await waitFor(() => expect(sheet().confirmDisabled).toBe(false));
  });

  it("EUR payout on account: rate seeded at the exchange's own 1.10 and sent; a typed rate wins; 0 turns Confirm off", async () => {
    await renderWithAmount("110");
    fireEvent.click(screen.getByTestId("stub-pick-client"));
    await openSheet();
    expect(sheet().accountRate?.currency).toBe("EUR");
    expect(sheet().accountRate?.value).toBeCloseTo(1.1, 10);

    payout([
      { method: "CASH", currencyCode: "EUR", amount: 60 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 40 },
    ]);
    act(() => sheet().accountRate!.onChange(0));
    await waitFor(() => expect(sheet().confirmDisabled).toBe(true));
    act(() => sheet().accountRate!.onChange(1.12));
    await waitFor(() => expect(sheet().confirmDisabled).toBe(false));

    const { raw, parsed } = await confirmAndParse();
    expect(parsed.payout_account_usd_rate).toBe(1.12);
    expect(parsed.clientId).toBe(42);
    expect(parsed.customer_account_usd_rate).toBeUndefined();
    // Native payout: none of the USD/LBP-only keys travel.
    for (const key of [
      "tender_exchange_rate",
      "kept_change_usd",
      "kept_change_lbp",
      "rounding_given_usd",
      "rounding_given_lbp",
      "added_change_usd",
      "added_change_lbp",
    ] as const) {
      expect(raw).not.toHaveProperty(key);
    }
  });

  it("EUR payout all in cash: no account rate is sent", async () => {
    await renderWithAmount("110");
    await openSheet();
    payout([{ method: "CASH", currencyCode: "EUR", amount: 100 }]);
    const { raw } = await confirmAndParse();
    expect(raw).not.toHaveProperty("payout_account_usd_rate");
    expect(raw).not.toHaveProperty("customer_account_usd_rate");
    expect(raw).not.toHaveProperty("tender_exchange_rate");
  });

  it("EUR customer side: Customer account offered, no discount cap, rate seeded at 1.10 and sent with an account line", async () => {
    mockCurrencyContext.activeCurrencies = EUR_USD;
    await renderWithAmount("100");
    fireEvent.click(screen.getByTestId("stub-pick-client"));
    await openSheet();
    const cf = sheet().counterFlow!;
    expect(cf.currency).toBe("EUR");
    expect((cf.paymentMethods ?? []).map((m) => m.code)).toContain(
      "CUSTOMER_ACCOUNT",
    );
    expect(cf.maxForgive).toBeUndefined();
    expect(cf.accountRate?.currency).toBe("EUR");
    expect(cf.accountRate?.value).toBeCloseTo(1.1, 10);
    // USD payout: no payout account rate box.
    expect(sheet().accountRate).toBeUndefined();

    payout([{ method: "CASH", currencyCode: "USD", amount: 110 }]);
    customer([
      { method: "CASH", currencyCode: "EUR", amount: 60 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 40 },
    ]);
    await waitFor(() => expect(sheet().confirmDisabled).toBe(false));
    const { parsed } = await confirmAndParse();
    expect(parsed.customer_account_usd_rate).toBeCloseTo(1.1, 10);
    expect(parsed.payout_account_usd_rate).toBeUndefined();
    expect(parsed.customerPayments).toEqual([
      { method: "CASH", currencyCode: "EUR", amount: 60 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 40 },
    ]);
  });

  it("EUR customer side on account with the rate cleared to 0: Confirm off", async () => {
    mockCurrencyContext.activeCurrencies = EUR_USD;
    await renderWithAmount("100");
    fireEvent.click(screen.getByTestId("stub-pick-client"));
    await openSheet();
    payout([{ method: "CASH", currencyCode: "USD", amount: 110 }]);
    customer([
      { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 100 },
    ]);
    await waitFor(() => expect(sheet().confirmDisabled).toBe(false));
    act(() => sheet().counterFlow!.accountRate!.onChange(0));
    await waitFor(() => expect(sheet().confirmDisabled).toBe(true));
  });
});
