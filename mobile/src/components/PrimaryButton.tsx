import { LinearGradient } from "expo-linear-gradient";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";

interface Props {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

/** Web primary button: full-width gradient, rounded-lg, semibold label. */
export function PrimaryButton({ label, onPress, loading = false, disabled = false }: Props) {
  const t = useTheme();
  const inactive = loading || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [styles.wrap, { opacity: inactive ? 0.7 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
    >
      <LinearGradient
        colors={inactive ? [t.borderStrong, t.borderStrong] : [t.gradientFrom, t.gradientTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.fill}
      >
        {loading ? (
          <ActivityIndicator color={t.accentLabel} />
        ) : (
          <Text style={[styles.label, { color: t.accentLabel }]}>{label}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", borderRadius: radius.lg, overflow: "hidden" },
  fill: { paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 16, fontWeight: "600" },
});
