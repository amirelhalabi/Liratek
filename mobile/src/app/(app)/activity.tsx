import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { getRecentTransactions } from "@/api/reads";
import { RefreshNotice } from "@/components/RefreshNotice";
import { queryKeys } from "@/data/queryKeys";
import { usePullRefresh } from "@/data/usePullRefresh";
import { useRefreshOnFocus } from "@/data/useRefreshOnFocus";
import { useShopSlug } from "@/data/useShop";
import { unwrap } from "@/data/unwrap";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing } from "@/theme/tokens";
import { txnAmount, txnTime } from "@/utils/format";

const LIMIT = 15;

/** Activity tab (LIRA-300 FR-006): the latest transactions, loaded when this tab is first opened. */
export default function ActivityScreen() {
  const t = useTheme();
  const slug = useShopSlug();
  const recent = useQuery({
    queryKey: queryKeys.recent(slug, LIMIT),
    queryFn: async () => unwrap(await getRecentTransactions(LIMIT)),
    enabled: !!slug,
  });
  useRefreshOnFocus([recent]);
  const pull = usePullRefresh([recent.refetch]);

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={t.accent} />}
    >
      <RefreshNotice error={recent.error} hasData={recent.data !== undefined} />
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        {recent.data === undefined ? (
          recent.isPending ? <ActivityIndicator color={t.accent} /> : null
        ) : recent.data.length === 0 ? (
          <Text style={{ color: t.textMuted }}>No transactions yet.</Text>
        ) : (
          recent.data.map((x, i) => (
            <View key={x.id} style={[styles.txn, i > 0 && { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <View style={styles.flex}>
                <Text style={[styles.label, { color: t.text }]} numberOfLines={1}>
                  {x.client_name ? `${x.type.replace(/_/g, " ")} · ${x.client_name}` : x.type.replace(/_/g, " ")}
                </Text>
                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                  {txnTime(x.created_at)}
                  {x.status && x.status !== "ACTIVE" ? ` · ${x.status}` : ""}
                </Text>
              </View>
              <Text style={[styles.value, { color: t.text }]}>{txnAmount(x)}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.lg, gap: spacing.lg },
  card: { borderRadius: radius.xl, borderWidth: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  txn: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, gap: spacing.md },
  label: { fontSize: 14, fontWeight: "500" },
  value: { fontSize: 14, fontWeight: "600", textAlign: "right", flexShrink: 1 },
});
