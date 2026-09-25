/** @jest-environment jsdom */

/**
 * DashboardChart — CHART-m4 (verifier finding, round 1 of the DC-10..12 fix
 * pass).
 *
 * DC-10's two-axis "Profit" layout (a USD `profit` line on the LEFT axis, an
 * LBP `lbp` line on the RIGHT axis) had no render-level guard at all — only
 * the pure axis/tooltip helper functions were unit-tested
 * (`DashboardChart.axisAndTooltip.test.tsx`). A regression that dropped the
 * Profit LBP line entirely, or bound both lines to the same axis, would
 * type-check and pass every existing test.
 *
 * `recharts` needs real layout measurement under jsdom and is slow/flaky
 * there, so this mocks it with thin stand-ins that just surface the props
 * this component passes — the same reasoning
 * `DashboardChart.axisAndTooltip.test.tsx`'s header comment gives for
 * testing the pure helpers in isolation instead of rendering the real
 * chart.
 */

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import DashboardChart from "../DashboardChart";
import { formatLbpAxisTick } from "../../utils/chartFormat";

jest.mock("recharts", () => {
  return {
    __esModule: true,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    LineChart: ({ children }: { children: ReactNode }) => (
      <div data-testid="line-chart">{children}</div>
    ),
    Line: (props: {
      dataKey?: string;
      yAxisId?: string;
      name?: string;
    }) => (
      <div
        data-testid={`line-${props.dataKey}`}
        data-yaxisid={props.yAxisId}
        data-name={props.name}
      />
    ),
    XAxis: () => <div data-testid="xaxis" />,
    YAxis: (props: {
      yAxisId?: string;
      orientation?: string;
      tickFormatter?: (value: number) => string;
    }) => (
      <div
        data-testid={`yaxis-${props.yAxisId}`}
        data-orientation={props.orientation}
        // CHART-V2-m2 (verifier finding, round 2) — the original mock
        // dropped `tickFormatter` entirely, so a regression that reverted
        // the Profit LBP axis to the old inline `/1_000_000 M` lambda
        // (instead of the shared `formatLbpAxisTick`) would type-check and
        // pass every test here. Surface the formatter's OWN output on a
        // sample tick so a swap changes this attribute.
        data-tick-sample={props.tickFormatter?.(25_000)}
      />
    ),
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

const baseProps = {
  chartData: [{ date: "Sep 1", usd: 100, lbp: 9_000_000, profit: 40 }],
  maxUsdSales: 0,
  maxLbpSales: 0,
  getSymbol: (c: string) => (c === "USD" ? "$" : "LBP"),
  formatAmount: (v: number, c: string) => `${v} ${c}`,
};

describe("DashboardChart — Profit series renders on both axes (DC-10, CHART-m4)", () => {
  it("renders a 'profit' (USD) line bound to the LEFT axis", () => {
    render(<DashboardChart {...baseProps} chartType="Profit" />);
    const line = screen.getByTestId("line-profit");
    expect(line.getAttribute("data-yaxisid")).toBe("left");
  });

  it("renders an 'lbp' line bound to the RIGHT axis", () => {
    render(<DashboardChart {...baseProps} chartType="Profit" />);
    const line = screen.getByTestId("line-lbp");
    expect(line.getAttribute("data-yaxisid")).toBe("right");
  });

  it("renders exactly two lines for Profit — no third/duplicate series", () => {
    render(<DashboardChart {...baseProps} chartType="Profit" />);
    expect(screen.getByTestId("line-chart").children).toHaveLength(
      // XAxis, 2x YAxis, 2x Line — CartesianGrid/Tooltip/Legend return null
      5,
    );
  });

  it("renders both a left and a right YAxis for Profit", () => {
    render(<DashboardChart {...baseProps} chartType="Profit" />);
    expect(screen.getByTestId("yaxis-left").getAttribute("data-orientation")).toBe(
      "left",
    );
    expect(
      screen.getByTestId("yaxis-right").getAttribute("data-orientation"),
    ).toBe("right");
  });

  // CHART-V2-m2 (verifier finding, round 2) — guards the Profit LBP axis
  // against reverting to the old inline `/1_000_000 M` lambda (CHART-m1),
  // now that the mock surfaces `tickFormatter`'s own output.
  it("binds the Profit right (LBP) axis to the shared formatLbpAxisTick, not an inline formatter", () => {
    render(<DashboardChart {...baseProps} chartType="Profit" />);
    expect(
      screen.getByTestId("yaxis-right").getAttribute("data-tick-sample"),
    ).toBe(formatLbpAxisTick(25_000));
  });

  it("Sales chartType still renders its own usd/lbp lines (control — this file's mock doesn't break the existing series)", () => {
    render(<DashboardChart {...baseProps} chartType="Sales" />);
    expect(screen.getByTestId("line-usd")).toBeInTheDocument();
    expect(screen.getByTestId("line-lbp")).toBeInTheDocument();
  });
});
