/** @jest-environment jsdom */

/**
 * Recharge page — LIRA-250 guard.
 *
 * Bug: on the MTC/Alfa ("telecom" formMode) tabs, the Count/Profit stat
 * cards always read 0, regardless of how many recharges succeed and
 * regardless of a reload. Root cause traced by reading the data flow (rule
 * 28 — not just inferred from the symptom):
 *
 *   - `getTelecomStats()` (Recharge/index.tsx) computes the cards from
 *     `finTransactions`, which is populated ONLY by `loadFinancialData()` ->
 *     `api.getOMTHistory(provider)` -> IPC `omt:get-history` ->
 *     `FinancialServiceRepository` -> the `financial_services` table (OMT
 *     App / Whish App / Binance transfers).
 *   - MTC/Alfa recharges are written to a COMPLETELY DIFFERENT table
 *     (`recharges`), read by `api.getRechargeHistory(provider)` -> IPC
 *     `recharge:get-history` -> `RechargeRepository.getHistory`, which
 *     lands in a SEPARATE piece of state (`rechargeHistory`) that
 *     `getTelecomStats()` never reads.
 *   - `rechargeHistory` itself is only ever loaded on demand (clicking the
 *     "History" button) — never on mount, never on a provider switch, and
 *     never after a successful recharge submit.
 *
 * So for MTC/Alfa the cards are wired to a table that can never contain a
 * recharge row, and even if it were the right table, nothing auto-refreshes
 * it. This is a wrong-data-source + missing-refresh bug, NOT the "today"/
 * timezone class of bug (ruled out per rule 28b: `getTelecomStats`'s own
 * date comparison — `new Date().toDateString()` vs `parseDbDate(tx.
 * created_at).toDateString()` — is entirely client-side, comparing the
 * browser's own clock to itself; the un-refreshed empty array is what
 * actually zeroes the cards). It needs no `packages/core` change — the
 * `recharges` table and its history endpoint already exist and are already
 * used elsewhere (the History modal); this page simply never wires them
 * into the stat cards.
 *
 * Harness copied from Recharge.telecomTenderRate.test.tsx (same page-level
 * stub set) — `CompactStats` is stubbed to CAPTURE its props (instead of
 * `() => null`) so the cards' actual values are observable.
 *
 * LIRA-250 FOLLOW-UP (this revision): the fix above shipped first and made
 * the cards non-zero, but it counted the WRONG rows — `rechargeHistory`
 * (`RechargeRepository.getHistory`, `LIMIT 100`, no type/refund filter) is
 * every recent row for the carrier, including refunded/voided sales, TOP_UP
 * drawer moves, and CREDIT_BUYBACK payouts, and its "commission" was
 * `price - cost`, not the transaction's actually-stamped profit. The cards
 * now read `api.getRechargeTodayStats(provider)` — a real server read
 * (`RechargeRepository.getTodayStats`) gated the SAME way the Profits page's
 * own recharge figures are (`t.type = 'RECHARGE'` only, `notRefunded`,
 * `notDebtPending`, `isToday`) — instead of deriving the cards from
 * `rechargeHistory` client-side. `loadRechargeHistory`/`rechargeHistory`
 * stay exactly as before for the on-demand History modal; this file's
 * assertions are updated to match the new source (mount/provider-switch no
 * longer eagerly calls `getRechargeHistory` at all — only the History button
 * does, unchanged — see Recharge.historyDrawerBalancesRest.test.tsx for that
 * assertion).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import MobileRecharge from "../index";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetClients = jest.fn().mockResolvedValue([]);
const mockGetDrawerBalances = jest.fn().mockResolvedValue([]);
const mockProcessRecharge = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetHistory = jest.fn().mockResolvedValue([]);

// The new read under test — `RechargeRepository.getTodayStats`'s shape
// (count/profit_usd/profit_lbp/byCurrency), as `api.getRechargeTodayStats`
// (backendApi.ts) returns it. USD-denominated so the page's `commission`
// scalar (profit_usd, the CompactStats fallback when byCurrency is empty)
// and the `byCurrency` entry agree — avoids the two needing separate
// fixtures for one sale.
const mockGetTodayStats = jest.fn().mockResolvedValue({
  count: 1,
  profit_usd: 50,
  profit_lbp: 0,
  byCurrency: [{ currency: "USD", commission: 50, count: 1 }],
});
const NO_TODAY_STATS = {
  count: 0,
  profit_usd: 0,
  profit_lbp: 0,
  byCurrency: [],
};

// `getRechargeHistory`/`getRechargeDrawerBalances`/`getRechargeTodayStats` go
// through the `api` object from `useApi()` (the dual-transport adapter — see
// `frontend/src/api/backendApi.ts`), NOT a raw `window.api.recharge.*` call —
// LIRA-103 removed that raw call. `Recharge.telecomTenderRate.test.tsx`'s
// `window.api.recharge = {...}` block predates that refactor and is dead
// weight there now; mocked directly on `useApi()` here instead, which is
// what `loadRechargeHistory`/`loadDrawerBalances`/`loadRechargeTodayStats`
// (Recharge/index.tsx) actually call.
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getAllSettings: mockGetAllSettings,
    getOMTHistory: mockGetOMTHistory,
    getOMTAnalytics: mockGetOMTAnalytics,
    getClients: mockGetClients,
    processRecharge: mockProcessRecharge,
    addOMTTransaction: jest.fn().mockResolvedValue({ success: true }),
    getRechargeHistory: mockGetHistory,
    getRechargeDrawerBalances: mockGetDrawerBalances,
    getRechargeTodayStats: mockGetTodayStats,
  }),
}));

const compactStatsPropsLog: Array<{
  todayCount: number | undefined;
  todayCommission: number | undefined;
  allProvidersCommission: number | undefined;
}> = [];

jest.mock("../../../components", () => ({
  CompactStats: (props: {
    todayCount?: number;
    todayCommission?: number;
    allProvidersCommission?: number;
  }) => {
    compactStatsPropsLog.push({
      todayCount: props.todayCount,
      todayCommission: props.todayCommission,
      allProvidersCommission: props.allProvidersCommission,
    });
    return (
      <div
        data-testid="stub-compact-stats"
        data-today-count={props.todayCount}
        data-today-commission={props.todayCommission}
        data-all-providers-commission={props.allProvidersCommission}
      />
    );
  },
  FinancialForm: () => null,
  KatshForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: () => null,
  CryptoForm: () => null,
  ProviderTabs: () => null,
  TelecomForm: ({
    setTelecomAmount,
    setTelecomPrice,
    setPaymentLines,
    handleTelecomSubmit,
  }: {
    setTelecomAmount: (v: string) => void;
    setTelecomPrice: (v: string) => void;
    setPaymentLines: (lines: PaymentLine[]) => void;
    handleTelecomSubmit: () => void;
  }) => (
    <div data-testid="stub-telecom-form">
      <button
        data-testid="telecom-fill"
        onClick={() => {
          setTelecomAmount("5");
          setTelecomPrice("450000");
          setPaymentLines([
            { id: "L1", method: "CASH", currencyCode: "LBP", amount: 450000 },
          ] as PaymentLine[]);
        }}
      />
      <button data-testid="telecom-submit" onClick={handleTelecomSubmit} />
    </div>
  ),
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

describe("Recharge page — MTC/Alfa Count/Profit cards (LIRA-250)", () => {
  beforeEach(() => {
    mockProcessRecharge.mockClear();
    mockGetHistory.mockClear();
    mockGetTodayStats.mockReset().mockResolvedValue({
      count: 1,
      profit_usd: 50,
      profit_lbp: 0,
      byCurrency: [{ currency: "USD", commission: 50, count: 1 }],
    });
    compactStatsPropsLog.length = 0;
  });

  it("on load, with an existing MTC recharge counted for today, the cards read from the new server-side read — not 0", async () => {
    await renderPage();

    // The page must have actually asked for MTC's today-stats at some point
    // during mount/provider-selection.
    await waitFor(() =>
      expect(mockGetTodayStats).toHaveBeenCalledWith("MTC"),
    );

    await waitFor(() => {
      const stats = screen.getByTestId("stub-compact-stats");
      expect(Number(stats.dataset.todayCount)).toBe(1);
    });
    const stats = screen.getByTestId("stub-compact-stats");
    // The scalar `todayCommission` prop is `profit_usd` off the new read —
    // the stamped transaction profit, not `price - cost` over every recent
    // row regardless of type/refund status (the pre-fix `rechargeHistory`
    // source's bug).
    expect(Number(stats.dataset.todayCommission)).toBe(50);

    // The "Total Profit" card is fed by the SAME new read while a telecom
    // provider is active — `finAnalytics` (OMT/Whish `financial_services`)
    // never holds a recharge row, so pre-fix this always read $0.00 here.
    expect(Number(stats.dataset.allProvidersCommission)).toBe(50);

    // The mount/provider-switch effect no longer eagerly loads
    // `rechargeHistory` (that source no longer feeds these cards) — only the
    // History button does (Recharge.historyDrawerBalancesRest.test.tsx
    // covers that call).
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it("after a successful MTC recharge submit, the cards refresh to reflect it", async () => {
    // Nothing pre-existing this time — isolates the post-submit refresh.
    mockGetTodayStats.mockResolvedValueOnce(NO_TODAY_STATS).mockResolvedValue({
      count: 1,
      profit_usd: 50,
      profit_lbp: 0,
      byCurrency: [{ currency: "USD", commission: 50, count: 1 }],
    });

    await renderPage();
    await waitFor(() => {
      const stats = screen.getByTestId("stub-compact-stats");
      expect(Number(stats.dataset.todayCount)).toBe(0);
    });

    fireEvent.click(screen.getByTestId("telecom-fill"));
    fireEvent.click(screen.getByTestId("telecom-submit"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));

    // The submit's success path must re-fetch the today-stats read (not just
    // financial-service history, which can never contain this row) so the
    // cards pick up the just-completed recharge without a manual reload.
    await waitFor(() => {
      const stats = screen.getByTestId("stub-compact-stats");
      expect(Number(stats.dataset.todayCount)).toBe(1);
    });
    expect(mockGetTodayStats.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
