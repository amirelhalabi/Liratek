import * as Linking from "expo-linking";
import { LogOut, Moon, Smartphone, Sun, Trash2, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/auth/AuthContext";
import { useTheme, useThemePreference, type ThemePreference } from "@/theme/ThemeProvider";
import { radius, spacing } from "@/theme/tokens";

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: LucideIcon }[] = [
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Smartphone },
];

export default function SettingsScreen() {
  const t = useTheme();
  const { shop, signOut } = useAuth();
  const { preference, setPreference } = useThemePreference();

  return (
    <View style={[styles.body, { backgroundColor: t.page }]}>
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={{ color: t.textMuted, fontSize: 12 }}>Signed in to</Text>
        <Text style={{ color: t.text, fontSize: 18, fontWeight: "600" }}>{shop?.name}</Text>
        <Text style={{ color: t.textMuted }}>{shop?.slug}.liratek.shop</Text>
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: 8 }}>Appearance</Text>
        <View accessibilityRole="radiogroup" style={[styles.segment, { backgroundColor: t.section, borderColor: t.border }]}>
          {THEME_OPTIONS.map(({ value, label, Icon }) => {
            const selected = preference === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setPreference(value)}
                style={[styles.segmentItem, selected && { backgroundColor: t.accentFill }]}
              >
                <Icon size={16} color={selected ? t.accentLabel : t.textMuted} />
                <Text style={{ color: selected ? t.accentLabel : t.textSoft, fontWeight: selected ? "600" : "500" }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        {preference === "system" ? (
          <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 8 }}>Follows your phone's dark or light mode.</Text>
        ) : null}
      </View>

      <Pressable onPress={() => void signOut()} style={[styles.row, { backgroundColor: t.card, borderColor: t.border }]}>
        <LogOut size={20} color={t.text} />
        <Text style={{ color: t.text, fontWeight: "500" }}>Sign out</Text>
      </Pressable>

      {/* Apple expects a way to delete the account; deletion happens on the web (research R9). */}
      <Pressable
        onPress={() => void Linking.openURL(`https://${shop?.slug ?? "www"}.liratek.shop/#/settings`)}
        style={[styles.row, { backgroundColor: t.card, borderColor: t.border }]}
      >
        <Trash2 size={20} color={t.danger} />
        <Text style={{ color: t.danger, fontWeight: "500" }}>Delete account (opens the web app)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: spacing.lg, gap: spacing.md },
  card: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: 4 },
  segment: { flexDirection: "row", borderRadius: radius.lg, borderWidth: 1, padding: 4, gap: 4 },
  segmentItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg },
});
