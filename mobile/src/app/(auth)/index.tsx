import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { loginWithShop } from "@/api/auth";
import { useAuth } from "@/auth/AuthContext";
import { signInErrorMessage } from "@/auth/messages";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PrimaryButton } from "@/components/PrimaryButton";
import { TextField } from "@/components/TextField";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing } from "@/theme/tokens";

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
    <LinearGradient colors={[t.section, t.section, t.page]} style={styles.flex}>
      <View style={[styles.blob, styles.blobTop, { backgroundColor: t.accent }]} />
      <View style={[styles.blob, styles.blobBottom, { backgroundColor: t.gradientTo }]} />
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
            <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
              <LinearGradient colors={[t.gradientFrom, t.gradientTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.header}>
                <Text style={[styles.title, { color: t.accentLabel }]}>LiraTek</Text>
                <Text style={[styles.subtitle, { color: t.accentLabel }]}>Management System</Text>
              </LinearGradient>

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
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  card: { borderRadius: radius.xxl, borderWidth: 1, overflow: "hidden" },
  header: { paddingVertical: 36, alignItems: "center" },
  title: { fontSize: 34, fontWeight: "700" },
  subtitle: { fontSize: 14, marginTop: 4, opacity: 0.85 },
  form: { padding: 24, gap: spacing.lg },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: spacing.sm },
  blob: { position: "absolute", width: 288, height: 288, borderRadius: 144, opacity: 0.1 },
  blobTop: { top: -80, right: -80 },
  blobBottom: { bottom: -80, left: -80 },
});
