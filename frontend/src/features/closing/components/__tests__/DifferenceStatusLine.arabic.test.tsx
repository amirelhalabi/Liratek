/** @jest-environment jsdom */
/**
 * LIRA-335 FR-021 — the transaction that resolved a checkpoint difference is
 * named in the shown language. In Arabic, "Sale" reads "بيع",
 * using the audit namespace's existing title words (LIRA-331
 * `translateTitle`), never a second copy of them. English is unchanged.
 *
 * Rule 17: written before the label was translated.
 */
import { render, screen } from "@testing-library/react";
import type { CheckpointDifferenceView } from "@liratek/core";
import { i18n, switchLanguage } from "@/i18n/setup";
import {
  DifferenceResolutionBlock,
  DifferenceStatusLine,
} from "../DifferenceStatusLine";

function resolvedBySale(): CheckpointDifferenceView {
  return {
    id: 1,
    closing_id: 1,
    closing_created_at: "2026-10-12 15:00:00",
    drawer_name: "General",
    currency_code: "USD",
    amount: 50,
    direction: "OVER",
    resolved: 50,
    open: 0,
    status: "RESOLVED",
    closed_at: null,
    closed_by_name: null,
    shortage_expense_id: null,
    resolutions: [
      {
        transaction_id: 4821,
        transaction_type: "SALE",
        summary: null,
        amount: 50,
        effective_time: "2026-10-12 11:10:00",
        entered_at: "2026-10-13 06:00:00",
        user_name: null,
      },
    ],
  };
}

afterEach(() => i18n.changeLanguage("en"));

describe("checkpoint difference — resolving transaction label (FR-021)", () => {
  it("English names it 'Sale' when it has no summary — never by its internal id", () => {
    render(<DifferenceStatusLine difference={resolvedBySale()} />);
    expect(screen.getByText(/Sale ·/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("#4821");
  });

  it("Arabic names the type in Arabic on the row and in the details", async () => {
    await switchLanguage("ar");
    const { container } = render(
      <>
        <DifferenceStatusLine difference={resolvedBySale()} />
        <DifferenceResolutionBlock difference={resolvedBySale()} />
      </>,
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("Sale");
    expect(text).not.toContain("#4821");
    expect(text.match(/بيع/g)).toHaveLength(2);
  });
});
