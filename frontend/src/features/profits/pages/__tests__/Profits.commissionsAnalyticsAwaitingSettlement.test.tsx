/** @jest-environment jsdom */

/**
 * LIRA-163 — the Commissions tab distinguishes "a real dollar figure is
 * pending" from "N rows are awaiting settlement, commission UNKNOWABLE until
 * then" (owner decision D15) — never a fabricated `$0.00` standing in for an
 * unknown amount. This file covers two render sites:
 *   1. The "Pending Commissions (As Of Now)" card's awaiting-settlement
 *      caption.
 *   2. The "Provider Performance" table's Realized cell and Status badge.
 *
 * UPDATED (OWNER_NOTES_2026-09-21.md §6, lane LC, PA-1.1/PA-1.6/PA-2.7/
 * PA-3.4/PA-4.16/PA-4.17/PA-4.18/PA-4.20): the tab no longer calls
 * `api.getOMTAnalytics()`/`api.getUnsettledSummary()` (those keep serving the
 * Services/Recharge pages, unchanged) — it now calls the Profits-gated
 * `api.getProfitsCommissions(from, to)`, which returns ONE merged
 * `CommissionsReport` (see CommissionsReportService.ts) instead of the old
 * getAnalytics/getUnsettledSummaryByProvider pair. This file is rewritten to
 * mock and assert against that new shape (rule 24 — a test whose premise is
 * a removed architecture is rewritten, not silently left to rot); the
 * underlying LIRA-163 UX guarantee (a count, never a fabricated dollar) is
 * unchanged and re-asserted below.
 *
 * Rule 17 (this session, `npx jest
 * Profits.commissionsAnalyticsAwaitingSettlement --maxWorkers=1`): reverting
 * the Realized cell's `hasAwaitingSettlement` branch to the OLD
 * `p.commission === 0 && p.count > 0` heuristic made the last test in this
 * file ("shows a plain realized total... when nothing is pending") FAIL —
 * `$6.0000` (an invented commission figure the mock never supplied) appeared
 * where the awaiting-settlement branch should have rendered nothing;
 * reverted after observing the failure.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Profits from "../Profits";
import type { CommissionsReport } from "@liratek/ui";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetProfitsCommissions = jest.fn();
// Guard (rule 24): the old routes must NEVER be called from this tab again —
// they keep serving Services/Recharge only (PA-4.20's "leave the originals
// working" instruction).
const mockGetOMTAnalytics = jest.fn();
const mockGetUnsettledSummary = jest.fn();

const mockApi = {
  getProfitsCommissions: mockGetProfitsCommissions,
  getOMTAnalytics: mockGetOMTAnalytics,
  getUnsettledSummary: mockGetUnsettledSummary,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function report(
  overrides: Partial<CommissionsReport> & {
    byProvider?: CommissionsReport["byProvider"];
  } = {},
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
    ...overrides,
  };
}

async function renderCommissionsTab() {
  const utils = render(<Profits />);
  await waitFor(() =>
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: /commissions/i }));
  await waitFor(() =>
    expect(mockGetProfitsCommissions).toHaveBeenCalledTimes(1),
  );
  await screen.findByText(/Provider Performance/);
  return utils;
}

function providerRowCells(
  container: HTMLElement,
  provider: string,
): HTMLTableCellElement[] {
  const rows = Array.from(
    container.querySelectorAll('[data-testid="data-table"] tbody tr'),
  );
  const row = rows.find((r) => r.querySelector("td")?.textContent === provider);
  if (!row) {
    throw new Error(`No provider row found for "${provider}"`);
  }
  return Array.from(row.querySelectorAll("td"));
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 0. PA-4.16 — a failed fetch must show a visible error, never look like
//    "still loading" forever.
// ---------------------------------------------------------------------------

describe("Profits — Commissions tab, error state (PA-4.16)", () => {
  it("shows a visible error message when getProfitsCommissions rejects, instead of 'Loading...' forever", async () => {
    mockGetProfitsCommissions.mockRejectedValueOnce(
      new Error("network down"),
    );

    render(<Profits />);
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /commissions/i }));

    await waitFor(() =>
      expect(mockGetProfitsCommissions).toHaveBeenCalledTimes(1),
    );
    await screen.findByText("Couldn't load commissions");

    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 1. "Pending Commissions (As Of Now)" card — awaiting-settlement caption
// ---------------------------------------------------------------------------

describe("Profits — Commissions tab, Pending card awaiting-settlement caption (LIRA-163)", () => {
  it("shows the count when the whole period's pending commission is model-1 (unknowable dollar)", async () => {
    mockGetProfitsCommissions.mockResolvedValueOnce(
      report({ awaiting_settlement_count: 12 }),
    );

    await renderCommissionsTab();

    expect(
      screen.getByTestId("commissions-awaiting-settlement").textContent,
    ).toContain("12 awaiting settlement");
    expect(mockGetOMTAnalytics).not.toHaveBeenCalled();
    expect(mockGetUnsettledSummary).not.toHaveBeenCalled();
  });

  it("omits the caption when nothing is awaiting settlement", async () => {
    mockGetProfitsCommissions.mockResolvedValueOnce(
      report({ realized_usd: 20, awaiting_settlement_count: 0 }),
    );

    await renderCommissionsTab();

    expect(
      screen.queryByTestId("commissions-awaiting-settlement"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. Provider Performance table — real count vs the deleted heuristic
// ---------------------------------------------------------------------------

describe("Profits — Commissions tab, Provider Performance real awaiting_settlement_count (LIRA-163)", () => {
  it("shows 'Awaiting settlement' in the Realized cell, and that Status, when nothing is realized yet but rows are awaiting settlement", async () => {
    mockGetProfitsCommissions.mockResolvedValueOnce(
      report({
        awaiting_settlement_count: 6,
        byProvider: [
          {
            provider: "OMT",
            realized_usd: 0,
            realized_lbp: 0,
            revenue_usd: 0,
            revenue_lbp: 0,
            count: 6,
            pending_usd: 0,
            pending_lbp: 0,
            total_owed_usd: 0,
            total_owed_lbp: 0,
            awaiting_settlement_count: 6,
            bill_count: 0,
          },
        ],
      }),
    );

    const { container } = await renderCommissionsTab();
    const cells = providerRowCells(container, "OMT");

    expect(cells[2].textContent).toContain("Awaiting settlement");
    expect(cells[4].textContent).toContain("Awaiting Settlement");
  });

  /**
   * The failure mode the deleted `commission === 0 && count > 0` heuristic
   * could not distinguish: a provider with zero realized commission AND
   * transactions in period, for a reason that has nothing to do with
   * settlement (e.g. every transaction genuinely earned $0). The real
   * `awaiting_settlement_count: 0` correctly reads this as a plain $0.00,
   * not "awaiting settlement" (rule 17 proof is in this file's header).
   */
  it("shows a plain $0.00 (not 'Awaiting settlement') when realized is genuinely zero and nothing is pending", async () => {
    mockGetProfitsCommissions.mockResolvedValueOnce(
      report({
        byProvider: [
          {
            provider: "OMT",
            realized_usd: 0,
            realized_lbp: 0,
            revenue_usd: 0,
            revenue_lbp: 0,
            count: 6,
            pending_usd: 0,
            pending_lbp: 0,
            total_owed_usd: 0,
            total_owed_lbp: 0,
            awaiting_settlement_count: 0,
            bill_count: 0,
          },
        ],
      }),
    );

    const { container } = await renderCommissionsTab();
    const cells = providerRowCells(container, "OMT");

    expect(cells[2].textContent).toContain("0 USD");
    expect(cells[2].textContent).not.toContain("Awaiting settlement");
    expect(cells[4].textContent?.trim()).toBe("—");
  });

  it("shows a plain realized total (not 'Awaiting settlement') when the provider has realized commission and nothing is pending", async () => {
    mockGetProfitsCommissions.mockResolvedValueOnce(
      report({
        realized_usd: 6,
        byProvider: [
          {
            provider: "WHISH",
            realized_usd: 6,
            realized_lbp: 0,
            revenue_usd: 60,
            revenue_lbp: 0,
            count: 3,
            pending_usd: 0,
            pending_lbp: 0,
            total_owed_usd: 0,
            total_owed_lbp: 0,
            awaiting_settlement_count: 0,
            bill_count: 0,
          },
        ],
      }),
    );

    const { container } = await renderCommissionsTab();
    const cells = providerRowCells(container, "WHISH");

    expect(cells[2].textContent).toContain("6 USD");
    expect(cells[2].textContent).not.toContain("Awaiting settlement");
    expect(cells[4].textContent).toContain("Settled");
  });
});
