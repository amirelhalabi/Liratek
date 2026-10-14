/** @jest-environment jsdom */

/**
 * LIRA-321 (T019) — Exchange page "Customer pays" wiring.
 *
 * The payout sheet gains a "Customer pays — <fromCurrency>" section (IN,
 * above "Shop pays"): one line locked to the exchange's fromCurrency, seeded
 * at amountIn; a short line splits off a leftover that goes on the client's
 * account. The page:
 *  - passes `counterFlow` with totalAmount = amountIn, currency =
 *    fromCurrency, lockCurrency, a CASH seed line, drawer methods +
 *    CUSTOMER_ACCOUNT (never GIFT_CARD), requiresClient, hasClient,
 *    maxForgive from SHORTFALL_MAX;
 *  - disables Confirm while the section is not balanced, overpaid, or has an
 *    account line with no client;
 *  - sends `customerPayments` (non-zero lines), `customer_waived_amount` and
 *    `clientId` in the ONE payload (rule 22) — asserted through
 *    `exchangeSubmitSchema.parse` (rule 24);
 *  - For-Partner: no customer section, no new fields.
 *
 * The PaymentSheet and the client picker are stubbed and their props
 * captured, so the test drives the page's real closures.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

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

let lastSheetProps: Record<string, unknown> = {};
/** When true the PaymentSheet stub renders the REAL sheet (real payment box). */
let mockUseRealSheet = false;
const sheetCounterFlow = (): CounterFlowProp | undefined =>
  lastSheetProps.counterFlow as CounterFlowProp | undefined;

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
            cf?.onStateChange?.({ ...BALANCED, balanced: false, overpaid: true })
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
  // USD → LBP, amountIn = 100 (the customer pays $100).
  fireEvent.change(screen.getByTestId("amount-in"), {
    target: { value: "100" },
  });
}

async function openSheet() {
  const btn = await screen.findByRole("button", {
    name: /Proceed to Payout/i,
  });
  fireEvent.click(btn);
  await screen.findByTestId("stub-payout-sheet");
}

function lastPayload() {
  expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1);
  expect(mockAddExchangeTransaction.mock.calls[0]).toHaveLength(1);
  return mockAddExchangeTransaction.mock.calls[0][0] as Record<
    string,
    unknown
  >;
}

describe("Exchange page — Customer pays (LIRA-321)", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    lastSheetProps = {};
    mockUseRealSheet = false;
    mockCurrencyContext.activeCurrencies = mockActiveCurrencies;
  });

  // Owner decision 2026-10-14 (Decision 2): the client can be picked INSIDE
  // the payment window. US1.3's own LBP numbers, real payment box: an
  // LBP → USD exchange of 89,500,000 where the customer hands over
  // 87,600,000. With no client the 1,900,000 leftover is "Still to settle";
  // picking the client in the sheet turns it into a Customer Account line
  // and enables Confirm — without closing the sheet.
  it("Decision 2 — picking a client inside the sheet puts the 1,900,000 leftover on their account and enables Confirm", async () => {
    mockUseRealSheet = true;
    render(<Exchange />);
    await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId("exchange-swap-button"));
    fireEvent.change(screen.getByTestId("amount-in"), {
      target: { value: "89500000" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /Proceed to Payout/i }),
    );
    await screen.findByTestId("counter-flow-section");

    const cfAmounts = () =>
      Array.from(
        document.querySelectorAll<HTMLInputElement>(
          '[data-testid^="counter-flow-amount-"]',
        ),
      );
    fireEvent.change(cfAmounts()[0]!, { target: { value: "87600000" } });
    expect(
      await screen.findByTestId("counter-flow-unaccounted"),
    ).toHaveTextContent(/pick a client to put it on their account/);
    expect(screen.getByRole("button", { name: /^Pay / })).toBeDisabled();

    // The client row sits inside the sheet, under the Summary.
    const sheetClient = screen.getByTestId("exchange-sheet-client");
    fireEvent.click(within(sheetClient).getByTestId("stub-pick-client"));

    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-testid^="counter-flow-line-"]'),
      ).toHaveLength(2),
    );
    expect(screen.queryByTestId("counter-flow-unaccounted")).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Pay / })).toBeEnabled(),
    );
    // Shared state: the page's own client field shows the same client.
    expect(
      (screen.getAllByTestId("stub-client-input")[0] as HTMLInputElement)
        .value,
    ).toBe("Rami Haddad");

    fireEvent.click(screen.getByRole("button", { name: /^Pay / }));
    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );
    const parsed = exchangeSubmitSchema.parse(lastPayload());
    expect(parsed.clientId).toBe(42);
    expect(parsed.customerPayments).toEqual([
      { method: "CASH", currencyCode: "LBP", amount: 87_600_000 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 1_900_000 },
    ]);
  });

  it("Decision 2 — the in-sheet client row is not shown for a partner exchange (no sheet, no row)", async () => {
    await renderWithAmount();
    fireEvent.click(screen.getByTestId("exchange-for-partner-toggle"));
    fireEvent.click(screen.getByTestId("stub-pick-partner"));
    await screen.findByRole("button", { name: /Submit to Partner/i });
    expect(screen.queryByTestId("exchange-sheet-client")).toBeNull();
  });

  // Owner decision 2026-10-14 (Decision 1): when the customer pays in a
  // currency other than USD/LBP, no account line and no Forgive — the
  // customer pays in full.
  it("Decision 1 — EUR → USD: no Customer Account method and no Forgive in the customer's section", async () => {
    mockCurrencyContext.activeCurrencies = [
      { code: "EUR", name: "Euro" },
      { code: "USD", name: "US Dollar" },
    ];
    await renderWithAmount();
    await openSheet();

    const cf = sheetCounterFlow();
    expect(cf).toBeDefined();
    expect(cf!.currency).toBe("EUR");
    const codes = (cf!.paymentMethods ?? []).map((m) => m.code);
    expect(codes).toContain("CASH");
    expect(codes).not.toContain("CUSTOMER_ACCOUNT");
    expect(cf!.maxForgive).toBeUndefined();
  });

  // US1.3 (LIRA-321 safety fix), with the REAL payment box: no client and
  // the customer pays less than owed, above the Forgive limit. The box used
  // to auto-add a CASH leftover, balance itself and turn Confirm on — the
  // drawer would have booked cash never handed over. US1.3's own numbers
  // are LBP (89,500,000 owed, 87,600,000 paid); this is the USD analogue
  // the stubbed rate engine supports: $100 owed, $90 paid (short $10 > $5).
  it("US1.3 — no client, customer pays less than owed: Confirm stays disabled and no cash leftover is added", async () => {
    mockUseRealSheet = true;
    await renderWithAmount();
    fireEvent.click(
      await screen.findByRole("button", { name: /Proceed to Payout/i }),
    );
    await screen.findByTestId("counter-flow-section");

    const cfAmount = () =>
      document.querySelector<HTMLInputElement>(
        '[data-testid^="counter-flow-amount-"]',
      )!;
    fireEvent.change(cfAmount(), { target: { value: "90" } });

    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-testid^="counter-flow-line-"]'),
      ).toHaveLength(1),
    );
    expect(screen.getByTestId("counter-flow-unaccounted")).toHaveTextContent(
      /pick a client to put it on their account/,
    );
    const confirm = screen.getByRole("button", { name: /^Pay / });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mockAddExchangeTransaction).not.toHaveBeenCalled();

    // Positive control: paying the full amount turns Confirm on, so the
    // disabled state above tracks the customer side, not something else.
    fireEvent.change(cfAmount(), { target: { value: "100" } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Pay / })).toBeEnabled(),
    );
  });

  it("passes counterFlow locked to fromCurrency, seeded at amountIn, drawer methods + account (no gift card)", async () => {
    await renderWithAmount();
    await openSheet();

    const cf = sheetCounterFlow();
    expect(cf).toBeDefined();
    expect(cf!.totalAmount).toBe(100);
    expect(cf!.currency).toBe("USD");
    expect(cf!.lockCurrency).toBe(true);
    expect(cf!.seedLines).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 100 },
    ]);
    expect(cf!.requiresClient).toBe(true);
    expect(cf!.hasClient).toBe(false);
    expect(cf!.maxForgive).toBe(5);
    const codes = (cf!.paymentMethods ?? []).map((m) => m.code);
    expect(codes).toContain("CASH");
    expect(codes).toContain("WHISH");
    expect(codes).toContain("CUSTOMER_ACCOUNT");
    expect(codes).not.toContain("GIFT_CARD");
    // The shop's payout side stays cash-only (unchanged).
    expect(lastSheetProps.paymentMethods).toEqual([
      { code: "CASH", label: "Cash", affects_drawer: 1 },
    ]);
  });

  it("hasClient turns true once a saved client is picked, and false again when the name is retyped", async () => {
    await renderWithAmount();
    fireEvent.click(screen.getByTestId("stub-pick-client"));
    await openSheet();
    expect(sheetCounterFlow()!.hasClient).toBe(true);

    fireEvent.change(screen.getByTestId("stub-client-input"), {
      target: { value: "Someone else" },
    });
    await waitFor(() => expect(sheetCounterFlow()!.hasClient).toBe(false));
  });

  it("Confirm is disabled while an account line has no client, the section is short, or overpaid", async () => {
    await renderWithAmount();
    await openSheet();

    fireEvent.click(screen.getByTestId("stub-state-needs-client"));
    await waitFor(() => expect(lastSheetProps.confirmDisabled).toBe(true));

    fireEvent.click(screen.getByTestId("stub-state-balanced"));
    await waitFor(() => expect(lastSheetProps.confirmDisabled).toBe(false));

    fireEvent.click(screen.getByTestId("stub-state-unbalanced"));
    await waitFor(() => expect(lastSheetProps.confirmDisabled).toBe(true));

    fireEvent.click(screen.getByTestId("stub-state-overpaid"));
    await waitFor(() => expect(lastSheetProps.confirmDisabled).toBe(true));
  });

  it("submit sends customerPayments (non-zero lines), clientId and clientName in ONE schema-valid payload", async () => {
    await renderWithAmount();
    fireEvent.click(screen.getByTestId("stub-pick-client"));
    await openSheet();

    fireEvent.click(screen.getByTestId("stub-payout-lines"));
    fireEvent.click(screen.getByTestId("stub-customer-lines"));
    fireEvent.click(screen.getByTestId("stub-state-balanced"));
    await waitFor(() => expect(lastSheetProps.confirmDisabled).toBe(false));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );

    const parsed = exchangeSubmitSchema.parse(lastPayload());
    expect(parsed.clientId).toBe(42);
    expect(parsed.clientName).toBe("Rami Haddad");
    expect(parsed.customerPayments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 90 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 10 },
    ]);
    expect(parsed.customer_waived_amount).toBeUndefined();
    // Payout legs unchanged.
    expect(parsed.payments).toEqual([
      expect.objectContaining({
        method: "CASH",
        currencyCode: "LBP",
        amount: 8_900_000,
      }),
    ]);
  });

  it("a forgiven shortfall travels as customer_waived_amount", async () => {
    await renderWithAmount();
    await openSheet();

    fireEvent.click(screen.getByTestId("stub-payout-lines"));
    fireEvent.click(screen.getByTestId("stub-customer-short"));
    fireEvent.click(screen.getByTestId("stub-state-forgiven"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );

    const parsed = exchangeSubmitSchema.parse(lastPayload());
    expect(parsed.customerPayments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 98 },
    ]);
    expect(parsed.customer_waived_amount).toBe(2);
    expect(parsed.clientId).toBeUndefined();
  });

  it("For-Partner: no customer section, and nothing new in the payload", async () => {
    await renderWithAmount();
    fireEvent.click(screen.getByTestId("stub-pick-client"));
    fireEvent.click(screen.getByTestId("exchange-for-partner-toggle"));
    fireEvent.click(screen.getByTestId("stub-pick-partner"));

    // Partner mode never opens the payout sheet — direct submit.
    const btn = await screen.findByRole("button", {
      name: /Submit to Partner/i,
    });
    expect(sheetCounterFlow()).toBeUndefined();
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );

    const payload = lastPayload();
    const parsed = exchangeSubmitSchema.parse(payload);
    expect(parsed.partnerMode).toBe("FOR");
    expect(parsed.customerPayments).toBeUndefined();
    expect(parsed.customer_waived_amount).toBeUndefined();
    expect(parsed.clientId).toBeUndefined();
  });
});
