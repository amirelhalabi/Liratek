/** @jest-environment jsdom */

/**
 * Profits — By Cashier / By Client tabs, Round 2 adversarial review
 * (OWNER_NOTES_2026-09-21.md §6, Lane LCC): LCC-V3 (exchange profit caption)
 * and LCC-V6 (Avg Profit/Txn LBP line). Same drive-the-real-page pattern as
 * `Profits.byCashierByClientLaneLCC.test.tsx` (layer-seam-testing lesson).
 *
 * RULE 17 — failing-first proof, this session (from the agent shell):
 *
 *   1. LCC-V3 caption: reverted the By Cashier caption text back to
 *      "Excludes exchange profit and counterparty discounts…" via Edit
 *      (this lane's own code), re-ran this file. RED, verbatim:
 *        "LCC-V3: the By Cashier caption no longer claims exchange profit
 *        is excluded" — TestingLibraryElementError: Unable to find an
 *        element with the text: /excludes counterparty discounts/i.
 *      Restored; re-ran: GREEN.
 *
 *   2. LCC-V6 LBP line: reverted the Avg Profit/Txn cell back to rendering
 *      ONLY the USD figure (removed the conditional LBP `<div>`) via Edit,
 *      re-ran this file. RED, verbatim:
 *        "LCC-V6: shows an LBP average line under the USD one" —
 *        TestingLibraryElementError: Unable to find an element with the
 *        text: /5,000 LBP/ (found only "10 USD").
 *      Restored; re-ran: GREEN.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    formatAmount: (v: number, c: string) =>
      c === "LBP" ? `${v.toLocaleString()} LBP` : `${v} ${c}`,
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

describe("Profits — By Cashier tab, Round 2 (LCC-V3 caption)", () => {
  it("no longer claims exchange profit is excluded — only counterparty discounts", async () => {
    mockGetProfitByUser.mockResolvedValueOnce([]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by cashier/i }));
    await waitFor(() => expect(mockGetProfitByUser).toHaveBeenCalledTimes(1));

    expect(
      await screen.findByText(/excludes counterparty discounts/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/excludes exchange profit/i),
    ).not.toBeInTheDocument();
  });

  it("By Client caption is UNCHANGED — still excludes exchange profit (no client_id on an exchange row)", async () => {
    mockGetProfitByClient.mockResolvedValueOnce([]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by client/i }));
    await waitFor(() =>
      expect(mockGetProfitByClient).toHaveBeenCalledTimes(1),
    );

    expect(
      await screen.findByText(/excludes exchange profit/i),
    ).toBeInTheDocument();
  });
});

describe("Profits — By Cashier tab, Round 2 (LCC-V6 Avg Profit/Txn LBP line)", () => {
  it("shows an LBP average line under the USD one", async () => {
    mockGetProfitByUser.mockResolvedValueOnce([
      {
        user_id: 1,
        username: "cashier1",
        revenue_usd: 0,
        revenue_lbp: 0,
        profit_usd: 20,
        profit_lbp: 10000,
        transaction_count: 2,
        recognized_transaction_count: 2,
        pending_profit_usd: 0,
        pending_profit_lbp: 0,
      },
    ]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by cashier/i }));
    await screen.findByText("cashier1");

    // 20 / 2 = 10 USD, 10000 / 2 = 5000 LBP
    expect(screen.getByText("10 USD")).toBeInTheDocument();
    expect(screen.getByText("5,000 LBP")).toBeInTheDocument();
  });

  it("omits the LBP line when profit_lbp is 0", async () => {
    mockGetProfitByUser.mockResolvedValueOnce([
      {
        user_id: 1,
        username: "cashier1",
        revenue_usd: 0,
        revenue_lbp: 0,
        profit_usd: 20,
        profit_lbp: 0,
        transaction_count: 2,
        recognized_transaction_count: 2,
        pending_profit_usd: 0,
        pending_profit_lbp: 0,
      },
    ]);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /by cashier/i }));
    await screen.findByText("cashier1");

    expect(screen.getByText("10 USD")).toBeInTheDocument();
    expect(screen.queryByText(/0 LBP/)).not.toBeInTheDocument();
  });
});

describe("Profits — By Client tab, Round 2 (LCC-V11 top-30 ranking notice)", () => {
  it("clarifies the cap/ranking is by USD profit", async () => {
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
    expect(screen.getByText(/ranked by USD profit/i)).toBeInTheDocument();
  });
});
