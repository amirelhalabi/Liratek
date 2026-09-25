/** @jest-environment jsdom */

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
