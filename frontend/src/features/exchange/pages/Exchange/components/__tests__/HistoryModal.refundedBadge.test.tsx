/** @jest-environment jsdom */

/**
 * Exchange History modal — refunded-row display (LIRA-131).
 *
 * `exchange_transactions` is in `TransactionRepository._markSourceRefunded`'s
 * supported-tables whitelist (migration v68) — a void/refund of an exchange
 * correctly sets `is_refunded = 1` / `refunded_at`. The "Refunded" badge JSX
 * already existed here (`isRefunded = Boolean(tx.is_refunded)`, LIRA-131
 * audit: "dead badge ready") — it was starved because
 * `ExchangeRepository.getColumns()` never projected either column (fixed in
 * this same change; see ExchangeRepository.refundedRead.test.ts for the
 * backend-side proof). This test proves the frontend half: given data
 * shaped exactly like the FIXED repository now returns it, the badge
 * renders AND the Profit column is neutralised (muted + struck through +
 * tooltip) rather than presenting reversed income as live — mirroring
 * e47dfa2 (Custom Services).
 *
 * Rule 17 (failing-first): the Profit-column neutralisation added by this
 * change did not exist before it (the className ternary had no `isRefunded`
 * branch at all — only totalProfit>=0/<0). Temporarily reverting it made
 * "does not present a live profit" FAIL (the refunded row's $8.00 rendered
 * plain `text-emerald-400`, indistinguishable from the live row) while the
 * badge assertion still passed (the badge logic pre-dated this fix) —
 * confirmed manually, then reverted (see task report for the exact captured
 * output).
 */

import { render, screen, within } from "@testing-library/react";

// EXCHANGE_LOT_SETTLEMENT.md Phase 5 — HistoryModal now calls useApi() (the
// inline metadata edit + the lot-breakdown expansion fetch), which throws
// without an ApiProvider in the tree. This suite never exercises either
// path, so a minimal stub is enough.
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    updateExchangeMetadata: jest.fn(),
    exchangeLots: { getBreakdown: jest.fn() },
  }),
}));

import { HistoryModal } from "../HistoryModal";

// This table has no Client column — rows are distinguished by their unique
// "Amount In" cell text (Number.toLocaleString() + currency), the same
// approach the table itself offers no other unique per-row text for.
const REFUNDED_AMOUNT_IN_TEXT = "100 USD";
const LIVE_AMOUNT_IN_TEXT = "50 USD";

describe("Exchange HistoryModal — refunded row display (LIRA-131)", () => {
  const transactions = [
    {
      id: 1,
      created_at: "2026-08-10 20:00:00",
      from_currency: "USD",
      to_currency: "LBP",
      rate: 89500,
      leg1_rate: null,
      leg1_market_rate: null,
      leg1_profit_usd: null,
      leg2_rate: null,
      leg2_market_rate: null,
      leg2_profit_usd: null,
      via_currency: null,
      profit_usd: 8,
      amount_in: 100,
      amount_out: 8950000,
      is_refunded: 1,
      refunded_at: "2026-08-10 21:00:00",
    },
    {
      id: 2,
      created_at: "2026-08-10 19:00:00",
      from_currency: "USD",
      to_currency: "LBP",
      rate: 89500,
      leg1_rate: null,
      leg1_market_rate: null,
      leg1_profit_usd: null,
      leg2_rate: null,
      leg2_market_rate: null,
      leg2_profit_usd: null,
      via_currency: null,
      profit_usd: 5,
      amount_in: 50,
      amount_out: 4475000,
      is_refunded: 0,
      refunded_at: null,
    },
  ];

  function renderModal() {
    render(
      <HistoryModal
        transactions={transactions}
        loading={false}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );
  }

  it("shows a Refunded badge on the refunded row and NOT on the live row", () => {
    renderModal();

    const refundedRow = screen
      .getByText(REFUNDED_AMOUNT_IN_TEXT)
      .closest("tr");
    const liveRow = screen.getByText(LIVE_AMOUNT_IN_TEXT).closest("tr");
    expect(refundedRow).not.toBeNull();
    expect(liveRow).not.toBeNull();

    expect(
      within(refundedRow as HTMLElement).getByText("Refunded"),
    ).toBeInTheDocument();
    expect(
      within(liveRow as HTMLElement).queryByText("Refunded"),
    ).not.toBeInTheDocument();
  });

  it("does not present a live profit for the refunded row, while the live row's profit stays live", () => {
    renderModal();

    const refundedRow = screen
      .getByText(REFUNDED_AMOUNT_IN_TEXT)
      .closest("tr");
    const liveRow = screen.getByText(LIVE_AMOUNT_IN_TEXT).closest("tr");

    const refundedProfit = within(refundedRow as HTMLElement).getByText(
      "$8.00",
    );
    expect(refundedProfit.className).not.toContain("text-emerald-400");
    expect(refundedProfit.className).toContain("line-through");

    const liveProfit = within(liveRow as HTMLElement).getByText("$5.00");
    expect(liveProfit.className).toContain("text-emerald-400");
    expect(liveProfit.className).not.toContain("line-through");
  });
});
