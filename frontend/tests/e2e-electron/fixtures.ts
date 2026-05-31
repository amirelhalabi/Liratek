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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test DB location — isolated from the user's real database
const TEST_DB_DIR = path.join(os.tmpdir(), "liratek-e2e-test");
const TEST_DB_PATH = path.join(TEST_DB_DIR, "phone_shop.db");
// Isolated user-data-dir so the test instance never collides with a
// running yarn dev session or installed app. Electron's
// requestSingleInstanceLock() is per user-data-dir, so without this
// the test instance would immediately quit when another Electron
// instance (e.g. yarn dev) is already running.
const TEST_USER_DATA_DIR = path.join(os.tmpdir(), "liratek-e2e-userdata");

// Shared state across all tests in a worker
let sharedApp: ElectronApplication | null = null;
let sharedPage: Page | null = null;
let setupDone = false;

export const test = base.extend<{
  appPage: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  appPage: async ({}, use) => {
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

      // Pipe Electron's stderr to console so startup errors are visible
      sharedApp.process().stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(`[electron] ${chunk.toString()}`);
      });
      sharedApp.process().stdout?.on("data", (chunk: Buffer) => {
        process.stdout.write(`[electron] ${chunk.toString()}`);
      });

      sharedPage = await sharedApp.waitForEvent("window", {
        predicate: (p) => !p.url().includes("devtools://"),
        timeout: 30_000,
      });
      await sharedPage.waitForLoadState("load");
      await sharedPage.waitForTimeout(2000);

      // Auto-dismiss native alert/confirm/prompt dialogs globally
      sharedPage.on("dialog", (dialog) => dialog.accept());
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
 */
export async function navigateTo(page: Page, route: string) {
  const path = route.startsWith("/") ? route : `/${route}`;
  // Click sidebar NavLink (rendered as <a> with href="#/path")
  const link = page.locator(`nav a[href="#${path}"]`).first();
  if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
    await link.click();
  } else {
    // Fallback: direct hash change (no reload)
    await page.evaluate((p) => {
      window.location.hash = `#${p}`;
    }, path);
  }
  await page.waitForTimeout(3000);
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
    await page
      .locator('[data-testid^="client-option-"]')
      .first()
      .click();
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
    // Click the floating session FAB (always visible in the top bar)
    const fab = page.locator(
      'button[title="New Customer Session"], button[title="Manage Sessions"]',
    );
    await fab.first().click();

    // If the speed-dial expanded (because sessions already exist), click the
    // inner "New Customer Session" button (UserPlus icon at the top)
    const newSessionInDial = page.locator(
      'button[title="New Customer Session"]',
    );
    const dialCount = await newSessionInDial.count();
    if (dialCount > 1) {
      // Multiple buttons with that title — the second one is the inner dial item
      await newSessionInDial.nth(1).click();
    }

    // Wait for the StartSessionModal to appear
    await page.waitForSelector(
      'h2:has-text("New Customer Session")',
      { timeout: 5000 },
    );

    // Type in the autocomplete — the modal renders ClientAutocompleteInput
    // which sets data-testid="client-autocomplete-field" on its <input>
    const modalInput = page
      .getByTestId("client-autocomplete-field")
      .first();

    // Fetch the client's name so we can search by it
    const clientName: string = await page.evaluate((id) => {
      return (window.api.clients as { getAll: (q: string) => Promise<{ id: number; full_name: string }[]> })
        .getAll("")
        .then((clients) => {
          const found = clients.find((c) => c.id === id);
          return found?.full_name ?? "";
        });
    }, clientId);

    const query = clientName.slice(0, 3);
    await modalInput.fill(query);

    // Wait for dropdown and click the correct client option
    await page.waitForSelector('[data-testid="client-dropdown"]', {
      timeout: 5000,
    });
    await page.getByTestId(`client-option-${clientId}`).click();

    // Submit the form
    await page.getByRole("button", { name: /Start Session/i }).click();

    // Wait for the modal to close
    await page.waitForSelector(
      'h2:has-text("New Customer Session")',
      { state: "detached", timeout: 8000 },
    );
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
    await offToggles.first().click();
    await page.waitForTimeout(100);
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

  // Step 6: Completion — Launch
  await page.waitForSelector("text=all set", { timeout: 5000 });
  await page.getByRole("button", { name: /Launch App/i }).click();

  // Wait for app to leave setup
  await page.waitForTimeout(5000);
}
