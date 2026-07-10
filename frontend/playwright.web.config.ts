import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Playwright config for WEB (browser) e2e tests.
 *
 * Fully isolated from the Electron suite (playwright.electron.config.ts):
 *   - own test dir:   tests/e2e-web/
 *   - own ports:      vite 5174, backend 3101 (Electron suite uses 5173 + IPC)
 *   - own database:   test-results/e2e-web/phone_shop.web.db (never the
 *                     Electron suite's DB, never the dev DB)
 *
 * The app runs as a real browser client: Vite serves the frontend, the
 * Express backend (backend/) serves /api/* against the test DB, and pages
 * talk to it over HTTP + JWT — no Electron, no IPC.
 *
 * Prerequisite: better-sqlite3 must be on the Node ABI (`yarn rebuild:node`).
 * The root `yarn test:e2e:web` script handles this. Plain `yarn dev` restores
 * the Electron ABI afterwards automatically.
 *
 * Run: yarn test:e2e:web
 */

export const WEB_PORT = 5174;
export const BACKEND_PORT = 3101;

// Signal web mode to the SHARED fixtures/seed helpers in tests/e2e-electron/
// (they branch on E2E_MODE — browser+REST instead of Electron+IPC). Set at
// config load so every worker process inherits it.
process.env.E2E_MODE = "web";
process.env.E2E_WEB_BASE_URL = `http://localhost:${WEB_PORT}`;
process.env.E2E_WEB_BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

// Desktop specs enabled in web mode. Extend this list as pages get fixed —
// the broken-page backlog is docs/plans/WEBAPP_MULTI_TENANT_PLAN.md Appendix A.
//
// Ad-hoc override — try ANY desktop spec file(s) in web mode without editing
// this file (comma-separated; globs work; disables the sub-test grep):
//   E2E_WEB_SPECS=lira-097-debt-cashout.spec.ts yarn test:e2e:web
//   E2E_WEB_SPECS='*.spec.ts' yarn test:e2e:web        # ALL desktop specs
const SPECS_OVERRIDE = process.env.E2E_WEB_SPECS;
const SHARED_DESKTOP_SPECS: string[] = SPECS_OVERRIDE
  ? SPECS_OVERRIDE.split(",").map((s) => s.trim())
  : ["app.spec.ts"];

// Within the default files, only sub-tests that touch web-working pages.
// Broken pages (products, clients, debts, services, recharge...) stay
// desktop-only until fixed — see Appendix A of the plan doc.
// Known web-mode failures kept OUT of the list (tracked in Appendix A):
//  - "POS: search product, add to cart, complete sale" and "Debts: add sale
//    debt and settle" — POST /api/sales/process 400s: the checkout payload
//    (items, payment legs, CUSTOMER_ACCOUNT) does not fit the thin REST
//    createSaleSchema. Blocked on the sales REST contract (roadmap step 2).
//  - lira-073 (export column picker) — its createOmtAppSend seeding helper's
//    #transfer-amount form does not open in web mode; needs its own look.
const SHARED_DESKTOP_GREP = SPECS_OVERRIDE
  ? undefined // explicit override runs everything in the requested files
  : new RegExp(
      [
        "POS: page loads",
        "Inventory: page loads",
        "Services: page loads and OMT buttons active",
        "Exchange: page loads",
        "Debts: page loads",
        "Expenses: page loads",
        "Inventory: create a product",
        "Clients: create a client",
        "Exchange: complete USD to LBP exchange",
        "Services: complete OMT send transaction",
        "Expenses: record an expense",
        "Services: WHISH disabled without partner",
      ].join("|"),
    );

const DB_PATH = path.join(
  __dirname,
  "test-results",
  "e2e-web",
  "phone_shop.web.db",
);

export default defineConfig({
  timeout: 60_000,
  retries: 0,
  // One backend process serves ONE shared accumulating DB (same model as the
  // Electron suite — see its rule about delta-based assertions). Keep runs
  // strictly sequential.
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/e2e-web/global-setup.ts",
  projects: [
    {
      name: "web",
      testDir: "./tests/e2e-web",
    },
    {
      name: "web-shared",
      testDir: "./tests/e2e-electron",
      testMatch: SHARED_DESKTOP_SPECS,
      grep: SHARED_DESKTOP_GREP,
    },
  ],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // Plain tsx (not `tsx watch`): test runs want a stable process that
      // Playwright fully owns and kills — no file-watch restarts mid-test.
      command: "npx tsx src/server.ts",
      cwd: path.join(__dirname, "..", "backend"),
      url: `http://127.0.0.1:${BACKEND_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "development",
        PORT: String(BACKEND_PORT),
        HOST: "127.0.0.1",
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        DATABASE_PATH: DB_PATH,
        JWT_SECRET: "e2e-web-only-secret-not-for-production-use-1234",
        JWT_EXPIRES_IN: "1d",
        // A single UI session fires hundreds of requests; production defaults
        // (100/15min) would 429 the suite (see rateLimit.ts env knobs).
        API_RATE_LIMIT_MAX: "1000000",
        AUTH_RATE_LIMIT_MAX: "100000",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: `npm run dev -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
