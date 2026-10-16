/** @jest-environment jsdom */
/**
 * Stats strip as icon chips: each metric shows an icon and its value; its
 * name is visually hidden (still read by screen readers and tests) and shown
 * on hover as a tooltip. Written before the change (rule 17).
 */
import { render, screen } from "@testing-library/react";
import { CompactStats } from "../CompactStats";
import { PROVIDER_CONFIGS } from "../../types";

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
});
