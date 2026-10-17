/** @jest-environment jsdom */

/**
 * LIRA-331 (rule 28d) — the Dashboard's money modals send the SAME payload in
 * English and in Arabic. Translation must only change what the cashier reads,
 * never a value that reaches the server (drawer names, currency codes,
 * amounts, notes).
 *
 * Every mode / sub-type is walked through the REAL modal:
 *  - Drawer Top-Up, External (Cash In): USD + LBP + a configured extra
 *    currency (EUR, no override) + a feed-only one (GBP, with the "edit"
 *    override); and a bare LBP top-up with no notes.
 *  - Drawer Top-Up, From Drawer: a primary cash drawer source (OMT_System →
 *    transferBetweenDrawers) and a non-primary one (PettyCash →
 *    createFromDrawer).
 *  - Drawer Top-Up, Transfer: General → primary, primary → General, and
 *    the negative-balance "Cover it" prefill.
 *  - Drawer Cash-Out: USD + LBP + an extra currency (EUR) + reason.
 *
 * Not failing-first (guard against future drift): it passed before the
 * module was converted.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { i18n } from "@/i18n/setup";

import { DrawerTopUpModal } from "../DrawerTopUpModal";
import { DrawerCashoutModal } from "../DrawerCashoutModal";

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
      data-testid="mock-select"
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

const mockCreate = jest.fn();
const mockCreateFromDrawer = jest.fn();
const mockGetSourceDrawers = jest.fn();
const mockTransferBetweenDrawers = jest.fn();
const mockCashoutCreate = jest.fn();

// Module scope: one stable reference for every render (rule 25).
const mockApi = {
  drawerTopUp: {
    getSourceDrawers: mockGetSourceDrawers,
    create: mockCreate,
    createFromDrawer: mockCreateFromDrawer,
  },
  drawerCashout: { create: mockCashoutCreate },
  getSystemExpectedBalancesDynamic: jest
    .fn()
    .mockResolvedValue({
      General: { USD: 500, LBP: 9_000_000 },
      OMT_System: { USD: 300, LBP: 4_000_000 },
    }),
  transferBetweenDrawers: mockTransferBetweenDrawers,
  // EUR has a configured exchange_rates row; GBP is feed-only (below).
  getRates: jest.fn().mockResolvedValue([
    {
      to_code: "EUR",
      market_rate: 1.16,
      buy_rate: 1.1601,
      sell_rate: 1.17,
      is_stronger: -1,
    },
  ]),
};

const mockCurrencyContext = {
  activeCurrencies: [
    { id: 1, code: "USD", name: "US Dollar", symbol: "$", decimal_places: 2, is_active: 1 },
    { id: 2, code: "LBP", name: "Lebanese Pound", symbol: "LBP", decimal_places: 0, is_active: 1 },
    { id: 3, code: "EUR", name: "Euro", symbol: "€", decimal_places: 2, is_active: 1 },
  ],
  getCurrenciesForDrawer: jest.fn().mockResolvedValue([]),
  getDecimals: () => 2,
};

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => mockCurrencyContext,
}));

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
  getCurrencySymbol: (code: string) => code,
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({ baseSystem: "OMT" }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: jest.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Captured = { call: string; payload: unknown };

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function submitTopUp() {
  fireEvent.click(screen.getByTestId("drawer-topup-submit"));
}

function renderTopUp() {
  render(<DrawerTopUpModal isOpen onClose={jest.fn()} onSuccess={jest.fn()} />);
}

async function clickAddCurrency(expectedRows: number) {
  const btn = screen.getByTestId("drawer-topup-add-currency");
  await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(btn);
  await waitFor(() =>
    expect(screen.getAllByTestId("mock-select")).toHaveLength(expectedRows),
  );
}

async function runScenarios(): Promise<Captured[]> {
  const out: Captured[] = [];
  const take = (call: string, fn: jest.Mock) => {
    expect(fn).toHaveBeenCalledTimes(1);
    out.push({ call, payload: fn.mock.calls[0][0] });
    fn.mockClear();
  };

  // 1. External: USD + LBP + EUR (configured) + GBP (feed-only, override).
  renderTopUp();
  type("drawer-topup-amount-usd-input", "100");
  type("drawer-topup-amount-lbp-input", "900000");
  await clickAddCurrency(1);
  fireEvent.change(screen.getAllByTestId("mock-select")[0], {
    target: { value: "EUR" },
  });
  await screen.findByTestId("drawer-topup-basis-line-0");
  type("drawer-topup-currency-amount-0", "50");
  await clickAddCurrency(2);
  fireEvent.change(screen.getAllByTestId("mock-select")[1], {
    target: { value: "GBP" },
  });
  await screen.findByTestId("drawer-topup-basis-line-1");
  type("drawer-topup-currency-amount-1", "40");
  fireEvent.click(screen.getByTestId("drawer-topup-basis-edit-1"));
  type("drawer-topup-acquisition-rate-1", "1.5");
  type("drawer-topup-notes-input", "cash from owner");
  submitTopUp();
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  take("drawerTopUp.create", mockCreate);
  cleanup();

  // 2. External: LBP only, no notes.
  renderTopUp();
  type("drawer-topup-amount-lbp-input", "250000");
  submitTopUp();
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  take("drawerTopUp.create", mockCreate);
  cleanup();

  // 3 + 4. From Drawer: primary source, then a non-primary one.
  for (const [drawer, call, fn] of [
    ["OMT_System", "transferBetweenDrawers", mockTransferBetweenDrawers],
    ["PettyCash", "drawerTopUp.createFromDrawer", mockCreateFromDrawer],
  ] as const) {
    mockGetSourceDrawers.mockResolvedValue({
      success: true,
      data: [{ drawer_name: drawer, balance_usd: 500, balance_lbp: 1000 }],
    });
    renderTopUp();
    fireEvent.click(screen.getByTestId("drawer-from-drawer-mode-toggle"));
    await waitFor(() =>
      expect(
        (screen.getByTestId("mock-select") as HTMLSelectElement).value,
      ).toBe(drawer),
    );
    type("drawer-topup-amount-usd-input", "20");
    type("drawer-topup-amount-lbp-input", "1000");
    type("drawer-topup-notes-input", "move it");
    submitTopUp();
    await waitFor(() => expect(fn).toHaveBeenCalled());
    take(call, fn);
    cleanup();
  }

  // 5 + 6. Transfer: General → primary, then primary → General.
  for (const directionIndex of [0, 1]) {
    renderTopUp();
    fireEvent.click(screen.getByTestId("drawer-transfer-mode-toggle"));
    const toggle = await screen.findByTestId(
      "drawer-transfer-direction-toggle",
    );
    fireEvent.click(toggle.querySelectorAll("button")[directionIndex]);
    type("drawer-transfer-amount-usd-input", "10");
    type("drawer-transfer-amount-lbp-input", "5000");
    type("drawer-transfer-notes-input", "float");
    submitTopUp();
    await waitFor(() => expect(mockTransferBetweenDrawers).toHaveBeenCalled());
    take("transferBetweenDrawers", mockTransferBetweenDrawers);
    cleanup();
  }

  // 7. Transfer via the negative-balance "Cover it" prefill (OMT_System is
  //    in the red in LBP): direction and amount come from the panel.
  mockApi.getSystemExpectedBalancesDynamic.mockResolvedValueOnce({
    General: { USD: 500, LBP: 9_000_000 },
    OMT_System: { USD: 300, LBP: -750_000 },
  });
  renderTopUp();
  fireEvent.click(screen.getByTestId("drawer-transfer-mode-toggle"));
  const panel = await screen.findByTestId("drawer-negative-balance-panel");
  fireEvent.click(panel.querySelector("button")!);
  submitTopUp();
  await waitFor(() => expect(mockTransferBetweenDrawers).toHaveBeenCalled());
  take("transferBetweenDrawers", mockTransferBetweenDrawers);
  cleanup();

  // 8. Cash-Out: USD + LBP + EUR + reason.
  render(
    <DrawerCashoutModal isOpen onClose={jest.fn()} onSuccess={jest.fn()} />,
  );
  type("drawer-cashout-amount-usd-input", "30");
  type("drawer-cashout-amount-lbp-input", "100000");
  fireEvent.change(screen.getByTestId("drawer-cashout-add-currency"), {
    target: { value: "EUR" },
  });
  type("drawer-cashout-extra-amount-0", "12");
  type("drawer-cashout-notes-input", "wrong top-up");
  fireEvent.click(screen.getByTestId("drawer-cashout-submit"));
  await waitFor(() => expect(mockCashoutCreate).toHaveBeenCalled());
  take("drawerCashout.create", mockCashoutCreate);
  cleanup();

  return out;
}

// ─── Test ─────────────────────────────────────────────────────────────────────

describe("Dashboard money modals — payload is language-independent", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ success: true });
    mockCreateFromDrawer.mockResolvedValue({ success: true });
    mockTransferBetweenDrawers.mockResolvedValue({ success: true });
    mockCashoutCreate.mockResolvedValue({ success: true });
    alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(async () => {
    alertSpy.mockRestore();
    await i18n.changeLanguage("en");
  });

  it("every top-up / transfer / cash-out mode sends the same payload in en and ar", async () => {
    const en = await runScenarios();
    expect(en).toHaveLength(8);
    expect(alertSpy).not.toHaveBeenCalled();

    const { loadLanguage } = await import("@/i18n/setup");
    await loadLanguage("ar");
    await i18n.changeLanguage("ar");
    expect(i18n.t("dashboard:page.title")).toBe("لوحة التحكم");

    const ar = await runScenarios();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(ar).toEqual(en);

    // Sanity: the captured payloads are the real ones, not empty shells.
    expect(en[0]).toEqual({
      call: "drawerTopUp.create",
      payload: {
        amount_usd: 100,
        amount_lbp: 900000,
        notes: "cash from owner",
        extra_currencies: [
          { currency_code: "EUR", amount: 50 },
          {
            currency_code: "GBP",
            amount: 40,
            acquisition_usd_per_unit: 1.5,
            market_usd_per_unit_hint: 1.27,
          },
        ],
      },
    });
    expect(en[2]).toEqual({
      call: "transferBetweenDrawers",
      payload: {
        fromDrawer: "OMT_System",
        toDrawer: "General",
        amount_usd: 20,
        amount_lbp: 1000,
        notes: "move it",
      },
    });
    expect(en[5].payload).toMatchObject({
      fromDrawer: "OMT_System",
      toDrawer: "General",
    });
    expect(en[4].payload).toMatchObject({
      fromDrawer: "General",
      toDrawer: "OMT_System",
    });
    expect(en[6]).toEqual({
      call: "transferBetweenDrawers",
      payload: {
        fromDrawer: "General",
        toDrawer: "OMT_System",
        amount_usd: 0,
        amount_lbp: 750000,
      },
    });
  });
});
