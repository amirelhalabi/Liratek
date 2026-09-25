import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
// DC-5/DC-6 helpers live in a plain (non-component) module — see that
// file's doc comment for why (LINT-1, round-2 verifier finding: a
// component file cannot also export plain functions under
// react-refresh/only-export-components).
import {
  formatUsdAxisTick,
  formatLbpAxisTick,
  formatTooltipValue,
} from "../utils/chartFormat";

type ChartType = "Sales" | "Profit";

interface ChartPoint {
  date: string;
  usd?: number;
  lbp?: number;
  profit?: number;
}

interface DashboardChartProps {
  chartData: ChartPoint[];
  chartType: ChartType;
  maxUsdSales: number;
  maxLbpSales: number;
  getSymbol: (code: string) => string;
  formatAmount: (value: number, currency: string) => string;
}

export default function DashboardChart({
  chartData,
  chartType,
  maxUsdSales,
  maxLbpSales,
  // DC-10 (OWNER_NOTES_2026-09-21.md §7.2): the Profit axis now uses the
  // SAME `formatUsdAxisTick`/LBP-millions formatters Sales already uses
  // (two-axis layout, matching Sales), so `getSymbol` is no longer read
  // inside this component. Kept in the prop interface (renamed `_getSymbol`
  // per this repo's unused-arg convention) rather than removed, so the
  // caller's prop doesn't need to change and a future single-axis/typed
  // tick format can reuse it without re-threading the prop.
  getSymbol: _getSymbol,
  formatAmount,
}: DashboardChartProps) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      initialDimension={{ width: 500, height: 300 }}
    >
      <LineChart
        data={chartData}
        margin={{ top: 5, right: 16, left: 8, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
        <XAxis dataKey="date" tick={{ fill: "#94a3b8" }} fontSize={12} />
        {chartType === "Sales" ? (
          <>
            <YAxis
              yAxisId="left"
              orientation="left"
              stroke="#34d399"
              tick={{ fill: "#34d399" }}
              fontSize={12}
              tickFormatter={formatUsdAxisTick}
              domain={[0, maxUsdSales > 0 ? maxUsdSales : "auto"]}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#8b5cf6"
              tick={{ fill: "#8b5cf6" }}
              fontSize={12}
              tickFormatter={formatLbpAxisTick}
              domain={[0, maxLbpSales > 0 ? maxLbpSales : "auto"]}
            />
          </>
        ) : (
          // DC-10 (OWNER_NOTES_2026-09-21.md §7.2) — Profit now carries BOTH
          // currencies (USD on `profit`, LBP on `lbp`), so it gets the SAME
          // two-axis layout as Sales. Deliberately NO forced `[0, max]`
          // domain here (unlike Sales, whose figures are revenue and can
          // never go negative): a day's GROSS profit can be negative (heavy
          // refunds/costs outweighing revenue that day), and clamping the
          // domain at 0 would clip a negative bar/line off the chart
          // entirely. `domain={['auto','auto']}` lets Recharts scale to
          // whatever the data actually is, above or below zero.
          <>
            <YAxis
              yAxisId="left"
              orientation="left"
              stroke="#34d399"
              tick={{ fill: "#34d399" }}
              fontSize={12}
              tickFormatter={formatUsdAxisTick}
              domain={["auto", "auto"]}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#8b5cf6"
              tick={{ fill: "#8b5cf6" }}
              fontSize={12}
              tickFormatter={formatLbpAxisTick}
              domain={["auto", "auto"]}
            />
          </>
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: "rgba(30, 41, 59, 0.9)",
            borderColor: "#475569",
            color: "#cbd5e1",
          }}
          labelStyle={{ fontWeight: "bold" }}
          formatter={(value, name, item) => {
            const dataKey =
              typeof item?.dataKey === "string" ? item.dataKey : undefined;
            return formatTooltipValue(
              value as number | string | undefined,
              typeof name === "string" ? name : String(name ?? ""),
              dataKey,
              formatAmount,
            );
          }}
        />
        <Legend />
        {chartType === "Sales" ? (
          <>
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="usd"
              name="Product & Telecom Sales (USD)"
              stroke="#34d399"
              strokeWidth={2}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="lbp"
              name="Product & Telecom Sales (LBP)"
              stroke="#8b5cf6"
              strokeWidth={2}
            />
          </>
        ) : (
          <>
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="profit"
              name="Profit (USD)"
              stroke="#34d399"
              strokeWidth={2}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="lbp"
              name="Profit (LBP)"
              stroke="#8b5cf6"
              strokeWidth={2}
            />
          </>
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
