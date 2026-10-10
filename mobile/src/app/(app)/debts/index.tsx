import { formatMoneyAmount } from "@liratek/core/utils/formatMoney";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { getDebtors, type Debtor } from "@/api/debts";
import { TextField } from "@/components/TextField";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing } from "@/theme/tokens";

/** Clients who owe the shop (spec Story 4 #3). Tap one to see the balance and record a repayment. */
export default function DebtsScreen() {
  const t = useTheme();
  const [debtors, setDebtors] = useState<Debtor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const r = await getDebtors();
    if (r.success) {
      setDebtors(r.data);
      setError(null);
    } else setError(r.error);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const q = query.trim().toLowerCase();
  const shown = (debtors ?? []).filter(
    (d) => !q || d.full_name.toLowerCase().includes(q) || d.phone_number.includes(q),
  );

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          tintColor={t.accent}
        />
      }
    >
      <TextField label="Search" value={query} onChangeText={setQuery} placeholder="Name or phone" autoCorrect={false} />
      {error ? <Text style={{ color: t.danger }}>Could not load ({error}). Pull down to retry.</Text> : null}
      {debtors === null && !error ? <ActivityIndicator color={t.accent} /> : null}
      {debtors !== null && shown.length === 0 ? <Text style={{ color: t.textMuted }}>No customer owes anything.</Text> : null}
      {shown.map((d) => (
        <Pressable
          key={d.id}
          onPress={() => router.push({ pathname: "/client/[id]", params: { id: String(d.id), name: d.full_name, phone: d.phone_number } })}
          style={[styles.row, { backgroundColor: t.card, borderColor: t.border }]}
        >
          <View style={styles.flex}>
            <Text style={{ color: t.text, fontWeight: "600" }}>{d.full_name}</Text>
            <Text style={{ color: t.textMuted, fontSize: 12 }}>{d.phone_number}</Text>
          </View>
          <View>
            {d.total_debt_usd ? <Text style={[styles.amount, { color: t.text }]}>{formatMoneyAmount(d.total_debt_usd, "USD")}</Text> : null}
            {d.total_debt_lbp ? <Text style={[styles.amount, { color: t.text }]}>{formatMoneyAmount(d.total_debt_lbp, "LBP")}</Text> : null}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md },
  amount: { fontWeight: "700", textAlign: "right" },
});
