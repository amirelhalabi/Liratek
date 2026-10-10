import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { loginWithShop } from "@/api/auth";
import { useAuth } from "@/auth/AuthContext";
import { signInErrorMessage } from "@/auth/messages";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PageBackground } from "@/components/PageBackground";
import { PrimaryButton } from "@/components/PrimaryButton";
import { TextField } from "@/components/TextField";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing } from "@/theme/tokens";

// Owner-chosen logo (2026-10-10): swirl + LIRA in Pastel Violet, TEK in Signal Blue.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO = require("../../../assets/brand/liratek-logo.png") as number;
const BRAND_NAVY = "#0c134f";

/** Mirrors the web sign-in card (frontend/src/features/auth/pages/Login.tsx). */
export default function SignIn() {
  const t = useTheme();
  const { completeSignIn, rememberedShop } = useAuth();
  const [shop, setShopAddress] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (rememberedShop && !shop) setShopAddress(rememberedShop.slug);
    // Only pre-fill once, when the remembered shop first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rememberedShop]);

  async function onSubmit() {
    setError(null);
    if (!shop.trim() || !username.trim() || !password) {
      setError("Enter your shop address, username and password.");
      return;
    }
    setLoading(true);
    const result = await loginWithShop({ shop, username, password, deviceName: `${Platform.OS} phone` });
    setLoading(false);
    if (!result.success) {
      setError(signInErrorMessage(result.error));
      return;
    }
    await completeSignIn(result.data);
  }

  return (
    <PageBackground>
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
            <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
              {/* Brand panel: the LiraTek logo (violet + blue) needs Cosmic Navy behind it in both modes. */}
              <View style={[styles.header, { backgroundColor: BRAND_NAVY }]}>
                <Image
                  source={LOGO}
                  style={styles.logo}
                  resizeMode="contain"
                  accessibilityRole="image"
                  accessibilityLabel="LiraTek"
                />
                <Text style={styles.subtitle}>Management System</Text>
              </View>

              <View style={styles.form}>
                {error ? <ErrorBanner message={error} /> : null}
                <TextField
                  label="Shop address"
                  placeholder="e.g. cornertech"
                  value={shop}
                  onChangeText={setShopAddress}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="organizationName"
                />
                <TextField
                  label="Username"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="username"
                  autoComplete="username"
                />
                <TextField
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="password"
                  autoComplete="password"
                  onSubmitEditing={onSubmit}
                  returnKeyType="go"
                />
                <PrimaryButton label="Sign in" onPress={onSubmit} loading={loading} />

                <View style={styles.footerRow}>
                  <Text style={{ color: t.textMuted }}>New to LiraTek? </Text>
                  <Link href="/create-shop" style={{ color: t.link, fontWeight: "600" }}>
                    Create your shop
                  </Link>
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  card: { borderRadius: radius.xxl, borderWidth: 1, overflow: "hidden" },
  header: { paddingVertical: 32, paddingHorizontal: 24, alignItems: "center" },
  logo: { width: "100%", height: 48 },
  subtitle: { fontSize: 13, marginTop: 10, color: "#bfc7dc", letterSpacing: 2, textTransform: "uppercase" },
  form: { padding: 24, gap: spacing.lg },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: spacing.sm },
});
