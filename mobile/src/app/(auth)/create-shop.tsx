import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { requestSignupLink } from "@/api/auth";
import { NO_CONNECTION } from "@/api/client";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PageBackground } from "@/components/PageBackground";
import { PrimaryButton } from "@/components/PrimaryButton";
import { TextField } from "@/components/TextField";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing } from "@/theme/tokens";

/** "Create your shop": the phone only sends the existing web sign-up email (spec FR-029). */
export default function CreateShop() {
  const t = useTheme();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!email.includes("@")) {
      setError("Enter your email address.");
      return;
    }
    setLoading(true);
    const result = await requestSignupLink({ email });
    setLoading(false);
    if (!result.success) {
      setError(
        result.error === NO_CONNECTION
          ? "No connection. Check your internet and try again."
          : "Could not send the email. Please try again.",
      );
      return;
    }
    setSent(true);
  }

  return (
    <PageBackground>
      <SafeAreaView style={styles.flex}>
        <View style={styles.body}>
          <View
            style={[
              styles.card,
              { backgroundColor: t.card, borderColor: t.border },
            ]}
          >
            <Text style={[styles.title, { color: t.text }]}>
              Create your shop
            </Text>
            {sent ? (
              <Text style={{ color: t.textSoft }}>
                Check your email. Open the link we sent to set up your shop in
                the browser, then come back here to sign in.
              </Text>
            ) : (
              <>
                <Text style={{ color: t.textSoft }}>
                  We will email you a link to set up your shop on the web.
                </Text>
                {error ? <ErrorBanner message={error} /> : null}
                <TextField
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                />
                <PrimaryButton
                  label="Email me the link"
                  onPress={onSubmit}
                  loading={loading}
                />
              </>
            )}
            <Pressable onPress={() => router.back()}>
              <Text style={[styles.back, { color: t.link }]}>
                Back to sign in
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flex: 1, justifyContent: "center", padding: spacing.lg },
  card: {
    borderRadius: radius.xxl,
    borderWidth: 1,
    padding: 24,
    gap: spacing.lg,
  },
  title: { fontSize: 22, fontWeight: "700" },
  back: { textAlign: "center", fontWeight: "600", marginTop: spacing.sm },
});
