/** @jest-environment jsdom */
/**
 * Owner 2026-11-28 — the Sessions page filters by date (From / To), so each
 * session card must show its date, not only its start / end time. The date
 * shown is the business (local) day of `started_at` (rule 27).
 *
 * `useApi` returns ONE module-level object (rule 25).
 * Rule 17: written before the date was shown and seen failing.
 */
import { render, screen } from "@testing-library/react";
import { businessDayOf } from "@/shared/utils/localDay";

const STARTED = "2026-11-20 09:15:00";
const mockApi = {
  session: {
    getByDateRange: jest.fn().mockResolvedValue({
      success: true,
      sessions: [
        {
          id: 7,
          customer_name: "Rami",
          started_at: STARTED,
          closed_at: "2026-11-20 09:45:00",
          started_by: "admin",
          is_active: 0,
          checkout_total_usd: 0,
          checkout_total_lbp: 0,
          checkout_profit_usd: 0,
          checkout_profit_lbp: 0,
          item_count: 0,
          total_usd: 0,
          total_lbp: 0,
          total_profit_usd: 0,
          total_profit_lbp: 0,
        },
      ],
    }),
    cartGet: jest.fn(),
    getTransactions: jest.fn(),
  },
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

import CustomerSessions from "../index";

describe("CustomerSessions — date shown on each session", () => {
  it("each session card carries its business day", async () => {
    render(<CustomerSessions />);
    const date = await screen.findByTestId("session-date-7");
    expect(date.getAttribute("datetime")).toBe(businessDayOf(STARTED));
  });
});
