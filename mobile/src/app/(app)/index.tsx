import { formatMoneyAmount } from "@liratek/core/utils/formatMoney";
import { MAIN_DRAWER_CURRENCIES, visibleDrawerCurrencies } from "@liratek/core/utils/visibleDrawerCurrencies";
import { router, useFocusEffect } from "expo-router";
import { ClipboardCheck, History, Send, Settings, Wallet, Zap } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  getDrawerBalances,
  getRecentTransactions,
  getSinceLastCount,
  type DrawerBalances,
  type RecentTransaction,
  type SinceLastCountDrawerView,
} from "@/api/reads";
import { useAuth } from "@/auth/AuthContext";
import { ModuleTile } from "@/components/ModuleTile";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing } from "@/theme/tokens";

// Module icons and accents follow the web (create_db.sql icons; HomeGrid accentMap):
// OMT/Whish = Send (indigo), iPick/Katsh = Zap, Binance = Bitcoin.
const INDIGO = "#818cf8";
const SKY = "#38bdf8";
// Wallet and voucher drawers the phone sales move (research R4), shown first.
const WALLET_DRAWERS = ["Whish_App", "OMT_App", "Binance", "Katsh", "iPick"];

function drawerLabel(name: string): string {
  return name.replace(/_/g, " ");
}

function sortedDrawers(balances: DrawerBalances): string[] {
  const names = Object.keys(balances);
  const wallets = WALLET_DRAWERS.filter((d) => names.includes(d));
  const others = names.filter((d) => !WALLET_DRAWERS.includes(d)).sort();
  return [...wallets, ...others];
}

// Which currencies to show: core's shared rule, same as the web Dashboard.
function drawerAmounts(byCurrency: Record<string, number>): string {
  const visible = visibleDrawerCurrencies(byCurrency);
  const order = (c: string) => {
    const i = MAIN_DRAWER_CURRENCIES.indexOf(c);
    return i === -1 ? MAIN_DRAWER_CURRENCIES.length : i;
  };
  return (
    Object.keys(visible)
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
      .map((c) => formatMoneyAmount(visible[c] ?? 0, c))
      .join("  ·  ") || "—"
  );
}

function txnAmount(t: RecentTransaction): string {
  const parts: string[] = [];
  if (t.amount_usd) parts.push(formatMoneyAmount(t.amount_usd, "USD"));
  if (t.amount_lbp) parts.push(formatMoneyAmount(t.amount_lbp, "LBP"));
  return parts.join(" · ") || "—";
}

function txnTime(iso: string): string {
  // Stored as UTC in either `YYYY-MM-DD HH:MM:SS` or ISO `…Z` form (research R2).
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// The four in-scope phone sales (spec FR-001). The sale screens arrive with US2.
const SALES = [
  { key: "WHISH_APP", label: "Whish App transfer", Icon: Send, color: INDIGO },
  { key: "OMT_APP", label: "OMT App transfer", Icon: Send, color: INDIGO },
  { key: "Katsh", label: "Katch voucher", Icon: Zap, color: SKY },
  { key: "iPick", label: "iPick voucher", Icon: Zap, color: SKY },
] as const;

export default function Home() {
  const t = useTheme();
  const { shop } = useAuth();
  const [balances, setBalances] = useState<DrawerBalances | null>(null);
  const [recent, setRecent] = useState<RecentTransaction[] | null>(null);
  const [sinceCount, setSinceCount] = useState<SinceLastCountDrawerView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [b, r, c] = await Promise.all([
      getDrawerBalances(),
      getRecentTransactions(15),
      getSinceLastCount(WALLET_DRAWERS),
    ]);
    if (b.success) setBalances(b.data);
    if (r.success) setRecent(r.data);
    // Optional extra: if it cannot load, the section simply stays hidden.
    setSinceCount(c.success ? c.data : null);
    setError(!b.success ? b.error : !r.success ? r.error : null);
  }, []);

  // Reload every time home comes back into view (e.g. after saving a sale),
  // not only on first mount.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function openSale(key: string) {
    if (key === "WHISH_APP" || key === "OMT_APP") {
      router.push({ pathname: "/sale/[provider]", params: { provider: key } });
      return;
    }
    Alert.alert("Coming next", "Recording vouchers from the phone is the next step being built.");
  }

  return (
    <SafeAreaView style={styles.flex} edges={["top"]}>
      <View style={[styles.topBar, { backgroundColor: t.card, borderBottomColor: t.border }]}>
        <Text style={[styles.shopName, { color: t.accent }]} numberOfLines={1}>
          {shop?.name ?? "LiraTek"}
        </Text>
        <Pressable accessibilityLabel="Settings" onPress={() => router.push("/settings")} hitSlop={12}>
          <Settings size={22} color={t.textMuted} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
      >
        {error ? <Text style={{ color: t.danger }}>Could not load data ({error}). Pull down to retry.</Text> : null}
        <View style={[styles.balances, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={styles.balancesHead}>
            <Wallet size={18} color={t.accent} />
            <Text style={[styles.sectionTitle, { color: t.text }]}>Drawer balances</Text>
          </View>
          {balances === null ? (
            error ? null : <ActivityIndicator color={t.accent} />
          ) : sortedDrawers(balances).length === 0 ? (
            <Text style={{ color: t.textMuted }}>No drawers yet.</Text>
          ) : (
            sortedDrawers(balances).map((d) => (
              <View key={d} style={[styles.line, { borderTopColor: t.border }]}>
                <Text style={[styles.lineLabel, { color: WALLET_DRAWERS.includes(d) ? t.text : t.textSoft }]}>{drawerLabel(d)}</Text>
                <Text style={[styles.lineValue, { color: t.text }]}>
                  {drawerAmounts(balances[d] ?? {})}
                </Text>
              </View>
            ))
          )}
        </View>

        <Text style={[styles.sectionTitle, { color: t.text }]}>Record a sale</Text>
        <View style={styles.grid}>
          {[0, 2].map((row) => (
            <View key={row} style={styles.row}>
              {SALES.slice(row, row + 2).map((s) => (
                <ModuleTile key={s.key} label={s.label} Icon={s.Icon} color={s.color} onPress={() => openSale(s.key)} />
              ))}
            </View>
          ))}
        </View>

        {sinceCount ? (
          <View style={[styles.balances, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={styles.balancesHead}>
              <ClipboardCheck size={18} color={t.accent} />
              <Text style={[styles.sectionTitle, { color: t.text }]}>Since the last count</Text>
            </View>
            {sinceCount.map((d) => (
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

        <View style={[styles.balances, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={styles.balancesHead}>
            <History size={18} color={t.accent} />
            <Text style={[styles.sectionTitle, { color: t.text }]}>Latest transactions</Text>
          </View>
          {recent === null ? (
            error ? null : <ActivityIndicator color={t.accent} />
          ) : recent.length === 0 ? (
            <Text style={{ color: t.textMuted }}>No transactions yet.</Text>
          ) : (
            recent.map((x) => (
              <View key={x.id} style={[styles.txn, { borderTopColor: t.border }]}>
                <View style={styles.flex}>
                  <Text style={[styles.lineLabel, { color: t.text }]} numberOfLines={1}>
                    {x.client_name ? `${x.type.replace(/_/g, " ")} · ${x.client_name}` : x.type.replace(/_/g, " ")}
                  </Text>
                  <Text style={{ color: t.textMuted, fontSize: 12 }}>
                    {txnTime(x.created_at)}
                    {x.status && x.status !== "ACTIVE" ? ` · ${x.status}` : ""}
                  </Text>
                </View>
                <Text style={[styles.lineValue, { color: t.text }]}>{txnAmount(x)}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, borderBottomWidth: 1 },
  shopName: { fontSize: 20, fontWeight: "700", flex: 1, marginRight: spacing.md },
  body: { padding: spacing.lg, gap: spacing.lg },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  grid: { gap: spacing.md },
  row: { flexDirection: "row", gap: spacing.md },
  balances: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
  balancesHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.md },
  lineLabel: { fontSize: 14, fontWeight: "500" },
  lineValue: { fontSize: 14, fontWeight: "600", textAlign: "right", flexShrink: 1 },
  txn: { flexDirection: "row", alignItems: "center", paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.md },
});
