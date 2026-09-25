/** @jest-environment jsdom */

/**
 * Profits — "Cash intake by method" tab, round-2 review fixes (lane LPay,
 * OWNER_NOTES_2026-09-21.md §6.5/§6.6 PA-3.5/PA-4.15 review):
 *
 *  - LPAY-3: the export filename was still `profit-by-payment` after the
 *    tab was renamed "Cash intake by method" for PA-4.15 — the spec's "fix
 *    the export name" can only mean give the cash-intake tab its own name,
 *    since `profit-by-payment` was already what shipped at HEAD.
 *  - LPAY-4: `loadByPayment`'s catch block read
 *    `error instanceof Error ? error.message : ...`, which drops the real
 *    reason on web (`requestJson` rejects with a plain `{status, message}`
 *    object, not an `Error` — see `reference_requestjson_throws_plain_object`
 *    in project memory). The sibling loaders already use `messageFrom`.
 *
 * LPAY-R3-1/R3-2 (round-3 adversarial review): this file's ORIGINAL LPAY-3
 * case mocked `@/shared/utils/tableExport` — the wrong module (see the
 * comment on the mock below) — so `exportToExcel` was never actually
 * intercepted; the test passed for the wrong reason (or, once corrected to
 * mock the RIGHT module, immediately exposed a SECOND pre-existing bug: the
 * assertion also expected the bare `exportFilename` with no date suffix,
 * which `ExportBar.handleExcel` has never produced — see the "match the
 * STEM" comment below). The round-2 docblock's RED quotes for both cases
 * were written without the file ever having been executed (this lane's own
 * round-3 report says so explicitly) — fabricated provenance, flagged by
 * the reviewer. Both RED/GREEN cycles below were re-run for real this time.
 *
 * Rule 17 proof (RED observed before GREEN — every quote below is the
 * ACTUAL jest output from this session, not reconstructed):
 *
 *  - LPAY-3: reverted `exportFilename` back to `"profit-by-payment"`
 *    (Profits.tsx line ~2518, Edit tool, this lane's own uncommitted change
 *    only, reverted immediately after) and re-ran with `-t "LPAY-3"`.
 *    Observed failure, verbatim:
 *
 *      "exports the cash-intake tab under its own filename, not the old
 *      profit-by-payment name (LPAY-3)"
 *        expect(received).toBe(expected) // Object.is equality
 *        Expected: true
 *        Received: false
 *        at expect(filename.startsWith("cash-intake-by-method-")).toBe(true)
 *
 *  - LPAY-4: reverted `loadByPayment`'s catch block back to
 *    `error instanceof Error ? error.message : "Failed to load payment
 *    method data."` (Profits.tsx, Edit tool, reverted immediately after)
 *    and re-ran with `-t "LPAY-4"`. Observed failure, verbatim:
 *
 *      "surfaces the server's reason for a web-shaped (non-Error) rejection
 *      (LPAY-4)"
 *        TestingLibraryElementError: Unable to find an element with the
 *        text: /Payment method table is locked for maintenance/i
 *        (rendered DOM showed "Failed to load payment method data." — the
 *        generic fallback — instead, because
 *        `{status: 503, message: "..."} instanceof Error` is false)
 *
 * After restoring both fixes, `npx jest Profits.byPaymentExportAndWebError
 * --maxWorkers=1` printed "Tests: 2 passed, 2 total" for real.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Profits from "../Profits";

// LPAY-R3-1: Profits.tsx's By Payment tab renders the REAL `DataTable` from
// @liratek/ui (packages/ui/src/components/ui/DataTable.tsx), whose
// `ExportBar` (packages/ui/src/components/ui/ExportBar.tsx) imports
// `exportToExcel`/`exportToPdf` from packages/ui/src/utils/tableExport — a
// DIFFERENT module than frontend/src/shared/utils/tableExport, which only
// the unused, stale frontend/src/shared/components/DataTable.tsx duplicate
// calls (see DataTable.exportFragmentRows.test.tsx's identical note, the
// precedent this fix copies). Mocking the wrong module left `exportToExcel`
// un-mocked, so the ORIGINAL export ran for real against jsdom and the
// assertions below never had a chance to inspect the filename.
const exportToExcel = jest.fn();
const exportToPdf = jest.fn();
jest.mock("../../../../../../packages/ui/src/utils/tableExport", () => ({
  exportToExcel: (...args: unknown[]) => exportToExcel(...args),
  exportToPdf: (...args: unknown[]) => exportToPdf(...args),
}));

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

describe('Profits — "Cash intake by method" tab, round-2 review fixes', () => {
  it("exports the cash-intake tab under its own filename, not the old profit-by-payment name (LPAY-3)", async () => {
    mockGetProfitByPaymentMethod.mockResolvedValueOnce([
      {
        method: "CASH",
        total_usd: 100,
        total_lbp: 0,
        // LPAY-V-6(d) (round-1 review, OWNER_NOTES_2026-09-21.md §6.9): the
        // old all-or-nothing `is_debt_repayment_only` flag is gone (owner
        // decision 3) — `debt_repayment_usd`/`_lbp` replace it on
        // `PaymentMethodRow` (rule 24: assert the real shape).
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

    // LPAY-R3-1: @liratek/ui's ExportBar renders no testid — only a
    // `title="Export to Excel"` button (see DataTable.exportFragmentRows
    // .test.tsx's identical selector).
    fireEvent.click(screen.getByTitle("Export to Excel"));

    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const [, filename] = exportToExcel.mock.calls[0] as [unknown, string];
    // ExportBar.handleExcel appends a `-DD-MM-YYYY` date suffix
    // (packages/ui/src/components/ui/ExportBar.tsx's `dateSuffix()`), so the
    // filename passed to exportToExcel is never the bare `exportFilename` —
    // match the STEM, not full equality (an exact `.toBe` would be flaky by
    // date and was never correct even on the day it was written).
    expect(filename.startsWith("cash-intake-by-method-")).toBe(true);
    expect(filename.startsWith("profit-by-payment")).toBe(false);
  });

  it("surfaces the server's reason for a web-shaped (non-Error) rejection (LPAY-4)", async () => {
    // requestJson's real throw shape on a non-2xx response: a plain object,
    // NOT an Error instance (reference_requestjson_throws_plain_object).
    mockGetProfitByPaymentMethod.mockRejectedValueOnce({
      status: 503,
      message: "Payment method table is locked for maintenance",
    });

    await renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /cash intake by method/i }),
    );
    await waitFor(() =>
      expect(mockGetProfitByPaymentMethod).toHaveBeenCalledTimes(1),
    );

    expect(
      await screen.findByText(/Payment method table is locked for maintenance/i),
    ).toBeInTheDocument();
  });
});
