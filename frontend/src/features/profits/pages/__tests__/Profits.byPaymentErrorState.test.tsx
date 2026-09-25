/** @jest-environment jsdom */

/**
 * Profits — "Cash intake by method" tab, PA-4.16
 * (OWNER_NOTES_2026-09-21.md §6.6, lane LPay's own tab only).
 *
 * Pre-fix, `loadByPayment`'s catch block collapsed ANY failure into
 * `setByPayment([])`, so a broken `getProfitByPaymentMethod` call rendered
 * the exact same "No payment data for this period" message the DataTable
 * shows for a genuine no-activity day — a query failure read as silence.
 *
 * This drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` are mocked), matching the layer-seam testing lesson
 * recorded for this repo.
 *
 * Rule 17 proof (RED observed before GREEN): run against the PRE-FIX
 * `loadByPayment` (`catch { setByPayment([]); }`, no error state) by
 * temporarily reverting that one function (Edit tool, this lane's own
 * uncommitted change only) and re-running. Observed failure, verbatim:
 *
 *   "shows a visible error state instead of the empty-data message"
 *     TestingLibraryElementError: Unable to find an element with the text:
 *     /Failed to load payment method data/. This could be because the text
 *     is broken up by multiple elements...
 *     (found "No payment data for this period" instead)
 *
 * After restoring the fix, the same run passed.
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

describe('Profits — "Cash intake by method" tab, error state (PA-4.16)', () => {
  it("shows a visible error state instead of the empty-data message", async () => {
    mockGetProfitByPaymentMethod.mockRejectedValueOnce(
      new Error("Network request failed"),
    );

    await renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /cash intake by method/i }),
    );
    await waitFor(() =>
      expect(mockGetProfitByPaymentMethod).toHaveBeenCalledTimes(1),
    );

    expect(
      await screen.findByText(/Failed to load payment method data/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Network request failed")).toBeInTheDocument();
    expect(
      screen.queryByText("No payment data for this period"),
    ).not.toBeInTheDocument();
  });

  it("clears a prior error and shows real data on a successful reload (regression)", async () => {
    mockGetProfitByPaymentMethod.mockRejectedValueOnce(new Error("boom"));

    await renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /cash intake by method/i }),
    );
    await screen.findByText(/Failed to load payment method data/i);

    mockGetProfitByPaymentMethod.mockResolvedValueOnce([
      {
        method: "CASH",
        total_usd: 100,
        total_lbp: 0,
        // LPAY-V-6(d) (round-1 review, OWNER_NOTES_2026-09-21.md §6.9): the
        // old all-or-nothing `is_debt_repayment_only` flag is gone (owner
        // decision 3) — `debt_repayment_usd`/`_lbp` are its real replacement
        // on `PaymentMethodRow`. A stale flag key here doesn't fail this
        // test (rule 24), it just asserts a shape no real response has ever
        // had since owner decision 3 shipped.
        debt_repayment_usd: 0,
        debt_repayment_lbp: 0,
        count: 1,
        pending_commission_usd: 0,
        is_settled: 1,
      },
    ]);
    // Re-trigger the tab's own fetch by leaving and returning to it — the
    // page's existing effect re-fires loadByPayment on tab re-entry via its
    // dependency array (from/to unchanged, so this exercises the same path
    // the date-range filter would).
    fireEvent.click(screen.getByRole("button", { name: /overview/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /cash intake by method/i }),
    );

    await waitFor(() =>
      expect(mockGetProfitByPaymentMethod).toHaveBeenCalledTimes(2),
    );
    await screen.findByText("CASH");
    expect(
      screen.queryByText(/Failed to load payment method data/i),
    ).not.toBeInTheDocument();
  });

  it("still renders the real empty-data message for a genuine no-activity period (regression)", async () => {
    mockGetProfitByPaymentMethod.mockResolvedValueOnce([]);

    await renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /cash intake by method/i }),
    );
    await waitFor(() =>
      expect(mockGetProfitByPaymentMethod).toHaveBeenCalledTimes(1),
    );

    expect(
      await screen.findByText("No payment data for this period"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Failed to load payment method data/i),
    ).not.toBeInTheDocument();
  });
});
