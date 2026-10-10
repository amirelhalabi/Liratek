import type { ComponentProps } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";

type Props = ComponentProps<typeof TextInput> & { label: string };

/** Web TextInput: label text-sm slate-400, input bg-slate-900 border-slate-700 rounded-lg. */
export function TextField({ label, style, ...input }: Props) {
  const t = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: t.textMuted }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.placeholder}
        style={[styles.input, { backgroundColor: t.section, borderColor: t.borderStrong, color: t.text }, style]}
        {...input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  label: { fontSize: 14, fontWeight: "500", marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15 },
});
