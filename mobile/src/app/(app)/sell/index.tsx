import { router } from "expo-router";
import { Send, Zap } from "lucide-react-native";
import { Alert, ScrollView, StyleSheet, View } from "react-native";

import { ModuleTile } from "@/components/ModuleTile";
import { spacing } from "@/theme/tokens";

// Module icons and accents follow the web (create_db.sql icons; HomeGrid accentMap):
// OMT/Whish = Send (indigo), iPick/Katsh = Zap.
const INDIGO = "#818cf8";
const SKY = "#38bdf8";

// The four in-scope phone sales (LIRA-289 FR-001). Vouchers are not built yet.
const SALES = [
  { key: "WHISH_APP", label: "Whish App transfer", Icon: Send, color: INDIGO },
  { key: "OMT_APP", label: "OMT App transfer", Icon: Send, color: INDIGO },
  { key: "Katsh", label: "Katsh voucher", Icon: Zap, color: SKY },
  { key: "iPick", label: "iPick voucher", Icon: Zap, color: SKY },
] as const;

function openSale(key: string) {
  if (key === "WHISH_APP" || key === "OMT_APP") {
    router.push({ pathname: "/sell/[provider]", params: { provider: key } });
    return;
  }
  Alert.alert("Coming next", "Recording vouchers from the phone is the next step being built.");
}

/** Sell tab (LIRA-300 FR-004): the sales the phone can record. Loads no data. */
export default function SellScreen() {
  return (
    <ScrollView contentContainerStyle={styles.body}>
      {[0, 2].map((row) => (
        <View key={row} style={styles.row}>
          {SALES.slice(row, row + 2).map((s) => (
            <ModuleTile key={s.key} label={s.label} Icon={s.Icon} color={s.color} onPress={() => openSale(s.key)} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: "row", gap: spacing.md },
});
