import type { ConfigContext, ExpoConfig } from "expo/config";

import { version } from "./package.json";

// Same variant pattern as hetivo-mobile-driver: one bundle id per variant so
// local, preview and production builds can sit side by side on one device.
const APP_VARIANT = (process.env.APP_VARIANT ?? "local") as
  | "local"
  | "preview"
  | "production";

const variantConfig = {
  local: { bundleIdentifier: "shop.liratek.app.local", name: "LiraTek Local", scheme: "liratek-local" },
  preview: { bundleIdentifier: "shop.liratek.app.preview", name: "LiraTek Preview", scheme: "liratek-preview" },
  production: { bundleIdentifier: "shop.liratek.app", name: "LiraTek", scheme: "liratek" },
} as const;

const { bundleIdentifier, name, scheme } = variantConfig[APP_VARIANT];

// Android refuses to install an update whose versionCode is not higher than
// the installed one. Derive it from the version so a version bump is enough:
// 0.1.1 → 101, 1.2.3 → 10203.
const [major, minor, patch] = version.split(".").map(Number);
const versionCode = major * 10000 + minor * 100 + patch;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name,
  slug: "liratek",
  scheme,
  version,
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: bundleIdentifier,
    versionCode,
    // LiraTek swirl (assets/brand, owner-chosen 2026-10-10): Pastel Violet on Cosmic Navy.
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#0c134f" },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "./plugins/withReleaseSigning",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash.png",
        imageWidth: 260,
        resizeMode: "contain",
        backgroundColor: "#020222",
        // Android 12+ shows the splash logo inside a circle and crops the rest,
        // which cut the wide wordmark to "LIRATE". Android gets the square
        // swirl, which fits the circle; iOS keeps the wordmark.
        android: { image: "./assets/brand/liratek-swirl.png", imageWidth: 140 },
      },
    ],
  ],
  experiments: { typedRoutes: true },
});
