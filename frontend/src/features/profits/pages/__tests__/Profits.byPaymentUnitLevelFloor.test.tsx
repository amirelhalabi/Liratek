/** @jest-environment jsdom */

/**
 * Profits — "Cash intake by method" tab, LPAY-X1 (round 5,
 * OWNER_NOTES_2026-09-21.md §6.8 follow-up).
 *
 * `ProfitRepository.getPaymentMethodRows` now floors owner decision 1's
 * "net of change" at the UNIT level, not per currency (see that method's own
 * doc comment and `ProfitRepository.paymentMethodRows.test.ts`'s "LPAY-X1"
 * describe block for the backend proof). A direct, mechanical consequence:
 * `total_usd`/`debt_repayment_usd`/`debt_repayment_lbp` can now be
 * GENUINELY NEGATIVE (a unit tendered in one currency with change given in
 * the other), which was previously impossible — the per-currency floor used
 * to clamp every one of those fields at 0. This file drives the REAL
 * `Profits` page (only `useApi`, `useModules` and `useCurrencyContext` are
 * mocked), matching the layer-seam testing lesson recorded for this repo.
 *
 * Rule 17 proof (RED observed before GREEN): each case below was run against
 * the PRE-FIX JSX (Edit tool, this lane's own uncommitted change only,
 * reverted immediately after each observation):
 *
 *   - Total (USD) cell: the `className` ternary had no `row.total_usd < 0`
 *     branch at all (`isCommission ? "text-emerald-400 font-semibold" :
 *     "text-white"`), so a negative total rendered in plain white, visually
 *     indistinguishable from a positive one.
 *     "renders a negative Total (USD) figure in red, not plain white"
 *       expect(element).toHaveClass("text-red-400")
 *       Received class list: ["text-white"] — element did NOT match
 *
 *   - Debt Repayment cell: the outer visibility check was `debtRepaymentUsd
 *     > 0 || debtRepaymentLbp > 0`, and each inner span was individually
 *     gated `> 0` — a row with debt_repayment_usd > 0 but debt_repayment_lbp
 *     < 0 rendered the cell (outer check passed on the USD side) but SILENTLY
 *     DROPPED the negative LBP span (inner check failed).
 *     "shows a negative debt-repayment LBP leg instead of silently dropping it"
 *       expect(row).toHaveTextContent(/-895000/)
 *       (not found — the LBP span was never rendered)
 *
 * After restoring the fix, both passed.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Profits from "../Profits";

const mockGetProfitByPaymentMethod = jest.fn();

const mockApi = {
  getProfitByPaymentMethod: mockGetProfitByPaymentMethod,
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

async function renderPage() {
  const utils = render(<Profits />);
  await waitFor(() =>
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
  );
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Profits — "Cash intake by method" tab, LPAY-X1 unit-level floor display', () => {
  it("renders a negative Total (USD) figure in red, not plain white", async () => {
    mockGetProfitByPaymentMethod.mockResolvedValueOnce([
      {
        // Owner-ticket shape: LBP tender, USD change — the unit qualifies
        // via its positive LBP net, so its USD net (-100) is genuinely
        // negative rather than floored to 0.
        method: "CASH",
        total_usd: -100,
        total_lbp: 9_000_000,
        debt_repayment_usd: 0,
        debt_repayment_lbp: 0,
        count: 1,
        pending_commission_usd: 0,
        is_settled: 1,
      },
    ]);

    await renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /cash intake by method/i }),
    );
    await screen.findByText("CASH");

    const row = screen.getByText("CASH").closest("tr");
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("-100 USD");
    const usdCell = screen.getByText("-100 USD");
    expect(usdCell).toHaveClass("text-red-400");
  });

  it("shows a negative debt-repayment LBP leg instead of silently dropping it", async () => {
    mockGetProfitByPaymentMethod.mockResolvedValueOnce([
      {
        // Owner-ticket shape: $100 USD tendered on a debt repayment, 895,000
        // LBP change given back — debt_repayment_usd stays positive while
        // debt_repayment_lbp goes negative.
        method: "CASH",
        total_usd: 0,
        total_lbp: 0,
        debt_repayment_usd: 100,
        debt_repayment_lbp: -895_000,
        count: 1,
        pending_commission_usd: 0,
        is_settled: 1,
      },
    ]);

    await renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /cash intake by method/i }),
    );
    await screen.findByText("CASH");

    const row = screen.getByText("CASH").closest("tr");
    expect(row).not.toBeNull();
    // Both legs of the SAME debt-repayment unit must be visible — the
    // positive USD leg must not hide the negative LBP one.
    expect(row).toHaveTextContent("100 USD");
    expect(row).toHaveTextContent("-895000 LBP");
    const lbpCell = screen.getByText("-895000 LBP");
    expect(lbpCell).toHaveClass("text-red-400");
  });
});
