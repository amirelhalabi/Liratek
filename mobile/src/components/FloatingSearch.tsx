import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Search, X } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useTheme, useThemePreference } from "@/theme/ThemeProvider";
import { spacing, TAB_BAR_CLEARANCE } from "@/theme/tokens";

const GLASS = isLiquidGlassAvailable();

/**
 * Glass on iOS 26 (Liquid Glass); a solid themed surface elsewhere (older
 * iOS, Android), so the shape and placement stay the same everywhere.
 */
function Glass({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  const t = useTheme();
  const { scheme } = useThemePreference();
  if (GLASS) {
    return (
      <GlassView style={style} glassEffectStyle="regular" isInteractive colorScheme={scheme === "dark" ? "dark" : "light"}>
        {children}
      </GlassView>
    );
  }
  return <View style={[style, { backgroundColor: t.card, borderColor: t.border, borderWidth: 1 }]}>{children}</View>;
}

/**
 * Search the iOS 26 way: a round glass search button floats at the bottom
 * right, just above the tab bar, within thumb reach. Tapping it opens a glass
 * search field that sits on the keyboard; the list above filters as you
 * type. Closing it clears the search and brings the button back.
 *
 * Place it as the LAST child of a `flex: 1` container that wraps the list.
 */
export function FloatingSearch({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [keyboard, setKeyboard] = useState(0);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => {
      LayoutAnimation.configureNext(LayoutAnimation.create(e.duration || 250, "keyboard", "opacity"));
      setKeyboard(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", (e) => {
      LayoutAnimation.configureNext(LayoutAnimation.create(e.duration || 250, "keyboard", "opacity"));
      setKeyboard(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  function openSearch() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(true);
  }

  function close() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onChangeText("");
    setOpen(false);
    Keyboard.dismiss();
  }

  // On the keyboard when it is up; otherwise just above the floating tab bar.
  const bottom = keyboard > 0 ? keyboard + spacing.sm : TAB_BAR_CLEARANCE - spacing.sm;

  if (!open) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Search" onPress={openSearch} style={[styles.fabWrap, { bottom }]} hitSlop={8}>
        <Glass style={styles.fab}>
          <Search size={22} color={t.text} />
          {value ? <View style={[styles.dot, { backgroundColor: t.accent }]} /> : null}
        </Glass>
      </Pressable>
    );
  }

  return (
    <View style={[styles.bar, { bottom }]}>
      <Glass style={styles.field}>
        <Search size={18} color={t.textMuted} />
        <TextInput
          ref={input}
          autoFocus
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.textMuted}
          style={[styles.input, { color: t.text }]}
          returnKeyType="search"
          onSubmitEditing={() => Keyboard.dismiss()}
          autoCorrect={false}
          accessibilityLabel={placeholder}
        />
        {value ? (
          <Pressable accessibilityLabel="Clear search" onPress={() => onChangeText("")} hitSlop={10}>
            <View style={[styles.clear, { backgroundColor: t.textMuted }]}>
              <X size={12} color={t.card} />
            </View>
          </Pressable>
        ) : null}
      </Glass>
      <Pressable accessibilityRole="button" accessibilityLabel="Close search" onPress={close} hitSlop={8}>
        <Glass style={styles.closeBtn}>
          <X size={20} color={t.text} />
        </Glass>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fabWrap: { position: "absolute", right: spacing.lg },
  fab: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  dot: { position: "absolute", top: 12, right: 12, width: 8, height: 8, borderRadius: 4 },
  bar: { position: "absolute", left: spacing.lg, right: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  field: {
    flex: 1,
    height: 50,
    borderRadius: 25,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    overflow: "hidden",
  },
  input: { flex: 1, fontSize: 17, paddingVertical: 0 },
  clear: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  closeBtn: { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
