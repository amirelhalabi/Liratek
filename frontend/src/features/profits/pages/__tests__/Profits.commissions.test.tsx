/**
 * Profits — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Profits from "../Profits";
import { type CommissionsReport } from "@liratek/ui";

const mockGetProfitsCommissions = jest.fn();

const mockApi = {
  getProfitsCommissions: mockGetProfitsCommissions,
  getOMTAnalytics: jest.fn(),
  getUnsettledSummary: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({ isModuleEnabled: () => true }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    formatAmount: (v: number, c: string) => `${v} ${c}`,
  }),
}));

jest.mock("../../../dashboard/components/CommissionsChart", () => ({
  __esModule: true,
  default: () => null,
}));

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetProfitsCommissions as unknown as jest.Mock).mockReset();
  (mockApi.getOMTAnalytics as unknown as jest.Mock).mockReset();
  (mockApi.getUnsettledSummary as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Profits.commissionsDateRangeRefetch", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Commissions tab — date picker wiring (round-2 review, LC-6 #1,
   * OWNER_NOTES_2026-09-21.md §6, lane LC).
   *
   * The Commissions tab's `loadCommissions` fetcher genuinely reads
   * [from, to] (`useCallback(..., [api, from, to])` — PA-4.17), but nothing
   * in the suite asserted the ACTUAL call args or that a date-picker change
   * re-fetches; `Profits.commissionsAnalyticsAwaitingSettlement.test.tsx`
   * only ever asserted `toHaveBeenCalledTimes(1)`, which passes identically
   * whether or not the args are right or the picker does anything at all.
   * This file closes that gap.
   *
   * RULE 17 (failing-first proof, this session, `npx jest
   * Profits.commissionsDateRangeRefetch --maxWorkers=1`): the "re-fetches
   * with the new from" test below was run against `Profits.tsx` with
   * `loadCommissions`'s dependency array TEMPORARILY reverted from
   * `[api, from, to]` to `[api]` (Edit tool, on this lane's own code, per the
   * shared-tree protocol's "rule-17 revert to prove red is done with Edit on
   * your OWN code only") and FAILED — NOT by skipping the re-fetch (the
   * page's top-level `useEffect` still re-runs because the OTHER tabs'
   * loaders, still `[api, from, to]`, change identity and are also effect
   * deps), but by re-fetching with the WRONG, STALE args — exactly the
   * closure-over-stale-props hazard a `[api]`-only dependency array causes:
   *
   *   "re-fetches with the new from when the date picker changes" ›
   *   expect(jest.fn()).toHaveBeenNthCalledWith(2, ...)
   *   n: 2
   *   Expected: "2026-01-15", "2026-09-23"
   *   Received
   *          1: "2026-08-24", "2026-09-23"
   *   ->     2: "2026-08-24", "2026-09-23"
   *   (both calls carry the INITIAL from — "2026-01-15" never reaches the API)
   *
   * The dependency array was then reverted back to `[api, from, to]`
   * (confirmed via `git diff` clean against the pre-revert state) and the
   * whole file was re-run: 2/2 passing.
   */

  function report(
    overrides: Partial<CommissionsReport> = {},
  ): CommissionsReport {
    return {
      from: "2026-09-01",
      to: "2026-09-30",
      realized_usd: 0,
      realized_lbp: 0,
      revenue_usd: 0,
      revenue_lbp: 0,
      pending_usd: 0,
      pending_lbp: 0,
      total_owed_usd: 0,
      total_owed_lbp: 0,
      awaiting_settlement_count: 0,
      bill_count: 0,
      byProvider: [],
      excludedProviders: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProfitsCommissions.mockResolvedValue(report());
  });

  async function openCommissionsTab() {
    render(<Profits />);
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /commissions/i }));
    await waitFor(() =>
      expect(mockGetProfitsCommissions).toHaveBeenCalledTimes(1),
    );
    await screen.findByText(/Provider Performance/);
  }

  describe("Profits — Commissions tab, date-range wiring (LC-6)", () => {
    it("calls getProfitsCommissions with the CURRENT [from, to] state (both non-empty YYYY-MM-DD strings, from <= to)", async () => {
      await openCommissionsTab();

      const [from, to] = mockGetProfitsCommissions.mock.calls[0] as [
        string,
        string,
      ];
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(from <= to).toBe(true);
    });

    it("re-fetches with the new from when the date picker changes, keeping to unchanged (PA-4.17 regression guard)", async () => {
      await openCommissionsTab();

      const [initialFrom, initialTo] = mockGetProfitsCommissions.mock
        .calls[0] as [string, string];

      fireEvent.change(screen.getByTestId("date-range-from"), {
        target: { value: "2026-01-15" },
      });

      await waitFor(() =>
        expect(mockGetProfitsCommissions).toHaveBeenCalledTimes(2),
      );
      expect(mockGetProfitsCommissions).toHaveBeenNthCalledWith(
        2,
        "2026-01-15",
        initialTo,
      );
      expect("2026-01-15").not.toBe(initialFrom);
    });
  });
});

describe("Profits.commissionsExcludedProviders", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Commissions tab — excludedProviders caption (round-2 review, LC-1,
   * OWNER_NOTES_2026-09-21.md §6, lane LC).
   *
   * BINANCE's realized commission is always $0.00 in this report (its
   * financial_services rows are stored in USDT, a currency the underlying
   * profit-stamp/report queries never bucket into USD/LBP — see
   * CommissionsReportService.ts's own header for the full trace). Rather
   * than show a misleading "$0.00", `CommissionsReportService.getReport`
   * drops it from `byProvider` and surfaces it in `excludedProviders`
   * instead; this file proves the UI actually renders that, and stays quiet
   * when there is nothing to caption.
   *
   * RULE 17 (failing-first proof, this session, `npx jest
   * Profits.commissionsExcludedProviders --maxWorkers=1`): the "renders a
   * caption" test was run with the `data-testid="commissions-excluded-
   * providers"` in `Profits.tsx`'s Commissions tab TEMPORARILY renamed (Edit
   * tool, on this lane's own code) and FAILED:
   *
   *   "shows a caption naming BINANCE and its reason when excludedProviders
   *   is non-empty" › TestingLibraryElementError: Unable to find an element
   *   by: [data-testid="commissions-excluded-providers"]
   *
   * The testid was then restored (confirmed via `git diff` clean against the
   * pre-revert state) and the whole file was re-run: 3/3 passing.
   */

  function report(
    overrides: Partial<CommissionsReport> = {},
  ): CommissionsReport {
    return {
      from: "2026-09-01",
      to: "2026-09-30",
      realized_usd: 0,
      realized_lbp: 0,
      revenue_usd: 0,
      revenue_lbp: 0,
      pending_usd: 0,
      pending_lbp: 0,
      total_owed_usd: 0,
      total_owed_lbp: 0,
      awaiting_settlement_count: 0,
      bill_count: 0,
      byProvider: [],
      excludedProviders: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function openCommissionsTab() {
    render(<Profits />);
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /commissions/i }));
    await waitFor(() =>
      expect(mockGetProfitsCommissions).toHaveBeenCalledTimes(1),
    );
    await screen.findByText(/Provider Performance/);
  }

  describe("Profits — Commissions tab, excludedProviders caption (LC-1)", () => {
    it("shows a caption naming BINANCE and its reason when excludedProviders is non-empty", async () => {
      mockGetProfitsCommissions.mockResolvedValueOnce(
        report({
          excludedProviders: [
            {
              provider: "BINANCE",
              reason:
                "Binance commission is recorded in USDT, a currency this tab can't yet report in USD/LBP — see Suppliers → Binance for its raw activity.",
            },
          ],
        }),
      );

      await openCommissionsTab();

      const caption = screen.getByTestId("commissions-excluded-providers");
      expect(caption.textContent).toContain("BINANCE");
      expect(caption.textContent).toContain("USDT");
    });

    it("renders no caption when excludedProviders is empty", async () => {
      mockGetProfitsCommissions.mockResolvedValueOnce(report());

      await openCommissionsTab();

      expect(
        screen.queryByTestId("commissions-excluded-providers"),
      ).not.toBeInTheDocument();
    });

    it("renders no caption when excludedProviders is absent (older cached payload, optional field)", async () => {
      const { excludedProviders: _excludedProviders, ...withoutField } =
        report();
      mockGetProfitsCommissions.mockResolvedValueOnce(
        withoutField as CommissionsReport,
      );

      await openCommissionsTab();

      expect(
        screen.queryByTestId("commissions-excluded-providers"),
      ).not.toBeInTheDocument();
    });
  });
});
