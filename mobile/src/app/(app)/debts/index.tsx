import { formatMoneyAmount } from "@liratek/core/utils/formatMoney";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getDebtors } from "@/api/debts";
import { RefreshNotice } from "@/components/RefreshNotice";
import { FloatingSearch } from "@/components/FloatingSearch";
import { queryKeys } from "@/data/queryKeys";
import { usePullRefresh } from "@/data/usePullRefresh";
import { useRefreshOnFocus } from "@/data/useRefreshOnFocus";
import { useShopSlug } from "@/data/useShop";
import { unwrap } from "@/data/unwrap";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing, TAB_BAR_CLEARANCE } from "@/theme/tokens";

/** Clients who owe the shop (spec Story 4 #3). Tap one to see the balance and record a repayment. */
export default function DebtsScreen() {
  const t = useTheme();
  const slug = useShopSlug();
  const [query, setQuery] = useState("");
  const debtorsQuery = useQuery({
    queryKey: queryKeys.debtors(slug),
    queryFn: async () => unwrap(await getDebtors()),
    enabled: !!slug,
  });
  useRefreshOnFocus([debtorsQuery]);
  const pull = usePullRefresh([debtorsQuery.refetch]);
  const debtors = debtorsQuery.data ?? null;

  const q = query.trim().toLowerCase();
  const shown = (debtors ?? []).filter(
    (d) =>
      !q || d.full_name.toLowerCase().includes(q) || d.phone_number.includes(q),
  );

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={t.accent}
          />
        }
      >
        <RefreshNotice error={debtorsQuery.error} hasData={debtors !== null} />
        {debtors === null && debtorsQuery.isPending ? (
          <ActivityIndicator color={t.accent} />
        ) : null}
        {debtors !== null && shown.length === 0 ? (
          <Text style={{ color: t.textMuted }}>No customer owes anything.</Text>
        ) : null}
        {shown.map((d) => (
          <Pressable
            key={d.id}
            onPress={() =>
              router.push({
                pathname: "/debts/[id]",
                params: {
                  id: String(d.id),
                  name: d.full_name,
                  phone: d.phone_number,
                },
              })
            }
            style={[
              styles.row,
              { backgroundColor: t.card, borderColor: t.border },
            ]}
          >
            <View style={styles.flex}>
              <Text style={{ color: t.text, fontWeight: "600" }}>
                {d.full_name}
              </Text>
              <Text style={{ color: t.textMuted, fontSize: 12 }}>
                {d.phone_number}
              </Text>
            </View>
            <View>
              {d.total_debt_usd ? (
                <Text style={[styles.amount, { color: t.text }]}>
                  {formatMoneyAmount(d.total_debt_usd, "USD")}
                </Text>
              ) : null}
              {d.total_debt_lbp ? (
                <Text style={[styles.amount, { color: t.text }]}>
                  {formatMoneyAmount(d.total_debt_lbp, "LBP")}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <FloatingSearch
        value={query}
        onChangeText={setQuery}
        placeholder="Name or phone"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: {
    padding: spacing.lg,
    paddingBottom: TAB_BAR_CLEARANCE,
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  amount: { fontWeight: "700", textAlign: "right" },
});
