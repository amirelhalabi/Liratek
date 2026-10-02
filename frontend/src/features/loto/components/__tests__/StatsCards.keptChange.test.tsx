/** @jest-environment jsdom */

/**
 * Loto StatsCards — "Kept change" line under the Commission card (LIRA-185,
 * owner decision 2026-10-02).
 *
 * The Commission card stays PURE commission; kept change is shown on its own
 * line under it, per currency, so the two read separately and add up to the
 * Profits page's loto figure (the sum itself is pinned against the real
 * writers in core's `LotoReportData.keptChange.test.ts`).
 */
import type { ComponentType } from "react";
import { render, screen } from "@testing-library/react";
import { StatsCards as StatsCardsImpl } from "../StatsCards";

/** The props this guard pins, declared here (not read off the component) so
 *  the file compiles and its assertions run — and fail on what renders —
 *  against a component that has no kept-change props yet. */
type KeptChangeStatsCardsProps = {
  ticketsSold: number;
  totalSales: number;
  totalCommission: number;
  totalPrizes: number;
  totalKeptChangeUsd: number;
  totalKeptChangeLbp: number;
};
const StatsCards =
  StatsCardsImpl as unknown as ComponentType<KeptChangeStatsCardsProps>;

const base = {
  ticketsSold: 1,
  totalSales: 500000,
  totalCommission: 22250,
  totalPrizes: 0,
};

describe("Loto StatsCards — kept change under Commission (LIRA-185)", () => {
  it("shows commission and LBP kept change as separate figures", () => {
    render(
      <StatsCards
        {...base}
        totalKeptChangeLbp={100000}
        totalKeptChangeUsd={0}
      />,
    );
    expect(screen.getByTestId("loto-commission-value")).toHaveTextContent(
      `${(22250).toLocaleString()} LBP`,
    );
    const kept = screen.getByTestId("loto-kept-change");
    expect(kept).toHaveTextContent("Kept change");
    expect(kept).toHaveTextContent(`${(100000).toLocaleString()} LBP`);
    expect(kept).not.toHaveTextContent("$");
  });

  it("shows USD kept change in USD next to the LBP figure", () => {
    render(
      <StatsCards
        {...base}
        totalKeptChangeLbp={50000}
        totalKeptChangeUsd={1}
      />,
    );
    const kept = screen.getByTestId("loto-kept-change");
    expect(kept).toHaveTextContent(`${(50000).toLocaleString()} LBP`);
    expect(kept).toHaveTextContent("$1");
  });

  it("shows only the USD figure when the kept change is USD-only", () => {
    render(
      <StatsCards {...base} totalKeptChangeLbp={0} totalKeptChangeUsd={2} />,
    );
    const kept = screen.getByTestId("loto-kept-change");
    expect(kept).toHaveTextContent("$2");
    expect(kept).not.toHaveTextContent("LBP");
  });

  it("shows 0 LBP kept change when there is none", () => {
    render(
      <StatsCards {...base} totalKeptChangeLbp={0} totalKeptChangeUsd={0} />,
    );
    expect(screen.getByTestId("loto-kept-change")).toHaveTextContent(
      "Kept change0 LBP",
    );
  });
});
