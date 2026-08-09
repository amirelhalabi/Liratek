/**
 * Electron Playwright Fixtures
 *
 * Strategy: Single Electron instance per worker.
 * - App launches once with a fresh DB
 * - `completeSetup()` is called once
 * - All tests share that instance (already logged in, setup done)
 * - Navigation between tests uses hash routing (no reload)
 */

import {
  test as base,
  _electron,
  type Browser,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";

// ---------------------------------------------------------------------------
// Seed helpers — thin re-exports so test files only need to import fixtures
// ---------------------------------------------------------------------------
export {
  seedClient,
  seedProduct,
  seedExpense,
  seedCustomService,
  seedExchangeRate,
} from "./helpers/seed.js";
import { installWebApiShim } from "./helpers/webApiShim.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Per-worker index so parallel workers never share a DB or user-data-dir.
// Playwright sets TEST_WORKER_INDEX per worker process; the fixture module
// state below is per-worker-process, so reading it once at module load is safe.
const WORKER_INDEX = process.env.TEST_WORKER_INDEX ?? "0";

// Unique run ID prevents a stale Electron process from a previous (crashed/killed)
// test run from holding requestSingleInstanceLock() on the same user-data-dir and
// causing the new run's Electron to call app.quit() before opening any window.
const RUN_ID = process.env.PLAYWRIGHT_TEST_RUN_UID ?? process.pid.toString();

// Test DB location — isolated from the user's real database AND per-worker.
const TEST_DB_DIR = path.join(
  os.tmpdir(),
  `liratek-e2e-test-${WORKER_INDEX}-${RUN_ID}`,
);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "phone_shop.db");
// Isolated user-data-dir so the test instance never collides with a
// running yarn dev session, installed app, or a sibling parallel worker.
// Electron's requestSingleInstanceLock() is per user-data-dir, so each
// worker MUST get its own directory or the second worker's Electron quits
// immediately ("Process failed to launch").
// The RUN_ID suffix ensures a stale process from a prior crashed run cannot
// hold the lock for directories used by the current run.
const TEST_USER_DATA_DIR = path.join(
  os.tmpdir(),
  `liratek-e2e-userdata-${WORKER_INDEX}-${RUN_ID}`,
);

// ---------------------------------------------------------------------------
// Web mode (E2E_MODE=web): the SAME specs run against a browser + the Express
// REST backend instead of Electron + IPC. playwright.web.config.ts sets the
// env vars; nothing changes for the Electron config. In web mode `appPage` is
// a shared logged-in browser page, and helpers/seed.ts seeds over REST.
// ---------------------------------------------------------------------------
export const isWebMode = process.env.E2E_MODE === "web";
const WEB_BASE_URL = process.env.E2E_WEB_BASE_URL ?? "http://localhost:5174";
const WEB_BACKEND_URL =
  process.env.E2E_WEB_BACKEND_URL ?? "http://127.0.0.1:3101";

// Shared state across all tests in a worker
let sharedApp: ElectronApplication | null = null;
let sharedBrowser: Browser | null = null; // web mode only
let sharedPage: Page | null = null;
let setupDone = false;

// A "Target page, context or browser has been closed" failure is silent about
// the cause — it looks identical whether the renderer crashed, the main process
// threw an uncaught JS exception, or the OS SIGKILL'd the process. These three
// signals disambiguate it (describeElectronDeath() bundles them for a failure
// message):
//
//   - lastElectronExit — the child `exit` event (code + signal). Async, so it
//     can still be null at the instant the "page closed" error is thrown; the
//     synchronous procState below is authoritative for alive-vs-dead.
//   - procState — sharedApp.process().exitCode / .signalCode read live and
//     SYNCHRONOUSLY at catch time. alive=true ⇒ the process is STILL RUNNING and
//     only the window/target was destroyed (not a process crash). signal set ⇒
//     OS/native kill (check ~/Library/Logs/DiagnosticReports for a matching
//     .ips). exitCode 1, no signal ⇒ a main-process JS exception (a real bug).
//   - recentStderr — the tail of the piped `[electron] …` stderr, where a
//     main-process JS exception prints its stack (a signal kill is silent here).
let lastElectronExit: {
  code: number | null;
  signal: string | null;
  at: string;
} | null = null;

// Ring buffer of the most recent Electron stderr chunks (a JS crash stack lives
// here but is otherwise buried in minutes of interleaved test output).
const electronStderrRing: string[] = [];
const MAX_STDERR_CHUNKS = 80;

// Fixture-level page lifecycle timestamps. A test-local `page.on("crash")`
// flag can race the failure throw (the death is detected ~1ms after the
// trigger, before the crash event dispatches) — these listeners live for the
// whole worker, so describeElectronDeath() reads them race-free.
let pageClosedAt: string | null = null;
let pageCrashedAt: string | null = null;

export function getLastElectronExit(): {
  code: number | null;
  signal: string | null;
  at: string;
} | null {
  return lastElectronExit;
}

// Live, synchronous liveness of the shared Electron main process. Unlike the
// `exit` event this never races the "page closed" rejection.
export function getElectronProcessState(): {
  exists: boolean;
  alive?: boolean;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  killed?: boolean;
  pid?: number;
  appObjectDisposed?: boolean;
} {
  if (!sharedApp) return { exists: false };
  try {
    const p = sharedApp.process();
    return {
      exists: true,
      alive: p.exitCode === null && p.signalCode === null,
      exitCode: p.exitCode,
      signalCode: p.signalCode,
      killed: p.killed,
      pid: p.pid,
    };
  } catch {
    // sharedApp.process() throws once Playwright has disposed the
    // ElectronApplication — which it only does when the debugger connection
    // to the app is gone. Mid-test, this is the FINGERPRINT of the flake:
    // the runner↔Electron inspector/CDP websocket dropped while the app,
    // window, and renderer all stayed alive (confirmed 2026-07-11: main.ts
    // render-process-gone/close diagnostics stayed silent at death time).
    return { exists: true, appObjectDisposed: true };
  }
}

// One compact string for a diagnostic failure message: is the process alive,
// how did it exit, when did the page close/crash, and the last ~1.2k chars of
// its output (both streams — render-process-gone diagnostics arrive via pino
// on stdout). Await the returned promise: it settles ~750ms so in-flight
// close/crash/process-gone events land before the snapshot is taken.
export async function describeElectronDeath(): Promise<string> {
  await new Promise((r) => setTimeout(r, 750));
  const state = getElectronProcessState();
  const outputTail = electronStderrRing.join("").slice(-1200);
  return (
    `procState=${JSON.stringify(state)}; ` +
    `lastExit=${JSON.stringify(lastElectronExit)}; ` +
    `pageClosedAt=${pageClosedAt}; pageCrashedAt=${pageCrashedAt}; ` +
    `outputTail=${JSON.stringify(outputTail)}`
  );
}

export const test = base.extend<
  {
    appPage: Page;
  },
  {
    _appCleanup: void;
  }
>({
  // Worker-scoped auto fixture: guarantees the shared Electron instance is
  // closed when the worker finishes, so cancelled/finished runs never leave a
  // stray electron.exe holding the per-worker user-data-dir lock.
  _appCleanup: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use();
      if (sharedApp) {
        await sharedApp.close().catch(() => {});
        sharedApp = null;
        sharedPage = null;
        setupDone = false;
      }
      if (sharedBrowser) {
        await sharedBrowser.close().catch(() => {});
        sharedBrowser = null;
        sharedPage = null;
      }
    },
    { scope: "worker", auto: true },
  ],
  appPage: async ({ playwright }, use) => {
    if (isWebMode) {
      if (!sharedPage) {
        sharedBrowser = await playwright.chromium.launch();
        const context = await sharedBrowser.newContext();
        // Point the app's httpClient at this suite's backend before any app
        // code runs (default would be 127.0.0.1:3000).
        await context.addInitScript((url: string) => {
          (
            globalThis as { __LIRATEK_BACKEND_URL?: string }
          ).__LIRATEK_BACKEND_URL = url;
        }, WEB_BACKEND_URL);
        // Phase 3: install the browser-side window.api → REST shim so the
        // IPC-driven desktop specs (page.evaluate(window.api.*)) run over HTTP.
        await installWebApiShim(context);
        sharedPage = await context.newPage();
        sharedPage.on("dialog", (dialog) => {
          dialog.accept().catch(() => {});
        });
        // Web mode has no setup wizard (it is IPC-gated) — log in directly.
        // The admin password is seeded by tests/e2e-web/global-setup.ts.
        await sharedPage.goto(`${WEB_BASE_URL}/#/login`);
        await sharedPage.fill('input[placeholder="Enter username"]', "admin");
        await sharedPage.fill('input[type="password"]', "admin123");
        await sharedPage.click('button[type="submit"]');
        await sharedPage.waitForURL((u) => !u.hash.includes("/login"), {
          timeout: 15_000,
        });
      }
      // eslint-disable-next-line react-hooks/rules-of-hooks
      await use(sharedPage);
      return;
    }

    if (!sharedApp) {
      // First test — launch Electron with fresh DB
      fs.mkdirSync(TEST_DB_DIR, { recursive: true });
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      for (const ext of ["-wal", "-shm"]) {
        const f = TEST_DB_PATH + ext;
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }

      const electronAppPath = path.resolve(__dirname, "../../../electron-app");
      // Use require('electron') to get the platform-correct binary path.
      // On Windows, node_modules/.bin/electron is a Unix shell script and
      // cannot be used as an executablePath directly.
      const _require = createRequire(import.meta.url);
      const electronBin = _require("electron") as string;

      // Ensure a clean isolated user-data-dir for this test run
      if (fs.existsSync(TEST_USER_DATA_DIR)) {
        fs.rmSync(TEST_USER_DATA_DIR, { recursive: true, force: true });
      }
      fs.mkdirSync(TEST_USER_DATA_DIR, { recursive: true });

      // Stagger Electron boots across parallel workers (A7): simultaneous
      // boots of multiple Electron instances race on shared macOS resources
      // and can hard-kill a sibling's main process ~5-15s in — the recurring
      // "Target page closed, pageCrashed=false" death that always hit
      // whichever test occupied that wall-clock slot on worker 0. Boots are
      // serialized (~2s apart); test execution stays fully parallel.
      const workerIdx = Number(WORKER_INDEX) || 0;
      if (workerIdx > 0) {
        await new Promise((r) => setTimeout(r, workerIdx * 2000));
      }

      sharedApp = await _electron.launch({
        executablePath: electronBin,
        args: [
          path.join(electronAppPath, "dist/main.js"),
          `--user-data-dir=${TEST_USER_DATA_DIR}`,
        ],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_PATH: TEST_DB_PATH,
          ELECTRON_RENDERER_URL: "http://localhost:5173",
        },
        cwd: electronAppPath,
      });

      // Pipe Electron's stdout/stderr to console so startup errors are
      // visible, and keep the tail of BOTH in a ring buffer so a main-process
      // crash stack or a render-process-gone diagnostic (pino → stdout) can be
      // embedded in a failing test's error (see describeElectronDeath()).
      sharedApp.process().stderr?.on("data", (chunk: Buffer) => {
        const s = chunk.toString();
        process.stderr.write(`[electron] ${s}`);
        electronStderrRing.push(s);
        if (electronStderrRing.length > MAX_STDERR_CHUNKS)
          electronStderrRing.shift();
      });
      sharedApp.process().stdout?.on("data", (chunk: Buffer) => {
        const s = chunk.toString();
        process.stdout.write(`[electron] ${s}`);
        electronStderrRing.push(s);
        if (electronStderrRing.length > MAX_STDERR_CHUNKS)
          electronStderrRing.shift();
      });

      // Record HOW the main process dies. A SIGKILL is silent on stderr, so
      // without this a "Target page closed" failure gives no cause. The marker
      // line lands in the per-test captured output; getLastElectronExit() lets
      // a failing assertion embed it in the thrown error too.
      sharedApp.process().on("exit", (code, signal) => {
        lastElectronExit = {
          code,
          signal,
          at: new Date().toISOString(),
        };
        process.stderr.write(`[electron-exit] code=${code} signal=${signal}\n`);
      });

      try {
        sharedPage = await sharedApp.waitForEvent("window", {
          predicate: (p) => !p.url().includes("devtools://"),
          timeout: 30_000,
        });
      } catch (err) {
        // Electron launched but the BrowserWindow never appeared — most likely
        // requestSingleInstanceLock() was grabbed by a stale process and the app
        // called app.quit() before creating a window. Clean up sharedApp so the
        // next retry attempt starts a completely fresh Electron instance.
        await sharedApp.close().catch(() => {});
        sharedApp = null;
        throw err;
      }
      await sharedPage.waitForLoadState("load");
      await sharedPage.waitForSelector(
        'button:has-text("Set Up New Shop"), nav a[href], [data-testid="sidebar"]',
        { timeout: 15_000 },
      );

      // Auto-accept native alert/confirm/prompt dialogs globally. The .catch
      // matters: if a spec's own handler already answered the dialog, this
      // accept() rejects — an unhandled rejection here can destabilize the
      // worker and strand the NEXT dialog on screen unanswered.
      sharedPage.on("dialog", (dialog) => {
        dialog.accept().catch(() => {});
      });

      // Worker-lifetime page lifecycle tracking for describeElectronDeath().
      pageClosedAt = null;
      pageCrashedAt = null;
      sharedPage.on("close", () => {
        pageClosedAt = new Date().toISOString();
      });
      sharedPage.on("crash", () => {
        pageCrashedAt = new Date().toISOString();
      });
    }

    if (!setupDone) {
      // Run setup wizard once
      await completeSetup(sharedPage!);
      setupDone = true;
    }

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(sharedPage!);
  },
});

export { expect } from "@playwright/test";

/**
 * Navigate to a route via sidebar NavLink or hash change.
 * Avoids page.goto() which causes a full reload and loses the session.
 * Dismisses any open overlay before attempting navigation so modals left
 * open by a previous test cannot block the sidebar click.
 */
export async function navigateTo(page: Page, route: string) {
  const path = route.startsWith("/") ? route : `/${route}`;

  // Hash routing fires no `hashchange` (and therefore no remount) when the
  // target hash already equals the current one. A caller landing back on
  // the exact route the previous step/test left it on then sees whatever
  // stale DOM/state that page instance was already holding — this bit
  // lira-transactions-hidden-types (stale /audit list), LIRA-111 (8 specs
  // needed a manual "/" bounce), and lira-093 (timed out on a client
  // dropdown left over from lira-088's canary). Detect the same-route case
  // and force a genuine remount by bouncing through a different route
  // first. This only does extra work when the route is unchanged — normal
  // (different-route) calls fall straight through to the existing logic
  // below, unaffected.
  const currentHash = await page.evaluate(() => window.location.hash);
  const currentPath = currentHash.replace(/^#/, "") || "/";
  if (currentPath === path) {
    const bouncePath = path === "/" ? "/pos" : "/";
    await page.evaluate((p) => {
      window.location.hash = `#${p}`;
    }, bouncePath);
    // Give the browser/router a moment to actually dispatch and process the
    // bounce's hashchange before we write `path` back below — otherwise the
    // two same-tick hash writes could collapse into one and the router
    // would never see the bounce as a distinct navigation.
    // eslint-disable-next-line no-restricted-syntax
    await page.waitForTimeout(100);
  }

  // Helper: is any fixed overlay currently visible?
  const overlayVisible = () =>
    page
      .locator("div.fixed.inset-0")
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);

  // Dismiss any open overlay before trying to navigate
  if (await overlayVisible()) {
    // 1. Escape closes popovers and modals that listen for keydown
    await page.keyboard.press("Escape");
    await page
      .locator("div.fixed.inset-0")
      .first()
      .waitFor({ state: "hidden", timeout: 500 })
      .catch(() => {});

    if (await overlayVisible()) {
      // 2. Click backdrop corner — closes modals with onClick={onClose} on the overlay div
      //    (e.g. HistoryModal for Expenses/Custom Services/Maintenance)
      await page.mouse.click(5, 5);
      await page
        .locator("div.fixed.inset-0")
        .first()
        .waitFor({ state: "hidden", timeout: 500 })
        .catch(() => {});
    }

    if (await overlayVisible()) {
      // 3. POS checkout modal uses onCancel (not onClose) — click its Cancel Order button
      const cancelBtn = page.locator('button[title="Cancel Order"]').first();
      if (await cancelBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        await cancelBtn.click();
        await cancelBtn
          .waitFor({ state: "hidden", timeout: 500 })
          .catch(() => {});
      }
    }

    if (await overlayVisible()) {
      // 4. Final Escape as safety net
      await page.keyboard.press("Escape");
      await page
        .locator("div.fixed.inset-0")
        .first()
        .waitFor({ state: "hidden", timeout: 500 })
        .catch(() => {});
    }
  }

  // Try clicking the sidebar link (short timeout so we don't hang)
  const link = page.locator(`nav a[href="#${path}"]`).first();
  const linkVisible = await link
    .isVisible({ timeout: 2000 })
    .catch(() => false);
  if (linkVisible) {
    try {
      await link.click({ timeout: 5000 });
    } catch {
      // Link blocked (e.g. modal still present) — fall back to hash change
      await page.evaluate((p) => {
        window.location.hash = `#${p}`;
      }, path);
    }
  } else {
    // Fallback: direct hash change (no reload)
    await page.evaluate((p) => {
      window.location.hash = `#${p}`;
    }, path);
  }
  // Route-specific anchor signals that the page has rendered
  const routeAnchors: Record<string, string> = {
    "/pos": 'input[placeholder*="Search"]',
    "/products": 'button:has-text("Add Product")',
    "/services": 'button:has-text("OMT")',
    "/exchange": "text=Exchange",
    "/debts": "text=Debt",
    "/expenses": "#expense-description",
    "/clients": 'button:has-text("Add Client")',
    "/recharge": '#telecom-amount, button:has-text("MTC")',
    "/maintenance": "#maintenance-device-name",
    "/loto": "text=Loto",
    // NOTE: keep anchors in sync with the pages — a stale anchor silently
    // costs EVERY navigation to that route the full 10s timeout
    // (#service-amount / "Record Service" were renamed long ago and burned
    // 10s per visit across lira-088/093/094).
    "/custom-services": '#svc-cost, button:has-text("Submit Service")',
    "/customer-sessions": "text=Customer Session",
  };
  const anchor = routeAnchors[path];
  if (anchor) {
    await page.waitForSelector(anchor, { timeout: 10_000 }).catch(() => {
      // page loaded but anchor not found — proceed without blocking
    });
  }
}

// ---------------------------------------------------------------------------
// Client context helpers (C1–C4)
// ---------------------------------------------------------------------------

/**
 * The four client-context strategies used across test files.
 *
 * C1 — anonymous walk-in: no client, no name/phone
 * C2 — manual entry: name + phone typed into raw inputs (no saved client)
 * C3 — autocomplete select: saved client looked up and picked from dropdown
 * C4 — session-active: a customer session is started for the given clientId
 */
export type ClientContext = {
  c1: (page: Page) => Promise<void>;
  c2: (
    page: Page,
    name: string,
    phone: string,
    nameSelector: string,
    phoneSelector: string,
  ) => Promise<void>;
  c3: (
    page: Page,
    clientAutocompleteTestId: string,
    clientName: string,
  ) => Promise<void>;
  c4: (page: Page, clientId: number) => Promise<void>;
};

export const clientContexts: ClientContext = {
  /**
   * C1 — no-op. The caller has already navigated to the page; the form is
   * open with no client context. Nothing to do here.
   */
  async c1(_page: Page): Promise<void> {
    // intentionally empty
  },

  /**
   * C2 — fill name and phone directly into the given input selectors.
   * Useful when the form exposes plain text/tel inputs rather than the
   * client-autocomplete component.
   */
  async c2(
    page: Page,
    name: string,
    phone: string,
    nameSelector: string,
    phoneSelector: string,
  ): Promise<void> {
    await page.fill(nameSelector, name);
    await page.fill(phoneSelector, phone);
  },

  /**
   * C3 — type the first 3 characters of clientName into the autocomplete
   * field, wait for the dropdown to appear, then click the first matching
   * client option.
   *
   * @param clientAutocompleteTestId  data-testid of the wrapper element that
   *   contains the ClientAutocompleteInput (e.g. "client-autocomplete-input")
   * @param clientName  full name of the client to search for
   */
  async c3(
    page: Page,
    clientAutocompleteTestId: string,
    clientName: string,
  ): Promise<void> {
    const query = clientName.slice(0, 3);
    const inputLocator = page
      .locator(`[data-testid="${clientAutocompleteTestId}"]`)
      .getByTestId("client-autocomplete-field");

    await inputLocator.fill(query);
    await page.waitForSelector('[data-testid="client-dropdown"]', {
      timeout: 5000,
    });
    await page.locator('[data-testid^="client-option-"]').first().click();
  },

  /**
   * C4 — start a customer session for the given client.
   * Opens the StartSessionModal via the floating session button in the app
   * (the MessengerStyleSessionButton FAB), types the client's name via the
   * ClientAutocompleteInput, selects the matching client-option, then
   * submits the "Start Session" form.
   *
   * The caller is responsible for seeding the client beforehand and
   * providing the returned clientId.
   */
  async c4(page: Page, clientId: number): Promise<void> {
    // If an active session already exists for this client, skip creation —
    // the backend rejects duplicates ("already exists today").
    const alreadyActive = await page
      .evaluate(async (cId: number) => {
        const [clientsResult, sessionsResult] = await Promise.all([
          window.api.clients.getAll(""),
          window.api.session.getActiveSessions(),
        ]);
        const clients = clientsResult as { id: number; full_name: string }[];
        const clientName = clients.find((c) => c.id === cId)?.full_name ?? "";
        if (!clientName) return false;
        // getActiveSessions returns { success, sessions } or a plain array
        const sessionList: { customer_name?: string }[] = Array.isArray(
          sessionsResult,
        )
          ? sessionsResult
          : ((sessionsResult as { sessions?: { customer_name?: string }[] })
              .sessions ?? []);
        return sessionList.some((s) => s.customer_name === clientName);
      }, clientId)
      .catch(() => false);
    if (alreadyActive) return;

    // Click the CustomerSessionButton in the TopBar.
    // Title is "Start Customer Session" when no sessions exist,
    // or "N active session(s)" when sessions are running.
    const fab = page.locator(
      'button[title="Start Customer Session"], button[title*="active session"]',
    );
    await fab.first().click({ timeout: 10_000 });
    await page
      .locator('button:has-text("New Session")')
      .waitFor({ state: "visible", timeout: 3000 })
      .catch(() => {});

    // The click opens a dropdown — click "New Session" inside it
    const newSessionBtn = page
      .locator('button:has-text("New Session")')
      .first();
    if (await newSessionBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newSessionBtn.click();
    }

    // Wait for the StartSessionModal to appear
    await page.waitForSelector('h2:has-text("New Customer Session")', {
      timeout: 5000,
    });

    // Fetch the client's name so we can search by it
    const clientName: string = await page.evaluate((id) => {
      return window.api.clients
        .getAll("")
        .then((clients: { id: number; full_name: string }[]) => {
          const found = clients.find((c) => c.id === id);
          return found?.full_name ?? "";
        });
    }, clientId);

    // StartSessionModal uses a plain input (id="customer-name"), not ClientAutocompleteInput
    const nameInput = page.locator("#customer-name").first();
    const query = clientName.slice(0, 3);
    await nameInput.fill(query);
    await page
      .locator("div.absolute button")
      .waitFor({ state: "visible", timeout: 3000 })
      .catch(() => {});

    // Click the matching client button in the inline dropdown
    if (clientName) {
      // Scope to div.absolute to avoid matching the session floating button,
      // which also displays the client name when a session is active.
      const clientBtn = page
        .locator("div.absolute button")
        .filter({ hasText: clientName })
        .first();
      const btnVisible = await clientBtn
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      if (btnVisible) {
        await clientBtn.click();
      }
    }

    // Submit the form
    await page.getByRole("button", { name: /Start Session/i }).click();

    // Wait for the modal to close
    await page.waitForSelector('h2:has-text("New Customer Session")', {
      state: "detached",
      timeout: 8000,
    });
  },
};

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Complete the setup wizard from scratch (called once).
 */
export async function completeSetup(page: Page) {
  // Step 0: Detect — click "Set Up New Shop"
  await page.waitForSelector("text=Set Up New Shop", { timeout: 15_000 });
  await page.getByRole("button", { name: /Set Up New Shop/i }).click();

  // Step 1: Account details
  await page.waitForSelector("text=Welcome to LiraTek", { timeout: 5000 });
  await page.getByPlaceholder("Enter shop name").fill("E2E Test Shop");
  const textInputs = page.locator("input[type='text']");
  await textInputs.nth(1).fill("admin");
  const passwordFields = page.locator("input[type='password']");
  await passwordFields.nth(0).fill("TestAdmin1!");
  await passwordFields.nth(1).fill("TestAdmin1!");
  await page.getByRole("button", { name: /Next/i }).click();

  // Step 2: Base System — choose OMT
  await page.waitForSelector("text=Choose Your Base System", { timeout: 5000 });
  await page.locator("button", { hasText: "OMT" }).first().click();

  // Step 3: Modules — enable ALL toggles, then click Next
  await page.waitForSelector("text=Modules & Features", { timeout: 5000 });
  const offToggles = page.locator(
    'button[class*="rounded-full"][class*="bg-slate-700"]',
  );
  let toggleCount = await offToggles.count();
  while (toggleCount > 0) {
    const prevCount = toggleCount;
    await offToggles.first().click();
    await page
      .waitForFunction(
        (n: number) =>
          document.querySelectorAll(
            'button[class*="rounded-full"][class*="bg-slate-700"]',
          ).length < n,
        prevCount,
        { timeout: 3000 },
      )
      .catch(() => {});
    toggleCount = await offToggles.count();
  }
  await page.getByRole("button", { name: /Next/i }).click();

  // Step 4: Currencies — skip with defaults
  await page.waitForSelector("h2:has-text('Currencies')", { timeout: 5000 });
  await page.locator("text=Skip — use defaults").click();

  // Step 5: Users & WhatsApp — skip
  await page.waitForSelector("text=Users & WhatsApp", { timeout: 5000 });
  await page
    .locator("button, a")
    .filter({ hasText: /^Skip$/ })
    .first()
    .click();

  // Step 6: Starting Drawer Amounts — seed DISTINCT per-currency amounts for
  // General (B1) so setup writes a real initial checkpoint (A4). Specs assert
  // deltas (rule 15), so a non-zero baseline is safe; lira-085 asserts these
  // exact values against the immutable setup-checkpoint row.
  await page.waitForSelector("text=Starting Drawer Amounts", { timeout: 5000 });
  await page
    .locator('[data-testid="setup-amount-General-USD"] input')
    .fill("500");
  await page
    .locator('[data-testid="setup-amount-General-LBP"] input')
    .fill("9000000");
  await page
    .locator("button")
    .filter({ hasText: /^Next →$/ })
    .click();

  // Step 7: Completion — Launch
  await page.waitForSelector("text=all set", { timeout: 5000 });
  await page.getByRole("button", { name: /Launch App/i }).click();

  // Wait for app to leave setup
  await page.waitForSelector('nav a[href], [data-testid="sidebar"]', {
    timeout: 15_000,
  });

  // Validate the setup seeding at the ONLY deterministic moment (before any
  // spec mutates the drawers): the dashboard must reflect the step-6 amounts
  // (General USD 500 / LBP 9,000,000). A mismatch here means the setup wizard
  // failed to seed the drawers — fail the whole worker loudly.
  //
  // NOTE (PRIMARY_CASH_DRAWER_PLAN.md §3 Phase C): SalesRepository.getDrawerBalances
  // now also returns `omtDrawer` (the active primary cash drawer only, exact
  // name match — no longer an `OMT_System`+`OMT_App` fold) and a new
  // `appWalletDrawer` key (combined OMT_App/Whish_App). This fixture only
  // ever asserted `generalDrawer`, which is untouched by that change, so the
  // type below deliberately stays a narrower subset of the real response —
  // no functional change needed here.
  const seeded = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        api: {
          dashboard: {
            getDrawerBalances: () => Promise<{
              generalDrawer: { usd: number; lbp: number };
            }>;
          };
        };
      }
    ).api;
    const balances = await api.dashboard.getDrawerBalances();
    return balances.generalDrawer;
  });
  if (
    Math.abs(seeded.usd - 500) > 0.01 ||
    Math.abs(seeded.lbp - 9_000_000) > 0.5
  ) {
    throw new Error(
      `Setup drawer seeding failed: General = $${seeded.usd} / ${seeded.lbp} LBP ` +
        `(expected $500 / 9,000,000 LBP). The setup wizard did not apply the ` +
        `step-6 per-currency amounts to drawer_balances.`,
    );
  }
}
