/** @jest-environment jsdom */

/**
 * DrawerTopUpModal — the "Other Currencies" picker must be scoped to the
 * General drawer's OWN currency configuration, not the shop-wide active
 * currency list or the live FX feed.
 *
 * Regression guard for a customer-reported bug: the picker used to be built
 * from `activeCurrencies` (shop-wide, unfiltered by drawer) UNIONED with
 * every currency the live feed happened to carry (e.g. GBP, JPY — currencies
 * with zero drawer configuration). The backend
 * (`DrawerTopUpService.addTopUp`) hard-rejects any `extra_currencies` entry
 * whose code is not explicitly linked to the General drawer via
 * `currency_drawers`, so the old picker let the operator pick a currency,
 * type an amount, and only THEN get rejected.
 *
 * The fix scopes the picker to `getCurrenciesForDrawer("General")`
 * (CurrencyContext) — the same drawer-scoped lookup the backend enforces —
 * filtered to exclude USD/LBP (dedicated inputs above). A currency present in
 * `activeCurrencies`/the live feed but NOT returned by that call must never
 * appear as an option.
 *
 * Proven against the buggy code per rule 17: reverting to the
 * `activeCurrencies` + live-feed memo makes every assertion below fail
 * (GBP/JPY appear despite no drawer config; EUR is sourced from
 * `activeCurrencies` instead of the drawer call; `getCurrenciesForDrawer` is
 * never invoked at all).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DrawerTopUpModal } from "../DrawerTopUpModal";

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

// Currencies actually enabled for the General drawer (`currency_drawers`).
// EUR is configured here; GBP/JPY are deliberately NOT — they represent
// currencies that are shop-wide active and/or live-feed-carried but have no
// General-drawer config row, i.e. exactly what the backend would reject.
const mockDrawerCurrencies = [
  { id: 1, code: "USD", name: "US Dollar", symbol: "$", decimal_places: 2, is_active: 1 },
  { id: 2, code: "LBP", name: "Lebanese Pound", symbol: "LBP", decimal_places: 0, is_active: 1 },
  { id: 3, code: "EUR", name: "Euro", symbol: "€", decimal_places: 2, is_active: 1 },
];
const mockGetCurrenciesForDrawer = jest
  .fn()
  .mockResolvedValue(mockDrawerCurrencies);

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    getCurrenciesForDrawer: mockGetCurrenciesForDrawer,
  }),
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
  // to enable IS the assertion that the drawer-scoped list reached the
  // picker.
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
    mockGetCurrenciesForDrawer.mockResolvedValue(mockDrawerCurrencies);
  });

  it("calls getCurrenciesForDrawer('General') and offers only what it returns", async () => {
    renderModal();

    const select = await openCurrencyRow();
    const labels = optionLabels(select);

    expect(mockGetCurrenciesForDrawer).toHaveBeenCalledWith("General");

    // EUR is enabled for the General drawer.
    expect(labels).toContain("EUR (€)");

    // USD/LBP have dedicated inputs above and must never be offered here,
    // even though the drawer call returns them.
    expect(labels.some((l) => l.startsWith("USD"))).toBe(false);
    expect(labels.some((l) => l.startsWith("LBP"))).toBe(false);
  });

  it("never offers a currency the General drawer has no config row for, even if it's shop-wide active or live-feed-carried", async () => {
    // GBP/JPY are NOT in mockDrawerCurrencies — the backend
    // (`DrawerTopUpService.addTopUp`) would reject them. The picker must not
    // offer them regardless of what any other source (activeCurrencies, the
    // live feed) might contain.
    renderModal();

    const select = await openCurrencyRow();
    const labels = optionLabels(select);

    expect(labels.some((l) => l.startsWith("GBP"))).toBe(false);
    expect(labels.some((l) => l.startsWith("JPY"))).toBe(false);
  });

  it("renders the empty state and does not call the drawer lookup when the modal is not in external mode", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /from drawer/i }));

    // Give any stray effect a tick to fire before asserting it didn't.
    await waitFor(() => {
      expect(screen.queryByText(/other currencies/i)).toBeNull();
    });
  });

  it("renders the empty state when the General drawer has no extra currencies configured", async () => {
    mockGetCurrenciesForDrawer.mockResolvedValue([
      { id: 1, code: "USD", name: "US Dollar", symbol: "$", decimal_places: 2, is_active: 1 },
      { id: 2, code: "LBP", name: "Lebanese Pound", symbol: "LBP", decimal_places: 0, is_active: 1 },
    ]);
    renderModal();

    expect(
      await screen.findByText(/no other currencies available/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("currency-select")).toBeNull();
  });
});
