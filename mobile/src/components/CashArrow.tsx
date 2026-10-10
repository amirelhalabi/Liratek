import type { CashFlowDirection } from "@liratek/core/utils/cashFlow";
import { Text } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";

const AMBER = "#f59e0b";

/**
 * The cash arrow before an amount, same meaning as the web Transactions
 * badge: green ↓ money in, red ↑ money out, both for a two-way move, amber +
 * for a cashless supplier credit. Nothing when no cash moved.
 */
export function CashArrow({
  direction,
  size = 15,
  muted = false,
}: {
  direction: CashFlowDirection | "credit" | null;
  size?: number;
  muted?: boolean;
}) {
  const t = useTheme();
  if (!direction) return null;
  const style = {
    fontSize: size,
    fontWeight: "700" as const,
    opacity: muted ? 0.5 : 1,
  };
  if (direction === "credit")
    return <Text style={[style, { color: AMBER }]}>+ </Text>;
  if (direction === "both")
    return (
      <Text style={style}>
        <Text style={{ color: t.success }}>↓</Text>
        <Text style={{ color: t.danger }}>↑ </Text>
      </Text>
    );
  return (
    <Text style={[style, { color: direction === "in" ? t.success : t.danger }]}>
      {direction === "in" ? "↓ " : "↑ "}
    </Text>
  );
}
