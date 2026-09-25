/** @jest-environment jsdom */
// NOT RUN — proven at the end-of-batch gate (LIRA-213 #20 batch).

/**
 * Exchange page — typeable "Customer Gets" (LIRA-213 #20, owner answer,
 * Part A only).
 *
 * Controlling owner answer (2026-09-24, OWNER_NOTES_REMAINING_BUILD.md #20 —
 * this supersedes the older todo_plans note quoted by an earlier draft of
 * this header, which this fix round corrected): "'Customer gets' is typeable
 * ONLY for the currency actually handed over. The dimmed '≈' boxes stay
 * display-only... NO rounding: show the exact figure. No leftover booking is
 * needed." (See also the scout's Part A framing, same file: "the purpose is
 * to answer 'the customer wants 50 EUR — how much USD does he pay?'".)
 *
 * Before this change every "Customer Gets" box was a plain `readOnly`
 * `<input>` with NO `data-testid` of its own (the page used a single shared
 * dimmed-display markup for all three currencies) — so
 * `screen.getByTestId("exchange-target-lbp-input")` itself THROWS
 * ("Unable to find an element by: [data-testid...]") before any
 * `fireEvent.change` runs. (An earlier draft of this comment said
 * `fireEvent.change` on the pre-fix box was a no-op; that description was
 * wrong — the box didn't exist to fire an event on at all.) Either way the
 * assertions below fail against the pre-change page, which is this suite's
 * guard (rule 17): it exercises the box that is NOW a `DecimalInput` wired
 * to `handleTargetAmountChange` → `calculateAmountInForTarget`
 * (@liratek/core).
 *
 * The worked numbers mirror the owner's own example in
 * OWNER_NOTES_REMAINING_BUILD.md #20: "customer wants 5,000,000 LBP and
 * pays USD (buy 89,000): 5,000,000 ÷ 89,000 = $56.1798" — except this suite
 * asserts the UNROUNDED value reaches `amountIn`, per "NO rounding: show
 * the exact figure."
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

const mockLbpBuyRate = 89_000;

function marketRateToUsdPerUnitMock(rate: number, isStronger: 1 | -1): number {
  return isStronger === 1 ? 1 / rate : rate;
}

// Same stub rationale as every other Exchange page test in this directory:
// @liratek/core's full index chains db imports that cannot resolve under
// jsdom, so stub the runtime exports the page actually uses.
//
// `calculateAmountInForTarget` and `computeOverrideLegProfitUsd` are
// FAITHFUL mirrors of the real formulas (not fakes that hardcode the
// answer) for the USD<->LBP pair this suite drives — `calculateExchange`
// stays fixed at the DB default rate (89,000) exactly like
// Exchange.splitPayout.test.tsx's own mock, since overrides are applied by
// the real, unmocked `applyCustomRates` in the page, never by
// `calculateExchange` itself.
jest.mock("@liratek/core", () => ({
  TAKE_USD: -1,
  isLotTrackedCurrency: (code: string) => !["USD", "LBP"].includes(code),
  convertFromUSD: (usd: number) => ({
    amountOut: usd * mockLbpBuyRate,
    rate: mockLbpBuyRate,
  }),
  calculateExchange: (from: string, to: string, amountIn: number) => ({
    fromCurrency: from,
    toCurrency: to,
    amountIn,
    totalAmountOut: amountIn * mockLbpBuyRate,
    totalProfitUsd: 0.5,
    viaCurrency: null,
    legs: [
      {
        fromCurrency: from,
        toCurrency: to,
        amountIn,
        amountOut: amountIn * mockLbpBuyRate,
        rate: mockLbpBuyRate,
        marketRate: 89_500,
        profitUsd: 0.5,
      },
    ],
  }),
  // Reverse of the mock above — reads the rate off the RATES ARGUMENT the
  // page passes (not a hardcoded number), so a test that overrides the LBP
  // rate actually proves the page threaded the override through, rather
  // than proving this mock always returns the same thing.
  calculateAmountInForTarget: (
    from: string,
    to: string,
    targetOut: number,
    rates: Array<{ to_code: string; buy_rate: number; sell_rate: number }>,
  ) => {
    if (from === "USD" && to === "LBP") {
      const lbp = rates.find((r) => r.to_code === "LBP");
      if (!lbp) throw new Error("No exchange rate found for currency: LBP");
      // USD→LBP forward used TAKE_USD => buy_rate (is_stronger=+1, action=-1
      // => is_stronger*action=-1<0 => buy_rate). Mirrors currencyConverter.ts.
      return targetOut / lbp.buy_rate;
    }
    // FIX ROUND 2 (selector-change-race guard) — the race the major finding
    // describes only reproduces by actually reaching an EUR calculation
    // through the buggy path (the old code called this with mismatched
    // currency/target pairs and silently booked whatever came back). A
    // faithful (not hardcoded) mirror of the real USD→EUR branch of
    // currencyConverter.ts's `calculateAmountInForTarget`: fromCurrency is
    // BASE_CURRENCY, so it's `convertToUSD(targetOut, eurRate, TAKE_USD)` —
    // EUR is_stronger=-1, TAKE_USD=-1 => product=+1 => sell_rate, and
    // is_stronger!==1 => multiply.
    if (from === "USD" && to === "EUR") {
      const eur = rates.find((r) => r.to_code === "EUR");
      if (!eur) throw new Error("No exchange rate found for currency: EUR");
      return targetOut * eur.sell_rate;
    }
    throw new Error(`unmocked reverse pair ${from}->${to}`);
  },
  // Faithful mirror of currencyConverter.ts's computeOverrideLegProfitUsd —
  // `applyCustomRates` (real, unmocked page code) calls this directly once
  // a rate override is active.
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
}));

import Exchange from "../index";

const mockAddExchangeTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetRates = jest.fn().mockResolvedValue([
  {
    to_code: "LBP",
    market_rate: 89_500,
    buy_rate: mockLbpBuyRate,
    sell_rate: 90_000,
    is_stronger: 1,
  },
  // FIX ROUND 2 (selector-change-race guard) — a second target currency the
  // "To" selector can switch to mid-test.
  {
    to_code: "EUR",
    market_rate: 1.18,
    buy_rate: 1.16,
    sell_rate: 1.2,
    is_stronger: -1,
  },
]);
const mockGetExchangeHistory = jest.fn().mockResolvedValue([]);
// EUR is lot-tracked per the `isLotTrackedCurrency` mock below, which fires
// the page's debounced FIFO-preview effect once `toCurrency` becomes "EUR".
// Resolve it to a plain NO_RATE_ANCHOR result so that effect settles quietly
// instead of throwing on a missing `exchangeLots` (no test here asserts
// anything about the FIFO preview itself).
const mockLotPreview = jest
  .fn()
  .mockResolvedValue({ lotTracked: false, reason: "NO_RATE_ANCHOR" });

// Rule 25 (test side): a fresh object literal on every `useApi()` call is
// exactly the unstable identity production hides — hoisted to a module-level
// const so every render sees the SAME reference.
const mockUseApiReturn = {
  getRates: mockGetRates,
  getExchangeHistory: mockGetExchangeHistory,
  addExchangeTransaction: mockAddExchangeTransaction,
  exchangeLots: { preview: mockLotPreview },
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockUseApiReturn,
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

// PaymentSheet stub (donor: Exchange.splitPayout.test.tsx) — LBP is a
// split-payout target (canSplitPayout), so "Confirm Exchange" opens this
// sheet instead of submitting directly; `stub-confirm` drives the page's
// real `handleProcess`.
jest.mock("@/features/recharge/components/PaymentSheet", () => ({
  PaymentSheet: (props: { open: boolean; onConfirm: () => void }) =>
    props.open ? (
      <div data-testid="stub-payout-sheet">
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null,
}));

// IMPORTANT: every value these context mocks return must be REFERENTIALLY
// STABLE across renders (rule 25) — a fresh closure per render loops the
// component forever.
const mockActiveCurrencies = [
  { code: "USD", name: "US Dollar" },
  { code: "LBP", name: "Lebanese Pound" },
  // FIX ROUND 2 (selector-change-race guard) — `useExchangeCurrencyList`
  // only offers a currency in the "To" dropdown when it's either in the
  // live feed (empty in this suite's `fetchLiveRatesSnapshot` mock) or, for
  // a feed-EXCLUDED code like EUR, in `activeCurrencies` itself. Without
  // this entry the "To" selector's dropdown has no EUR option to click and
  // the race-guard test below could never reach the buggy path.
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

async function renderExchange() {
  render(<Exchange />);
  await waitFor(() => expect(mockGetRates).toHaveBeenCalled());

  // FIX ROUND 1 (new-test-rates-race) — `mockGetRates` having been CALLED is
  // not proof its resolved rates have been COMMITTED to the page's `rates`
  // state yet (it's a promise; React needs another tick to apply the
  // `setRates` from its `.then`). `calculateAmountInForTarget` throws inside
  // `handleTargetAmountChange`'s try/catch when `rates` is still empty
  // (findCurrencyRate's "No exchange rate found" error), which would leave
  // `amountIn` unmoved and fail whichever assertion runs first — silently,
  // since the throw is caught and only logged. Seed a forward amount and
  // wait for the UI that only renders once `effectiveResult` exists (which
  // itself requires non-empty `rates`), then clear it back out so every
  // test starts from the same pristine `amountIn = 0` as before.
  const amountInField = screen.getByTestId("amount-in") as HTMLInputElement;
  fireEvent.change(amountInField, { target: { value: "1" } });
  await waitFor(() =>
    expect(
      screen.getByTestId("exchange-direct-rate-input"),
    ).toBeInTheDocument(),
  );
  fireEvent.change(amountInField, { target: { value: "" } });
}

describe("Exchange page — typeable Customer Gets (LIRA-213 #20, Part A)", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
  });

  it("typing the LBP target computes the EXACT (unrounded) amount-in and submits it — no rounding, no leftover", async () => {
    await renderExchange();

    // USD → LBP is the page's default pairing for this currency order.
    // LBP is the payout target, so its box is the typeable one.
    const targetInput = screen.getByTestId("exchange-target-lbp-input");
    fireEvent.change(targetInput, { target: { value: "5000000" } });

    // "You Receive" (amountIn) must reflect the EXACT reverse figure —
    // 5,000,000 ÷ 89,000 — not a rounded-up $57 (the scout's proposal,
    // explicitly rejected by the owner).
    const expectedAmountIn = 5_000_000 / mockLbpBuyRate;
    await waitFor(() => {
      const amountInField = screen.getByTestId(
        "amount-in",
      ) as HTMLInputElement;
      expect(parseFloat(amountInField.value)).toBeCloseTo(
        expectedAmountIn,
        10,
      );
    });

    // Submit through the split-payout sheet (LBP is a canSplitPayout target).
    const btn = await screen.findByRole("button", {
      name: /Proceed to Payout/i,
    });
    fireEvent.click(btn);
    await screen.findByTestId("stub-payout-sheet");
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );
    const payload = mockAddExchangeTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.fromCurrency).toBe("USD");
    expect(payload.toCurrency).toBe("LBP");
    expect(payload.amountIn).toBeCloseTo(expectedAmountIn, 10);
    // The target itself is exact — no rounding up to a cash increment.
    expect(payload.amountOut).toBe(5_000_000);
  });

  it("the dimmed (non-target) box has no effect on amount-in — only the SELECTED target currency is typeable", async () => {
    await renderExchange();

    // Default pairing is USD → LBP, so the USD box is the dimmed "≈"
    // equivalent, not the payout target.
    const dimmedUsd = screen.getByTestId("exchange-dimmed-usd-input");
    fireEvent.change(dimmedUsd, { target: { value: "999" } });

    const amountInField = screen.getByTestId("amount-in") as HTMLInputElement;
    // Untouched — the dimmed box is a plain readOnly <input> with no
    // onChange handler; this assertion would also pass trivially on the
    // pre-change page (both boxes were readOnly then), but combined with
    // the previous test it proves the NEW typeable behavior is scoped to
    // exactly the selected target currency, not every box.
    expect(amountInField.value).toBe("");
  });

  it("honours an active rate override on the reverse calculation", async () => {
    await renderExchange();

    // The per-leg rate override input only renders once a non-empty
    // `effectiveResult` exists (it lives beside the calculated rate), so
    // seed one first with an ordinary (un-overridden) target.
    fireEvent.change(screen.getByTestId("exchange-target-lbp-input"), {
      target: { value: "890000" },
    });
    await screen.findByTestId("exchange-direct-rate-input");

    // Override the direct-pair leg rate from the DB default (89,000) to
    // 88,000 — the SAME per-leg override mechanism the forward direction
    // already uses (handleRateChange → customRates/rateOverridden).
    fireEvent.change(screen.getByTestId("exchange-direct-rate-input"), {
      target: { value: "88000" },
    });

    // 4,400,000 ÷ 88,000 = exactly 50 — chosen so the assertion doesn't
    // need a float-tolerance comment.
    fireEvent.change(screen.getByTestId("exchange-target-lbp-input"), {
      target: { value: "4400000" },
    });

    await waitFor(() => {
      const amountInField = screen.getByTestId(
        "amount-in",
      ) as HTMLInputElement;
      expect(parseFloat(amountInField.value)).toBeCloseTo(50, 8);
    });
  });

  it("typing back into 'You Receive' after a reverse-typed target still drives the forward direction normally", async () => {
    await renderExchange();

    fireEvent.change(screen.getByTestId("exchange-target-lbp-input"), {
      target: { value: "5000000" },
    });
    await waitFor(() => {
      const amountInField = screen.getByTestId(
        "amount-in",
      ) as HTMLInputElement;
      expect(parseFloat(amountInField.value)).toBeGreaterThan(0);
    });

    // Forward typing still works exactly as before — amountIn is the page's
    // single source of truth regardless of which box last drove it.
    fireEvent.change(screen.getByTestId("amount-in"), {
      target: { value: "100" },
    });
    const amountInField = screen.getByTestId("amount-in") as HTMLInputElement;
    expect(parseFloat(amountInField.value)).toBe(100);
  });

  // FIX ROUND 2 review finding "selector-change-race" (major) — a currency
  // picked from the "To" selector right after typing a reverse target must
  // NOT let the override re-derive effect reinterpret the OLD (LBP-
  // denominated) typed target under the NEW currency's rates. Reproduces the
  // review's exact scenario: type an LBP target, then change "To" to EUR.
  // Pre-fix (raw setToCurrency wired to onSelect, no reset), the re-derive
  // effect would still see lastEditedSide==="out"/lastTypedTarget===5,000,000
  // and overwrite amountIn with `calculateAmountInForTarget("USD","EUR",
  // 5000000, …)` = 5,000,000 × 1.20 = 6,000,000 (per the mock's USD→EUR
  // branch) — nothing like the true ~56.18 the LBP target produced.
  it("changing the 'To' currency after a reverse-typed target leaves amountIn UNCHANGED (selector-change-race)", async () => {
    await renderExchange();

    fireEvent.change(screen.getByTestId("exchange-target-lbp-input"), {
      target: { value: "5000000" },
    });
    const amountInField = screen.getByTestId("amount-in") as HTMLInputElement;
    let amountInAfterTarget = 0;
    await waitFor(() => {
      amountInAfterTarget = parseFloat(amountInField.value);
      expect(amountInAfterTarget).toBeGreaterThan(0);
    });

    // Open the "To" selector's dropdown and pick EUR — scoped with `within`
    // so this doesn't collide with the "From" selector's own (also-labelled
    // "More") dropdown trigger.
    const toSection = screen.getByText("To").closest("div") as HTMLElement;
    fireEvent.click(within(toSection).getByRole("button", { name: "More" }));
    fireEvent.click(within(toSection).getByRole("button", { name: /^EUR/ }));

    // The currency change alone must not recompute amountIn — it was never
    // retyped, and the new currency pair has nothing to do with the old
    // LBP-denominated target.
    expect(parseFloat(amountInField.value)).toBeCloseTo(
      amountInAfterTarget,
      10,
    );
  });

  // FIX ROUND 1 review finding "drift-fix-unguarded" (minor), first guard —
  // editing the direct-pair rate override must re-derive amountIn from the
  // ORIGINAL typed target WITHOUT the cashier retyping it. Unlike the
  // "honours an active rate override" test above (which retypes a fresh
  // target after the override edit and so cannot tell the re-derive effect
  // apart from a no-op), this asserts straight after the override edit.
  it("editing the rate override recomputes amountIn from the target the cashier already typed, with no retype", async () => {
    await renderExchange();

    fireEvent.change(screen.getByTestId("exchange-target-lbp-input"), {
      target: { value: "890000" },
    });
    await screen.findByTestId("exchange-direct-rate-input");

    fireEvent.change(screen.getByTestId("exchange-direct-rate-input"), {
      target: { value: "88000" },
    });

    // 890,000 ÷ 88,000 = 10.1136363... — no retype of the target happens.
    const expectedAmountIn = 890000 / 88000;
    await waitFor(() => {
      const amountInField = screen.getByTestId(
        "amount-in",
      ) as HTMLInputElement;
      expect(parseFloat(amountInField.value)).toBeCloseTo(
        expectedAmountIn,
        6,
      );
    });

    // The target box itself re-derives FORWARD from the new amountIn (real,
    // unmocked `recalculate()` + `applyCustomRates`) and still reads back
    // (approximately) the cashier's original 890,000 — it was never
    // retyped, the override edit alone drove it back there.
    const targetField = screen.getByTestId(
      "exchange-target-lbp-input",
    ) as HTMLInputElement;
    expect(
      parseFloat(targetField.value.replace(/,/g, "")),
    ).toBeCloseTo(890000, 0);
  });

  // FIX ROUND 1 review finding "drift-fix-unguarded" (minor), second guard —
  // once the cashier types FORWARD into "You Receive" after a reverse-typed
  // target, a later rate-override edit must NOT resurrect the stale reverse
  // target. This is the scenario `handleAmountInChange` exists to guard
  // (LIRA-213 #20 FIX ROUND 1): if it were unwired (raw `setAmountIn` on the
  // "You Receive" box, the interrupted session's original half-done state),
  // `lastEditedSide` would stay "out" and `lastTypedTarget` would stay
  // 5,000,000, so the override edit below would silently overwrite the
  // forward-typed 100 with 5,000,000 ÷ 88,000.
  it("typing forward after a reverse-typed target survives a later rate-override edit", async () => {
    await renderExchange();

    fireEvent.change(screen.getByTestId("exchange-target-lbp-input"), {
      target: { value: "5000000" },
    });
    const amountInField = screen.getByTestId("amount-in") as HTMLInputElement;
    await waitFor(() => {
      expect(parseFloat(amountInField.value)).toBeGreaterThan(0);
    });

    fireEvent.change(amountInField, { target: { value: "100" } });
    expect(parseFloat(amountInField.value)).toBe(100);

    await screen.findByTestId("exchange-direct-rate-input");
    fireEvent.change(screen.getByTestId("exchange-direct-rate-input"), {
      target: { value: "88000" },
    });

    expect(parseFloat(amountInField.value)).toBe(100);
  });
});
