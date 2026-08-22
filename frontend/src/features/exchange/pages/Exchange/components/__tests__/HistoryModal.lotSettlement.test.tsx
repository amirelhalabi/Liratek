/** @jest-environment jsdom */

/**
 * Exchange History modal — lot-settlement UI (EXCHANGE_LOT_SETTLEMENT.md
 * Phase 5 / Q16): the Status/Remaining/Realized columns derived from
 * `lot_summary`/`settler_summary`, the currency filter, and the expandable
 * per-row settlement breakdown fetched lazily via
 * `useApi().exchangeLots.getBreakdown`.
 *
 * Row fixtures (all fields the component actually reads):
 *  - id 10: Open BUY   — EUR→USD, lot_summary fully unsettled.
 *  - id 11: Partial BUY — EUR→USD, lot_summary 40% settled.
 *  - id 12: Settled BUY — EUR→USD, lot_summary remaining_qty within epsilon of 0.
 *  - id 13: SELL        — USD→EUR, settler_summary only (no lot_summary).
 *  - id 14: plain USD↔LBP row — neither summary (pre-existing behavior).
 */

import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

const mockUpdateExchangeMetadata = jest.fn();
const mockGetBreakdown = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    updateExchangeMetadata: mockUpdateExchangeMetadata,
    exchangeLots: { getBreakdown: mockGetBreakdown },
  }),
}));

import { HistoryModal } from "../HistoryModal";

// Deliberately DISTINCT from each row's own lot_summary.original_qty/
// remaining_qty below (an "Open" lot's remaining_qty always equals its
// original_qty, which the component has no reason to also equal amount_in —
// keeping them apart avoids a same-row text collision on `getByText`).
const OPEN_BUY_AMOUNT_IN = "505 EUR";
const PARTIAL_BUY_AMOUNT_IN = "1,010 EUR";
const SETTLED_BUY_AMOUNT_IN = "205 EUR";
const SELL_AMOUNT_IN = "580 USD";
const PLAIN_AMOUNT_IN = "50 USD";

const transactions = [
  {
    id: 10,
    created_at: "2026-08-20 10:00:00",
    from_currency: "EUR",
    to_currency: "USD",
    rate: 1.1,
    leg1_rate: 1.1,
    leg1_market_rate: 1.1,
    leg1_profit_usd: 0,
    leg2_rate: null,
    leg2_market_rate: null,
    leg2_profit_usd: null,
    via_currency: null,
    profit_usd: 0,
    amount_in: 505,
    amount_out: 550,
    lot_summary: {
      original_qty: 500,
      remaining_qty: 500,
      settled_qty: 0,
      realized_profit_usd: 0,
      is_voided: 0,
    },
    settler_summary: null,
  },
  {
    id: 11,
    created_at: "2026-08-19 09:00:00",
    from_currency: "EUR",
    to_currency: "USD",
    rate: 1.1,
    leg1_rate: 1.1,
    leg1_market_rate: 1.1,
    leg1_profit_usd: 0,
    leg2_rate: null,
    leg2_market_rate: null,
    leg2_profit_usd: null,
    via_currency: null,
    profit_usd: 0,
    amount_in: 1010,
    amount_out: 1100,
    lot_summary: {
      original_qty: 1000,
      remaining_qty: 600,
      settled_qty: 400,
      realized_profit_usd: 12.5,
      is_voided: 0,
    },
    settler_summary: null,
  },
  {
    id: 12,
    created_at: "2026-08-18 08:00:00",
    from_currency: "EUR",
    to_currency: "USD",
    rate: 1.1,
    leg1_rate: 1.1,
    leg1_market_rate: 1.1,
    leg1_profit_usd: 0,
    leg2_rate: null,
    leg2_market_rate: null,
    leg2_profit_usd: null,
    via_currency: null,
    profit_usd: 0,
    amount_in: 205,
    amount_out: 220,
    lot_summary: {
      original_qty: 200,
      remaining_qty: 0.001,
      settled_qty: 199.999,
      realized_profit_usd: 5,
      is_voided: 0,
    },
    settler_summary: null,
  },
  {
    id: 13,
    created_at: "2026-08-17 07:00:00",
    from_currency: "USD",
    to_currency: "EUR",
    rate: 0.91,
    leg1_rate: 0.91,
    leg1_market_rate: 0.9,
    leg1_profit_usd: 8,
    leg2_rate: null,
    leg2_market_rate: null,
    leg2_profit_usd: null,
    via_currency: null,
    profit_usd: 8,
    amount_in: 580,
    amount_out: 527,
    lot_summary: null,
    settler_summary: { settled_qty: 527, realized_profit_usd: 8 },
  },
  {
    id: 14,
    created_at: "2026-08-16 06:00:00",
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
    lot_summary: null,
    settler_summary: null,
  },
];

function renderModal(initialCurrencyFilter?: string) {
  render(
    <HistoryModal
      transactions={transactions}
      loading={false}
      onClose={jest.fn()}
      onRefresh={jest.fn()}
      {...(initialCurrencyFilter !== undefined ? { initialCurrencyFilter } : {})}
    />,
  );
}

function rowFor(amountInText: string): HTMLElement {
  return screen.getByText(amountInText).closest("tr") as HTMLElement;
}

describe("Exchange HistoryModal — lot status derivation (Q16)", () => {
  beforeEach(() => {
    mockGetBreakdown.mockReset();
    mockUpdateExchangeMetadata.mockReset();
  });

  it("shows Open for a fully-unsettled lot", () => {
    renderModal();
    const row = rowFor(OPEN_BUY_AMOUNT_IN);
    expect(within(row).getByText("Open")).toBeInTheDocument();
    expect(within(row).getByText("500 EUR")).toBeInTheDocument(); // remaining
  });

  it("shows Partial with the settled percentage for a partially-settled lot", () => {
    renderModal();
    const row = rowFor(PARTIAL_BUY_AMOUNT_IN);
    // settled_qty 400 / original_qty 1000 = 40%
    expect(within(row).getByText("Partial (40%)")).toBeInTheDocument();
    expect(within(row).getByText("600 EUR")).toBeInTheDocument(); // remaining
    expect(within(row).getByText("+$12.50")).toBeInTheDocument(); // realized
  });

  it("shows Settled once remaining_qty is within the epsilon of zero", () => {
    renderModal();
    const row = rowFor(SETTLED_BUY_AMOUNT_IN);
    expect(within(row).getByText("Settled")).toBeInTheDocument();
  });

  it("shows a dash for Status/Remaining/Realized on a sell-only row (settler_summary, no lot_summary)", () => {
    renderModal();
    const row = rowFor(SELL_AMOUNT_IN);
    // 3 dashes: Status, Remaining, Realized (Via already has its own dash,
    // so this row carries 4 "—" total — assert at least the 3 lot columns).
    const dashes = within(row).getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
    // The existing Profit column is untouched — still shows the live figure.
    expect(within(row).getByText("$8.00")).toBeInTheDocument();
  });

  it("shows dashes across the board for a plain USD<->LBP row (no lot data at all)", () => {
    renderModal();
    const row = rowFor(PLAIN_AMOUNT_IN);
    const dashes = within(row).getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Exchange HistoryModal — currency filter (Q17)", () => {
  beforeEach(() => {
    mockGetBreakdown.mockReset();
  });

  it("lists every from/to currency across the loaded rows plus All", () => {
    renderModal();
    const select = screen.getByTitle("Filter by currency");
    const optionLabels = within(select as HTMLElement)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(optionLabels).toEqual(
      expect.arrayContaining(["All Currencies", "EUR", "USD", "LBP"]),
    );
  });

  it("filters to rows whose from OR to currency matches the selection", () => {
    renderModal();
    fireEvent.change(screen.getByTitle("Filter by currency"), {
      target: { value: "LBP" },
    });
    // Only the plain USD<->LBP row touches LBP.
    expect(screen.getByText(PLAIN_AMOUNT_IN)).toBeInTheDocument();
    expect(screen.queryByText(OPEN_BUY_AMOUNT_IN)).not.toBeInTheDocument();
    expect(screen.queryByText(SELL_AMOUNT_IN)).not.toBeInTheDocument();
  });

  it("honors an initialCurrencyFilter preset (PositionsPanel's per-row view action)", () => {
    renderModal("EUR");
    // Every EUR-touching row stays visible...
    expect(screen.getByText(OPEN_BUY_AMOUNT_IN)).toBeInTheDocument();
    expect(screen.getByText(SELL_AMOUNT_IN)).toBeInTheDocument();
    // ...the LBP-only row does not.
    expect(screen.queryByText(PLAIN_AMOUNT_IN)).not.toBeInTheDocument();
  });
});

describe("Exchange HistoryModal — expandable settlement breakdown (Q16)", () => {
  beforeEach(() => {
    mockGetBreakdown.mockReset();
  });

  it("does not fetch a breakdown until a lot-touched row is clicked", () => {
    renderModal();
    expect(mockGetBreakdown).not.toHaveBeenCalled();
  });

  it("lazily fetches and renders the breakdown for a lot-touched row on click", async () => {
    mockGetBreakdown.mockResolvedValue({
      asSettler: [],
      againstSource: [
        {
          id: 1,
          qty: 400,
          unit_cost_usd: 1.1,
          unit_proceeds_usd: 1.13,
          profit_usd: 12.5,
          basis_source: "LOT",
          is_refunded: 0,
          created_at: "2026-08-20 11:00:00",
        },
      ],
    });
    renderModal();
    fireEvent.click(rowFor(PARTIAL_BUY_AMOUNT_IN));

    expect(mockGetBreakdown).toHaveBeenCalledWith(11);
    expect(screen.getByText(/Loading settlement breakdown/i)).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText("+$12.5000")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Later settlements against this lot/i)).toBeInTheDocument();

    // Toggling again collapses without a second fetch.
    fireEvent.click(rowFor(PARTIAL_BUY_AMOUNT_IN));
    expect(screen.queryByText("+$12.5000")).not.toBeInTheDocument();
    fireEvent.click(rowFor(PARTIAL_BUY_AMOUNT_IN));
    await waitFor(() =>
      expect(screen.getByText("+$12.5000")).toBeInTheDocument(),
    );
    expect(mockGetBreakdown).toHaveBeenCalledTimes(1);
  });

  it("shows the loading then error state when the fetch rejects", async () => {
    mockGetBreakdown.mockRejectedValue(new Error("network down"));
    renderModal();
    fireEvent.click(rowFor(OPEN_BUY_AMOUNT_IN));
    await waitFor(() =>
      expect(
        screen.getByText(/Failed to load settlement breakdown/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows an empty state when a lot-touched row has no settlements yet", async () => {
    mockGetBreakdown.mockResolvedValue({ asSettler: [], againstSource: [] });
    renderModal();
    fireEvent.click(rowFor(OPEN_BUY_AMOUNT_IN));
    await waitFor(() =>
      expect(screen.getByText(/No settlements recorded/i)).toBeInTheDocument(),
    );
  });

  it("never fetches a breakdown for a row with no lot data at all", () => {
    renderModal();
    fireEvent.click(rowFor(PLAIN_AMOUNT_IN));
    expect(mockGetBreakdown).not.toHaveBeenCalled();
  });

  it("marks a refunded settlement with a strike-through and flags a MARKET-basis settlement", async () => {
    mockGetBreakdown.mockResolvedValue({
      asSettler: [
        {
          id: 2,
          qty: 100,
          unit_cost_usd: 0.9,
          unit_proceeds_usd: 0.85,
          profit_usd: -5,
          basis_source: "MARKET",
          is_refunded: 1,
          created_at: "2026-08-17 07:30:00",
        },
      ],
      againstSource: [],
    });
    renderModal();
    fireEvent.click(rowFor(SELL_AMOUNT_IN));

    await waitFor(() => expect(screen.getByText("MARKET")).toBeInTheDocument());
    // No separate sign-flip on this table (matches the pre-existing Profit
    // column convention) — a negative profit_usd carries its own "-" from
    // toFixed(), rendered after the literal "$".
    const negProfit = screen.getByText("$-5.0000");
    expect(negProfit.className).toContain("text-red-400");
    const settlementRow = negProfit.closest("tr");
    expect(settlementRow?.className).toContain("line-through");
  });
});

describe("Exchange HistoryModal — metadata edit routes through useApi (rule 19)", () => {
  it("saves via api.updateExchangeMetadata, not a raw window.api call", async () => {
    mockUpdateExchangeMetadata.mockResolvedValue({ success: true, data: {} });
    renderModal();

    const row = rowFor(PLAIN_AMOUNT_IN);
    fireEvent.click(within(row).getByTitle("Edit metadata"));
    fireEvent.click(screen.getByTitle("Save"));

    await waitFor(() =>
      expect(mockUpdateExchangeMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ id: 14 }),
      ),
    );
  });
});
