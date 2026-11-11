/**
 * CompactStats — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen } from "@testing-library/react";
import { CompactStats } from "../CompactStats";
import { PROVIDER_CONFIGS } from "../../types";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("CompactStats.awaitingSettlement (LIRA-163)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-163 — Recharge page CompactStats "Total Profit" metric for
   * non-crypto providers. Fed by `finAnalytics.today` (getOMTAnalytics,
   * filtered to the active provider), which used to read a bare `$0.00` for
   * an all-post-cutover provider with no way to tell it apart from a provider
   * that genuinely earned nothing today.
   *
   * Component-level test — CompactStats's inputs are plain props.
   */

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
});

describe("CompactStats.iconChips", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Stats strip as icon chips: each metric shows an icon and its value; its
   * name is visually hidden (still read by screen readers and tests) and shown
   * on hover as a tooltip. Written before the change (rule 17).
   */

  const whish = PROVIDER_CONFIGS.find((p) => p.key === "WHISH_APP");

  function chipOf(name: string): HTMLElement {
    const label = screen.getByText(name);
    const chip = label.closest<HTMLElement>("[data-stat-chip]");
    if (!chip) throw new Error(`no chip around "${name}"`);
    return chip;
  }

  describe("CompactStats — icon chips", () => {
    beforeEach(() => {
      render(
        <CompactStats
          {...(whish ? { activeConfig: whish } : {})}
          isAdmin
          todayCommission={0}
          todayCount={0}
          allProvidersCommission={0}
          drawerBalance={{ usdBalance: -485.79, lbpBalance: 33600000 }}
        />,
      );
    });

    it("each metric is an icon + value, its name visually hidden", () => {
      for (const name of ["Profit", "Total Profit", "Count", "Drawer"]) {
        const chip = chipOf(name);
        expect(chip.querySelector("svg")).not.toBeNull();
        expect(screen.getByText(name)).toHaveClass("sr-only");
      }
    });

    it("hovering a chip names it", () => {
      expect(chipOf("Profit")).toHaveAttribute("title", "Profit today");
      expect(chipOf("Count")).toHaveAttribute("title", "Sales today");
      expect(chipOf("Drawer")).toHaveAttribute("title", "Whish App drawer");
    });

    it("drawer value reads USD · LBP", () => {
      expect(screen.getByText("$-485.79 · 33,600,000 LBP")).toBeInTheDocument();
    });

    it("the strip is 48px tall, matching the provider tabs", () => {
      const strip = chipOf("Profit").parentElement as HTMLElement;
      expect(strip).toHaveClass("h-12");
    });
  });
});
