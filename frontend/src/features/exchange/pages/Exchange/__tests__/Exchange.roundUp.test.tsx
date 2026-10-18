/** @jest-environment jsdom */

/**
 * Exchange page — payout round-up (LIRA-334, T027). Handing out a little MORE
 * than the exchange owes (8,950,000 LBP on 8,900,000) is a round-up the shop
 * books as change rounding. The payout sheet reports it via
 * `onRoundUpChange`; the page sends `rounding_given_*` in the ONE payload,
 * next to the payout legs (rule 22). Re-opening the sheet clears it.
 *
 * Harness from Exchange.splitPayout.test.tsx (PaymentSheet stubbed,
 * @liratek/core stubbed, payload parsed through the schema module — rule 24).
 * Rule 17: run against the unwired page first — see the task report.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// The page needs only the currency-converter exports from @liratek/core;
// the package's full index chains db imports that cannot resolve under
// jsdom (and cross-package requireActual stalls ts-jest), so stub the three
// runtime exports with a fixed USD→LBP result at rate 89,000. Type-only
// imports (CurrencyRate, CurrencyExchangeResult) are erased at compile time.
jest.mock("@liratek/core", () => ({
  TAKE_USD: -1,
  // LIRA-321: the page reads the forgive cap for the "Customer pays" section.
  SHORTFALL_MAX: { USD: 5, LBP: 450_000 },
  // LIRA-213 #20 — the typeable "Customer Gets" reverse calc. Unused by this
  // suite's scenarios (it never types into the target box), so a trivial
  // stub is enough to keep the module import from resolving to `undefined`.
  calculateAmountInForTarget: jest.fn(() => 0),
  // EXCHANGE_LOT_SETTLEMENT.md Q1 — this suite only ever exercises USD/LBP,
  // both exempt from lot tracking; Exchange/index.tsx calls this
  // unconditionally every render, so it must exist even though the
  // lot-preview path is never reached here.
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
// Rule 24: payload field names are asserted THROUGH the core schema (the
// direct validator module — @liratek/core itself is stubbed above).
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

// Rule 25: useApi() must return a STABLE reference (production's is a
// module-level singleton) — a fresh literal per call hides identity-churn
// render loops.
const mockApi = {
  getRates: mockGetRates,
  getExchangeHistory: mockGetExchangeHistory,
  addExchangeTransaction: mockAddExchangeTransaction,
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  // LIRA-213 #20 added a SECOND DecimalInput to the page (the typeable
  // "Customer Gets" target box), so this stub must respect a caller-passed
  // `data-testid` instead of always rendering "amount-in" — otherwise two
  // stubbed inputs would collide on the same testid. Callers that don't
  // pass one (the "You Receive" box) keep the original "amount-in" id.
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

// PaymentSheet stub: captures every render's props so the test can assert
// the seed rate / method list, and exposes buttons to inject lines, edit the
// sheet rate, and confirm.
let lastSheetProps: Record<string, unknown> = {};
jest.mock("@/features/recharge/components/PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
    onRoundUpChange?: (r: { usd: number; lbp: number } | null) => void;
    onClose: () => void;
    onConfirm: () => void;
  }) => {
    lastSheetProps = props as unknown as Record<string, unknown>;
    return props.open ? (
      <div data-testid="stub-payout-sheet">
        {/* 8,900,000 LBP owed, 8,950,000 handed out → 50,000 rounded up. */}
        <button
          data-testid="stub-payout-roundup"
          onClick={() => {
            props.onPaymentChange([
              {
                id: "R1",
                method: "CASH",
                currencyCode: "LBP",
                amount: 8_950_000,
              },
            ]);
            props.onKeptChange?.(null);
            props.onRoundUpChange?.({ usd: 0, lbp: 50_000 });
          }}
        />
        {/* Lines only: the exact 8,900,000 owed. */}
        <button
          data-testid="stub-payout-exact"
          onClick={() =>
            props.onPaymentChange([
              {
                id: "E1",
                method: "CASH",
                currencyCode: "LBP",
                amount: 8_900_000,
              },
            ])
          }
        />
        <button data-testid="stub-close" onClick={props.onClose} />
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

async function openPayoutSheet() {
  render(<Exchange />);
  await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
  fireEvent.change(screen.getByTestId("amount-in"), {
    target: { value: "100" },
  });
  const btn = await screen.findByRole("button", {
    name: /Proceed to Payout/i,
  });
  fireEvent.click(btn);
  await screen.findByTestId("stub-payout-sheet");
}

describe("Exchange page — payout round-up (LIRA-334)", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    lastSheetProps = {};
  });

  it("8,950,000 on 8,900,000 sends rounding_given_lbp 50,000 with the legs and no kept change", async () => {
    await openPayoutSheet();
    expect(typeof lastSheetProps.onRoundUpChange).toBe("function");
    fireEvent.click(screen.getByTestId("stub-payout-roundup"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );
    const parsed = exchangeSubmitSchema.parse(
      mockAddExchangeTransaction.mock.calls[0][0],
    );
    expect(parsed.rounding_given_lbp).toBe(50_000);
    expect(parsed.rounding_given_usd ?? 0).toBe(0);
    expect(parsed.kept_change_usd).toBeUndefined();
    expect(parsed.kept_change_lbp).toBeUndefined();
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "LBP", amount: 8_950_000 }),
    ]);
  });

  it("exact payout: no rounding_given_* in the payload", async () => {
    await openPayoutSheet();
    fireEvent.click(screen.getByTestId("stub-payout-exact"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );
    const parsed = exchangeSubmitSchema.parse(
      mockAddExchangeTransaction.mock.calls[0][0],
    );
    expect(parsed.rounding_given_usd).toBeUndefined();
    expect(parsed.rounding_given_lbp).toBeUndefined();
  });

  it("a round-up from a closed sheet is not sent after the sheet is re-opened", async () => {
    await openPayoutSheet();
    fireEvent.click(screen.getByTestId("stub-payout-roundup"));
    fireEvent.click(screen.getByTestId("stub-close"));
    const btn = await screen.findByRole("button", {
      name: /Proceed to Payout/i,
    });
    fireEvent.click(btn);
    await screen.findByTestId("stub-payout-sheet");
    fireEvent.click(screen.getByTestId("stub-payout-exact"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );
    const parsed = exchangeSubmitSchema.parse(
      mockAddExchangeTransaction.mock.calls[0][0],
    );
    expect(parsed.rounding_given_usd).toBeUndefined();
    expect(parsed.rounding_given_lbp).toBeUndefined();
  });
});
