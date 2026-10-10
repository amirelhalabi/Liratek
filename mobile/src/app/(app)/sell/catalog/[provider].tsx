import {
  buildCatalogSalePayload,
  catalogCartTotals,
  formatCatalogItemName,
  usdForLbp,
  type CatalogCartLine,
} from "@liratek/core/utils/catalogSale";
import { readUsdLbpRates } from "@liratek/core/utils/exchangeRates";
import { formatMoneyAmount } from "@liratek/core/utils/formatMoney";
import { canChargeToCustomerAccount } from "@liratek/ui/utils/customerAccount";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { NO_CONNECTION } from "@/api/client";
import { getCatalog, getRates, type CatalogRow } from "@/api/catalog";
import { newIdempotencyKey, recordServiceSale } from "@/api/sales";
import { ClientPicker, useClientPicker } from "@/components/ClientPicker";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PrimaryButton } from "@/components/PrimaryButton";
import { RefreshNotice } from "@/components/RefreshNotice";
import { Segmented } from "@/components/Segmented";
import { TextField } from "@/components/TextField";
import { invalidateAfter } from "@/data/invalidation";
import { queryKeys } from "@/data/queryKeys";
import { useShopSlug } from "@/data/useShop";
import { unwrap } from "@/data/unwrap";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing, TAB_BAR_CLEARANCE } from "@/theme/tokens";

type Provider = "Katsh" | "iPick";
type PayMethod = "CUSTOMER_ACCOUNT" | "WHISH" | "OMT";
type Currency = "LBP" | "USD";

const PAY_OPTIONS = [
  { value: "CUSTOMER_ACCOUNT", label: "On account" },
  { value: "WHISH", label: "Whish wallet" },
  { value: "OMT", label: "OMT wallet" },
] as const;
const CURRENCIES = [
  { value: "LBP", label: "LBP" },
  { value: "USD", label: "USD" },
] as const;

/** A catalog row the phone can sell: this provider's, with a cost and a price (spec FR-002). */
function sellable(rows: CatalogRow[], provider: Provider): (CatalogRow & { cost_lbp: number; sell_lbp: number })[] {
  return rows.filter(
    (r): r is CatalogRow & { cost_lbp: number; sell_lbp: number } =>
      r.provider === provider && (r.cost_lbp ?? 0) > 0 && (r.sell_lbp ?? 0) > 0,
  );
}

function messageFor(code: string): string {
  if (code === NO_CONNECTION) return "Not saved — no connection. Check your internet and tap Save again.";
  if (code === "DUPLICATE_IN_PROGRESS") return "This sale is still being saved. Wait a moment and check Activity.";
  return code;
}

/**
 * Katsh / iPick catalog sale (LIRA-302): pick items into a cart, then review,
 * choose the customer and how they pay, and save. The cart is booked as ONE
 * sale through core's buildCatalogSalePayload — the same builder the web's
 * Katsh/iPick screen uses — so it books exactly like the counter.
 */
export default function CatalogSaleScreen() {
  const t = useTheme();
  const slug = useShopSlug();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ provider: string }>();
  const provider: Provider = params.provider === "iPick" ? "iPick" : "Katsh";

  const catalog = useQuery({
    queryKey: queryKeys.catalog(slug),
    queryFn: async () => unwrap(await getCatalog()),
    enabled: !!slug,
  });
  const rates = useQuery({
    queryKey: queryKeys.rates(slug),
    queryFn: async () => unwrap(await getRates()),
    enabled: !!slug,
  });
  // No fallback rate on the phone: without a set rate, USD is off (spec edge case).
  const buyRate = rates.data ? readUsdLbpRates(rates.data)?.buyRate ?? null : null;

  const [step, setStep] = useState<"pick" | "pay">("pick");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Map<number, { row: CatalogRow & { cost_lbp: number; sell_lbp: number }; quantity: number }>>(new Map());
  const [method, setMethod] = useState<PayMethod>("CUSTOMER_ACCOUNT");
  const [currency, setCurrency] = useState<Currency>("LBP");
  const [flagged, setFlagged] = useState<Map<number, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useClientPicker();
  // One key per cart and payment; kept across retries of the same Save.
  const idemKey = useRef<string | null>(null);

  const lines: CatalogCartLine[] = useMemo(
    () => [...cart.values()].map(({ row, quantity }) => ({ item: { ...row, subcategory: row.subcategory ?? "" }, quantity })),
    [cart],
  );
  const { price } = catalogCartTotals(lines);
  const itemCount = [...cart.values()].reduce((n, l) => n + l.quantity, 0);
  const usdAmount = currency === "USD" && buyRate ? usdForLbp(price, buyRate) : null;

  useEffect(() => {
    idemKey.current = null;
  }, [cart, method, currency, picker.client, picker.newName, picker.newPhone]);
  useEffect(() => {
    if (currency === "USD" && !buyRate) setCurrency("LBP");
  }, [currency, buyRate]);
  // Android back button on the review returns to the item list too.
  useEffect(() => {
    if (step !== "pay") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setStep("pick");
      return true;
    });
    return () => sub.remove();
  }, [step]);

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = sellable(catalog.data ?? [], provider).filter((r) => !q || formatCatalogItemName(r).toLowerCase().includes(q));
    const byCategory = new Map<string, typeof rows>();
    for (const r of rows) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([title, data]) => ({ title, data }));
  }, [catalog.data, provider, search]);

  function changeQty(row: CatalogRow & { cost_lbp: number; sell_lbp: number }, delta: number) {
    setCart((prev) => {
      const next = new Map(prev);
      const qty = (next.get(row.id)?.quantity ?? 0) + delta;
      if (qty <= 0) next.delete(row.id);
      else next.set(row.id, { row, quantity: qty });
      return next;
    });
    setFlagged((prev) => {
      if (!prev.has(row.id)) return prev;
      const next = new Map(prev);
      next.delete(row.id);
      return next;
    });
  }

  /** Spec edge case: re-check the cart against the latest catalog; the sale carries no item ids. */
  async function staleLines(): Promise<Map<number, string> | null> {
    try {
      const fresh = await queryClient.fetchQuery({
        queryKey: queryKeys.catalog(slug),
        queryFn: async () => unwrap(await getCatalog()),
        staleTime: 0,
      });
      const byId = new Map(fresh.map((r) => [r.id, r]));
      const out = new Map<number, string>();
      for (const { row } of cart.values()) {
        const now = byId.get(row.id);
        if (!now || now.provider !== provider) out.set(row.id, "No longer available — remove it.");
        else if (now.cost_lbp !== row.cost_lbp || now.sell_lbp !== row.sell_lbp) out.set(row.id, "Price changed — remove it and add it again.");
      }
      return out;
    } catch {
      return null;
    }
  }

  async function onSave() {
    setError(null);
    if (cart.size === 0) {
      setError("Add at least one item.");
      return;
    }
    const { name, phone } = picker;
    if (method === "CUSTOMER_ACCOUNT" && !canChargeToCustomerAccount({ name, phone, clientId: picker.client?.id ?? null })) {
      setError("To put it on the customer's account, choose a client or enter a name and phone.");
      return;
    }
    if (currency === "USD" && !buyRate) {
      setError("No exchange rate is set, so USD cannot be used. Choose LBP.");
      return;
    }
    setSaving(true);
    const stale = await staleLines();
    if (stale === null) {
      setSaving(false);
      setError(messageFor(NO_CONNECTION));
      return;
    }
    if (stale.size > 0) {
      setSaving(false);
      setFlagged(stale);
      setError("Some items changed on the catalog. Fix the flagged lines, then save.");
      return;
    }
    const ensured = await picker.ensureClient();
    if (!ensured.ok) {
      setSaving(false);
      setError(ensured.error);
      return;
    }
    const amount = currency === "USD" && buyRate ? usdForLbp(price, buyRate) : price;
    const body = buildCatalogSalePayload({
      provider,
      lines,
      paidByMethod: method,
      payments: [{ method, currencyCode: currency, amount }],
      ...(currency === "USD" && buyRate ? { tenderExchangeRate: buyRate } : {}),
      client: { id: ensured.id, name: name || null },
    });
    idemKey.current ??= newIdempotencyKey();
    const result = await recordServiceSale(body, idemKey.current);
    setSaving(false);
    if (!result.success) {
      setError(messageFor(result.error));
      return;
    }
    idemKey.current = null;
    // Home, Activity and (on account) Debts show the sale next time (LIRA-300).
    void invalidateAfter(slug, { kind: "sale", paidBy: method, clientId: ensured.id });
    Alert.alert("Saved", `${provider} sale of ${formatMoneyAmount(amount, currency)} recorded.`, [
      { text: "OK", onPress: () => router.back() },
    ]);
  }

  const card = [styles.card, { backgroundColor: t.card, borderColor: t.border }];

  if (step === "pick") {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ title: provider }} />
        <View style={styles.searchBar}>
          <TextField label="" value={search} onChangeText={setSearch} placeholder={`Search ${provider} items`} autoCorrect={false} />
        </View>
        <RefreshNotice error={catalog.error} hasData={catalog.data !== undefined} />
        {catalog.isPending ? (
          <ActivityIndicator color={t.accent} style={{ marginTop: spacing.xl }} />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(r) => String(r.id)}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled={false}
            ListEmptyComponent={
              <Text style={{ color: t.textMuted, textAlign: "center", marginTop: spacing.xl }}>
                {search ? "No item matches your search." : `No ${provider} items with a price and a cost in the catalog.`}
              </Text>
            }
            renderSectionHeader={({ section }) => (
              <Text style={[styles.sectionHeader, { color: t.textSoft }]}>{section.title}</Text>
            )}
            renderItem={({ item: row }) => {
              const qty = cart.get(row.id)?.quantity ?? 0;
              return (
                <Pressable
                  accessibilityLabel={`${row.label}${row.subcategory ? ` ${row.subcategory}` : ""}`}
                  onPress={() => changeQty(row, 1)}
                  style={[styles.row, { backgroundColor: t.card, borderColor: qty > 0 ? t.accent : t.border }]}
                >
                  <View style={styles.flex}>
                    <Text style={{ color: t.text, fontWeight: "600" }}>{row.label}</Text>
                    {row.subcategory ? <Text style={{ color: t.textMuted, fontSize: 12 }}>{row.subcategory}</Text> : null}
                  </View>
                  <Text style={{ color: t.text, fontWeight: "600" }}>{formatMoneyAmount(row.sell_lbp, "LBP")}</Text>
                  {qty > 0 ? (
                    <View style={[styles.badge, { backgroundColor: t.accentFill }]}>
                      <Text style={{ color: t.accentLabel, fontWeight: "700" }}>{qty}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            }}
          />
        )}
        {itemCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Review cart"
            onPress={() => setStep("pay")}
            style={[styles.cartBar, { backgroundColor: t.accentFill }]}
          >
            <ShoppingCart size={18} color={t.accentLabel} />
            <Text style={[styles.flex, { color: t.accentLabel, fontWeight: "700" }]}>
              {itemCount === 1 ? "1 item" : `${itemCount} items`} · {formatMoneyAmount(price, "LBP")}
            </Text>
            <Text style={{ color: t.accentLabel, fontWeight: "700" }}>Review</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen
        options={{
          title: `${provider} — review`,
          // Back from the review returns to the item list, keeping the cart.
          headerLeft: () => (
            <Pressable accessibilityLabel="Back to items" onPress={() => setStep("pick")} hitSlop={12} style={styles.backBtn}>
              <ChevronLeft size={24} color={t.text} />
              <Text style={{ color: t.text, fontSize: 16 }}>Items</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={card}>
          <View style={styles.headRow}>
            <Text style={[styles.section, { color: t.text }]}>Cart</Text>
            <Pressable onPress={() => setStep("pick")} hitSlop={10}>
              <Text style={{ color: t.link, fontWeight: "600" }}>Add items</Text>
            </Pressable>
          </View>
          {[...cart.values()].map(({ row, quantity }) => (
            <View key={row.id} style={[styles.cartLine, { borderTopColor: t.border }]}>
              <View style={styles.flex}>
                <Text style={{ color: t.text, fontWeight: "500" }}>{formatCatalogItemName({ ...row, subcategory: row.subcategory ?? "" })}</Text>
                <Text style={{ color: t.textMuted, fontSize: 12 }}>{formatMoneyAmount(row.sell_lbp * quantity, "LBP")}</Text>
                {flagged.get(row.id) ? <Text style={{ color: t.danger, fontSize: 12 }}>{flagged.get(row.id)}</Text> : null}
              </View>
              <Pressable accessibilityLabel="One less" onPress={() => changeQty(row, -1)} hitSlop={8}>
                <Minus size={18} color={t.text} />
              </Pressable>
              <Text style={[styles.qty, { color: t.text }]}>{quantity}</Text>
              <Pressable accessibilityLabel="One more" onPress={() => changeQty(row, 1)} hitSlop={8}>
                <Plus size={18} color={t.text} />
              </Pressable>
              <Pressable accessibilityLabel="Remove" onPress={() => changeQty(row, -quantity)} hitSlop={8}>
                <Trash2 size={18} color={t.danger} />
              </Pressable>
            </View>
          ))}
          <View style={styles.headRow}>
            <Text style={{ color: t.textSoft }}>Total</Text>
            <Text style={[styles.amount, { color: t.text }]}>{formatMoneyAmount(price, "LBP")}</Text>
          </View>
        </View>

        <View style={card}>
          <Text style={[styles.section, { color: t.text }]}>Customer{method === "CUSTOMER_ACCOUNT" ? "" : " (optional)"}</Text>
          <ClientPicker picker={picker} />
        </View>

        <View style={card}>
          <Text style={[styles.section, { color: t.text }]}>How the customer pays</Text>
          <Segmented options={PAY_OPTIONS} value={method} onChange={setMethod} />
          <Segmented
            options={CURRENCIES}
            value={currency}
            onChange={(c) => {
              if (c === "USD" && !buyRate) {
                setError("No exchange rate is set, so USD cannot be used. Ask the admin to set it in Settings → Rates.");
                return;
              }
              setCurrency(c);
            }}
          />
          {!buyRate && !rates.isPending ? (
            <Text style={{ color: t.textMuted, fontSize: 13 }}>USD is off: no exchange rate is set.</Text>
          ) : null}
          <View style={styles.headRow}>
            <Text style={{ color: t.textSoft }}>Customer pays</Text>
            <Text style={[styles.amount, { color: t.text }]}>
              {usdAmount !== null ? formatMoneyAmount(usdAmount, "USD") : formatMoneyAmount(price, "LBP")}
            </Text>
          </View>
          {usdAmount !== null && buyRate ? (
            <Text style={{ color: t.textMuted, fontSize: 13 }}>
              {formatMoneyAmount(price, "LBP")} at {buyRate.toLocaleString()} LBP per $1
            </Text>
          ) : null}
          {method === "CUSTOMER_ACCOUNT" ? (
            <Text style={{ color: t.textMuted, fontSize: 13 }}>Added to the customer's debt.</Text>
          ) : null}
        </View>

        {/* Next to Save, where the owner is looking when it refuses. */}
        {error ? <ErrorBanner message={error} /> : null}
        <PrimaryButton label="Save" onPress={() => void onSave()} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  // Room for the cart bar, which floats just above the tab bar.
  list: { padding: spacing.lg, paddingBottom: TAB_BAR_CLEARANCE + 80, gap: spacing.sm },
  sectionHeader: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", marginTop: spacing.md, marginBottom: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  badge: { minWidth: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  cartBar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: TAB_BAR_CLEARANCE - spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  body: { padding: spacing.lg, paddingBottom: TAB_BAR_CLEARANCE, gap: spacing.lg },
  card: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  section: { fontSize: 16, fontWeight: "600" },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cartLine: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  backBtn: { flexDirection: "row", alignItems: "center" },
  qty: { minWidth: 20, textAlign: "center", fontWeight: "700" },
  amount: { fontSize: 16, fontWeight: "700" },
});
