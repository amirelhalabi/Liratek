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
  getSymbol,
  formatAmount,
}: DashboardChartProps) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart
        data={chartData}
        margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
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
              tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
              domain={[0, maxUsdSales > 0 ? maxUsdSales : "auto"]}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#8b5cf6"
              tick={{ fill: "#8b5cf6" }}
              fontSize={12}
              tickFormatter={(value) => `${(value / 1_000_000).toFixed(1)}M`}
              domain={[0, maxLbpSales > 0 ? maxLbpSales : "auto"]}
            />
          </>
        ) : (
          <YAxis
            tick={{ fill: "#94a3b8" }}
            fontSize={12}
            tickFormatter={(value) => `${getSymbol("USD")}${value}`}
          />
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: "rgba(30, 41, 59, 0.9)",
            borderColor: "#475569",
            color: "#cbd5e1",
          }}
          labelStyle={{ fontWeight: "bold" }}
          formatter={(value: number | string | undefined, name?: string) => {
            const valNum =
              typeof value === "number" ? value : Number(value ?? 0);
            const label = name ?? "";
            if (label === "LBP Sales") {
              return [formatAmount(valNum, "LBP"), label];
            }
            if (label === "Profit") {
              return [formatAmount(valNum, "USD"), label];
            }
            return [
              `${valNum.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
              label,
            ];
          }}
        />
        <Legend />
        {chartType === "Sales" ? (
          <>
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="usd"
              name="USD Sales"
              stroke="#34d399"
              strokeWidth={2}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="lbp"
              name="LBP Sales"
              stroke="#8b5cf6"
              strokeWidth={2}
            />
          </>
        ) : (
          <Line
            type="monotone"
            dataKey="profit"
            name="Profit"
            stroke="#34d399"
            strokeWidth={2}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
