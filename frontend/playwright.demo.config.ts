import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webConfig from "./playwright.web.config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Records the public demo video for the landing page
 * (docs/plans/ongoing_plans/LANDING_PAGE_PLAN.md, Phase 3a).
 *
 * NOT a test suite. It lives in tests/demo/, outside the testDirs of the
 * electron and web configs, so no e2e run (CI included) ever picks it up.
 *
 * Same stack as the web e2e suite (Vite 5174 + backend 3101, so the shared
 * web fixtures work unchanged), but against its OWN database, rebuilt from
 * scratch on every run: the video is public, so it must only ever show the
 * fictional data seeded by tests/demo/record-demo.spec.ts.
 *
 * Prerequisite: better-sqlite3 on the Node ABI (`yarn rebuild:node`).
 * Run: yarn workspace @liratek/frontend demo:record
 */

export const DEMO_DB_PATH = path.join(
  __dirname,
  "test-results",
  "demo",
  "demo.db",
);

const webServers = Array.isArray(webConfig.webServer)
  ? webConfig.webServer
  : [];

export default defineConfig({
  timeout: 180_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  testDir: "./tests/demo",
  outputDir: "./test-results/demo/output",
  globalSetup: "./tests/demo/global-setup.ts",
  reporter: "list",
  use: {
    baseURL: webConfig.use?.baseURL,
    viewport: { width: 1280, height: 720 },
    video: { mode: "on", size: { width: 1280, height: 720 } },
  },
  // Same two servers as the web suite, with the backend pointed at the demo
  // database instead of the e2e one.
  webServer: webServers.map((server) =>
    server.env?.DATABASE_PATH
      ? { ...server, env: { ...server.env, DATABASE_PATH: DEMO_DB_PATH } }
      : server,
  ),
});
