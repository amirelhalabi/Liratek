/** @jest-environment jsdom */

/**
 * PositionsPanel (EXCHANGE_LOT_SETTLEMENT.md Q16) — the Exchange page's
 * open-positions panel, fed by useApi().exchangeLots.getPositions(). Proves:
 * loading/empty/error states, a null current-market renders "—" instead of
 * a stale/fabricated number, the "Indicative" caption always accompanies a
 * non-empty table, unrealized P&L color/sign, and the per-row "view" action.
 */

import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";

const mockGetPositions = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    exchangeLots: { getPositions: mockGetPositions },
  }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import { PositionsPanel } from "../PositionsPanel";

describe("PositionsPanel", () => {
  beforeEach(() => {
    mockGetPositions.mockReset();
  });

  it("shows a loading state while the read is in flight", () => {
    mockGetPositions.mockReturnValue(new Promise(() => {})); // never resolves
    render(<PositionsPanel refreshKey={0} onViewCurrency={jest.fn()} />);
    expect(screen.getByText(/Loading positions/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no open positions", async () => {
    mockGetPositions.mockResolvedValue([]);
    render(<PositionsPanel refreshKey={0} onViewCurrency={jest.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByText(/No open exotic-currency positions/i),
      ).toBeInTheDocument(),
    );
    // No indicative caption when there's nothing to caveat.
    expect(
      screen.queryByText(/Indicative — market feed may be stale/i),
    ).not.toBeInTheDocument();
  });

  it("shows an error state when the read rejects", async () => {
    mockGetPositions.mockRejectedValue(new Error("boom"));
    render(<PositionsPanel refreshKey={0} onViewCurrency={jest.fn()} />);
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });

  it("renders a row per open position, with '—' for a null market/unrealized P&L", async () => {
    mockGetPositions.mockResolvedValue([
      {
        currency_code: "EUR",
        open_qty: 500,
        avg_unit_cost_usd: 1.1,
        lot_count: 2,
        current_market_unit_usd: null,
        unrealized_profit_usd: null,
      },
    ]);
    render(<PositionsPanel refreshKey={0} onViewCurrency={jest.fn()} />);

    const row = await screen.findByText("EUR");
    const tr = row.closest("tr") as HTMLElement;
    expect(tr).not.toBeNull();
    // Two "—" cells: current market and unrealized P&L.
    expect(within(tr).getAllByText("—")).toHaveLength(2);
    expect(
      screen.getByText(/Indicative — market feed may be stale/i),
    ).toBeInTheDocument();
  });

  it("colors unrealized P&L green for a gain and red for a loss, with a market value shown", async () => {
    mockGetPositions.mockResolvedValue([
      {
        currency_code: "EUR",
        open_qty: 500,
        avg_unit_cost_usd: 1.1,
        lot_count: 1,
        current_market_unit_usd: 1.15,
        unrealized_profit_usd: 25,
      },
      {
        currency_code: "GBP",
        open_qty: 300,
        avg_unit_cost_usd: 1.3,
        lot_count: 1,
        current_market_unit_usd: 1.2,
        unrealized_profit_usd: -30,
      },
    ]);
    render(<PositionsPanel refreshKey={0} onViewCurrency={jest.fn()} />);

    const gain = await screen.findByText("+$25.00");
    expect(gain.className).toContain("text-emerald-400");
    // No separate sign-flip — a negative value carries its own "-" from
    // toFixed() after the literal "$" (matches HistoryModal's convention).
    const loss = screen.getByText("$-30.00");
    expect(loss.className).toContain("text-red-400");

    expect(screen.getByText("$1.1500")).toBeInTheDocument();
    expect(screen.getByText("$1.2000")).toBeInTheDocument();
  });

  it("excludes a currency whose open_qty is at/below the lot-quantity epsilon", async () => {
    mockGetPositions.mockResolvedValue([
      {
        currency_code: "EUR",
        open_qty: 0.001,
        avg_unit_cost_usd: 1.1,
        lot_count: 1,
        current_market_unit_usd: 1.1,
        unrealized_profit_usd: 0,
      },
    ]);
    render(<PositionsPanel refreshKey={0} onViewCurrency={jest.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByText(/No open exotic-currency positions/i),
      ).toBeInTheDocument(),
    );
  });

  it("calls onViewCurrency with the row's currency when its view action is clicked", async () => {
    mockGetPositions.mockResolvedValue([
      {
        currency_code: "EUR",
        open_qty: 500,
        avg_unit_cost_usd: 1.1,
        lot_count: 1,
        current_market_unit_usd: 1.15,
        unrealized_profit_usd: 25,
      },
    ]);
    const onViewCurrency = jest.fn();
    render(<PositionsPanel refreshKey={0} onViewCurrency={onViewCurrency} />);

    const viewButton = await screen.findByTitle("View EUR history");
    fireEvent.click(viewButton);
    expect(onViewCurrency).toHaveBeenCalledWith("EUR");
  });

  it("refetches when refreshKey changes", async () => {
    mockGetPositions.mockResolvedValue([]);
    const { rerender } = render(
      <PositionsPanel refreshKey={0} onViewCurrency={jest.fn()} />,
    );
    await waitFor(() => expect(mockGetPositions).toHaveBeenCalledTimes(1));

    rerender(<PositionsPanel refreshKey={1} onViewCurrency={jest.fn()} />);
    await waitFor(() => expect(mockGetPositions).toHaveBeenCalledTimes(2));
  });
});
