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
    // LiraTek swirl (assets/brand, owner-chosen 2026-10-10): Pastel Violet on Cosmic Navy.
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#0c134f" },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "./plugins/withReleaseSigning",
    [
      "expo-splash-screen",
      { image: "./assets/splash.png", imageWidth: 260, resizeMode: "contain", backgroundColor: "#020222" },
    ],
  ],
  experiments: { typedRoutes: true },
});
