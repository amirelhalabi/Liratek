import { buildWalletTransferPayload, calculateOmtWhishAppFees } from "@liratek/core/utils/walletTransfer";
import { formatMoneyAmount } from "@liratek/core/utils/formatMoney";
import { canChargeToCustomerAccount } from "@liratek/ui/utils/customerAccount";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { NO_CONNECTION } from "@/api/client";
import { createClient, searchClients, type ClientSummary } from "@/api/clients";
import { newIdempotencyKey, recordServiceSale } from "@/api/sales";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Segmented } from "@/components/Segmented";
import { TextField } from "@/components/TextField";
import { invalidateAfter } from "@/data/invalidation";
import { useShopSlug } from "@/data/useShop";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing } from "@/theme/tokens";

type Provider = "WHISH_APP" | "OMT_APP";
type Currency = "USD" | "LBP";
/**
 * The phone's payment choices (spec FR-003; no cash). Binance is left out
 * until the owner decides: the server refuses a USDT leg and a USD leg would
 * put a USD balance on the USDT Binance drawer (research, 2026-10-10).
 */
type PayMethod = "CUSTOMER_ACCOUNT" | "WHISH" | "OMT";

const TITLES: Record<Provider, string> = { WHISH_APP: "Whish App transfer", OMT_APP: "OMT App transfer" };
const PAY_OPTIONS = [
  { value: "CUSTOMER_ACCOUNT", label: "On account" },
  { value: "WHISH", label: "Whish wallet" },
  { value: "OMT", label: "OMT wallet" },
] as const;
const CURRENCIES = [
  { value: "USD", label: "USD" },
  { value: "LBP", label: "LBP" },
] as const;

function messageFor(code: string): string {
  if (code === NO_CONNECTION) return "Not saved — no connection. Check your internet and tap Save again.";
  if (code === "DUPLICATE_IN_PROGRESS") return "This sale is still being saved. Wait a moment and check the latest transactions.";
  return code;
}

/**
 * Record an OMT App / Whish App transfer (a SEND: the shop sends from its
 * wallet on the customer's behalf). The request body comes from core's shared
 * builder — the same one the web form uses — so the server books it exactly
 * like a sale at the counter.
 */
export default function SaleScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ provider: string }>();
  const provider: Provider = params.provider === "OMT_APP" ? "OMT_APP" : "WHISH_APP";
  const slug = useShopSlug();

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [fee, setFee] = useState("");
  const [method, setMethod] = useState<PayMethod>("CUSTOMER_ACCOUNT");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ClientSummary[]>([]);
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per Save tap, kept across retries of that tap; a new sale or an
  // edited form gets a new key.
  const idemKey = useRef<string | null>(null);

  const parsedAmount = Number.parseFloat(amount.replace(",", ".")) || 0;
  const fees = calculateOmtWhishAppFees({
    activeProvider: provider,
    serviceType: "SEND",
    currency,
    parsedAmount,
    manualFee: provider === "OMT_APP" ? fee : "",
    includingFees: false,
  });

  useEffect(() => {
    idemKey.current = null;
  }, [amount, currency, fee, method, client, newName, newPhone]);

  useEffect(() => {
    if (client || query.trim().length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchClients(query.trim()).then((r) => {
        if (!cancelled && r.success) setMatches(r.data.slice(0, 6));
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, client]);

  async function onSave() {
    setError(null);
    if (parsedAmount <= 0) {
      setError("Enter the amount to send.");
      return;
    }
    const name = client?.full_name ?? newName.trim();
    const phone = client?.phone_number ?? newPhone.trim();
    // Same rule as the web (rule 14): putting it on account needs a client
    // with a name and a phone.
    if (method === "CUSTOMER_ACCOUNT" && !canChargeToCustomerAccount({ name, phone, clientId: client?.id ?? null })) {
      setError("To put it on the customer's account, choose a client or enter a name and phone.");
      return;
    }
    setSaving(true);
    let clientId = client?.id ?? null;
    if (!clientId && name && phone) {
      const created = await createClient({ full_name: name, phone_number: phone, whatsapp_opt_in: false });
      if (!created.success) {
        setSaving(false);
        setError(created.error === NO_CONNECTION ? messageFor(NO_CONNECTION) : `Could not register the client: ${created.error}`);
        return;
      }
      clientId = created.data;
      setClient({ id: clientId, full_name: name, phone_number: phone });
    }
    const body = buildWalletTransferPayload({
      provider,
      serviceType: "SEND",
      currency,
      fees,
      includingFees: false,
      client: { id: clientId, name, phone },
      paidByMethod: method,
      payments: [{ method, currencyCode: currency, amount: fees.customerPays }],
    });
    idemKey.current ??= newIdempotencyKey();
    const result = await recordServiceSale(body, idemKey.current);
    setSaving(false);
    if (!result.success) {
      setError(messageFor(result.error));
      return;
    }
    idemKey.current = null;
    // Home, Activity and (on account) Debts show the sale next time (LIRA-300 FR-012).
    void invalidateAfter(slug, { kind: "transfer", paidBy: method, clientId });
    Alert.alert("Saved", `${TITLES[provider]} of ${formatMoneyAmount(fees.walletAmount, currency)} recorded.`, [
      { text: "OK", onPress: () => router.back() },
    ]);
  }

  const card = [styles.card, { backgroundColor: t.card, borderColor: t.border }];

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: TITLES[provider] }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {error ? <ErrorBanner message={error} /> : null}

        <View style={card}>
          <Text style={[styles.section, { color: t.text }]}>Amount to send</Text>
          <Segmented options={CURRENCIES} value={currency} onChange={setCurrency} />
          <TextField label={`Amount (${currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
          {provider === "OMT_APP" ? (
            <TextField label={`OMT App fee (${currency})`} value={fee} onChangeText={setFee} keyboardType="decimal-pad" placeholder="0" />
          ) : (
            <Text style={{ color: t.textMuted, fontSize: 13 }}>Whish App sends have no fee.</Text>
          )}
        </View>

        <View style={card}>
          <Text style={[styles.section, { color: t.text }]}>Customer</Text>
          {client ? (
            <View style={[styles.chosen, { borderColor: t.border }]}>
              <View style={styles.flex}>
                <Text style={{ color: t.text, fontWeight: "600" }}>{client.full_name}</Text>
                <Text style={{ color: t.textMuted }}>{client.phone_number}</Text>
              </View>
              <Pressable onPress={() => { setClient(null); setQuery(""); }} hitSlop={10}>
                <Text style={{ color: t.link, fontWeight: "600" }}>Change</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextField label="Search clients" value={query} onChangeText={setQuery} placeholder="Name or phone" autoCorrect={false} />
              {matches.map((m) => (
                <Pressable key={m.id} onPress={() => { setClient(m); setMatches([]); }} style={[styles.match, { borderColor: t.border }]}>
                  <Text style={{ color: t.text }}>{m.full_name}</Text>
                  <Text style={{ color: t.textMuted }}>{m.phone_number}</Text>
                </Pressable>
              ))}
              <Text style={{ color: t.textMuted, fontSize: 13 }}>Or a new client:</Text>
              <TextField label="Name" value={newName} onChangeText={setNewName} />
              <TextField label="Phone" value={newPhone} onChangeText={setNewPhone} keyboardType="phone-pad" />
            </>
          )}
        </View>

        <View style={card}>
          <Text style={[styles.section, { color: t.text }]}>How the customer pays</Text>
          <Segmented options={PAY_OPTIONS} value={method} onChange={setMethod} />
          <View style={styles.summaryRow}>
            <Text style={{ color: t.textSoft }}>Customer pays</Text>
            <Text style={[styles.amount, { color: t.text }]}>{formatMoneyAmount(fees.customerPays, currency)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={{ color: t.textSoft }}>Sent from {provider === "OMT_APP" ? "OMT App" : "Whish App"}</Text>
            <Text style={[styles.amount, { color: t.text }]}>{formatMoneyAmount(fees.walletAmount, currency)}</Text>
          </View>
          {method === "CUSTOMER_ACCOUNT" ? (
            <Text style={{ color: t.textMuted, fontSize: 13 }}>Added to the customer's debt.</Text>
          ) : null}
        </View>

        {saving ? <ActivityIndicator color={t.accent} /> : null}
        <PrimaryButton label="Save" onPress={() => void onSave()} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.lg, gap: spacing.lg },
  card: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  section: { fontSize: 16, fontWeight: "600" },
  chosen: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  match: { flexDirection: "row", justifyContent: "space-between", borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  amount: { fontSize: 16, fontWeight: "700" },
});
