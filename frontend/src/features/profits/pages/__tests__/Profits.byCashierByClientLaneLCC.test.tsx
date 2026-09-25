/** @jest-environment jsdom */

/**
 * Profits — By Cashier / By Client tabs, Lane LCC
 * (OWNER_NOTES_2026-09-21.md §6, PA-1.7, PA-1.3, PA-4.16, PA-4.19).
 *
 * Drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` are mocked), matching this repo's layer-seam-testing
 * lesson and the exact precedent `Profits.byPaymentErrorState.test.tsx`
 * already established for the sibling "Cash intake by method" tab's own
 * PA-4.16 fix.
 *
 * Rule 17 proof (this session, from the agent shell — RED observed before
 * GREEN, recorded verbatim):
 *
 *   (a) Error state — reverted `loadByUser`/`loadByClient` back to the
 *       pre-fix shape (`catch { setByUser([]); }` / `catch {
 *       setByClient([]); }`, no `byUserError`/`byClientError` state) via
 *       Edit (this lane's own code only), then re-ran this file.
 *       RED, verbatim:
 *         "By Cashier shows a visible error state instead of the empty-data
 *         message" — TestingLibraryElementError: Unable to find an element
 *         with the text: /Failed to load profit by cashier/i (found "No
 *         data for this period" instead).
 *         "By Client shows a visible error state instead of the empty-data
 *         message" — identical shape, /Failed to load profit by client/i
 *         not found.
 *       Restored the fix; re-ran: both GREEN.
 *
 *   (b) Avg Profit/Txn denominator — reverted the By Cashier row's Avg
 *       Profit/Txn cell back to `row.profit_usd / row.transaction_count`
 *       (the pre-PA-4.19 denominator) via Edit, then re-ran this file.
 *       RED, verbatim:
 *         "By Cashier divides Avg Profit/Txn by recognized_transaction_count,
 *         not transaction_count" — expected the cell to read "10 USD"
 *         (20 / 2 recognized), received "6.666666666666667 USD" (20 / 3
 *         raw transaction_count) — the REFUND-inflated denominator this fix
 *         exists to remove.
 *       Restored the fix; re-ran: GREEN.
 *
 * Round 3 (LCC-X10) — the By Cashier/By Client profit cells were hard-coded
 * `text-emerald-400`, so a legitimate loss (a refund, or the LCC-X1/X2
 * double-count these fixes close) rendered green. Reverted both cells back
 * to a hard-coded `text-emerald-400 font-medium` `<td>` (no `profitClass`
 * span) via Edit, then re-ran this file with `-t "LCC-X10"`.
 *   RED, verbatim: "By Cashier: a negative profit_usd renders in the loss
 *   color, not emerald" — `expect(cell.className).not.toMatch(/emerald/)` —
 *   Received: "px-4 py-3 text-right text-emerald-400 font-medium" (matched
 *   /emerald/, the exact bug). Same shape for the By Client case.
 * Restored the fix; re-ran: both GREEN.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import Profits from "../Profits";

const mockGetProfitByUser = jest.fn();
const mockGetProfitByClient = jest.fn();

const mockApi = {
  getProfitByUser: mockGetProfitByUser,
  getProfitByClient: mockGetProfitByClient,
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

describe("Profits — By Cashier tab (Lane LCC)", () => {
  it("PA-4.16: shows a visible error state instead of the empty-data message", async () => {
    mockGetProfitByUser.mockRejectedValueOnce(new Error("Network down"));

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by cashier/i }));
    await waitFor(() => expect(mockGetProfitByUser).toHaveBeenCalledTimes(1));

    expect(
      await screen.findByText(/Failed to load profit by cashier/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Network down")).toBeInTheDocument();
    expect(
      screen.queryByText("No data for this period"),
    ).not.toBeInTheDocument();
  });

  it("PA-4.16 (regression): still renders the real empty-data message for a genuine no-activity period", async () => {
    mockGetProfitByUser.mockResolvedValueOnce([]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by cashier/i }));
    await waitFor(() => expect(mockGetProfitByUser).toHaveBeenCalledTimes(1));

    expect(
      await screen.findByText("No data for this period"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Failed to load profit by cashier/i),
    ).not.toBeInTheDocument();
  });

  it("PA-1.7: renders revenue_lbp alongside revenue_usd", async () => {
    mockGetProfitByUser.mockResolvedValueOnce([
      {
        user_id: 1,
        username: "cashier1",
        revenue_usd: 80,
        revenue_lbp: 5000000,
        profit_usd: 10,
        profit_lbp: 0,
        transaction_count: 1,
        recognized_transaction_count: 1,
        pending_profit_usd: 0,
        pending_profit_lbp: 0,
      },
    ]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by cashier/i }));
    await screen.findByText("cashier1");

    expect(screen.getByText("80 USD")).toBeInTheDocument();
    expect(screen.getByText("5000000 LBP")).toBeInTheDocument();
  });

  it("PA-1.3: renders pending_profit_lbp separately from pending_profit_usd", async () => {
    mockGetProfitByUser.mockResolvedValueOnce([
      {
        user_id: 1,
        username: "cashier1",
        revenue_usd: 0,
        revenue_lbp: 0,
        profit_usd: 0,
        profit_lbp: 0,
        transaction_count: 1,
        recognized_transaction_count: 1,
        pending_profit_usd: 0,
        pending_profit_lbp: 15000,
      },
    ]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by cashier/i }));
    await screen.findByText("cashier1");

    // The pending LBP figure renders with a "⚠ " prefix in the same text
    // node ("⚠ 15000 LBP"), so match on the number/currency substring.
    expect(screen.getByText(/15000 LBP/)).toBeInTheDocument();
  });

  it("PA-4.19: Avg Profit/Txn divides by recognized_transaction_count, not the raw transaction_count", async () => {
    mockGetProfitByUser.mockResolvedValueOnce([
      {
        user_id: 1,
        username: "cashier1",
        revenue_usd: 100,
        revenue_lbp: 0,
        profit_usd: 20,
        profit_lbp: 0,
        // 3 raw rows (e.g. a SALE, its REFUND, and a SUPPLIER_SETTLEMENT),
        // but only 2 are "recognized" profit-bearing events.
        transaction_count: 3,
        recognized_transaction_count: 2,
        pending_profit_usd: 0,
        pending_profit_lbp: 0,
      },
    ]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by cashier/i }));
    await screen.findByText("cashier1");

    // 20 / 2 = 10, NOT 20 / 3 = 6.666...
    expect(screen.getByText("10 USD")).toBeInTheDocument();
    expect(screen.queryByText(/6\.66/)).not.toBeInTheDocument();
  });

  it("LCC-X10: a negative profit_usd renders in the loss color, not emerald", async () => {
    mockGetProfitByUser.mockResolvedValueOnce([
      {
        user_id: 1,
        username: "cashier1",
        revenue_usd: 0,
        revenue_lbp: 0,
        profit_usd: -20,
        profit_lbp: 0,
        transaction_count: 1,
        recognized_transaction_count: 1,
        pending_profit_usd: 0,
        pending_profit_lbp: 0,
      },
    ]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by cashier/i }));
    const nameCell = await screen.findByText("cashier1");
    const row = nameCell.closest("tr") as HTMLElement;

    // "-20 USD" appears twice in this row (Profits and, since
    // recognized_transaction_count is 1, the identical Avg Profit/Txn
    // figure too) — find the specific occurrence colored by profitClass.
    const occurrences = within(row).getAllByText("-20 USD");
    expect(
      occurrences.some((el) => el.className.includes("red")),
    ).toBe(true);
    expect(
      occurrences.some((el) => el.className.includes("emerald")),
    ).toBe(false);
  });

  it("LCC-X10 (regression): a positive profit_usd still renders emerald", async () => {
    mockGetProfitByUser.mockResolvedValueOnce([
      {
        user_id: 1,
        username: "cashier1",
        revenue_usd: 0,
        revenue_lbp: 0,
        profit_usd: 20,
        profit_lbp: 0,
        transaction_count: 1,
        recognized_transaction_count: 1,
        pending_profit_usd: 0,
        pending_profit_lbp: 0,
      },
    ]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by cashier/i }));
    const nameCell = await screen.findByText("cashier1");
    const row = nameCell.closest("tr") as HTMLElement;

    // Scoped to the Profits column specifically (revenue_usd is 0 here, and
    // Avg Profit/Txn also reads "20 USD" for this fixture — both would
    // otherwise collide with a bare page-wide query).
    const cells = within(row).getAllByText("20 USD");
    expect(cells.some((el) => el.className.includes("emerald"))).toBe(true);
  });
});

describe("Profits — By Client tab (Lane LCC)", () => {
  it("PA-4.16: shows a visible error state instead of the empty-data message", async () => {
    mockGetProfitByClient.mockRejectedValueOnce(new Error("Network down"));

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by client/i }));
    await waitFor(() =>
      expect(mockGetProfitByClient).toHaveBeenCalledTimes(1),
    );

    expect(
      await screen.findByText(/Failed to load profit by client/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Network down")).toBeInTheDocument();
    expect(
      screen.queryByText("No data for this period"),
    ).not.toBeInTheDocument();
  });

  it("PA-4.16 (regression): still renders the real empty-data message for a genuine no-activity period", async () => {
    mockGetProfitByClient.mockResolvedValueOnce([]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by client/i }));
    await waitFor(() =>
      expect(mockGetProfitByClient).toHaveBeenCalledTimes(1),
    );

    expect(
      await screen.findByText("No data for this period"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Failed to load profit by client/i),
    ).not.toBeInTheDocument();
  });

  it("PA-1.7: renders revenue_lbp alongside revenue_usd", async () => {
    mockGetProfitByClient.mockResolvedValueOnce([
      {
        client_id: 5,
        client_name: "Jane Doe",
        client_phone: "71000000",
        revenue_usd: 0,
        revenue_lbp: 5000000,
        profit_usd: 0,
        profit_lbp: 0,
        transaction_count: 1,
        recognized_transaction_count: 1,
        pending_profit_usd: 0,
        pending_profit_lbp: 0,
      },
    ]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by client/i }));
    await screen.findByText("Jane Doe");

    expect(screen.getByText("5000000 LBP")).toBeInTheDocument();
  });

  it("PA-4.19: shows a notice when the top-30 cap is reached", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      client_id: i + 1,
      client_name: `Client ${i + 1}`,
      client_phone: null,
      revenue_usd: 10,
      revenue_lbp: 0,
      profit_usd: 1,
      profit_lbp: 0,
      transaction_count: 1,
      recognized_transaction_count: 1,
      pending_profit_usd: 0,
      pending_profit_lbp: 0,
    }));
    mockGetProfitByClient.mockResolvedValueOnce(rows);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by client/i }));
    await screen.findByText("Client 1");

    expect(
      screen.getByText(/top 30 clients by profit/i),
    ).toBeInTheDocument();
  });

  it("PA-4.19: no top-30 notice when under the cap", async () => {
    mockGetProfitByClient.mockResolvedValueOnce([
      {
        client_id: 1,
        client_name: "Only Client",
        client_phone: null,
        revenue_usd: 10,
        revenue_lbp: 0,
        profit_usd: 1,
        profit_lbp: 0,
        transaction_count: 1,
        recognized_transaction_count: 1,
        pending_profit_usd: 0,
        pending_profit_lbp: 0,
      },
    ]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by client/i }));
    await screen.findByText("Only Client");

    expect(
      screen.queryByText(/top 30 clients by profit/i),
    ).not.toBeInTheDocument();
  });

  it("LCC-X10: a negative profit_usd renders in the loss color, not emerald", async () => {
    mockGetProfitByClient.mockResolvedValueOnce([
      {
        client_id: 5,
        client_name: "Jane Doe",
        client_phone: null,
        revenue_usd: 0,
        revenue_lbp: 0,
        profit_usd: -12,
        profit_lbp: 0,
        transaction_count: 1,
        recognized_transaction_count: 1,
        pending_profit_usd: 0,
        pending_profit_lbp: 0,
      },
    ]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by client/i }));
    const nameCell = await screen.findByText("Jane Doe");
    const row = nameCell.closest("tr") as HTMLElement;

    const cell = within(row).getByText("-12 USD");
    expect(cell.className).not.toMatch(/emerald/);
    expect(cell.className).toMatch(/red/);
  });
});
