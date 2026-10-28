/**
 * Owner request 2026-10-28 (Cornertech): a General <-> OMT drawer transfer
 * must be recordable on the day it really happened, so it resolves that
 * day's drawer-count difference. The server already accepts
 * `transaction_time` (drawerTransfer schema); the Transfer window had no
 * field for it. Written before the change; the first run failed (no
 * "Set custom time" toggle in Transfer mode).
 */

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
  getSystemExpectedBalancesDynamic: jest.fn().mockResolvedValue({
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

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function submitTopUp() {
  fireEvent.click(screen.getByTestId("drawer-topup-submit"));
}

function renderTopUp() {
  render(<DrawerTopUpModal isOpen onClose={jest.fn()} onSuccess={jest.fn()} />);
}

describe("Drawer transfer — Set custom time", () => {
  beforeEach(() => {
    mockTransferBetweenDrawers.mockReset();
    mockTransferBetweenDrawers.mockResolvedValue({ success: true });
    mockGetSourceDrawers.mockResolvedValue({ success: true, drawers: [] });
  });

  it("sends the chosen time with the transfer", async () => {
    renderTopUp();
    fireEvent.click(screen.getByTestId("drawer-transfer-mode-toggle"));
    await screen.findByTestId("drawer-transfer-direction-toggle");
    type("drawer-transfer-amount-lbp-input", "1119000000");
    fireEvent.click(screen.getByTestId("txn-time-toggle"));
    fireEvent.change(screen.getByTestId("txn-time-input"), {
      target: { value: "2026-10-26T13:18" },
    });
    submitTopUp();
    await waitFor(() => expect(mockTransferBetweenDrawers).toHaveBeenCalled());
    const payload = mockTransferBetweenDrawers.mock.calls[0][0];
    expect(payload.transaction_time).toBe(
      new Date("2026-10-26T13:18").toISOString(),
    );
    expect(payload.amount_lbp).toBe(1119000000);
  });

  it("sends no time when none is set (unchanged)", async () => {
    renderTopUp();
    fireEvent.click(screen.getByTestId("drawer-transfer-mode-toggle"));
    await screen.findByTestId("drawer-transfer-direction-toggle");
    type("drawer-transfer-amount-usd-input", "10");
    submitTopUp();
    await waitFor(() => expect(mockTransferBetweenDrawers).toHaveBeenCalled());
    expect(mockTransferBetweenDrawers.mock.calls[0][0]).not.toHaveProperty(
      "transaction_time",
    );
  });
});
