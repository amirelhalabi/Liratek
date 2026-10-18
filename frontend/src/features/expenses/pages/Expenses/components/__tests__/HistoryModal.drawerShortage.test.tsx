/** @jest-environment jsdom */
/**
 * LIRA-335 US3 (FR-013) — a Drawer shortage expense in the History window.
 *
 * Closing a Short checkpoint difference books an automatic "Drawer shortage"
 * expense linked to the difference (`source_ref_table`
 * = CHECKPOINT_DIFFERENCE_SOURCE_TABLE). Only Reopen may remove it, so its
 * row offers neither Void nor Edit; every other row is unchanged. The
 * constants come from core (rule 14/24), never retyped.
 *
 * Rule 17: written before the HistoryModal change.
 */

import { render, screen, within } from "@testing-library/react";
import {
  CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
  DRAWER_SHORTAGE_EXPENSE_CATEGORY,
} from "@liratek/core";
import { HistoryModal } from "../HistoryModal";

const SHORTAGE_DESC = "Drawer shortage (General, checkpoint Oct 10, 18:00)";
const SUPPLY_DESC = "Cleaning";

function renderModal() {
  render(
    <HistoryModal
      expenses={[
        {
          id: 1,
          description: SHORTAGE_DESC,
          category: DRAWER_SHORTAGE_EXPENSE_CATEGORY,
          amount_usd: 3,
          amount_lbp: 0,
          expense_date: "2026-10-10",
          source_ref_table: CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
        },
        {
          id: 2,
          description: SUPPLY_DESC,
          category: "Shop_Supply",
          amount_usd: 10,
          amount_lbp: 0,
          expense_date: "2026-10-10",
        },
      ]}
      loading={false}
      onClose={jest.fn()}
      onRefresh={jest.fn()}
      onVoid={jest.fn()}
    />,
  );
}

describe("Expenses HistoryModal — Drawer shortage row (LIRA-335)", () => {
  it("labels the category Drawer shortage and offers no Void or Edit", () => {
    renderModal();
    const row = screen.getByText(SHORTAGE_DESC).closest("tr") as HTMLElement;

    expect(within(row).getByText("Drawer shortage")).toBeInTheDocument();
    expect(within(row).queryByTitle("Void expense")).toBeNull();
    expect(within(row).queryByTitle("Edit metadata")).toBeNull();
  });

  it("leaves every other row's Void and Edit in place", () => {
    renderModal();
    const row = screen.getByText(SUPPLY_DESC).closest("tr") as HTMLElement;

    expect(within(row).getByTitle("Void expense")).toBeInTheDocument();
    expect(within(row).getByTitle("Edit metadata")).toBeInTheDocument();
  });
});
