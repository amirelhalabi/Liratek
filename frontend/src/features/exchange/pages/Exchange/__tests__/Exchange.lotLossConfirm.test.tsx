/** @jest-environment jsdom */

/**
 * Exchange page — Q10 loss-confirm dialog + the >10% guard bypass for a
 * lot-tracked toCurrency.
 *
 * Drives a USD → EUR direct exchange (EUR is lot-tracked, Q1) whose mocked
 * `calculateExchange` reports an artificially huge (50%) local spread
 * profit — the exact shape that would have tripped the pre-existing >10%
 * sanity guard and disabled the submit button. Q10 says a lot-tracked
 * toCurrency must never be hard-blocked by that guard; the FIFO preview
 * (mocked here to return a realized LOSS) drives a confirm dialog instead.
 * Submission only proceeds once the operator confirms.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

jest.mock("@liratek/core", () => ({
  TAKE_USD: -1,
  isLotTrackedCurrency: (code: string) => !["USD", "LBP"].includes(code),
  convertFromUSD: (usd: number) => ({ amountOut: usd * 89_000, rate: 89_000 }),
  calculateExchange: (from: string, to: string, amountIn: number) => ({
    fromCurrency: from,
    toCurrency: to,
    amountIn,
    totalAmountOut: amountIn / 1.16,
    // Artificially huge — 50% of input — the exact case the pre-existing
    // >10% guard was built to catch. Must NOT disable the submit button for
    // a lot-tracked toCurrency (Q10).
    totalProfitUsd: amountIn * 0.5,
    viaCurrency: null,
    legs: [
      {
        fromCurrency: from,
        toCurrency: to,
        amountIn,
        amountOut: amountIn / 1.16,
        rate: 1.16,
        marketRate: 1.16,
        profitUsd: amountIn * 0.5,
      },
    ],
  }),
}));

const mockAddExchangeTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1, realizedProfitUsd: -25 });
const mockGetRates = jest.fn().mockResolvedValue([
  {
    to_code: "EUR",
    market_rate: 1.16,
    buy_rate: 1.1601,
    sell_rate: 1.17,
    is_stronger: -1,
  },
]);
const mockGetExchangeHistory = jest.fn().mockResolvedValue([]);
// Default resolution — genuine FIFO lot tracking with a realized loss (the
// Q10 scenario this file was originally written for). Re-applied in
// `beforeEach` so a test that overrides it (e.g. NO_RATE_ANCHOR, a rejected
// preview) never leaks its mock resolution into a later test.
const defaultPreviewResult = {
  lotTracked: true,
  marketUnitCostUsd: 1.1,
  settlements: [],
  realizedProfitUsd: -25,
  coveredQty: 100,
  marketQty: 0,
};
const mockPreview = jest.fn().mockResolvedValue(defaultPreviewResult);

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getRates: mockGetRates,
    getExchangeHistory: mockGetExchangeHistory,
    addExchangeTransaction: mockAddExchangeTransaction,
    exchangeLots: { preview: mockPreview },
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
  activeSession: null,
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
    lastUpdatedUtc: "Fri, 21 Aug 2026 00:02:31 +0000",
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

// Waits past the 400ms preview debounce AND the button's own
// `lotPreviewLoading` gate (the submit button is deliberately disabled while
// the preview is in flight — see Exchange/index.tsx — so every test here
// must let it settle before clicking, or the click on a disabled <button>
// is a no-op in jsdom).
async function renderAndType(amount = "100") {
  render(<Exchange />);
  await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
  fireEvent.change(screen.getByTestId("amount-in"), {
    target: { value: amount },
  });
  const btn = await screen.findByRole("button", { name: /Confirm Exchange/i });
  await waitFor(() => expect(mockPreview).toHaveBeenCalled());
  await waitFor(() => expect(btn).not.toBeDisabled());
  return btn;
}

describe("Exchange page — lot-tracked loss confirm (Q10) + 10% guard bypass", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    mockPreview.mockClear();
    mockPreview.mockResolvedValue(defaultPreviewResult);
    mockLinkTransaction.mockClear();
  });

  it("does not disable the submit button despite a 50% local spread profit (guard bypassed for a lot-tracked toCurrency)", async () => {
    const btn = await renderAndType();
    // The pre-existing >10% guard would have disabled this button; Q10 says
    // it must not for a lot-tracked toCurrency (EUR here). renderAndType's
    // own wait already proves this — assert it explicitly too.
    expect(btn).not.toBeDisabled();
  });

  it("shows a loss-confirm dialog on submit when the FIFO preview is negative, and does not submit until confirmed", async () => {
    const btn = await renderAndType();
    expect(mockPreview).toHaveBeenCalledWith(
      expect.objectContaining({ currencyCode: "EUR" }),
    );

    fireEvent.click(btn);

    expect(await screen.findByText(/Confirm Loss/i)).toBeInTheDocument();
    // Scoped to the exact dialog copy — the page's OWN "Realized profit:
    // -$25.0000 USD" line (rendered behind the dialog) also contains
    // "-$25.00" as a substring, so a loose match would be ambiguous.
    expect(
      screen.getByText(/realizes -\$25\.00 against acquisition cost/i),
    ).toBeInTheDocument();
    expect(mockAddExchangeTransaction).not.toHaveBeenCalled();

    // Cancel — never submits.
    fireEvent.click(screen.getByTestId("confirm-modal-cancel-btn"));
    expect(mockAddExchangeTransaction).not.toHaveBeenCalled();

    // Re-open and confirm — submits exactly once.
    fireEvent.click(btn);
    await screen.findByText(/Confirm Loss/i);
    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));

    await waitFor(() =>
      expect(mockAddExchangeTransaction).toHaveBeenCalledTimes(1),
    );
  });

  it("uses the server-authoritative realizedProfitUsd for session.linkTransaction when present", async () => {
    mockSessionContext.activeSession = { id: 1 } as any;
    try {
      const btn = await renderAndType();
      await waitFor(() => expect(mockPreview).toHaveBeenCalled());
      fireEvent.click(btn);
      await screen.findByText(/Confirm Loss/i);
      fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));

      await waitFor(() => expect(mockLinkTransaction).toHaveBeenCalled());
      const payload = mockLinkTransaction.mock.calls[0][0];
      // Server returned realizedProfitUsd: -25 — must win over the client's
      // huge (amountIn * 0.5) local spread estimate.
      expect(payload.profitUsd).toBe(-25);
    } finally {
      mockSessionContext.activeSession = null;
    }
  });
});

/**
 * Adversarial-review FIX 2 item 3 — a cross/lot-tracked toCurrency with NO
 * USD rate anchor. The server (ExchangeLotService.previewSettlement) skips
 * lot tracking entirely for this case and keeps the plain spread-based
 * profit model, so the preview now reports `{ lotTracked: false, reason:
 * "NO_RATE_ANCHOR" }` instead of a fabricated FIFO figure.
 */
describe("Exchange page — lot-tracked toCurrency with no rate anchor (NO_RATE_ANCHOR)", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    mockPreview.mockClear();
    mockPreview.mockResolvedValue(defaultPreviewResult);
    mockLinkTransaction.mockClear();
  });

  it("shows the amber 'cost-basis unavailable' note (never the FIFO line) and never arms the loss-confirm dialog", async () => {
    mockPreview.mockResolvedValue({
      lotTracked: false,
      reason: "NO_RATE_ANCHOR",
    });
    render(<Exchange />);
    await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId("amount-in"), {
      target: { value: "10" },
    });
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());

    expect(
      await screen.findByText(
        /Cost-basis tracking unavailable for this pair/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/FIFO vs cost basis/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirm Loss/i)).not.toBeInTheDocument();
  });

  it("REGRESSION (rule 17): keeps the >10% sanity guard active instead of bypassing it just because toCurrency is lot-tracked", async () => {
    // The mocked calculateExchange reports totalProfitUsd = amountIn * 0.5
    // — the exact 50% local-spread shape the >10% guard exists to catch.
    // For NO_RATE_ANCHOR the server keeps this exact spread-based profit
    // (lot tracking never ran), so the guard must apply here precisely as
    // it would for a plain non-lot-tracked currency — it must NOT be
    // silently bypassed just because EUR happens to be lot-tracked in
    // general. This is the gating bug the adversarial review found: the
    // pre-fix code bypassed the guard off `isLotTrackedCurrency(toCurrency)`
    // alone, without checking whether the preview actually confirmed real
    // lot tracking for THIS pair.
    mockPreview.mockResolvedValue({
      lotTracked: false,
      reason: "NO_RATE_ANCHOR",
    });
    render(<Exchange />);
    await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId("amount-in"), {
      target: { value: "100" },
    });
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    await screen.findByText(/Cost-basis tracking unavailable for this pair/i);

    const btn = await screen.findByRole("button", {
      name: /Confirm Exchange/i,
    });
    await waitFor(() => expect(btn).toBeDisabled());
    expect(screen.getByText(/Unusually high profit/i)).toBeInTheDocument();
  });
});

/**
 * Adversarial-review FIX 3 — the preview FETCH itself can fail (network/IPC
 * error), which must be visibly distinguishable from "not yet started" or
 * "not applicable" (both also leave the preview state empty). Must never
 * block or disable submit — the server still computes profit authoritatively
 * at submit time regardless of whether the client-side preview succeeded.
 */
describe("Exchange page — FIFO preview fetch failure", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    mockPreview.mockClear();
    mockLinkTransaction.mockClear();
  });

  it("shows a visible 'preview unavailable' warning and never disables submit because of it", async () => {
    mockPreview.mockRejectedValue(new Error("network down"));
    const btn = await renderAndType();

    expect(
      await screen.findByText(
        /Realized-profit preview unavailable — profit will be computed at submit/i,
      ),
    ).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });
});

/**
 * Adversarial-review FIX 2 item 3 (payload) + FIX 4 — the preview call must
 * carry `fromCurrency` (so the server can detect a cross pair with no USD
 * anchor) and its `qty` must be the SAME rounded value `handleProcess`
 * actually sends as `amountOut`, not the raw unrounded leg amount. 100/1.16
 * is chosen deliberately: it has more decimal places than EUR's 2-decimal
 * display precision, so the raw (86.206896551724...) and rounded ("86.21")
 * values genuinely differ — a non-vacuous check.
 */
describe("Exchange page — preview payload correctness", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    mockPreview.mockClear();
    mockPreview.mockResolvedValue(defaultPreviewResult);
    mockLinkTransaction.mockClear();
  });

  it("sends fromCurrency and the rounded displayed amountOut as qty, not the raw unrounded leg amount", async () => {
    await renderAndType("100");

    expect(mockPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        currencyCode: "EUR",
        fromCurrency: "USD",
        qty: 86.21,
      }),
    );
    // The raw leg amount (100 / 1.16) would have been 86.206896551724... —
    // confirm the call was never made with that unrounded figure.
    expect(mockPreview).not.toHaveBeenCalledWith(
      expect.objectContaining({ qty: 100 / 1.16 }),
    );
  });
});

/**
 * Owner-reported UX bug (2026-08-23), fixed alongside the above — for an
 * exotic TARGET currency (neither USD nor LBP), the Customer Gets panel
 * previously showed ONLY the USD/LBP value-equivalents; the actual payout
 * quantity in the target currency (e.g. "100 EUR") appeared nowhere,
 * leaving the till operator no way to know how much to hand the customer.
 */
describe("Exchange page — exotic target currency amount display (FIX 6)", () => {
  beforeEach(() => {
    mockAddExchangeTransaction.mockClear();
    mockPreview.mockClear();
    mockPreview.mockResolvedValue(defaultPreviewResult);
    mockLinkTransaction.mockClear();
  });

  it("shows the exotic target's own amount prominently for USD -> EUR", async () => {
    // Mocked calculateExchange: totalAmountOut = amountIn / 1.16. Using 116
    // gives an exact, easy-to-assert 100.00 EUR.
    await renderAndType("116");

    const exoticBox = screen.getByTestId("exchange-exotic-payout");
    expect(within(exoticBox).getByDisplayValue("100.00")).toBeInTheDocument();
    expect(within(exoticBox).getByText("EUR")).toBeInTheDocument();

    // USD/LBP boxes still render, but only as dimmed "≈" equivalents (both
    // usdIsPayout and lbpIsPayout are false for an exotic target) — never
    // primary — for this exotic-target case.
    expect(screen.getAllByDisplayValue(/^≈ /).length).toBe(2);
  });

  it("does not regress the USD-target case (EUR -> USD via swap) — no exotic box, USD renders prominently", async () => {
    await renderAndType("100");
    fireEvent.click(screen.getByTestId("exchange-swap-button"));

    // Swapped: fromCurrency is now EUR, toCurrency is now USD (a plain
    // USD-target payout) — the exotic box must not render at all.
    await waitFor(() =>
      expect(
        screen.queryByTestId("exchange-exotic-payout"),
      ).not.toBeInTheDocument(),
    );
  });
});
