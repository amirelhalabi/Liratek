import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";

// Realized commission colors (solid)
const REALIZED_COLORS = ["#8b5cf6", "#ec4899", "#3b82f6", "#10b981", "#6366f1"];
// Pending commission colors (amber/muted — always amber to indicate pending)
const PENDING_COLOR = "#f59e0b";

interface PieEntry {
  name: string;
  value: number;
  pending?: number;
}

interface CommissionsChartProps {
  pieData: PieEntry[];
  formatAmount: (value: number, currency: string) => string;
}

export default function CommissionsChart({
  pieData,
  formatAmount,
}: CommissionsChartProps) {
  // Build two rings:
  // Inner ring: realized (settled) commission per provider
  // Outer ring: pending commission per provider (amber slices)
  const realizedData = pieData.filter((p) => p.value > 0);
  const pendingData = pieData
    .filter((p) => (p.pending ?? 0) > 0)
    .map((p) => ({ name: `${p.name} (Pending)`, value: p.pending! }));

  const hasPending = pendingData.length > 0;
  const hasRealized = realizedData.length > 0;

  // If nothing to show, show a placeholder
  if (!hasRealized && !hasPending) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        No commission data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        {/* Inner ring: realized */}
        {hasRealized && (
          <Pie
            data={realizedData}
            cx="50%"
            cy="50%"
            innerRadius={hasPending ? 45 : 55}
            outerRadius={hasPending ? 70 : 80}
            paddingAngle={5}
            dataKey="value"
            nameKey="name"
          >
            {realizedData.map((entry, i) => (
              <Cell
                key={`realized-${entry.name}`}
                fill={REALIZED_COLORS[i % REALIZED_COLORS.length]}
              />
            ))}
          </Pie>
        )}

        {/* Outer ring: pending (amber) — shown only when there's pending data */}
        {hasPending && (
          <Pie
            data={pendingData}
            cx="50%"
            cy="50%"
            innerRadius={75}
            outerRadius={90}
            paddingAngle={3}
            dataKey="value"
            nameKey="name"
          >
            {pendingData.map((entry) => (
              <Cell
                key={`pending-${entry.name}`}
                fill={PENDING_COLOR}
                opacity={0.8}
              />
            ))}
          </Pie>
        )}

        <Tooltip
          contentStyle={{
            backgroundColor: "#1e293b",
            border: "1px solid #334155",
            borderRadius: "8px",
          }}
          itemStyle={{ color: "#fff" }}
          formatter={(value, name) => [
            formatAmount(Number(value || 0), "USD"),
            String(name).includes("Pending") ? `${name} ⚠` : name,
          ]}
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          formatter={(value) =>
            String(value).includes("Pending") ? (
              <span style={{ color: PENDING_COLOR }}>{value}</span>
            ) : (
              value
            )
          }
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
