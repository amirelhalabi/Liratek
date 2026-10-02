/** @jest-environment jsdom */

/**
 * LIRA-185 owner decision #4 (2026-10-02) — MTC/Alfa History: a sale charged
 * to a customer's account keeps its profit figure but shows a "pending until
 * paid" label (the Profits page does not count that profit until the
 * customer repays); the label disappears once repaid (`profit_pending`
 * false). A refunded row never shows it — there is nothing left to collect.
 *
 * Rule 25: the `useApi()` mock returns ONE stable object.
 * Rule 17: written before the fix; red run recorded in the task report.
 */

import { render, screen, within } from "@testing-library/react";
import { HistoryModal } from "../HistoryModal";
import type { FinancialTransaction } from "../../types";

const mockApi = { getAllSettings: jest.fn().mockResolvedValue([]) };
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const base: Omit<FinancialTransaction, "id" | "client_name"> = {
  provider: "MTC",
  service_type: "SEND",
  amount: 3,
  currency: "LBP",
  cost: 255000,
  commission: 45000,
  created_at: "2026-10-01 10:00:00",
  is_refunded: 0,
  refunded_at: null,
};

function renderRows(rows: FinancialTransaction[]) {
  render(
    <HistoryModal
      transactions={rows}
      provider="MTC"
      onClose={jest.fn()}
      onRefresh={jest.fn()}
    />,
  );
}

function rowOf(client: string): HTMLElement {
  return screen.getByText(client).closest("tr") as HTMLElement;
}

describe("recharge/HistoryModal — profit pending until paid (LIRA-185 #4)", () => {
  it("an unpaid account sale keeps its profit figure AND shows the pending label", () => {
    renderRows([
      { ...base, id: 1, client_name: "Unpaid Client", profit_pending: true },
    ]);
    const row = rowOf("Unpaid Client");
    expect(within(row).getByTestId("profit-pending-label").textContent).toMatch(
      /pending until paid/i,
    );
    expect(row.textContent).toContain("45,000");
  });

  it("once repaid (profit_pending false) the label is gone and the profit stays", () => {
    renderRows([
      { ...base, id: 2, client_name: "Repaid Client", profit_pending: false },
    ]);
    const row = rowOf("Repaid Client");
    expect(within(row).queryByTestId("profit-pending-label")).toBeNull();
    expect(row.textContent).toContain("45,000");
  });

  it("a refunded row never shows the pending label", () => {
    renderRows([
      {
        ...base,
        id: 3,
        client_name: "Refunded Client",
        profit_pending: true,
        is_refunded: 1,
        refunded_at: "2026-10-01 11:00:00",
      },
    ]);
    expect(
      within(rowOf("Refunded Client")).queryByTestId("profit-pending-label"),
    ).toBeNull();
  });
});
