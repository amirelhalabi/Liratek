import { fireEvent, screen } from "@testing-library/react";

/**
 * Owner request (2026-10-16) — the selected supplier's Transactions history
 * and Payments ledger live in their own modals, opened from two header
 * buttons. Page tests that assert on rows of either table open it through
 * this one helper, so the button/dialog wiring is named in one place.
 *
 * Resolves to the open dialog element (scope further queries with `within`).
 */
export async function openSupplierTable(
  which: "transactions" | "payments",
): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId(`supplier-open-${which}`));
  return screen.findByRole("dialog");
}
