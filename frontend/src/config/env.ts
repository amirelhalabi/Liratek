/**
 * Frontend Environment Configuration
 * Centralizes access to Vite environment variables
 */

export const env = {
  // API Configuration
  apiUrl: import.meta.env.VITE_API_URL || "http://localhost:3000",
  wsUrl: import.meta.env.VITE_WS_URL || "ws://localhost:3000",

  // App Mode
  appMode: (import.meta.env.VITE_APP_MODE || "standalone") as
    | "standalone"
    | "electron",

  // Debug
  debug: import.meta.env.VITE_DEBUG === "true" || import.meta.env.DEV,

  // Environment
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
  mode: import.meta.env.MODE,
} as const;

// Type-safe environment variable access
export type AppMode = typeof env.appMode;

// Validation (runs at import time)
if (env.isProd && !import.meta.env.VITE_API_URL) {
  // Note: Using console.warn here is intentional as this runs before logger is initialized
  console.warn(
    "⚠️ VITE_API_URL not set in production. Using default:",
    env.apiUrl,
  );
}

export default env;
