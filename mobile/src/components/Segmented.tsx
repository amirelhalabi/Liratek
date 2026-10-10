import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";

interface Option<T extends string> {
  value: T;
  label: string;
}

/** A row of mutually exclusive choices, styled like the web's accent tabs. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly Option<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={[styles.wrap, { backgroundColor: t.section, borderColor: t.border }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.item, selected && { backgroundColor: t.accentFill }]}
          >
            <Text style={{ color: selected ? t.accentLabel : t.textSoft, fontWeight: selected ? "600" : "500" }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", borderRadius: radius.lg, borderWidth: 1, padding: 4, gap: 4 },
  item: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 6 },
});
