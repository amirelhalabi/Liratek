import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ChevronRight, ClipboardCheck, History, Wallet } from "lucide-react-native";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getDrawerBalances, getSinceLastCount, type DrawerBalances } from "@/api/reads";
import { useAuth } from "@/auth/AuthContext";
import { RefreshNotice } from "@/components/RefreshNotice";
import { queryKeys } from "@/data/queryKeys";
import { usePullRefresh } from "@/data/usePullRefresh";
import { useRefreshOnFocus } from "@/data/useRefreshOnFocus";
import { useShopSlug } from "@/data/useShop";
import { unwrap } from "@/data/unwrap";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing, TAB_BAR_CLEARANCE } from "@/theme/tokens";
import { drawerAmounts, drawerLabel, txnTime } from "@/utils/format";

// Wallet and voucher drawers the phone sales move (LIRA-289 research R4), shown first.
const WALLET_DRAWERS = ["Whish_App", "OMT_App", "Binance", "Katsh", "iPick"];

function sortedDrawers(balances: DrawerBalances): string[] {
  const names = Object.keys(balances);
  const wallets = WALLET_DRAWERS.filter((d) => names.includes(d));
  const others = names.filter((d) => !WALLET_DRAWERS.includes(d)).sort();
  return [...wallets, ...others];
}

/**
 * Home tab (LIRA-300 FR-003): balances and "since the last count" only. The
 * latest transactions live on the Activity tab and load there.
 */
export default function Home() {
  const t = useTheme();
  const { shop } = useAuth();
  const slug = useShopSlug();

  const balances = useQuery({
    queryKey: queryKeys.balances(slug),
    queryFn: async () => unwrap(await getDrawerBalances()),
    enabled: !!slug,
  });
  const sinceCount = useQuery({
    queryKey: queryKeys.sinceLastCount(slug, WALLET_DRAWERS),
    queryFn: async () => unwrap(await getSinceLastCount(WALLET_DRAWERS)),
    enabled: !!slug,
  });

  useRefreshOnFocus([balances, sinceCount]);
  const pull = usePullRefresh([balances.refetch, sinceCount.refetch]);

  return (
    <SafeAreaView style={styles.flex} edges={["top"]}>
      <View style={[styles.topBar, { backgroundColor: t.card, borderBottomColor: t.border }]}>
        <Text style={[styles.shopName, { color: t.accent }]} numberOfLines={1}>
          {shop?.name ?? "LiraTek"}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={t.accent} />}
      >
        <RefreshNotice error={balances.error} hasData={balances.data !== undefined} />
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={styles.cardHead}>
            <Wallet size={18} color={t.accent} />
            <Text style={[styles.sectionTitle, { color: t.text }]}>Drawer balances</Text>
          </View>
          {balances.data === undefined ? (
            balances.isPending ? <ActivityIndicator color={t.accent} /> : null
          ) : sortedDrawers(balances.data).length === 0 ? (
            <Text style={{ color: t.textMuted }}>No drawers yet.</Text>
          ) : (
            sortedDrawers(balances.data).map((d) => (
              <View key={d} style={[styles.line, { borderTopColor: t.border }]}>
                <Text style={[styles.lineLabel, { color: WALLET_DRAWERS.includes(d) ? t.text : t.textSoft }]}>{drawerLabel(d)}</Text>
                <Text style={[styles.lineValue, { color: t.text }]}>{drawerAmounts(balances.data[d] ?? {})}</Text>
              </View>
            ))
          )}
        </View>

        {/* Optional extra: if it cannot load, the section simply stays hidden. */}
        {sinceCount.data ? (
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={styles.cardHead}>
              <ClipboardCheck size={18} color={t.accent} />
              <Text style={[styles.sectionTitle, { color: t.text }]}>Since the last count</Text>
            </View>
            {sinceCount.data.map((d) => (
              <View key={d.drawer} style={[styles.line, { borderTopColor: t.border }]}>
                <View style={styles.flex}>
                  <Text style={[styles.lineLabel, { color: t.text }]}>{drawerLabel(d.drawer)}</Text>
                  <Text style={{ color: t.textMuted, fontSize: 12 }}>
                    {d.lastCountAt ? `Counted ${txnTime(d.lastCountAt)}` : "Never counted"}
                  </Text>
                </View>
                <Text style={[styles.lineValue, { color: t.text }]}>
                  {d.transactions.length === 1 ? "1 sale" : `${d.transactions.length} sales`}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.navigate("/activity")}
          style={[styles.card, styles.linkRow, { backgroundColor: t.card, borderColor: t.border }]}
        >
          <History size={18} color={t.accent} />
          <Text style={[styles.sectionTitle, styles.flex, { color: t.text }]}>Latest transactions</Text>
          <ChevronRight size={18} color={t.textMuted} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, borderBottomWidth: 1 },
  shopName: { fontSize: 20, fontWeight: "700", flex: 1 },
  body: { padding: spacing.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: spacing.lg },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  card: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.md },
  lineLabel: { fontSize: 14, fontWeight: "500" },
  lineValue: { fontSize: 14, fontWeight: "600", textAlign: "right", flexShrink: 1 },
});
