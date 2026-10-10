import {
  transactionSummary,
  transactionTitle,
} from "@liratek/core/utils/transactionText";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getRecentTransactions, type RecentTransaction } from "@/api/reads";
import { RefreshNotice } from "@/components/RefreshNotice";
import { queryKeys } from "@/data/queryKeys";
import { usePullRefresh } from "@/data/usePullRefresh";
import { useRefreshOnFocus } from "@/data/useRefreshOnFocus";
import { useShopSlug } from "@/data/useShop";
import { unwrap } from "@/data/unwrap";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing, TAB_BAR_CLEARANCE } from "@/theme/tokens";
import {
  dayHeader,
  txnAmount,
  txnClock,
  txnDayKey,
  txnFullDate,
  txnMainAmount,
} from "@/utils/format";
import { typeColor } from "@/utils/typeColors";

const LIMIT = 15;

/** Rows grouped under their day on the phone's calendar, newest day first (API order kept). */
function groupByDay(rows: RecentTransaction[]): { day: string; rows: RecentTransaction[] }[] {
  const groups: { day: string; rows: RecentTransaction[] }[] = [];
  for (const row of rows) {
    const day = txnDayKey(row.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else groups.push({ day, rows: [row] });
  }
  return groups;
}

function isInactive(x: RecentTransaction): boolean {
  return !!x.status && x.status !== "ACTIVE";
}

/**
 * Activity tab (LIRA-300 FR-006): the latest transactions, loaded when this
 * tab is first opened. Rows stay short (type dot, title, client, amount,
 * time); tapping a row opens the details sheet with the rest.
 */
export default function ActivityScreen() {
  const t = useTheme();
  const slug = useShopSlug();
  const [selected, setSelected] = useState<RecentTransaction | null>(null);
  const recent = useQuery({
    queryKey: queryKeys.recent(slug, LIMIT),
    queryFn: async () => unwrap(await getRecentTransactions(LIMIT)),
    enabled: !!slug,
  });
  useRefreshOnFocus([recent]);
  const pull = usePullRefresh([recent.refetch]);

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={t.accent}
          />
        }
      >
        <RefreshNotice error={recent.error} hasData={recent.data !== undefined} />
        {recent.data === undefined ? (
          recent.isPending ? (
            <ActivityIndicator color={t.accent} />
          ) : null
        ) : recent.data.length === 0 ? (
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={{ color: t.textMuted, paddingVertical: spacing.sm }}>
              No transactions yet.
            </Text>
          </View>
        ) : (
          groupByDay(recent.data).map((g) => (
            <View key={g.day} style={styles.group}>
              <Text style={[styles.dayHeader, { color: t.textMuted }]}>
                {dayHeader(g.day)}
              </Text>
              <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
                {g.rows.map((x, i) => {
                  const inactive = isInactive(x);
                  return (
                    <Pressable
                      key={x.id}
                      accessibilityRole="button"
                      onPress={() => setSelected(x)}
                      style={({ pressed }) => [
                        styles.txn,
                        i > 0 && {
                          borderTopColor: t.border,
                          borderTopWidth: StyleSheet.hairlineWidth,
                        },
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: typeColor(x.type) },
                          inactive && { opacity: 0.4 },
                        ]}
                      />
                      <Text
                        style={[styles.label, styles.flex, { color: inactive ? t.textMuted : t.text }]}
                        numberOfLines={1}
                      >
                        {/* Same title wording as the web Transactions page (LIRA-301). */}
                        {transactionTitle(x)}
                        {x.client_name ? (
                          <Text style={{ color: t.textMuted, fontWeight: "400" }}>
                            {` · ${x.client_name}`}
                          </Text>
                        ) : null}
                      </Text>
                      <View style={styles.right}>
                        <Text
                          style={[
                            styles.value,
                            { color: inactive ? t.textMuted : t.text },
                            inactive && styles.struck,
                          ]}
                          numberOfLines={1}
                        >
                          {txnMainAmount(x)}
                        </Text>
                        <Text style={[styles.time, { color: t.textMuted }]}>
                          {inactive ? `${x.status} · ` : ""}
                          {txnClock(x.created_at)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>
      <TransactionSheet txn={selected} onClose={() => setSelected(null)} />
    </>
  );
}

/** Details sheet: everything the list row leaves out. */
function TransactionSheet({
  txn,
  onClose,
}: {
  txn: RecentTransaction | null;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const summary = txn ? transactionSummary(txn) : null;

  return (
    <Modal visible={!!txn} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close details" />
      {txn ? (
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: t.card,
              borderColor: t.border,
              paddingBottom: insets.bottom + spacing.lg,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: t.borderStrong }]} />
          <View style={styles.sheetHead}>
            <View style={[styles.dot, { backgroundColor: typeColor(txn.type) }]} />
            <Text style={[styles.sheetTitle, { color: t.text }]}>{transactionTitle(txn)}</Text>
          </View>
          <Text style={[styles.sheetAmount, { color: t.text }, isInactive(txn) && styles.struck]}>
            {txnAmount(txn)}
          </Text>
          {summary ? <Text style={{ color: t.textSoft, fontSize: 14 }}>{summary}</Text> : null}
          <DetailLine label="Date" value={txnFullDate(txn.created_at)} />
          {txn.client_name ? <DetailLine label="Client" value={txn.client_name} /> : null}
          {isInactive(txn) ? <DetailLine label="Status" value={txn.status ?? ""} /> : null}
          <DetailLine label="Number" value={`#${txn.id}`} />
        </View>
      ) : null}
    </Modal>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={[styles.detailLine, { borderTopColor: t.border }]}>
      <Text style={{ color: t.textMuted, fontSize: 14 }}>{label}</Text>
      <Text style={[styles.detailValue, { color: t.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: spacing.lg },
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
  txn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { fontSize: 15, fontWeight: "500" },
  right: { alignItems: "flex-end", flexShrink: 0, maxWidth: "45%" },
  value: { fontSize: 15, fontWeight: "600", textAlign: "right" },
  time: { fontSize: 11, marginTop: 2 },
  struck: { textDecorationLine: "line-through" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginBottom: spacing.xs },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sheetTitle: { fontSize: 18, fontWeight: "600", flexShrink: 1 },
  sheetAmount: { fontSize: 22, fontWeight: "700" },
  detailLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  detailValue: { fontSize: 14, fontWeight: "500", textAlign: "right", flexShrink: 1 },
});
