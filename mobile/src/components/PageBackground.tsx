import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";

/**
 * The web app's page background (frontend/src/index.css `.bg-gradient-to-br`):
 * a diagonal page → section → page gradient, in both modes.
 */
export function PageBackground({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <LinearGradient colors={[t.page, t.section, t.page]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
