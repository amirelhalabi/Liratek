import { CloudOff, WifiOff } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { useModuleGates } from "@/data/useModuleGates";
import { useTheme } from "@/theme/ThemeProvider";
import { spacing, TAB_BAR_CLEARANCE } from "@/theme/tokens";

/**
 * A tab's content needs a connection (LIRA-307, owner decision 2026-10-11):
 * the tab stays in the bar, but while the phone cannot reach the server its
 * pages are covered by "Please connect to the internet". The pages stay
 * mounted underneath, so a half-filled sale survives a short drop.
 */
export function ConnectionGate({ children }: { children: ReactNode }) {
  const t = useTheme();
  const gates = useModuleGates();
  const [retrying, setRetrying] = useState(false);

  if (gates.access === "ok") return <>{children}</>;

  async function retry() {
    setRetrying(true);
    try {
      await gates.refetch();
    } finally {
      setRetrying(false);
    }
  }

  const offline = gates.access === "offline";
  return (
    <View style={styles.fill}>
      {children}
      <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: t.page }]}>
        {gates.access === "checking" ? (
          <ActivityIndicator color={t.accent} />
        ) : (
          <View style={styles.box}>
            <View style={[styles.icon, { backgroundColor: t.card, borderColor: t.border }]}>
              {offline ? <WifiOff size={30} color={t.textMuted} /> : <CloudOff size={30} color={t.textMuted} />}
            </View>
            <Text style={[styles.title, { color: t.text }]}>{offline ? "No internet connection" : "Can't reach LiraTek"}</Text>
            <Text style={[styles.body, { color: t.textMuted }]}>
              {offline
                ? "Please connect to the internet to see this page."
                : "The server did not answer. Check again in a moment."}
            </Text>
            <View style={styles.button}>
              <PrimaryButton label="Try again" onPress={retry} loading={retrying} />
            </View>
            <Text style={[styles.hint, { color: t.textSoft }]}>Trying again automatically…</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  cover: { alignItems: "center", justifyContent: "center", paddingBottom: TAB_BAR_CLEARANCE / 2 },
  box: { alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xxl, maxWidth: 420 },
  icon: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  title: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  body: { fontSize: 15, textAlign: "center", lineHeight: 21 },
  button: { alignSelf: "stretch", marginTop: spacing.md },
  hint: { fontSize: 12 },
});
