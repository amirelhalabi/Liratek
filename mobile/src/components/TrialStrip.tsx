import { useQuery } from "@tanstack/react-query";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getSubscriptionStatus } from "@/api/subscription";
import { queryKeys } from "@/data/queryKeys";
import { unwrap } from "@/data/unwrap";
import { useShopSlug } from "@/data/useShop";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { trialStripModel } from "@/utils/trialStrip";

/** Re-checked every 15 minutes, like the web banner; also on sign-in and on foreground. */
const REFRESH_MS = 15 * 60 * 1000;

/**
 * LIRA-332: the free-trial strip above the tabs — days left, or "trial ended",
 * with the WhatsApp activation button. Draws `trialStripModel` only; renders
 * nothing for a paying shop or before the first answer (fail open).
 */
export function TrialStrip() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const slug = useShopSlug();
  const query = useQuery({
    queryKey: queryKeys.subscription(slug),
    queryFn: async () => unwrap(await getSubscriptionStatus()),
    enabled: !!slug,
    staleTime: 0,
    refetchInterval: REFRESH_MS,
  });
  const model = trialStripModel(query.data ?? null);
  if (!model) return null;

  const colour = model.tone === "danger" ? t.danger : model.tone === "warning" ? "#f59e0b" : t.textSoft;
  const fill = model.tone === "danger" ? t.dangerSoft : t.card;
  return (
    <View style={[styles.box, { paddingTop: insets.top + 8, backgroundColor: fill, borderColor: colour }]}>
      <Text style={[styles.text, { color: colour }]}>{model.text}</Text>
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(model.url)}
        style={[styles.button, { backgroundColor: model.tone === "danger" ? t.danger : t.accentFill }]}
      >
        <Text style={[styles.buttonText, { color: model.tone === "danger" ? "#ffffff" : t.accentLabel }]}>
          {model.button}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: 1, gap: 8 },
  text: { fontSize: 13 },
  button: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.lg },
  buttonText: { fontSize: 13, fontWeight: "600" },
});
