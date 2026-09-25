/** @jest-environment jsdom */

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

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Profits from "../Profits";
import type { CommissionsReport } from "@liratek/ui";

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

function report(overrides: Partial<CommissionsReport> = {}): CommissionsReport {
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
