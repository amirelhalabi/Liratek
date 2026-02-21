import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";

const COLORS = ["#8b5cf6", "#ec4899", "#3b82f6", "#10b981", "#f59e0b"];

interface PieEntry {
  name: string;
  value: number;
}

interface CommissionsChartProps {
  pieData: PieEntry[];
  formatAmount: (value: number, currency: string) => string;
}

export default function CommissionsChart({
  pieData,
  formatAmount,
}: CommissionsChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={pieData}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={80}
          paddingAngle={5}
          dataKey="value"
        >
          {pieData.map((entry) => (
            <Cell
              key={entry.name}
              fill={COLORS[pieData.indexOf(entry) % COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: "#1e293b",
            border: "none",
            borderRadius: "8px",
          }}
          itemStyle={{ color: "#fff" }}
          formatter={(value) => formatAmount(Number(value || 0), "USD")}
        />
        <Legend verticalAlign="bottom" height={36} />
      </PieChart>
    </ResponsiveContainer>
  );
}
