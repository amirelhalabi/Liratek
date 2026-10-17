import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("dashboard");
  // Build two rings:
  // Inner ring: realized (settled) commission per provider
  // Outer ring: pending commission per provider (amber slices)
  const realizedData = pieData.filter((p) => p.value > 0);
  const pendingData = pieData
    .filter((p) => (p.pending ?? 0) > 0)
    .map((p) => ({
      name: t("commissions.pendingName", { name: p.name }),
      value: p.pending!,
    }));
  // Which slice names are the pending ring's — compared by identity with
  // the names built just above, never by searching for a word in a label.
  const pendingNames = new Set(pendingData.map((p) => p.name));

  const hasPending = pendingData.length > 0;
  const hasRealized = realizedData.length > 0;

  // If nothing to show, show a placeholder
  if (!hasRealized && !hasPending) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        {t("commissions.empty")}
      </div>
    );
  }

  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      initialDimension={{ width: 500, height: 300 }}
    >
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
            pendingNames.has(String(name)) ? `${name} ⚠` : name,
          ]}
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          formatter={(value) =>
            pendingNames.has(String(value)) ? (
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
