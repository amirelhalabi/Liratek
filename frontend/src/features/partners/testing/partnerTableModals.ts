import { fireEvent, screen } from "@testing-library/react";

/**
 * LIRA-340 — the selected partner's Transactions and Payments open in their
 * own windows from two header buttons (like the Suppliers page). Page tests
 * that read ledger rows open the window through this one helper.
 *
 * Resolves to the open dialog element (scope further queries with `within`).
 */
export async function openPartnerTable(
  which: "transactions" | "payments",
): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId(`partner-open-${which}`));
  return screen.findByRole("dialog");
}
