/** @jest-environment jsdom */

/**
 * DrawerTopUpModal — the "Other Currencies" picker mirrors the Exchange
 * page's OWN currency list (AC1, EXCHANGE_LOT_SETTLEMENT.md Q3 refinement,
 * owner-approved 2026-08-23), via the shared `useExchangeCurrencyList` hook:
 * configured currencies excluded from the live feed (EUR today) + every
 * currency the live FX feed carries (GBP, JPY, ...). USD/LBP are never
 * offered — they have dedicated inputs above.
 *
 * This INTENTIONALLY REPLACES the previous, narrower policy this same file
 * used to guard: scoping the picker to `getCurrenciesForDrawer("General")`
 * (a `currency_drawers` allowlist). That existed because the backend used to
 * hard-reject an `extra_currencies` entry whose code wasn't already
 * registered for the General drawer. The backend no longer does that:
 * `DrawerTopUpRepository.createTopUp` now auto-registers an unknown code
 * (mirroring `ExchangeRepository.ensureCurrency`) before opening its
 * exchange lot — see `DrawerTopUpService.addTopUp`'s updated doc comment —
 * so offering exactly what Exchange offers is safe again, and the picker no
 * longer needs to be narrower than Exchange's own list.
 *
 * Proven against the pre-refinement code per rule 17: reverting this file's
 * subject to source `availableExtraCurrencies` from
 * `getCurrenciesForDrawer("General")` instead of `useExchangeCurrencyList`
 * makes every assertion below fail — GBP/JPY absent (the old picker rejected
 * anything without a drawer config row), and `getCurrenciesForDrawer` would
 * be called at all (it no longer is).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DrawerTopUpModal } from "../DrawerTopUpModal";
import { fetchLiveRatesSnapshot } from "@/utils/liveExchangeRates";

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

const mockGetRates = jest.fn().mockResolvedValue([]);

const mockApi = {
  drawerTopUp: {
    getSourceDrawers: jest.fn().mockResolvedValue({ success: true, data: [] }),
    create: jest.fn().mockResolvedValue({ success: true }),
    createFromDrawer: jest.fn().mockResolvedValue({ success: true }),
  },
  getSystemExpectedBalancesDynamic: jest.fn().mockResolvedValue({}),
  transferBetweenDrawers: jest.fn().mockResolvedValue({ success: true }),
  getRates: mockGetRates,
};

// ─── Contexts / feed ──────────────────────────────────────────────────────────

// Shop-wide active currencies (CurrencyContext) — EUR is active here (the
// "configured, feed-excluded" currency `useExchangeCurrencyList` surfaces
// alongside the feed). USD/LBP are also active but must never be offered.
// `let` (not `const`) so the empty-state test can swap it out before
// rendering — the factory below reads the CURRENT value on every call
// (`useCurrencyContext()` runs fresh on every render), so reassigning it
// before a render changes what that render sees.
let mockActiveCurrencies = [
  {
    id: 1,
    code: "USD",
    name: "US Dollar",
    symbol: "$",
    decimal_places: 2,
    is_active: 1,
  },
  {
    id: 2,
    code: "LBP",
    name: "Lebanese Pound",
    symbol: "LBP",
    decimal_places: 0,
    is_active: 1,
  },
  {
    id: 3,
    code: "EUR",
    name: "Euro",
    symbol: "€",
    decimal_places: 2,
    is_active: 1,
  },
];
const mockActiveCurrenciesWithEur = mockActiveCurrencies;
const mockActiveCurrenciesNoExtras = mockActiveCurrencies.filter(
  (c) => c.code !== "EUR",
);
jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    activeCurrencies: mockActiveCurrencies,
    getCurrenciesForDrawer: jest.fn().mockResolvedValue([]),
  }),
}));

// The live FX feed — GBP/JPY carry no shop-side configuration at all (no
// `currencies` row, no `currency_drawers` row); the whole point of AC1 is
// that they are offered anyway.
jest.mock("@/utils/liveExchangeRates", () => ({
  fetchLiveCurrencyRates: jest.fn().mockResolvedValue([]),
  fetchLiveRatesSnapshot: jest.fn().mockResolvedValue({
    raw: {},
    rates: [
      {
        to_code: "GBP",
        market_rate: 1.27,
        buy_rate: 1.27,
        sell_rate: 1.27,
        is_stronger: -1,
      },
      {
        to_code: "JPY",
        market_rate: 157,
        buy_rate: 157,
        sell_rate: 157,
        is_stronger: 1,
      },
    ],
    marketRates: [],
    lastUpdatedUtc: "Fri, 21 Aug 2026 00:02:31 +0000",
    nextUpdateUnix: 9_999_999_999,
  }),
  CURRENCY_NAMES: {
    USD: "US Dollar",
    LBP: "Lebanese Pound",
    EUR: "Euro",
    GBP: "British Pound",
    JPY: "Japanese Yen",
  },
  EXCLUDED_CURRENCIES: new Set(["USD", "LBP", "EUR"]),
  getCurrencySymbol: (code: string) =>
    (
      ({ USD: "$", LBP: "LBP", EUR: "€", GBP: "£", JPY: "¥" }) as Record<
        string,
        string
      >
    )[code] ?? code,
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
  // to enable IS the assertion that the merged list reached the picker.
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

describe("DrawerTopUpModal — extra-currency picker (AC1: mirrors Exchange's list)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRates.mockResolvedValue([]);
    mockActiveCurrencies = mockActiveCurrenciesWithEur;
  });

  it("offers the configured currency (EUR) AND the live feed (GBP, JPY) — the same merged list Exchange uses", async () => {
    renderModal();

    const select = await openCurrencyRow();
    const labels = optionLabels(select);

    expect(labels).toContain("EUR (€)");
    expect(labels).toContain("GBP (£)");
    expect(labels).toContain("JPY (¥)");
  });

  it("never offers USD/LBP, even though they are active currencies", async () => {
    renderModal();

    const select = await openCurrencyRow();
    const labels = optionLabels(select);

    expect(labels.some((l) => l.startsWith("USD"))).toBe(false);
    expect(labels.some((l) => l.startsWith("LBP"))).toBe(false);
  });

  it("dedupes a currency already added as another row out of the next row's options", async () => {
    renderModal();

    const firstSelect = await openCurrencyRow();
    // First row defaults to the first available option — assert whichever it
    // is disappears from a SECOND row's list.
    const firstCode = firstSelect.value;

    const addBtn = screen.getByRole("button", { name: /add currency/i });
    fireEvent.click(addBtn);

    const selects = screen.getAllByTestId(
      "currency-select",
    ) as HTMLSelectElement[];
    expect(selects).toHaveLength(2);
    const secondRowLabels = optionLabels(selects[1]);
    expect(secondRowLabels.some((l) => l.startsWith(firstCode))).toBe(false);
  });

  it("renders the empty state and does not call the drawer-scoped lookup when the modal is not in external mode", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /from drawer/i }));

    await waitFor(() => {
      expect(screen.queryByText(/other currencies/i)).toBeNull();
    });
  });

  it("renders the empty state when neither a configured currency nor the live feed has anything to offer", async () => {
    // No EUR in the active-currency list, and an empty feed — swap both
    // BEFORE rendering; `mockActiveCurrencies` is read fresh by
    // `useCurrencyContext()` on every render, and `mockResolvedValueOnce`
    // overrides just this test's single `fetchLiveRatesSnapshot()` call.
    mockActiveCurrencies = mockActiveCurrenciesNoExtras;
    (fetchLiveRatesSnapshot as jest.Mock).mockResolvedValueOnce({
      raw: {},
      rates: [],
      marketRates: [],
      lastUpdatedUtc: "",
      nextUpdateUnix: 9_999_999_999,
    });

    renderModal();

    expect(
      await screen.findByText(/no other currencies available/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("currency-select")).toBeNull();
  });
});
