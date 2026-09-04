/** @jest-environment jsdom */

/**
 * LIRA-163 — Recharge page CompactStats "Total Profit" metric for
 * non-crypto providers. Fed by `finAnalytics.today` (getOMTAnalytics,
 * filtered to the active provider), which used to read a bare `$0.00` for
 * an all-post-cutover provider with no way to tell it apart from a provider
 * that genuinely earned nothing today.
 *
 * Component-level test — CompactStats's inputs are plain props.
 */

import { render, screen } from "@testing-library/react";
import { CompactStats } from "../CompactStats";

describe("Recharge CompactStats — Total Profit awaiting-settlement caption (LIRA-163)", () => {
  it("appends the pending count to Total Profit when commission is 0 purely because settlement hasn't happened", () => {
    render(
      <CompactStats
        allProvidersCommission={0}
        allProvidersAwaitingSettlementCount={4}
        todayCount={4}
      />,
    );

    expect(screen.getByText("Total Profit")).toBeInTheDocument();
    expect(screen.getByText("$0.00 · 4 pending")).toBeInTheDocument();
  });

  it("shows a plain dollar figure with no pending caption when nothing is pending", () => {
    render(
      <CompactStats
        allProvidersCommission={7.25}
        allProvidersAwaitingSettlementCount={0}
        todayCount={2}
      />,
    );

    expect(screen.getByText("$7.25")).toBeInTheDocument();
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });

  it("omits the Total Profit metric entirely when allProvidersCommission is undefined (crypto provider)", () => {
    render(<CompactStats showCryptoStats todayCount={0} />);

    expect(screen.queryByText("Total Profit")).not.toBeInTheDocument();
  });
});
