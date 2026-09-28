/** @jest-environment jsdom */

/**
 * LIRA-103 — the history tab and the drawer-balance readout must go through
 * the dual-mode adapter (`useApi()`), not a raw `window.api.recharge.*` call.
 *
 * Two gaps closed by this ticket, both in Recharge/index.tsx:
 *  1. `loadRechargeHistory` (history tab, MTC/Alfa) called
 *     `window.api.recharge.getHistory(provider)` directly — no REST route
 *     backed it at all, so in a real browser it threw before
 *     `setRechargeHistory` ever ran (caught, silently empty history).
 *  2. `loadDrawerBalances` called `window.api.recharge.getDrawerBalances()`
 *     directly behind a `!window.api?.recharge` guard — even though the
 *     dual-mode twin `api.getRechargeDrawerBalances()` already existed and
 *     was already used elsewhere in this same file (`handleTopUpClick`).
 *
 * This test proves BOTH call sites now reach `useApi()`'s
 * `getRechargeHistory` / `getRechargeDrawerBalances` — never `window.api`.
 * `window.api` is deliberately left UNDEFINED here (unlike
 * Recharge.telecomTenderRate.test.tsx, which sets it up for the OTHER
 * window.api.recharge.* calls this ticket does not touch): if either call
 * site under test regressed back to `window.api.recharge.*`, it would throw
 * (window.api is undefined) instead of reaching the mock, and the
 * `toHaveBeenCalledWith` assertions below would fail — which is exactly what
 * happens if you revert the two Recharge/index.tsx call-site edits (rule 17;
 * verified failing pre-fix, see commit message).
 *
 * LIRA-250 FOLLOW-UP (this revision): the mount/provider-switch effect used
 * to ALSO call `loadRechargeHistory()` for a "telecom" provider (MTC/Alfa),
 * so the "History tab" test below used to see an automatic
 * `getRechargeHistory("MTC")` call on mount, before the button was ever
 * clicked. That automatic call fed the Count/Profit cards from
 * `rechargeHistory` — a source LIRA-250's follow-up fix replaced with a real
 * server-side read (`api.getRechargeTodayStats`, `RechargeRepository
 * .getTodayStats`), so the mount effect no longer needs `rechargeHistory`
 * warm at all. `getRechargeHistory` is now ONLY ever called on demand, by
 * the History button — updated below.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MobileRecharge from "../index";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetClients = jest.fn().mockResolvedValue([]);
const mockProcessRecharge = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetPrimaryCarrierLine = jest
  .fn()
  .mockResolvedValue({ success: true, data: null });

// The two call sites under test — routed through useApi(), NEVER window.api.
const mockGetRechargeHistory = jest.fn().mockResolvedValue([
  {
    id: 7,
    carrier: "MTC",
    recharge_type: "CREDIT_TRANSFER",
    amount: 5,
    cost: 4,
    price: 5,
    default_price_to_client: null,
    currency_code: "USD",
    paid_by: "CASH",
    phone_number: "03000091",
    client_id: null,
    client_name: null,
    note: null,
    created_at: "2026-08-08T00:00:00.000Z",
    created_by: 1,
    edited_by: null,
    edited_at: null,
  },
]);
const mockGetRechargeDrawerBalances = jest.fn().mockResolvedValue([
  { name: "MTC", usdBalance: 100, lbpBalance: 0, usdtBalance: 0 },
  { name: "General", usdBalance: 500, lbpBalance: 0, usdtBalance: 0 },
]);

// A STABLE object (module-level, not a fresh literal per call) — mirrors the
// real ApiProvider, whose context value is one adapter instance created once
// at app root. A fresh-object-per-call mock would give every `useCallback`
// depending on `api` a new identity on every render, re-firing its
// mount-effect on every render and breaking the call-count assertions below
// for reasons that have nothing to do with the code under test.
const mockApi = {
  getAllSettings: mockGetAllSettings,
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: mockGetOMTAnalytics,
  getClients: mockGetClients,
  processRecharge: mockProcessRecharge,
  addOMTTransaction: jest.fn().mockResolvedValue({ success: true }),
  getPrimaryCarrierLine: mockGetPrimaryCarrierLine,
  // Owner note #21 (migration v182): the page's own shop-line detection now
  // fetches every active line, not just the primary one — mocked here too
  // so that (caught, harmless) fetch doesn't log noise on mount.
  getActiveCarrierLines: jest.fn().mockResolvedValue([]),
  getRechargeHistory: mockGetRechargeHistory,
  getRechargeDrawerBalances: mockGetRechargeDrawerBalances,
  // LIRA-250 follow-up: the mount/provider-switch effect now calls this
  // instead of getRechargeHistory for a telecom provider — mocked so that
  // (caught, harmless) call resolves cleanly rather than logging noise.
  getRechargeTodayStats: jest.fn().mockResolvedValue({
    count: 0,
    profit_usd: 0,
    profit_lbp: 0,
    byCurrency: [],
  }),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

// Deliberately NO window.api here (contrast with
// Recharge.telecomTenderRate.test.tsx) — proves neither call site under test
// falls back to window.api.recharge.*.

jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatchForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: () => null,
  CryptoForm: () => null,
  ProviderTabs: () => null,
  TelecomForm: () => <div data-testid="stub-telecom-form" />,
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 91000, buyRate: 90000 }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    formatAmount: (v: number, c: string) => `${v} ${c}`,
  }),
}));

jest.mock("../../../hooks/useMobileServiceItems", () => ({
  useMobileServiceItems: () => ({
    getCategoriesForProvider: () => [],
    getItems: () => [],
    refresh: jest.fn(),
  }),
  formatCatalogItemName: (item: { label: string }) => item.label,
}));

jest.mock("../../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: null }),
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

async function renderPage() {
  render(<MobileRecharge />);
  await waitFor(() => expect(mockGetAllSettings).toHaveBeenCalled());
  await screen.findByTestId("stub-telecom-form");
}

describe("Recharge page — history tab + drawer-balance readout go through useApi() (LIRA-103)", () => {
  beforeEach(() => {
    mockGetRechargeHistory.mockClear();
    mockGetRechargeDrawerBalances.mockClear();
  });

  it("drawer-balance readout: loads via api.getRechargeDrawerBalances() on mount, not window.api", async () => {
    await renderPage();

    await waitFor(() =>
      expect(mockGetRechargeDrawerBalances).toHaveBeenCalledTimes(1),
    );
    expect(mockGetRechargeDrawerBalances).toHaveBeenCalledWith();
  });

  it("history tab: the History button loads via api.getRechargeHistory(provider), not window.api", async () => {
    await renderPage();

    // LIRA-250 follow-up: the mount/provider-switch effect no longer calls
    // loadRechargeHistory() for a "telecom" formMode provider (MTC/Alfa) —
    // the Count/Profit cards now read a dedicated server-side stats read
    // (api.getRechargeTodayStats) instead, so rechargeHistory has no reason
    // to be warmed eagerly any more. getRechargeHistory must therefore stay
    // uncalled until the operator actually opens History.
    expect(mockGetRechargeHistory).not.toHaveBeenCalled();

    // Default provider is MTC (first PROVIDER_CONFIGS entry, formMode
    // "telecom"), so the page-level History button is already visible.
    // This LIRA-103 test's real assertion (never window.api) still holds:
    // the click's call resolves through the mock, never throwing on an
    // undefined window.api.
    fireEvent.click(screen.getByText("History"));

    await waitFor(() =>
      expect(mockGetRechargeHistory).toHaveBeenCalledWith("MTC"),
    );
  });
});
