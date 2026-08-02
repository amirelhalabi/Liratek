/** @jest-environment jsdom */

/**
 * DrawerTopUpModal — the "Other Currencies" picker is built from the LIVE FEED.
 *
 * Regression guard for a bug that shipped once (fixed in a1e073b): the list was
 * loaded inside an effect keyed on `[isOpen]` that read `liveCurrencyRates` from
 * state, so it ran before the feed's promise resolved, saw the initial `[]`, and
 * never re-ran. The picker therefore only ever offered the shop's own configured
 * non-USD/LBP currencies — in practice EUR alone, and nothing at all when EUR
 * was not configured.
 *
 * To isolate exactly that, `activeCurrencies` here holds ONLY USD and LBP (both
 * of which the picker excludes, since they have dedicated inputs above). The
 * feed is therefore the sole possible source of options, so:
 *   - fixed  -> the feed's currencies are offered
 *   - buggy  -> zero options, and the empty-state copy renders instead
 *
 * Proven against the buggy code per rule 17: restoring the pre-fix modal
 * (a1e073b~1) fails all three cases. The first two are the real guards — they
 * fail because the feed's currencies are absent. The third fails only because
 * the pre-fix empty state used different copy, so it documents intended
 * behaviour rather than guarding the regression; it is labelled as such below.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DrawerTopUpModal } from "../DrawerTopUpModal";

// ─── Feed ─────────────────────────────────────────────────────────────────────

// AFN is deliberately a code with no symbol mapping: getCurrencySymbol falls
// back to the code itself, and the option label must stay "AFN" rather than
// degrading to "AFN (AFN)".
const mockFeedRates = [
  {
    to_code: "GBP",
    market_rate: 1.3,
    buy_rate: 1.3,
    sell_rate: 1.3,
    is_stronger: -1,
  },
  {
    to_code: "JPY",
    market_rate: 160,
    buy_rate: 160,
    sell_rate: 160,
    is_stronger: 1,
  },
  {
    to_code: "AFN",
    market_rate: 65,
    buy_rate: 65,
    sell_rate: 65,
    is_stronger: 1,
  },
];
const mockFetchLiveCurrencyRates = jest.fn();

jest.mock("@/utils/liveExchangeRates", () => ({
  fetchLiveCurrencyRates: () => mockFetchLiveCurrencyRates(),
  CURRENCY_NAMES: {
    GBP: "British Pound",
    JPY: "Japanese Yen",
    EUR: "Euro",
  },
  // Faithful to the real implementation: unknown codes fall back to the code.
  getCurrencySymbol: (code: string) =>
    ({ GBP: "£", JPY: "¥", EUR: "€" })[code] ?? code,
}));

// ─── @liratek/ui ──────────────────────────────────────────────────────────────

// Select is stubbed to a native <select> so the option list is directly
// assertable; DecimalInput to a plain text input.
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select
      data-testid="currency-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  DecimalInput: ({
    value,
    onChange,
  }: {
    value: number;
    onChange: (n: number) => void;
  }) => (
    <input
      type="text"
      value={value === 0 ? "" : String(value)}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
    />
  ),
}));

const mockApi = {
  drawerTopUp: {
    getSourceDrawers: jest.fn().mockResolvedValue({ success: true, data: [] }),
    create: jest.fn().mockResolvedValue({ success: true }),
    createFromDrawer: jest.fn().mockResolvedValue({ success: true }),
  },
  getSystemExpectedBalancesDynamic: jest.fn().mockResolvedValue({}),
  transferBetweenDrawers: jest.fn().mockResolvedValue({ success: true }),
};

// ─── Contexts ─────────────────────────────────────────────────────────────────

// Referentially STABLE across renders — a fresh object per call re-runs the
// component's memo/effect dependencies every render (the Exchange split-payout
// spec documents burning 18 minutes of CPU on exactly that mistake).
const mockCurrencyContext = {
  // USD/LBP only: both are excluded by the picker, so the feed is the sole
  // source of options and the assertions isolate the regression.
  activeCurrencies: [
    { code: "USD", name: "US Dollar", symbol: "$" },
    { code: "LBP", name: "Lebanese Pound", symbol: "LBP" },
  ],
};
jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => mockCurrencyContext,
}));

const mockShopBase = { baseSystem: "OMT" };
jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => mockShopBase,
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: jest.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderModal() {
  return render(
    <DrawerTopUpModal isOpen onClose={jest.fn()} onSuccess={jest.fn()} />,
  );
}

/** Add one extra-currency row and return its <select>. */
async function openCurrencyRow(): Promise<HTMLSelectElement> {
  const addBtn = await screen.findByRole("button", { name: /add currency/i });
  // The button is disabled while the option list is empty, so waiting for it
  // to enable IS the assertion that the feed reached the picker.
  await waitFor(() =>
    expect((addBtn as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(addBtn);
  return (await screen.findByTestId("currency-select")) as HTMLSelectElement;
}

function optionLabels(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => o.textContent ?? "");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DrawerTopUpModal — extra-currency picker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchLiveCurrencyRates.mockResolvedValue(mockFeedRates);
    // Reset the baseline: USD/LBP only, so the feed is the sole source of
    // options. One case below reassigns this, so it must be restored per test
    // rather than relying on declaration order.
    mockCurrencyContext.activeCurrencies = [
      { code: "USD", name: "US Dollar", symbol: "$" },
      { code: "LBP", name: "Lebanese Pound", symbol: "LBP" },
    ];
  });

  it("offers the live feed's currencies once the feed resolves", async () => {
    renderModal();

    const select = await openCurrencyRow();
    const labels = optionLabels(select);

    // The regression: with the effect+state version these were all absent.
    expect(labels).toContain("GBP (£)");
    expect(labels).toContain("JPY (¥)");

    // A code with no symbol mapping keeps its bare code — getCurrencySymbol's
    // fallback must not surface as "AFN (AFN)".
    expect(labels).toContain("AFN");
    expect(labels).not.toContain("AFN (AFN)");

    // USD/LBP have dedicated inputs above and must never be offered here.
    expect(labels.some((l) => l.startsWith("USD"))).toBe(false);
    expect(labels.some((l) => l.startsWith("LBP"))).toBe(false);
  });

  it("puts configured currencies first and never duplicates one the feed also carries", async () => {
    // EUR is configured AND present in the feed — the two halves of the list
    // must be deduped, and the shop's own entry is the one that wins (it
    // carries the real name/symbol from settings).
    mockCurrencyContext.activeCurrencies = [
      { code: "USD", name: "US Dollar", symbol: "$" },
      { code: "LBP", name: "Lebanese Pound", symbol: "LBP" },
      { code: "EUR", name: "Euro", symbol: "€" },
    ];
    mockFetchLiveCurrencyRates.mockResolvedValue([
      {
        to_code: "EUR",
        market_rate: 1.1,
        buy_rate: 1.1,
        sell_rate: 1.1,
        is_stronger: -1,
      },
      ...mockFeedRates,
    ]);

    renderModal();

    const select = await openCurrencyRow();
    const labels = optionLabels(select);

    // Exactly once, despite appearing on both sides.
    expect(labels.filter((l) => l.startsWith("EUR"))).toHaveLength(1);

    // Configured before feed-sourced. (Fails pre-fix for the right reason:
    // GBP was absent entirely, so it had no index to compare.)
    expect(labels.indexOf("EUR (€)")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("GBP (£)")).toBeGreaterThan(
      labels.indexOf("EUR (€)"),
    );
  });

  it("renders the empty state when the feed is unavailable", async () => {
    // A failed fetch is swallowed as non-critical. With no configured extras
    // either, there is genuinely nothing to offer — the one case where the
    // empty-state copy is correct and the add button stays disabled.
    //
    // NOTE: this documents intended behaviour; it is NOT the rule-17 guard
    // (the two cases above are). Pre-fix code also rendered an empty list
    // here, just under different copy.
    mockFetchLiveCurrencyRates.mockRejectedValue(new Error("offline"));
    renderModal();

    expect(
      await screen.findByText(/no other currencies available/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("currency-select")).toBeNull();
  });
});
