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
  // Default 1 worker: tried 2-by-default (2026-07-21) but reverted. The
  // specific failure seen (lira-069's session-mode "Add to Cart" assertion)
  // turned out to reproduce at 1 worker too in a full-suite run, so worker
  // count is NOT its cause — ruled out by a controlled comparison, not
  // assumed. That leaves the suite's baseline (1-worker) flake rate
  // unquantified, so default-on multi-worker safety is unverified rather
  // than disproven. Sequential (1 worker) stays the conservative default
  // until that baseline is measured. Override with PWTEST_WORKERS=N to opt
  // in; the per-worker DB/user-data-dir isolation and staggered boot
  // (fixtures.ts) already support it.
  workers: process.env.PWTEST_WORKERS ? Number(process.env.PWTEST_WORKERS) : 1,
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
