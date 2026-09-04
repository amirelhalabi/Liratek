/** @jest-environment jsdom */

/**
 * LIRA-163 — `getAnalytics` gains a real `awaiting_settlement_count`, and
 * three render sites (Services header, Recharge CompactStats, Profits →
 * Commissions) stop GUESSING "is this $0.00 genuinely zero or just unknown
 * until settlement" from `commission === 0 && count > 0`. This file covers
 * the Profits → Commissions tab surfaces:
 *   1. The "Realized Commissions (Month/Today)" cards — used to show no
 *      caption at all for an all-post-cutover period (pending_commission
 *      stays 0 forever for a model-1 row, by design).
 *   2. The "Provider Performance (Today)" table's Commission (Realized)
 *      cell and Status badge — used to GUESS "awaiting settlement" from the
 *      `commission === 0 && count > 0` heuristic.
 *
 * The heuristic's failure mode this suite pins: a provider can have
 * `commission === 0 && count > 0` for a reason that has NOTHING to do with
 * settlement (e.g. a provider whose today's transactions all had a genuine
 * $0 commission) — the heuristic could not tell that apart from "unknown
 * until settlement" and would mislabel it. The real count can. This is
 * proven failing-first below (see the last describe block): the assertion
 * would have FAILED against the pre-LIRA-163 heuristic-driven render.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Profits from "../Profits";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetOMTAnalytics = jest.fn();
const mockGetUnsettledSummary = jest.fn();

const mockApi = {
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

async function renderCommissionsTab() {
  const utils = render(<Profits />);
  await waitFor(() =>
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: /commissions/i }));
  await waitFor(() => expect(mockGetOMTAnalytics).toHaveBeenCalledTimes(1));
  await screen.findByText("Provider Performance (Today)");
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
  mockGetUnsettledSummary.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// 1. Realized Commissions (Month/Today) cards
// ---------------------------------------------------------------------------

describe("Profits — Commissions tab, Realized Commissions cards awaiting-settlement caption (LIRA-163)", () => {
  it("shows the count when the legacy pending_commission figure is 0 for an all-post-cutover period", async () => {
    mockGetOMTAnalytics.mockResolvedValueOnce({
      today: {
        commission: 0,
        pending_commission: 0,
        count: 4,
        awaiting_settlement_count: 4,
      },
      month: {
        commission: 0,
        pending_commission: 0,
        count: 12,
        awaiting_settlement_count: 12,
      },
      byProvider: [],
    });

    await renderCommissionsTab();

    expect(
      screen.getByTestId("commissions-month-awaiting-settlement").textContent,
    ).toContain("12 awaiting settlement");
    expect(
      screen.getByTestId("commissions-today-awaiting-settlement").textContent,
    ).toContain("4 awaiting settlement");
  });

  it("omits the caption when the period has genuinely no pending activity", async () => {
    mockGetOMTAnalytics.mockResolvedValueOnce({
      today: {
        commission: 5,
        pending_commission: 0,
        count: 2,
        awaiting_settlement_count: 0,
      },
      month: {
        commission: 20,
        pending_commission: 0,
        count: 8,
        awaiting_settlement_count: 0,
      },
      byProvider: [],
    });

    await renderCommissionsTab();

    expect(
      screen.queryByTestId("commissions-month-awaiting-settlement"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("commissions-today-awaiting-settlement"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. Provider Performance (Today) table — real count vs the deleted heuristic
// ---------------------------------------------------------------------------

describe("Profits — Commissions tab, Provider Performance real awaiting_settlement_count (LIRA-163)", () => {
  it("shows 'Awaiting settlement' when the SQL states a genuine model-1 pending count", async () => {
    mockGetOMTAnalytics.mockResolvedValueOnce({
      today: { commission: 0, pending_commission: 0, count: 6 },
      month: { commission: 0, pending_commission: 0, count: 6 },
      byProvider: [
        {
          provider: "OMT",
          commission: 0,
          currency: "USD",
          count: 6,
          awaiting_settlement_count: 6,
        },
      ],
    });

    const { container } = await renderCommissionsTab();
    const cells = providerRowCells(container, "OMT");

    expect(cells[2].textContent).toContain("Awaiting settlement");
    expect(cells[4].textContent).toContain("Awaiting Settlement");
  });

  /**
   * The failure mode the deleted `commission === 0 && count > 0` heuristic
   * could not distinguish: a provider with zero realized commission AND
   * transactions today, but for a reason that has nothing to do with
   * settlement (e.g. every transaction genuinely earned $0). The real SQL
   * count (`awaiting_settlement_count: 0`) correctly reads this as "$0.00",
   * not "awaiting settlement".
   *
   * Rule 17 proof (see this ticket's own report): reverting
   * `providerTodayAwaitingSettlementCount = p.awaiting_settlement_count ?? 0`
   * back to the deleted `p.commission === 0 && p.count > 0` heuristic makes
   * this exact assertion FAIL — the heuristic renders "Awaiting settlement"
   * here because commission is 0 and count is 6, even though
   * awaiting_settlement_count is 0 (nothing is actually pending).
   */
  it("shows a plain $0.00 (not 'Awaiting settlement') when commission is genuinely zero and nothing is pending", async () => {
    mockGetOMTAnalytics.mockResolvedValueOnce({
      today: { commission: 0, pending_commission: 0, count: 6 },
      month: { commission: 0, pending_commission: 0, count: 6 },
      byProvider: [
        {
          provider: "OMT",
          commission: 0,
          currency: "USD",
          count: 6,
          awaiting_settlement_count: 0,
        },
      ],
    });

    const { container } = await renderCommissionsTab();
    const cells = providerRowCells(container, "OMT");

    expect(cells[2].textContent).toContain("$0.00");
    expect(cells[2].textContent).not.toContain("Awaiting settlement");
    expect(cells[4].textContent?.trim()).toBe("—");
  });
});
