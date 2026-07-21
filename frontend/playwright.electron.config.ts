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
  retries: 2,
  // Each spec file runs in its own worker; workers do NOT share an Electron
  // instance or DB (fixtures key the user-data-dir + DB path by worker index),
  // so Electron's per-user-data-dir single-instance lock never collides.
  // Within a file, tests stay ordered (specs use test.describe.serial +
  // beforeAll seeding), so fullyParallel is left off.
  fullyParallel: false,
  // Default 2 workers on macOS/Linux/CI — each worker gets its own DB +
  // user-data-dir (fixtures.ts) and boots are staggered to avoid the shared
  // macOS resource race. Windows stays at 1: Electron's
  // requestSingleInstanceLock() can conflict when multiple instances start
  // simultaneously there, even with different --user-data-dir values.
  // Override with PWTEST_WORKERS=N.
  workers: process.env.PWTEST_WORKERS
    ? Number(process.env.PWTEST_WORKERS)
    : process.platform === "win32"
      ? 1
      : 2,
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    port: 5173,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
