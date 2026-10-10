import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";

interface Props {
  label: string;
  Icon: LucideIcon;
  /** The web home grid gives each module its own accent (HomeGrid accentMap). */
  color: string;
  onPress: () => void;
  disabled?: boolean;
}

/** Web home-grid tile: card fill, coloured top border, icon badge, label. */
export function ModuleTile({ label, Icon, color, onPress, disabled = false }: Props) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: t.card, borderColor: t.border, borderTopColor: color, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
      ]}
    >
      <View style={[styles.badge, { backgroundColor: `${color}1A` }]}>
        <Icon size={28} color={color} />
      </View>
      <Text style={[styles.label, { color: t.textSoft }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minHeight: 128, alignItems: "center", justifyContent: "center", gap: 14, padding: 16, borderRadius: radius.xl, borderWidth: 1, borderTopWidth: 2 },
  badge: { padding: 12, borderRadius: radius.xl },
  label: { fontSize: 13, fontWeight: "500", textAlign: "center" },
});
