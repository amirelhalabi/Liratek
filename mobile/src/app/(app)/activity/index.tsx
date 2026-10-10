import { transactionTitle } from "@liratek/core/utils/transactionText";
import {
  computeSessionGroupHeaders,
  isSessionGroupHeader,
} from "@liratek/core/utils/transactionRowDisplay";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { type RecentTransaction } from "@/api/reads";
import { RefreshNotice } from "@/components/RefreshNotice";
import { usePullRefresh } from "@/data/usePullRefresh";
import { useRefreshOnFocus } from "@/data/useRefreshOnFocus";
import { useRecentTransactions } from "@/data/useRecentTransactions";
import { useTheme, useThemePreference } from "@/theme/ThemeProvider";
import { radius, spacing, TAB_BAR_CLEARANCE } from "@/theme/tokens";
import { CashArrow } from "@/components/CashArrow";
import { FloatingSearch } from "@/components/FloatingSearch";
import {
  formatAmounts,
  isInactiveTxn,
  sessionLines,
  txnDirection,
  txnDisplayAmount,
  txnRowDetail,
} from "@/utils/activity";
import { dayHeader, txnClock, txnDayKey } from "@/utils/format";
import { sessionColors } from "@/utils/sessionColor";
import { typeColor } from "@/utils/typeColors";

/** Rows grouped under their day on the phone's calendar, newest day first (API order kept). */
function groupByDay(
  rows: RecentTransaction[],
): { day: string; rows: RecentTransaction[] }[] {
  const groups: { day: string; rows: RecentTransaction[] }[] = [];
  for (const row of rows) {
    const day = txnDayKey(row.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else groups.push({ day, rows: [row] });
  }
  return groups;
}

/**
 * Activity tab (LIRA-300 FR-006): the latest transactions, loaded when this
 * tab is first opened. Each row reads like the web Transactions row: type
 * (or session basket) colour, title, client, arrow + amount, the cash line
 * with its rate, and the basket's pooled line on its header row. Tapping a
 * row opens the details sheet ([id].tsx) with the rest.
 */
export default function ActivityScreen() {
  const t = useTheme();
  const [search, setSearch] = useState("");
  const term = useDebounced(search, 300);
  const recent = useRecentTransactions(term);
  useRefreshOnFocus([recent]);
  const pull = usePullRefresh([recent.refetch]);
  const { scheme } = useThemePreference();
  // Same basket header choice as the web: the one row that carries the
  // session's pooled "Session: in: …" line.
  const headers = useMemo(
    () => computeSessionGroupHeaders(recent.data ?? []),
    [recent.data],
  );

  return (
    <View style={styles.flex}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={t.accent}
          />
        }
      >
        <RefreshNotice
          error={recent.error}
          hasData={recent.data !== undefined}
        />
        {recent.data === undefined ? (
          recent.isPending ? (
            <ActivityIndicator color={t.accent} />
          ) : null
        ) : recent.data.length === 0 ? (
          <View
            style={[
              styles.card,
              { backgroundColor: t.card, borderColor: t.border },
            ]}
          >
            <Text style={{ color: t.textMuted, paddingVertical: spacing.sm }}>
              {term
                ? "No transaction matches your search."
                : "No transactions yet."}
            </Text>
          </View>
        ) : (
          groupByDay(recent.data).map((g) => (
            <View key={g.day} style={styles.group}>
              <Text style={[styles.dayHeader, { color: t.textMuted }]}>
                {dayHeader(g.day)}
              </Text>
              <View
                style={[
                  styles.card,
                  styles.listCard,
                  { backgroundColor: t.card, borderColor: t.border },
                ]}
              >
                {g.rows.map((x, i) => {
                  const inactive = isInactiveTxn(x);
                  // Rows of one session basket share a colour, as on the web.
                  const session =
                    x.session_id != null
                      ? sessionColors(x.session_id, scheme)
                      : null;
                  const detail = txnRowDetail(x);
                  const basket = isSessionGroupHeader(x, headers)
                    ? sessionLines(x)
                    : [];
                  return (
                    <Pressable
                      key={x.id}
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({
                          pathname: "/activity/[id]",
                          params: { id: String(x.id), q: term },
                        })
                      }
                      style={({ pressed }) => [
                        styles.txn,
                        i > 0 && {
                          borderTopColor: t.border,
                          borderTopWidth: StyleSheet.hairlineWidth,
                        },
                        session && { backgroundColor: session.tint },
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <View
                        style={[
                          styles.typeBar,
                          {
                            backgroundColor: session?.bar ?? typeColor(x.type),
                          },
                          inactive && { opacity: 0.4 },
                        ]}
                      />
                      <View style={styles.txnBody}>
                        <View style={styles.line}>
                          <Text
                            style={[
                              styles.label,
                              styles.flex,
                              { color: inactive ? t.textMuted : t.text },
                            ]}
                            numberOfLines={1}
                          >
                            {/* Same title wording as the web Transactions page (LIRA-301). */}
                            {transactionTitle(x)}
                            {x.client_name ? (
                              <Text
                                style={{
                                  color: t.textMuted,
                                  fontWeight: "400",
                                }}
                              >
                                {` · ${x.client_name}`}
                              </Text>
                            ) : null}
                          </Text>
                          <Text
                            style={[
                              styles.value,
                              { color: inactive ? t.textMuted : t.text },
                            ]}
                            numberOfLines={1}
                          >
                            <CashArrow
                              direction={txnDirection(x)}
                              muted={inactive}
                            />
                            <Text style={inactive ? styles.struck : undefined}>
                              {formatAmounts(txnDisplayAmount(x), true)}
                            </Text>
                          </Text>
                        </View>
                        <View style={styles.line}>
                          <Text
                            style={[
                              styles.sub,
                              styles.flex,
                              { color: t.textMuted },
                            ]}
                            numberOfLines={1}
                          >
                            {detail}
                          </Text>
                          <Text style={[styles.sub, { color: t.textMuted }]}>
                            {inactive ? `${x.status} · ` : ""}
                            {txnClock(x.created_at)}
                          </Text>
                        </View>
                        {basket.map((line) => (
                          <Text
                            key={line}
                            style={[styles.sub, { color: session?.bar }]}
                            numberOfLines={1}
                          >
                            {line}
                          </Text>
                        ))}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>
      <FloatingSearch
        value={search}
        onChangeText={setSearch}
        placeholder="Search client, phone, item, cashier"
      />
    </View>
  );
}

/** The value, once it has stopped changing for `ms` (one server search per pause in typing). */
function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: {
    padding: spacing.lg,
    paddingBottom: TAB_BAR_CLEARANCE,
    gap: spacing.lg,
  },
  group: { gap: spacing.xs },
  dayHeader: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: spacing.xs,
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  // The list card has no side padding and clips its corners, so each row's
  // colour bar sits flush on the card's left edge, full row height.
  listCard: { paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden" },
  txn: { flexDirection: "row", alignItems: "stretch" },
  txnBody: {
    flex: 1,
    paddingVertical: spacing.lg,
    paddingLeft: spacing.md,
    paddingRight: spacing.lg,
    gap: spacing.xs + 2,
  },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  sub: { fontSize: 12 },
  typeBar: { width: 4 },
  label: { fontSize: 15, fontWeight: "500" },
  value: { fontSize: 15, fontWeight: "600", textAlign: "right" },
  struck: { textDecorationLine: "line-through" },
});
