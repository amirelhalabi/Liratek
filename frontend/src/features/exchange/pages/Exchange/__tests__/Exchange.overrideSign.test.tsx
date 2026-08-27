/** @jest-environment jsdom */

/**
 * Exchange page — per-leg rate-override profit is SIGNED, never Math.abs'd.
 *
 * Owner-reported confusion: overriding a rate to give the customer a BETTER
 * deal than market (a real loss for the shop) previewed AND submitted a
 * PHANTOM POSITIVE profit, because `applyCustomRates` computed
 * `Math.abs(marketOut - amountOut)` locally instead of the signed
 * `computeOverrideLegProfitUsd` (@liratek/core, currencyConverter.ts). A
 * second, related bug: for an acquire-only cross (buying an exotic currency,
 * Q8 books the buy leg's profit only at sale) the session-link profit stamp
 * fell back to the client's PRE-LOT total (leg1 + leg2), double-counting the
 * deferred leg1 profit the server actually zeros — e.g. stamping $6.63 while
 * the transaction books $0.63.
 *
 * Worked anchors (see currencyConverter.ts computeOverrideLegProfitUsd
 * doc-comment — the EUR/USD figures below are NOT invented here, they're
 * the function's own documented examples; the USD→LBP one is recomputed
 * below for a rate that's never configured on LBP, so a hypothetical
 * clamp-to-configured-rate bug can never be confused with an honored
 * override — see the loss test itself for the same reasoning):
 *   - USD→LBP payout of 116 USD, applied 90,200 vs market 89,500 (customer
 *     gets MORE LBP than market — a real loss):
 *     (116×89,500 − 116×90,200) / 89,500 = −81,200 / 89,500 ≈ −0.9073.
 *   - EUR→USD leg, shop buys 100 EUR at applied 1.12 vs market 1.18: +6.00.
 *   - Same buy at applied 1.20 (shop overpaid the customer in USD): −2.00.
 *
 * Same rationale as Exchange.splitPayout.test.tsx: @liratek/core's full
 * index chains db imports that can't resolve under jsdom, so this stubs the
 * runtime exports the page actually uses — INCLUDING a faithful
 * reimplementation of `computeOverrideLegProfitUsd` (mirroring the real
 * signed formula exactly), since `applyCustomRates` calls it directly and a
 * fake that always returns a positive number would defeat the point of
 * these tests (rule 17 — the guard must be able to fail against the bug).
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

function marketRateToUsdPerUnitMock(
  rate: number,
  isStronger: 1 | -1,
): number {
  return isStronger === 1 ? 1 / rate : rate;
}

jest.mock("@liratek/core", () => ({
  TAKE_USD: -1,
  isLotTrackedCurrency: (code: string) => !["USD", "LBP"].includes(code),
  convertFromUSD: (usd: number) => ({ amountOut: usd * 89_000, rate: 89_000 }),
  // Faithful mirror of currencyConverter.ts's computeOverrideLegProfitUsd —
  // NOT a stub that fakes the answer. `applyCustomRates` (the real,
  // unmocked page code under test) calls this directly; if it were wrong or
  // hardcoded, a Math.abs regression in the page could never be caught here.
  computeOverrideLegProfitUsd: (
    marketOut: number,
    actualOut: number,
    outCurrencyRate: { market_rate: number; is_stronger: 1 | -1 } | null,
  ) => {
    const usdPerOutUnit = outCurrencyRate
      ? marketRateToUsdPerUnitMock(
          outCurrencyRate.market_rate,
          outCurrencyRate.is_stronger,
        )
      : 1;
    return (marketOut - actualOut) * usdPerOutUnit;
  },
  // Base (pre-override) calculation for the two pairs these tests drive.
  // Both branches reproduce the REAL half-spread formula
  // (computeLegProfitUsd) by hand so the base leg the page starts from is
  // exactly what production would compute at the default (non-overridden)
  // rate — only the override math itself (applyCustomRates, real/unmocked)
  // is what's under test.
  calculateExchange: (from: string, to: string, amountIn: number) => {
    if (from === "USD" && to === "LBP") {
      const rate = 89_000;
      const marketRate = 89_500;
      const amountOut = amountIn * rate;
      const profitUsd = (amountIn * ((90_000 - 89_000) / 2)) / marketRate;
      return {
        fromCurrency: from,
        toCurrency: to,
        amountIn,
        totalAmountOut: amountOut,
        totalProfitUsd: profitUsd,
        viaCurrency: null,
        legs: [
          {
            fromCurrency: from,
            toCurrency: to,
            amountIn,
            amountOut,
            rate,
            marketRate,
            profitUsd,
          },
        ],
      };
    }
    if (from === "EUR" && to === "LBP") {
      const eurRate = 1.16;
      const eurMarket = 1.18;
      const eurSpread = 1.2 - 1.16;
      const leg1Out = amountIn * eurRate; // USD
      const leg1Profit = amountIn * (eurSpread / 2); // EUR→USD, fromCurrencyIsUsd=false
      const lbpRate = 89_000;
      const lbpMarket = 89_500;
      const lbpSpread = 90_000 - 89_000;
      const leg2Out = leg1Out * lbpRate; // LBP
      const leg2Profit = (leg1Out * (lbpSpread / 2)) / lbpMarket; // USD→LBP, fromCurrencyIsUsd=true
      return {
        fromCurrency: from,
        toCurrency: to,
        amountIn,
        totalAmountOut: leg2Out,
        totalProfitUsd: leg1Profit + leg2Profit,
        viaCurrency: "USD",
        legs: [
          {
            fromCurrency: from,
            toCurrency: "USD",
            amountIn,
            amountOut: leg1Out,
            rate: eurRate,
            marketRate: eurMarket,
            profitUsd: leg1Profit,
          },
          {
            fromCurrency: "USD",
            toCurrency: to,
            amountIn: leg1Out,
            amountOut: leg2Out,
            rate: lbpRate,
            marketRate: lbpMarket,
            profitUsd: leg2Profit,
          },
        ],
      };
    }
    throw new Error(`calculateExchange mock: unhandled pair ${from}->${to}`);
  },
}));

const mockAddExchangeTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetRates = jest.fn().mockResolvedValue([
  { to_code: "LBP", market_rate: 89_500, buy_rate: 89_000, sell_rate: 90_000, is_stronger: 1 },
  { to_code: "EUR", market_rate: 1.18, buy_rate: 1.16, sell_rate: 1.2, is_stronger: -1 },
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

// USD/LBP is a split-payout target (canSplitPayout), so every submit in this
// suite routes through the PaymentSheet — stubbed with a bare confirm button
// (donor: Exchange.splitPayout.test.tsx). No lines are ever injected: the
// page's `payoutLines` stays `[]`, so `handleProcess` sends the plain
// (non-split) payload these tests actually care about.
jest.mock("@/features/recharge/components/PaymentSheet", () => ({
  PaymentSheet: (props: { open: boolean; onConfirm: () => void }) =>
    props.open ? (
      <button data-testid="stub-confirm" onClick={props.onConfirm} />
    ) : null,
}));

const mockActiveCurrencies = [
  { code: "USD", name: "US Dollar" },
  { code: "LBP", name: "Lebanese Pound" },
  { code: "EUR", name: "Euro" },
];
const mockGetDecimals = (c: string) => (c === "LBP" ? 0 : 2);
const mockCurrencyContext = {
  activeCurrencies: mockActiveCurrencies,
  getDecimals: mockGetDecimals,
};
jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => mockCurrencyContext,
}));

const mockLinkTransaction = jest.fn();
const mockSessionContext = {
  activeSession: null as { id: number } | null,
  linkTransaction: mockLinkTransaction,
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
    lastUpdatedUtc: "Thu, 27 Aug 2026 00:02:31 +0000",
    nextUpdateUnix: 1785543661,
  }),
  CURRENCY_NAMES: { USD: "US Dollar", LBP: "Lebanese Pound", EUR: "Euro" },
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

import Exchange from "../index";

/** Opens the "From" currency picker and selects EUR; "To" is left at its
 *  context-driven default (LBP — mockActiveCurrencies[1]), giving an
 *  EUR → LBP cross (via USD). */
function switchFromToEur() {
  const fromContainer = screen.getByText("From").closest("div") as HTMLElement;
  fireEvent.click(within(fromContainer).getByText("More"));
  fireEvent.click(within(fromContainer).getByText("EUR"));
}

/** Extracts the signed numeric value out of a "+$X.XXXX" / "-$X.XXXX" node. */
function signedAmount(el: HTMLElement): number {
  const m = el.textContent!.match(/([+-])\$([0-9.]+)/);
  if (!m) throw new Error(`No signed amount found in: ${el.textContent}`);
  return (m[1] === "-" ? -1 : 1) * parseFloat(m[2]);
}

describe("Exchange page — signed rate-override profit (no Math.abs)", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    mockAddExchangeTransaction.mockResolvedValue({ success: true, id: 1 });
    mockLinkTransaction.mockClear();
    mockSessionContext.activeSession = null;
  });

  it("LOSING override: USD->LBP overridden above market books a NEGATIVE leg profit — displayed AND submitted", async () => {
    render(<Exchange />);
    await waitFor(() => expect(mockGetRates).toHaveBeenCalled());

    // USD/LBP are the context's first two currencies — no picker needed.
    fireEvent.change(screen.getByTestId("amount-in"), {
      target: { value: "116" },
    });

    // 90,200 — deliberately NOT the seeded LBP sell_rate (90,000, see
    // mockGetRates above): using the sell_rate here would make a
    // hypothetical clamp-to-sell-rate bug indistinguishable from an honored
    // override, since both would land on the exact same displayed/booked
    // number.
    const rateInput = await screen.findByTestId("exchange-direct-rate-input");
    fireEvent.change(rateInput, { target: { value: "90200" } });

    // profit = (marketOut − actualOut) / market_rate
    //        = (116×89,500 − 116×90,200) / 89,500
    //        = (10,382,000 − 10,463,200) / 89,500 = −81,200 / 89,500 ≈ −0.9073
    // Displayed: signed, negative, in the app's loss (red) styling — never
    // the pre-fix "$-0.9073" (sign after the "$") or a phantom "+0.9073".
    const profitEl = await screen.findByTestId("exchange-direct-total-profit");
    await waitFor(() =>
      expect(profitEl.textContent).toMatch(/^-\$0\.9073 USD$/),
    );
    expect(profitEl.className).toMatch(/text-red-400/);

    const btn = await screen.findByRole("button", {
      name: /Proceed to Payout/i,
    });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    fireEvent.click(await screen.findByTestId("stub-confirm"));

    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );
    const payload = mockAddExchangeTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // The exact bug: reintroducing `Math.abs(marketOut - amountOut)` in
    // applyCustomRates makes this book +0.9073 (the same magnitude, wrong
    // sign) instead of the correct signed -0.9073 — confirmed by hand
    // against the pre-fix source (rule 17).
    expect(payload.leg1ProfitUsd as number).toBeCloseTo(-0.9073, 3);
    expect(payload.totalProfitUsd as number).toBeCloseTo(-0.9073, 3);
  });

  it("WINNING override parity: EUR->LBP leg1 overridden to 1.12 previews the owner's exact case B total", async () => {
    render(<Exchange />);
    await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
    switchFromToEur();

    fireEvent.change(screen.getByTestId("amount-in"), {
      target: { value: "100" },
    });

    const rateInput1 = await screen.findByTestId("exchange-cross-rate-input-1");
    fireEvent.change(rateInput1, { target: { value: "1.12" } });

    // Total = leg1 (zeroed for display — Q8, deferred to sale) + leg2 —
    // the SAME figure the transaction actually books, not the client's
    // pre-lot leg1+leg2 sum (~$6.63).
    const totalEl = await screen.findByTestId("exchange-cross-total-profit");
    await waitFor(() => expect(signedAmount(totalEl)).toBeCloseTo(0.6257, 2));
  });

  it("deferred-profit annotation: signed leg-1 buy-side value, flips to a loss variant above market", async () => {
    render(<Exchange />);
    await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
    switchFromToEur();

    fireEvent.change(screen.getByTestId("amount-in"), {
      target: { value: "100" },
    });
    const rateInput1 = await screen.findByTestId("exchange-cross-rate-input-1");

    fireEvent.change(rateInput1, { target: { value: "1.12" } });
    let deferredEl = await screen.findByTestId("exchange-cross-deferred-1");
    await waitFor(() =>
      expect(deferredEl.textContent).toMatch(/^\+\$6\.00 books at sale$/),
    );

    fireEvent.change(rateInput1, { target: { value: "1.20" } });
    deferredEl = await screen.findByTestId("exchange-cross-deferred-1");
    await waitFor(() =>
      expect(deferredEl.textContent).toMatch(
        /^-\$2\.00 books at sale \(loss\)$/,
      ),
    );
    expect(deferredEl.className).toMatch(/text-red-400/);
  });

  it("session stamp: prefers bookedProfitUsd over both realizedProfitUsd and the client's pre-lot total", async () => {
    mockAddExchangeTransaction.mockResolvedValue({
      success: true,
      id: 42,
      bookedProfitUsd: 0.63,
      // A third, distinct value (never 0.63, never ~6.63) so a regressed
      // `realizedProfitUsd ?? bookedProfitUsd` precedence — checking
      // realizedProfitUsd FIRST — is caught: it would stamp 99, not 0.63.
      realizedProfitUsd: 99,
    });
    mockSessionContext.activeSession = { id: 1 };

    render(<Exchange />);
    await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
    switchFromToEur();

    fireEvent.change(screen.getByTestId("amount-in"), {
      target: { value: "100" },
    });
    const rateInput1 = await screen.findByTestId("exchange-cross-rate-input-1");
    fireEvent.change(rateInput1, { target: { value: "1.12" } });

    const btn = await screen.findByRole("button", {
      name: /Proceed to Payout/i,
    });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    fireEvent.click(await screen.findByTestId("stub-confirm"));

    await waitFor(() => expect(mockLinkTransaction).toHaveBeenCalled());
    const payload = mockLinkTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Server's bookedProfitUsd (0.63) must win over BOTH realizedProfitUsd
    // (99, mocked above) and the client's pre-lot leg1+leg2 total (~6.63,
    // effectiveResult.totalProfitUsd) — either wrong precedence stamps a
    // different, distinguishable number.
    expect(payload.profitUsd).toBe(0.63);
  });
});
