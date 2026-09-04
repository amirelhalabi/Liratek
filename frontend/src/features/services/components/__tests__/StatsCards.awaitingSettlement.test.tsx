/** @jest-environment jsdom */

/**
 * LIRA-163 — Services (OMT/Whish) page header. Today/Month commission chips
 * read a bare `$0.00` for an all-post-cutover period, on the very page these
 * transactions are entered, with nothing hinting the commission exists.
 * `FinancialServiceRepository.getAnalytics` now carries
 * `today`/`month.awaiting_settlement_count`; this proves the header chip
 * renders it.
 *
 * Component-level test (not the full Services page) — this component's
 * inputs are plain props, so a page-level render would only add unrelated
 * setup noise without covering anything this test doesn't already exercise.
 */

import { render, screen } from "@testing-library/react";
import { StatsCards } from "../StatsCards";

describe("Services StatsCards — awaiting-settlement caption (LIRA-163)", () => {
  it("shows the count on the Today chip when commission is 0 purely because settlement hasn't happened", () => {
    render(
      <StatsCards
        todayCommission={0}
        monthCommission={0}
        todayAwaitingSettlementCount={3}
        monthAwaitingSettlementCount={10}
        owedByProvider={{}}
      />,
    );

    expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
    expect(
      screen.getByTestId("services-today-awaiting-settlement").textContent,
    ).toContain("3 awaiting settlement");
    expect(
      screen.getByTestId("services-month-awaiting-settlement").textContent,
    ).toContain("10 awaiting settlement");
  });

  it("omits both captions when there is genuinely no pending commission", () => {
    render(
      <StatsCards
        todayCommission={12.5}
        monthCommission={340}
        todayAwaitingSettlementCount={0}
        monthAwaitingSettlementCount={0}
        owedByProvider={{}}
      />,
    );

    expect(
      screen.queryByTestId("services-today-awaiting-settlement"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("services-month-awaiting-settlement"),
    ).not.toBeInTheDocument();
  });

  it("defaults to omitted when the props are simply absent (older cached payload shape)", () => {
    render(
      <StatsCards todayCommission={0} monthCommission={0} owedByProvider={{}} />,
    );

    expect(
      screen.queryByTestId("services-today-awaiting-settlement"),
    ).not.toBeInTheDocument();
  });
});
