import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Wallet } from "lucide-react-native";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { getDrawerBalances, getShopBaseSystem, getSinceLastCount, type DrawerBalances } from "@/api/reads";
import { RefreshNotice } from "@/components/RefreshNotice";
import { queryKeys } from "@/data/queryKeys";
import { usePullRefresh } from "@/data/usePullRefresh";
import { useRefreshOnFocus } from "@/data/useRefreshOnFocus";
import { useShopSlug } from "@/data/useShop";
import { unwrap } from "@/data/unwrap";
import { useModuleGates } from "@/data/useModuleGates";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing, TAB_BAR_CLEARANCE } from "@/theme/tokens";
import { drawerAmounts, drawerLabel, txnTime } from "@/utils/format";
import { visibleDrawers } from "@/utils/moduleGates";

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
 * latest transactions live on the Activity tab (reached from the tab bar).
 */
export default function Home() {
  const t = useTheme();
  const slug = useShopSlug();

  const balances = useQuery({
    queryKey: queryKeys.balances(slug),
    queryFn: async () => unwrap(await getDrawerBalances()),
    enabled: !!slug,
  });
  // The shop's primary system: the other one's cash drawer is hidden while empty.
  // A failed read leaves it unknown, and then nothing is hidden on its account.
  const shopBase = useQuery({
    queryKey: queryKeys.shopBase(slug),
    queryFn: async () => unwrap(await getShopBaseSystem()),
    enabled: !!slug,
  });
  const sinceCount = useQuery({
    queryKey: queryKeys.sinceLastCount(slug, WALLET_DRAWERS),
    queryFn: async () => unwrap(await getSinceLastCount(WALLET_DRAWERS)),
    enabled: !!slug,
  });

  // Drawers of switched-off modules are hidden, as on the web Dashboard (LIRA-307).
  const gates = useModuleGates();

  useRefreshOnFocus([balances, sinceCount]);
  const pull = usePullRefresh([balances.refetch, sinceCount.refetch, gates.refetch]);
  const drawers = balances.data
    ? visibleDrawers(sortedDrawers(balances.data), gates, {
        baseSystem: shopBase.data ?? null,
        balances: balances.data,
      })
    : [];
  const counted = sinceCount.data?.filter((d) => visibleDrawers([d.drawer], gates).length > 0);

  return (
    <View style={styles.flex}>

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
          ) : drawers.length === 0 ? (
            <Text style={{ color: t.textMuted }}>No drawers yet.</Text>
          ) : (
            drawers.map((d) => (
              <View key={d} style={[styles.line, { borderTopColor: t.border }]}>
                <Text style={[styles.lineLabel, { color: WALLET_DRAWERS.includes(d) ? t.text : t.textSoft }]}>{drawerLabel(d)}</Text>
                <Text style={[styles.lineValue, { color: t.text }]}>{drawerAmounts(balances.data[d] ?? {})}</Text>
              </View>
            ))
          )}
        </View>

        {/* Optional extra: if it cannot load, the section simply stays hidden. */}
        {counted && counted.length > 0 ? (
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={styles.cardHead}>
              <ClipboardCheck size={18} color={t.accent} />
              <Text style={[styles.sectionTitle, { color: t.text }]}>Since the last count</Text>
            </View>
            {counted.map((d) => (
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

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: spacing.lg },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  card: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.md },
  lineLabel: { fontSize: 14, fontWeight: "500" },
  lineValue: { fontSize: 14, fontWeight: "600", textAlign: "right", flexShrink: 1 },
});
