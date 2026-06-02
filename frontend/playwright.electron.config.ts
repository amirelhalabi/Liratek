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
  // Override with `--workers=N` or PWTEST_WORKERS. 3 is a safe default —
  // each worker spawns a full Electron app, so this is RAM/CPU-bound.
  workers: process.env.PWTEST_WORKERS
    ? Number(process.env.PWTEST_WORKERS)
    : 3,
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
