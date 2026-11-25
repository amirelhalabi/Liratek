/** @jest-environment jsdom */

/**
 * LIRA-404 — the Open Positions panel fills Market (USD) and Unrealized P&L
 * from the online feed when the server leaves them blank (no Settings rate
 * row, e.g. EUR after v235). With no feed it keeps "—".
 */
import { render, screen, within } from "@testing-library/react";
import type { CurrencyRate } from "@liratek/core";

const mockGetPositions = jest.fn();
// rule 25: one stable identity for the whole file.
const mockApi = { exchangeLots: { getPositions: mockGetPositions } };

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import { PositionsPanel } from "../PositionsPanel";

const eurFeed: CurrencyRate = {
  to_code: "EUR",
  market_rate: 1.2,
  buy_rate: 1.2,
  sell_rate: 1.2,
  is_stronger: -1,
};

const serverRows = [
  {
    currency_code: "EUR",
    open_qty: 100,
    avg_unit_cost_usd: 1.16,
    lot_count: 2,
    current_market_unit_usd: null,
    unrealized_profit_usd: null,
  },
];

describe("PositionsPanel — market from the online feed (LIRA-404)", () => {
  beforeEach(() => mockGetPositions.mockReset());

  it("fills Market and Unrealized from the feed when the server sends null", async () => {
    mockGetPositions.mockResolvedValue(serverRows);
    render(
      <PositionsPanel
        refreshKey={0}
        onViewCurrency={jest.fn()}
        marketRates={[eurFeed]}
      />,
    );
    const tr = (await screen.findByText("EUR")).closest("tr") as HTMLElement;
    expect(within(tr).getByText("$1.2000")).toBeInTheDocument();
    expect(within(tr).getByText("+$4.00")).toBeInTheDocument(); // 100 × (1.20 − 1.16)
    expect(within(tr).queryByText("—")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Indicative — market feed may be stale/i),
    ).toBeInTheDocument();
  });

  it("keeps '—' when the feed is unavailable", async () => {
    mockGetPositions.mockResolvedValue(serverRows);
    render(
      <PositionsPanel
        refreshKey={0}
        onViewCurrency={jest.fn()}
        marketRates={[]}
      />,
    );
    const tr = (await screen.findByText("EUR")).closest("tr") as HTMLElement;
    expect(within(tr).getAllByText("—")).toHaveLength(2);
  });
});
