import { Text } from "react-native";

import { errorCodeOf } from "@/data/unwrap";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * A page's load error (LIRA-300 FR-010). With nothing on screen yet it says the
 * page could not load; with earlier data still shown it only says the refresh
 * failed — the old data stays visible.
 */
export function RefreshNotice({ error, hasData }: { error: unknown; hasData: boolean }) {
  const t = useTheme();
  if (!error) return null;
  return (
    <Text style={{ color: t.danger }}>
      {hasData
        ? "Could not refresh — pull down to retry."
        : `Could not load data (${errorCodeOf(error)}). Pull down to retry.`}
    </Text>
  );
}
