/** @jest-environment jsdom */

/**
 * Profits — "Cash intake by method" tab, owner decision 3 (2026-09-24,
 * OWNER_NOTES_2026-09-21.md §6.5 review round 3): debt-repayment intake
 * gets its OWN column instead of the old all-or-nothing "No Profit" flag,
 * and both new-sales and debt-repayment intake count toward Share.
 *
 * This drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` are mocked), matching the layer-seam testing lesson
 * recorded for this repo.
 *
 * Rule 17 status — UNVERIFIED red, GREEN confirmed (be explicit rather than
 * claim more than was checked): a revert-and-rerun of the PRE-FIX By Payment
 * JSX block was ATTEMPTED here the same way it was done successfully for the
 * backend query (see `ProfitRepository.paymentMethodRows.test.ts`), but this
 * file — `Profits.tsx` — is being edited concurrently by other lanes right
 * now (shared-tree protocol), and the revert collided with one of those
 * edits: restoring the surrounding ternary lost 4 lines
 * (`{byPaymentError}`'s second `<p>`, two closing `</div>`s, and the `) : (`
 * separator) that this test's own edit never touched. That corruption was
 * caught immediately by `tsc` and repaired via a small, targeted Edit (see
 * this lane's final report) — but repeating the same large-block revert to
 * chase a RED screenshot was judged not worth the risk of a second collision
 * on a file this volatile. What IS verified: both assertions below FAIL
 * (`toBeInTheDocument()`/`toHaveTextContent()` fail) against ANY render that
 * doesn't include the "Debt Repayment" header and doesn't fold
 * `debt_repayment_usd`/`_lbp` into the Share numerator/denominator — which
 * is mechanically what the pre-fix JSX did (no such header, `shareEligible`
 * excluded `is_debt_repayment_only` rows entirely) — and the backend's own
 * RED/GREEN proof for the SAME owner decision (`ProfitRepository
 * .paymentMethodRows.test.ts`'s "still routes a debt-repayment method..."
 * case, and `ProfitService.getByPaymentMethod` feeding `debt_repayment_usd`/
 * `_lbp` through) is real and already captured. GREEN below is confirmed
 * against the current, fixed code.
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

describe('Profits — "Cash intake by method" tab, debt-repayment column (owner decision 3)', () => {
  it("shows debt-repayment intake in its own column, separate from the sales total", async () => {
    mockGetProfitByPaymentMethod.mockResolvedValueOnce([
      {
        method: "CASH",
        total_usd: 100,
        total_lbp: 0,
        debt_repayment_usd: 40,
        debt_repayment_lbp: 0,
        count: 2,
        pending_commission_usd: 0,
        is_settled: 1,
      },
    ]);

    await renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /cash intake by method/i }),
    );
    await screen.findByText("CASH");

    // The column header exists.
    expect(screen.getByText("Debt Repayment")).toBeInTheDocument();

    const row = screen.getByText("CASH").closest("tr");
    expect(row).not.toBeNull();
    // Both figures are visible on the SAME row — sales intake (100 USD) is
    // never zeroed out by the presence of debt-repayment money (40 USD).
    expect(row).toHaveTextContent("100 USD");
    expect(row).toHaveTextContent("40 USD");
    // The old all-or-nothing flag text is gone.
    expect(row).not.toHaveTextContent("No Profit");
  });

  it("counts debt-repayment intake toward Share instead of hiding it behind 'No Profit'", async () => {
    mockGetProfitByPaymentMethod.mockResolvedValueOnce([
      {
        // Pure new-sales method: $50 sales, no debt repayment.
        method: "CASH",
        total_usd: 50,
        total_lbp: 0,
        debt_repayment_usd: 0,
        debt_repayment_lbp: 0,
        count: 1,
        pending_commission_usd: 0,
        is_settled: 1,
      },
      {
        // Pure debt-repayment method: used to read "No Profit" / excluded
        // from Share entirely. Now it must count toward Share like any
        // other intake.
        method: "OMT",
        total_usd: 0,
        total_lbp: 0,
        debt_repayment_usd: 50,
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
    await screen.findByText("OMT");

    // Denominator is 50 (CASH sales) + 50 (OMT debt repayment) = 100, so
    // OMT's share is 50/100 = 50%, not the old hidden/"0%" treatment.
    const omtRow = screen.getByText("OMT").closest("tr");
    expect(omtRow).not.toBeNull();
    expect(omtRow).toHaveTextContent(/50\.0% USD/i);
    expect(omtRow).not.toHaveTextContent("No Profit");

    const cashRow = screen.getByText("CASH").closest("tr");
    expect(cashRow).not.toBeNull();
    expect(cashRow).toHaveTextContent(/50\.0% USD/i);
  });
});
