/** @jest-environment jsdom */

/**
 * LIRA-321 (T025 UI half, FR-014) — the Exchange history shows who the
 * exchange was for. `ExchangeRepository.getHistory` now projects
 * `client_id` + `client_full_name` (the saved client's current name); the
 * row shows that name when the exchange is linked to a client, else the
 * typed `client_name`, else nothing.
 */

import { render, screen } from "@testing-library/react";

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));
const mockApi = {
  updateExchangeMetadata: jest.fn(),
  exchangeLots: { getBreakdown: jest.fn() },
};

import { HistoryModal } from "../HistoryModal";

const base = {
  created_at: "2026-10-14 10:00:00",
  from_currency: "LBP",
  to_currency: "USD",
  rate: 89500,
  leg1_rate: null,
  leg1_market_rate: null,
  leg1_profit_usd: null,
  leg2_rate: null,
  leg2_market_rate: null,
  leg2_profit_usd: null,
  via_currency: null,
  profit_usd: 1,
  amount_out: 1000,
  is_refunded: 0,
  refunded_at: null,
};

describe("Exchange HistoryModal — linked client (LIRA-321)", () => {
  it("shows the saved client's name for a linked exchange, the typed name otherwise", () => {
    render(
      <HistoryModal
        transactions={[
          {
            ...base,
            id: 11,
            amount_in: 89_500_000,
            client_id: 42,
            client_full_name: "Rami Haddad",
            client_name: "rami (typed)",
          },
          {
            ...base,
            id: 12,
            amount_in: 44_750_000,
            client_id: null,
            client_full_name: null,
            client_name: "Walk-in Sami",
          },
          {
            ...base,
            id: 13,
            amount_in: 8_950_000,
            client_id: null,
            client_full_name: null,
            client_name: null,
          },
        ]}
        loading={false}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );

    expect(screen.getByTestId("exchange-history-client-11")).toHaveTextContent(
      "Rami Haddad",
    );
    expect(
      screen.getByTestId("exchange-history-client-11"),
    ).not.toHaveTextContent("rami (typed)");
    expect(screen.getByTestId("exchange-history-client-12")).toHaveTextContent(
      "Walk-in Sami",
    );
    expect(
      screen.queryByTestId("exchange-history-client-13"),
    ).not.toBeInTheDocument();
  });
});
