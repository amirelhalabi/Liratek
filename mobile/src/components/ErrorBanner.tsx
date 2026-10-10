import { AlertCircle } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";

/** Web error alert: red-500/15 fill, red border, AlertCircle icon. */
export function ErrorBanner({ message }: { message: string }) {
  const t = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: t.dangerSoft, borderColor: t.danger }]}>
      <AlertCircle size={18} color={t.danger} />
      <Text style={[styles.text, { color: t.danger }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", gap: 12, padding: 16, borderRadius: radius.lg, borderWidth: 1, alignItems: "flex-start" },
  text: { flex: 1, fontSize: 14 },
});
