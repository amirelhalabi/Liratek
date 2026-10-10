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
      // LIRA-297 batch A — specs whose window.api surface is fully mapped
      // (helpers/webApiShim.ts). Each passed over web via E2E_WEB_SPECS.
      "harness-notification-override.spec.ts", // needed fixtures' web-branch notification init script + shim auth.restoreSession
      "lira-064-payment-legs-summary.spec.ts",
      "lira-083-send-receive-fields.spec.ts",
      // 099: its order-flakiness was a hardcoded phone (03777888) that
      // lira-web-019 also seeds — findOrCreateByPhone attached the basket
      // to that client. Now per-run-unique phone + name.
      "lira-099-session-debt-detail.spec.ts",
      "lira-116-omt-whish-route-rename.spec.ts",
      "lira-127-payment-legs-expandable-row.spec.ts",
      "lira-130-maintenance-draft-and-unlock.spec.ts",
      "lira-151-inventory-batch-delete-transport.spec.ts",
      "lira-165-stock-intake-cost-visibility.spec.ts",
      "lira-176-maintenance-parts.spec.ts",
      "lira-232-session-item-refund.spec.ts",
      "lira-session-basket-payment.spec.ts",
      "lira-session-exchange-rate.spec.ts",
      "lira-session-grouping-ui.spec.ts",
      "lira-session-payout.spec.ts",
      // LIRA-297 batch B1 — BEGIN (edit only inside your own block)
      "lira-101-app-wallet-receive-fee-ui.spec.ts", // omt.getHistory
      "lira-109-session-keep-change.spec.ts", // transactions.getById
      "lira-alfa-gift-recording.spec.ts", // recharge.getHistory, session.cartGet
      "lira-session-allocation.spec.ts", // vouchers.create, sales.get
      "lira-session-basket-debt.spec.ts", // clients.getAll
      "lira-session-profits.spec.ts",
      // The four below start/close sessions over window.api and nudge the
      // app's visibilitychange refresh (web session poll is 120s).
      "lira-094-session-client-propagation.spec.ts", // + exchange.addTransaction, session.linkTransaction, partners.getAll
      "lira-095-multi-bill-checkout.spec.ts", // + session.cartGet
      "lira-098-binance-session-cashout.spec.ts",
      "lira-136-binance-fee-mode-c-ui-driven.spec.ts",
      // LIRA-297 batch B1 — END
      // LIRA-297 batch B2 — BEGIN (edit only inside your own block)
      // Suppliers / settlement / OMT account. No spec changes needed; 059
      // passes without the desktop wizard's base-system step (the seeded OMT
      // supplier is active and is_system=1 on the fresh web DB).
      "lira-056-supplier-credit-topup-settle.spec.ts",
      "lira-059-supplier-cashflow-bidirectional.spec.ts",
      "lira-061-sale-cost-supplier-ledger.spec.ts",
      "lira-062-ipick-katsh-bill.spec.ts",
      "lira-076-supplier-ledger-amount.spec.ts",
      "lira-079-created-at-ordering.spec.ts",
      "lira-089-bill-commission-settlement.spec.ts",
      "lira-134-refund-fee-on-top-receive.spec.ts",
      "lira-148-omt-system-account-settlement-routing.spec.ts",
      "lira-159-unsettled-summary-count.spec.ts",
      "lira-188-omt-account-rollup.spec.ts",
      "lira-189-omt-account-settlement.spec.ts",
      "lira-190-omt-app-credit-topup.spec.ts",
      "lira-192-omt-app-cashout.spec.ts",
      "lira-transactions-hidden-types.spec.ts",
      // GET /api/suppliers and /balances now forward includeInactive.
      "lira-supplier-secondary-system.spec.ts",
      // Left out of B2:
      //  - lira-137 / lira-141 (Checkpoint 1) / lira-158: find their row by
      //    the raw transfer amount, but since c2f4429d (2026-10-02) the
      //    settlement list shows supplier_owed (Katsh bill → 0 LBP; OMT SEND
      //    → amount + fee). Stale on both transports, not a web difference.
      // LIRA-297 batch B2 — END
      // LIRA-297 batch B3 — BEGIN (edit only inside your own block)
      "lira-063-omt-whish-optional-client.spec.ts", // shim omt.getById
      "lira-069-receipt-print-gating.spec.ts",
      "lira-073-datatable-export-columns.spec.ts", // createOmtAppSend now opens on web
      "lira-075-omt-inout-semantics.spec.ts",
      "lira-077-app-drawer-movement.spec.ts",
      "lira-078-prepaid-units.spec.ts",
      "lira-082-loto-inout.spec.ts",
      "lira-089-card-face-values.spec.ts",
      "lira-112-service-receipt-legs.spec.ts", // shim transactions.getCustomerLegs
      "lira-128-wallet-exchange.spec.ts", // shim walletExchange.create
      "lira-131-omt-fee-ui-driven.spec.ts",
      "recharge.spec.ts",
      // nested shim routes loto.cashPrize.* / loto.checkpoint.*
      "lira-091-loto-ledger-sign.spec.ts",
      "lira-092-supplier-payment-void.spec.ts",
      "lira-129-loto-refund.spec.ts",
      // Stale on both transports, brought up to date then enabled:
      // 074 test 3 now guards the RECEIVE OUT-leg refusal, 087 sends an ISO
      // transaction_time, 137/141/158 find settle rows by data-testid.
      "lira-074-omt-receive-split-payout.spec.ts",
      "lira-087-currency-by-date.spec.ts",
      "lira-137-katsh-bill-settlement-commission-topup.spec.ts",
      "lira-141-settlement-modes-and-topup-arrows.spec.ts",
      "lira-158-deferred-settlement-commission.spec.ts",
      // LIRA-297 batch B3 — END
      // LIRA-297 batch B4 — BEGIN (edit only inside your own block)
      // Partners / profits / keep-change / custom services.
      "lira-057-whish-topup-partner-client.spec.ts",
      // 071: web branch swaps `liratek.jwt` (not `sessionToken`) to the
      // staff JWT and back.
      "lira-071-profits-password-gate.spec.ts",
      "lira-086-profits-coverage.spec.ts",
      "lira-088-change-legs-all-forms.spec.ts",
      "lira-090-profit-correctness.spec.ts",
      "lira-106-keep-change-profit.spec.ts",
      "lira-107-debt-keep-change.spec.ts",
      "lira-108-keep-change-modules.spec.ts",
      "lira-113-partner-for-pos.spec.ts",
      "lira-114-partner-for-pos-ui.spec.ts",
      "lira-115-partner-for-recharge.spec.ts",
      "lira-116-partner-for-loto.spec.ts",
      "lira-118-partner-lifecycle.spec.ts",
      "lira-119-partner-for-financial-service.spec.ts",
      "lira-120-partner-profit-recognition.spec.ts",
      "lira-121-partner-payment-debt-profit.spec.ts",
      "lira-124-split-void-group.spec.ts",
      "lira-126-owner-notes-money-flows.spec.ts",
      "lira-custom-service-payout.spec.ts",
      "lira-services-for-partner-ui.spec.ts",
      // LIRA-297 batch B4 — END
      // LIRA-297 batch B5 — BEGIN (edit only inside your own block)
      // Debt / closing / exchange / hold money.
      "lira-060-hold-money.spec.ts",
      "lira-080-debt-import-totals.spec.ts",
      // 091/150: tops up General's float only if short (a fresh web DB
      // running a subset can start at 0), so the checkpoint seed is valid.
      "lira-091-checkpoint-timeline-variance.spec.ts",
      "lira-093-customer-account-everywhere.spec.ts",
      "lira-100-checkpoint-timeline-timezone.spec.ts",
      "lira-103-business-day-today.spec.ts",
      "lira-104-refund-account-debt.spec.ts",
      "lira-105-debt-repayment-rate-invariance.spec.ts",
      "lira-110-expense-payment-methods.spec.ts",
      "lira-122-auto-debt-split.spec.ts",
      // 123: S9's networkidle wait is desktop-only (never settles on web).
      "lira-123-auto-debt-scenarios.spec.ts",
      "lira-142-exchange-lot-settlement.spec.ts",
      "lira-146-exchange-cross-currency-override.spec.ts",
      "lira-147-general-drawer-foreign-currency.spec.ts",
      "lira-150-dashboard-checkpoint-time.spec.ts",
      // 165: web credential key is liratek.jwt; never runs a real reset.
      "lira-165-database-reset-guard.spec.ts",
      // LIRA-297 batch B5 — END
      // LIRA-297 batch B6 — BEGIN (edit only inside your own block)
      "lira-077-stock-adjustments.spec.ts",
      "lira-111-walkin-customer-rename.spec.ts",
      "lira-117-custom-service-item-pick.spec.ts",
      "lira-125-carrier-lines-validity-credits.spec.ts",
      "lira-132-telecom-only-days.spec.ts",
      "lira-133-telecom-credit-buyback-ui-driven.spec.ts",
      "lira-145-carrier-line-usage-expense.spec.ts", // + shim profits gate (ensureProfitsUnlocked)
      "lira-149-validity-rule-and-onlydays-profit.spec.ts",
      // Left out: lira-143 / lira-144 — the shared shim inventory.createProduct
      // drops warranty_months (143) and supplier (144), so their seeds differ.
      // LIRA-297 batch B6 — END
      // LIRA-297 batch LIRA270 — BEGIN (edit only inside your own block)
      // Were refused by core's LIRA-270 guard (a gross kind-less payout leg
      // read as netted change); fixed in SessionPaymentService.basketCollectNet.
      "lira-session-cashout-credit.spec.ts",
      "lira-session-debt-payout-signs.spec.ts",
      // LIRA-297 batch LIRA270 — END
    ];

// Optional per-file sub-test filter for partially-passing spec files.
// app.spec.ts passes IN FULL in web mode (2026-07-10, incl. POS sale + debt
// settle after the shared saleProcessSchema landed) — no filter needed.
const SHARED_DESKTOP_GREP: RegExp | undefined = undefined;

const DB_PATH = path.join(
  __dirname,
  "test-results",
  "e2e-web",
  "phone_shop.web.db",
);

/**
 * LIRA-267: where the backend's `file` email transport writes each email
 * (`<template>-<outboxId>.{html,txt,json}`). lira-web-039 polls it for the
 * invite link instead of a real mailbox. Exported for the spec.
 */
export const EMAIL_FILE_DIR = path.join(
  __dirname,
  "test-results",
  "e2e-web",
  "mail",
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
        // Pinned empty, NOT omitted: dotenv (core's env.ts, cwd=backend)
        // never overrides an already-set var, so leaving this unset lets a
        // developer's own (gitignored) backend/.env leak its real
        // APP_BASE_DOMAIN in here. That breaks the "Connect as admin"
        // impersonation handoff: admin.ts computes a real
        // `https://<slug>.<APP_BASE_DOMAIN>` targetOrigin and window.open()
        // navigates the e2e browser to an unreachable domain
        // (chrome-error://chromewebdata/) instead of this suite's own
        // localhost origin. Mirrors the same explicit-pin the backend jest
        // suite already does for ENV independence (wp5_wp6_admin_tenant.api.test.ts).
        APP_BASE_DOMAIN: "",
        JWT_SECRET: "e2e-web-only-secret-not-for-production-use-1234",
        JWT_EXPIRES_IN: "1d",
        // A single UI session fires hundreds of requests; production defaults
        // (100/15min) would 429 the suite (see rateLimit.ts env knobs).
        API_RATE_LIMIT_MAX: "1000000",
        // LIRA-282: the suite signs in as one user and makes thousands of
        // calls; the per-user (200/min) and per-IP flood caps would 429 it.
        API_USER_RATE_LIMIT_MAX: "1000000",
        API_IP_FLOOD_RATE_LIMIT_MAX: "1000000",
        AUTH_RATE_LIMIT_MAX: "100000",
        // LIRA-267 (lira-web-039): email invites + self-serve sign-up.
        // Every value pinned, NOT omitted, for the same dotenv-leak reason
        // as APP_BASE_DOMAIN above.
        EMAIL_TRANSPORT: "file",
        EMAIL_FILE_DIR,
        // APP_BASE_DOMAIN is pinned empty, so without this there is nowhere
        // for the link to point and invites answer 409 EMAIL_NOT_CONFIGURED.
        SIGNUP_INVITE_BASE_URL: `http://localhost:${WEB_PORT}`,
        // LIRA-278: self-serve is ON by its own switch, with Turnstile OFF —
        // the production launch configuration. Turnstile pinned empty (not
        // omitted) for the same dotenv-leak reason; its optional path is
        // covered by the backend API tests (no internet needed here).
        SIGNUP_SELF_SERVE_ENABLED: "true",
        TURNSTILE_SITE_KEY: "",
        TURNSTILE_SECRET_KEY: "",
        // The DB and limiter windows outlive one run; re-running within the
        // hour must not 429 or hit the daily self-serve cap.
        SIGNUP_RATE_LIMIT_MAX: "100000",
        SIGNUP_CHECK_RATE_LIMIT_MAX: "100000",
        SIGNUP_REQUEST_RATE_LIMIT_MAX: "100000",
        SIGNUP_SELF_SERVE_DAILY_CAP: "100000",
        // The account limiters (LIRA-275/276/279/281), raised for the same
        // re-run reason: forgot / reset-link check+reset, the /#/join link
        // check+accept, the /#/verify-email link.
        PASSWORD_RESET_FORGOT_RATE_LIMIT_MAX: "100000",
        PASSWORD_RESET_TOKEN_RATE_LIMIT_MAX: "100000",
        USER_INVITE_LINK_RATE_LIMIT_MAX: "100000",
        EMAIL_VERIFY_LINK_RATE_LIMIT_MAX: "100000",
        // LIRA-287 (lira-web-042): www sign-in code request + check.
        SIGNIN_CODE_REQUEST_RATE_LIMIT_MAX: "100000",
        SIGNIN_CODE_VERIFY_RATE_LIMIT_MAX: "100000",
        // Pinned empty (dotenv-leak, as above): the limiters key on req.ip,
        // and Google stays dormant — its flows are unit-tested only (no
        // Google account in e2e).
        CLIENT_IP_HEADER: "",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
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
