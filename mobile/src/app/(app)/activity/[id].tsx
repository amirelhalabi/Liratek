import {
  transactionSummary,
  transactionTitle,
} from "@liratek/core/utils/transactionText";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useRecentTransactions } from "@/data/useRecentTransactions";
import { useTheme } from "@/theme/ThemeProvider";
import { spacing } from "@/theme/tokens";
import { txnFullDate } from "@/utils/format";
import { CashArrow } from "@/components/CashArrow";
import {
  formatAmounts,
  formatCheckpointAmounts,
  isInactiveTxn,
  paymentDetail,
  sessionLines,
  txnCashLine,
  txnDirection,
  txnDisplayAmount,
  txnRate,
} from "@/utils/activity";
import { typeColor } from "@/utils/typeColors";

/**
 * Transaction details, shown as a native bottom sheet over the Activity list
 * (see the layout). Everything the list row leaves out lives here — the
 * web Transactions row's payment detail, rate, basket total, cashier. Reads the
 * list's cached rows, so it opens without a request.
 */
export default function TransactionDetails() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { id, q } = useLocalSearchParams<{ id: string; q?: string }>();
  const recent = useRecentTransactions(q ?? "");
  const txn = recent.data?.find((x) => String(x.id) === id);

  if (!txn) {
    return (
      <View
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
      >
        <Text style={{ color: t.textMuted }}>
          This transaction is no longer in the list.
        </Text>
      </View>
    );
  }

  const summary = transactionSummary(txn);
  const inactive = isInactiveTxn(txn);
  const cash = txnCashLine(txn, false);
  const rate = txnRate(txn);
  const legs = paymentDetail(txn);
  const basket = sessionLines(txn, false);
  const counted =
    txn.type === "CHECKPOINT"
      ? formatCheckpointAmounts(txn.metadata_json)
      : null;
  const returned = txn.returned_credits_usd;
  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.head}>
        <View
          style={[styles.typeBar, { backgroundColor: typeColor(txn.type) }]}
        />
        <Text style={[styles.title, { color: t.text }]}>
          {transactionTitle(txn)}
        </Text>
      </View>
      <Text style={[styles.amount, { color: t.text }]}>
        <CashArrow direction={txnDirection(txn)} size={22} muted={inactive} />
        <Text style={inactive ? styles.struck : undefined}>
          {formatAmounts(txnDisplayAmount(txn), false)}
        </Text>
      </Text>
      {summary ? (
        <Text style={{ color: t.textSoft, fontSize: 14 }}>{summary}</Text>
      ) : null}
      {cash ? <DetailLine label="Cash" value={cash} /> : null}
      {rate ? <DetailLine label="Rate" value={rate} /> : null}
      {legs.length > 0 ? (
        <DetailLine
          label="Payment"
          value={legs
            .map((l) => `${l.side === "in" ? "in" : "out"}  ${l.text}`)
            .join("\n")}
        />
      ) : null}
      {basket.length > 0 ? (
        <DetailLine
          label={`Session #${txn.session_id}`}
          value={basket.join("\n")}
        />
      ) : null}
      {counted ? <DetailLine label="Counted" value={counted} /> : null}
      {returned !== undefined ? (
        <DetailLine
          label="Returned credits"
          value={`${returned < 0 ? "−" : ""}$${Math.abs(returned).toLocaleString()}`}
        />
      ) : null}
      {txn.username ? (
        <DetailLine label="Cashier" value={txn.username} />
      ) : null}
      <DetailLine label="Date" value={txnFullDate(txn.created_at)} />
      {txn.client_name ? (
        <DetailLine label="Client" value={txn.client_name} />
      ) : null}
      {inactive ? <DetailLine label="Status" value={txn.status ?? ""} /> : null}
      <DetailLine
        label="Number"
        value={
          txn.reverses_id
            ? `#${txn.id} · reverses #${txn.reverses_id}`
            : `#${txn.id}`
        }
      />
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={[styles.line, { borderTopColor: t.border }]}>
      <Text style={{ color: t.textMuted, fontSize: 14 }}>{label}</Text>
      <Text style={[styles.lineValue, { color: t.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // No flex: 1 — the sheet sizes itself to this content ("fitToContents").
  sheet: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  typeBar: { width: 3, alignSelf: "stretch", borderRadius: 2 },
  title: { fontSize: 18, fontWeight: "600", flexShrink: 1 },
  amount: { fontSize: 22, fontWeight: "700" },
  struck: { textDecorationLine: "line-through" },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  lineValue: {
    fontSize: 14,
    fontWeight: "500",
    textAlign: "right",
    flexShrink: 1,
  },
});
