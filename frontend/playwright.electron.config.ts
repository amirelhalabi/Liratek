import { defineConfig } from "@playwright/test";

/**
 * Playwright config for Electron e2e tests.
 *
 * These tests launch the real Electron app (with IPC, database, etc.)
 * and exercise full transaction flows.
 *
 * Prerequisites:
 *   - electron-app must be built: cd electron-app && npm run build
 *   - Vite dev server is started automatically by this config
 *
 * Run: yarn test:e2e:electron
 */
export default defineConfig({
  testDir: "./tests/e2e-electron",
  timeout: 90_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  use: {
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    port: 5173,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
