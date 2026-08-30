/** @jest-environment jsdom */

/**
 * DrawerTopUpModal — hands-free cost basis (AC2, EXCHANGE_LOT_SETTLEMENT.md
 * Q3 refinement, owner-approved 2026-08-23: "market rate by default").
 *
 * The always-visible "Acquisition rate" input is gone. In its place: a quiet
 * "Cost basis: market rate ..." line (computed the same way the server will
 * — `marketRateToUsdPerUnit` over either a configured `exchange_rates` row
 * or the live feed) plus an "edit" link that reveals the manual-override
 * input on demand. Per row, on submit:
 *  - `acquisition_usd_per_unit` is sent ONLY when the operator opened the
 *    edit link and typed a value.
 *  - `market_usd_per_unit_hint` is auto-attached ONLY for a currency with no
 *    configured `exchange_rates` row (feed-only) — EUR has one here, GBP
 *    does not.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DrawerTopUpModal } from "../DrawerTopUpModal";

// ─── @liratek/ui ──────────────────────────────────────────────────────────────

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
    "data-testid": testId,
  }: {
    value: number;
    onChange: (n: number) => void;
    "data-testid"?: string;
  }) => (
    <input
      type="text"
      data-testid={testId}
      value={value === 0 ? "" : String(value)}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
    />
  ),
}));

const mockCreate = jest.fn().mockResolvedValue({ success: true });
// EUR has a configured `exchange_rates` row (market_rate 1.16, is_stronger
// -1 => already USD-per-unit, so marketRateToUsdPerUnit returns 1.16
// unchanged). GBP deliberately has none — it only exists in the feed below.
const mockGetRates = jest.fn().mockResolvedValue([
  {
    to_code: "EUR",
    market_rate: 1.16,
    buy_rate: 1.1601,
    sell_rate: 1.17,
    is_stronger: -1,
  },
]);

const mockApi = {
  drawerTopUp: {
    getSourceDrawers: jest.fn().mockResolvedValue({ success: true, data: [] }),
    create: mockCreate,
    createFromDrawer: jest.fn().mockResolvedValue({ success: true }),
  },
  getSystemExpectedBalancesDynamic: jest.fn().mockResolvedValue({}),
  transferBetweenDrawers: jest.fn().mockResolvedValue({ success: true }),
  getRates: mockGetRates,
};

// ─── Contexts / feed ──────────────────────────────────────────────────────────

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    activeCurrencies: [
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
    ],
    getCurrenciesForDrawer: jest.fn().mockResolvedValue([]),
  }),
}));

// GBP: feed-only — no configured exchange_rates row (mockGetRates above).
// market_rate 1.27 at is_stronger -1 is already USD-per-unit.
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
  },
  EXCLUDED_CURRENCIES: new Set(["USD", "LBP", "EUR"]),
  getCurrencySymbol: (code: string) =>
    (({ USD: "$", LBP: "LBP", EUR: "€", GBP: "£" }) as Record<string, string>)[
      code
    ] ?? code,
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({ baseSystem: "OMT" }),
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

/** Adds row 0 (defaults to the first option — EUR, since configured
 *  currencies sort before the feed) and returns its <select>. */
async function addFirstRow(): Promise<HTMLSelectElement> {
  const addBtn = await screen.findByRole("button", { name: /add currency/i });
  await waitFor(() =>
    expect((addBtn as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(addBtn);
  return (await screen.findByTestId("currency-select")) as HTMLSelectElement;
}

function selectCurrency(select: HTMLSelectElement, code: string) {
  fireEvent.change(select, { target: { value: code } });
}

function setAmount(index: number, value: string) {
  fireEvent.change(
    screen.getByTestId(`drawer-topup-currency-amount-${index}`),
    {
      target: { value },
    },
  );
}

function submit() {
  fireEvent.click(screen.getByTestId("drawer-topup-submit"));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DrawerTopUpModal — hands-free cost basis (AC2)", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ success: true });
    mockGetRates.mockResolvedValue([
      {
        to_code: "EUR",
        market_rate: 1.16,
        buy_rate: 1.1601,
        sell_rate: 1.17,
        is_stronger: -1,
      },
    ]);
    alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it("shows the market-rate basis line by default for a configured currency (EUR) — no rate input visible", async () => {
    renderModal();
    await addFirstRow();

    const basisLine = await screen.findByTestId("drawer-topup-basis-line-0");
    expect(basisLine.textContent).toMatch(
      /Cost basis: market rate 1\.16 USD\/EUR/,
    );
    expect(screen.queryByTestId("drawer-topup-acquisition-rate-0")).toBeNull();
  });

  it('clicking "edit" reveals the manual override input and hides the basis line', async () => {
    renderModal();
    await addFirstRow();
    await screen.findByTestId("drawer-topup-basis-line-0");

    fireEvent.click(screen.getByTestId("drawer-topup-basis-edit-0"));

    expect(
      await screen.findByTestId("drawer-topup-acquisition-rate-0"),
    ).toBeTruthy();
    expect(screen.queryByTestId("drawer-topup-basis-line-0")).toBeNull();
  });

  it("shows the feed rate as the basis line for a feed-only currency (GBP)", async () => {
    renderModal();
    const select = await addFirstRow();
    selectCurrency(select, "GBP");

    const basisLine = await screen.findByTestId("drawer-topup-basis-line-0");
    expect(basisLine.textContent).toMatch(
      /Cost basis: market rate 1\.27 USD\/GBP/,
    );
  });

  it("submitting a feed-only currency (GBP) without an override attaches market_usd_per_unit_hint, never acquisition_usd_per_unit", async () => {
    renderModal();
    const select = await addFirstRow();
    selectCurrency(select, "GBP");
    await screen.findByTestId("drawer-topup-basis-line-0");
    setAmount(0, "40");

    submit();

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const payload = mockCreate.mock.calls[0][0];
    expect(payload.extra_currencies).toEqual([
      { currency_code: "GBP", amount: 40, market_usd_per_unit_hint: 1.27 },
    ]);
  });

  it("submitting a configured currency (EUR) without opening edit sends neither field — the server uses its own configured rate", async () => {
    renderModal();
    await addFirstRow();
    await screen.findByTestId("drawer-topup-basis-line-0");
    setAmount(0, "100");

    submit();

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const payload = mockCreate.mock.calls[0][0];
    expect(payload.extra_currencies).toEqual([
      { currency_code: "EUR", amount: 100 },
    ]);
  });

  it("using the edit link to override a feed-only currency sends acquisition_usd_per_unit alongside the feed hint (override still wins server-side)", async () => {
    renderModal();
    const select = await addFirstRow();
    selectCurrency(select, "GBP");
    await screen.findByTestId("drawer-topup-basis-line-0");
    setAmount(0, "40");
    fireEvent.click(screen.getByTestId("drawer-topup-basis-edit-0"));
    fireEvent.change(
      await screen.findByTestId("drawer-topup-acquisition-rate-0"),
      { target: { value: "1.5" } },
    );

    submit();

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const payload = mockCreate.mock.calls[0][0];
    expect(payload.extra_currencies).toEqual([
      {
        currency_code: "GBP",
        amount: 40,
        acquisition_usd_per_unit: 1.5,
        market_usd_per_unit_hint: 1.27,
      },
    ]);
  });

  it("blocks submit with a friendly message when a currency has no configured rate, no feed rate, and no override", async () => {
    // EUR this time has NO configured exchange_rates row, and the feed never
    // carries EUR (EXCLUDED_CURRENCIES) — no basis exists anywhere.
    mockGetRates.mockResolvedValueOnce([]);

    renderModal();
    await addFirstRow();
    await waitFor(() =>
      expect(
        screen.getByTestId("drawer-topup-basis-line-0").textContent,
      ).toMatch(/No market rate found for EUR/),
    );
    setAmount(0, "100");

    submit();

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toMatch(
      /No market rate available for EUR/,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
