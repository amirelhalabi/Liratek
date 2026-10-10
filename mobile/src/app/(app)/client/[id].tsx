import { formatMoneyAmount } from "@liratek/core/utils/formatMoney";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { NO_CONNECTION } from "@/api/client";
import { getClientBalance, recordRepayment, type ClientBalance } from "@/api/debts";
import { newIdempotencyKey } from "@/api/sales";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Segmented } from "@/components/Segmented";
import { TextField } from "@/components/TextField";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing } from "@/theme/tokens";

type Currency = "USD" | "LBP";
/** Wallets the customer can pay into from the phone (no cash; Binance deferred, owner 2026-10-10). */
type Wallet = "WHISH" | "OMT";

const CURRENCIES = [
  { value: "USD", label: "USD" },
  { value: "LBP", label: "LBP" },
] as const;
const WALLETS = [
  { value: "WHISH", label: "Whish wallet" },
  { value: "OMT", label: "OMT wallet" },
] as const;

/**
 * A client's debt (spec FR-015) and "Record a repayment" into a wallet
 * (US5 / FR-006). The body has the same keys as the web Debts page.
 */
export default function ClientScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ id: string; name?: string; phone?: string }>();
  const clientId = Number(params.id);

  const [balance, setBalance] = useState<ClientBalance | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [wallet, setWallet] = useState<Wallet>("WHISH");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idemKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    const r = await getClientBalance(clientId);
    if (r.success) setBalance(r.data);
  }, [clientId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    idemKey.current = null;
  }, [amount, currency, wallet, note]);

  const parsed = Number.parseFloat(amount.replace(",", ".")) || 0;

  async function onSave() {
    setError(null);
    if (parsed <= 0) {
      setError("Enter the amount the customer paid.");
      return;
    }
    setSaving(true);
    idemKey.current ??= newIdempotencyKey();
    const result = await recordRepayment(
      {
        clientId,
        amountUSD: currency === "USD" ? parsed : 0,
        amountLBP: currency === "LBP" ? parsed : 0,
        payments: [{ method: wallet, currencyCode: currency, amount: parsed }],
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      idemKey.current,
    );
    setSaving(false);
    if (!result.success) {
      setError(
        result.error === NO_CONNECTION
          ? "Not saved — no connection. Check your internet and tap Save again."
          : result.error,
      );
      return;
    }
    idemKey.current = null;
    setAmount("");
    setNote("");
    await load();
    Alert.alert("Saved", `Repayment of ${formatMoneyAmount(parsed, currency)} recorded.`);
  }

  const card = [styles.card, { backgroundColor: t.card, borderColor: t.border }];

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: params.name || "Client" }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {error ? <ErrorBanner message={error} /> : null}
        <View style={card}>
          <Text style={{ color: t.textMuted, fontSize: 12 }}>{params.phone ?? ""}</Text>
          <Text style={[styles.section, { color: t.text }]}>Owes</Text>
          {balance === null ? (
            <Text style={{ color: t.textMuted }}>Loading…</Text>
          ) : (
            <View style={styles.owes}>
              <Text style={[styles.big, { color: t.text }]}>{formatMoneyAmount(balance.balance_usd, "USD")}</Text>
              {balance.balance_lbp ? <Text style={[styles.big, { color: t.text }]}>{formatMoneyAmount(balance.balance_lbp, "LBP")}</Text> : null}
            </View>
          )}
        </View>

        <View style={card}>
          <Text style={[styles.section, { color: t.text }]}>Record a repayment</Text>
          <Segmented options={CURRENCIES} value={currency} onChange={setCurrency} />
          <TextField label={`Amount paid (${currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
          <Text style={{ color: t.textSoft }}>Paid into</Text>
          <Segmented options={WALLETS} value={wallet} onChange={setWallet} />
          <TextField label="Note (optional)" value={note} onChangeText={setNote} />
          <PrimaryButton label="Save repayment" onPress={() => void onSave()} loading={saving} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.lg, gap: spacing.lg },
  card: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  section: { fontSize: 16, fontWeight: "600" },
  owes: { gap: 2 },
  big: { fontSize: 24, fontWeight: "700" },
});
