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
// the broken-page backlog is docs/plans/done_plans/WEBAPP_MULTI_TENANT_PLAN.md Appendix A.
//
// Ad-hoc override — try ANY desktop spec file(s) in web mode without editing
// this file (comma-separated; globs work; disables the sub-test grep):
//   E2E_WEB_SPECS=lira-097-debt-cashout.spec.ts yarn test:e2e:web
//   E2E_WEB_SPECS='*.spec.ts' yarn test:e2e:web        # ALL desktop specs
const SPECS_OVERRIDE = process.env.E2E_WEB_SPECS;
const SHARED_DESKTOP_SPECS: string[] = SPECS_OVERRIDE
  ? SPECS_OVERRIDE.split(",").map((s) => s.trim())
  : [
      "app.spec.ts",
      // Phase 3 (window.api→REST shim, helpers/webApiShim.ts): desktop specs
      // enabled over web as their window.api.* surface is mapped in the shim.
      // Add a spec here once it passes via `E2E_WEB_SPECS=<spec> yarn test:e2e:web`.
      "lira-transactions-timezone.spec.ts", // needs transactions.getRecent
      "lira-session-multiple-per-day.spec.ts", // session.start/close/getActiveSessions/getTodayAllSessions (write path proven)
      "lira-081-maintenance-customer-account.spec.ts", // maintenance.getJobs/save/delete (save = money → debt_ledger)
      "lira-084-supplier-opening-balance.spec.ts", // suppliers.list/getBalances/addLedgerEntry (ledger money path)
      "lira-096-debt-split-repayment.spec.ts", // dashboard.getDrawerBalances/rates.list/maintenance.save/debt; split USD+LBP repayment
      "lira-097-debt-cashout.spec.ts", // clients.create + debt.addCredit (new POST /api/debts/credit) + cash-out
      // lira-099-session-debt-detail: green STANDALONE (E2E_WEB_SPECS) but
      // order-flaky in the full suite once 081/084 precede it — its session
      // checkout succeeds yet its debtor doesn't surface (shared-DB/shared-page
      // cross-spec state, NOT a shim/money bug — REST checkout→debtor verified).
      // Its session.getActive/cartAdd/checkout shim mappings stay for standalone;
      // re-add here once the isolation cause is found (roadmap §7b).
    ];

// Optional per-file sub-test filter for partially-passing spec files.
// app.spec.ts passes IN FULL in web mode (2026-07-10, incl. POS sale + debt
// settle after the shared saleProcessSchema landed) — no filter needed.
// Known exclusions (tracked in the plan doc's Appendix A):
//  - lira-073 (export column picker) — its createOmtAppSend seeding helper's
//    #transfer-amount form does not open in web mode; needs its own look.
const SHARED_DESKTOP_GREP: RegExp | undefined = undefined;

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
