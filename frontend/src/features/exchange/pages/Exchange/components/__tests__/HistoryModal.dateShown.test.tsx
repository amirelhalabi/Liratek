/** @jest-environment jsdom */

/**
 * Owner 2026-11-28 — the Exchange history filters by date (From / To), so each
 * row must show its date, not only its time. The date shown is the business
 * (local) day the filter files the row under (rule 27).
 *
 * Rule 17: written before the date was shown and seen failing.
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
import { businessDayOf } from "@/shared/utils/localDay";

const CREATED = "2026-10-14 10:00:00";

describe("Exchange HistoryModal — date shown on each row", () => {
  it("each row carries its business day next to its time", () => {
    render(
      <HistoryModal
        transactions={[
          {
            id: 21,
            created_at: CREATED,
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
            amount_in: 89_500_000,
            amount_out: 1000,
            is_refunded: 0,
            refunded_at: null,
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

    expect(
      screen.getByTestId("exchange-history-date-21").getAttribute("datetime"),
    ).toBe(businessDayOf(CREATED));
  });
});
