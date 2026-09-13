// ESM: frontend/package.json is "type": "module", so a .js here is an ES
// module — `require` throws. Kept as .js (not .ts) because an earlier attempt
// under node_modules hit ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING, and when
// a config fails to load Playwright FALLS BACK to discovering the repo's own
// config — which silently started the 300-test electron suite. Always
// `--list` before `test` with a new config, and always pass an ABSOLUTE
// --config path: Playwright resolves a relative one against the package root
// (frontend/), not your cwd.
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// REQUIRED, no default — deliberately. This harness creates REAL transactions
// (see README.md). Defaulting to the test tenant would be one typo away from
// writing into a customer's books.
const SMOKE_URL = process.env.SMOKE_URL;
if (!SMOKE_URL) {
  throw new Error(
    "SMOKE_URL is required — this harness writes REAL records. Set it " +
      "explicitly, e.g. SMOKE_URL=https://test.liratek.shop. See README.md.",
  );
}
if (!process.env.SMOKE_USER || !process.env.SMOKE_PASS) {
  throw new Error(
    "SMOKE_USER and SMOKE_PASS are required (environment only — never hard-coded).",
  );
}

export default defineConfig({
  testDir: HERE,
  testMatch: /smoke\.spec\.js$/,
  timeout: 20 * 60 * 1000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: path.join(HERE, "out"),
  use: {
    baseURL: SMOKE_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    actionTimeout: 20000,
    navigationTimeout: 45000,
    screenshot: "off",
    video: "off",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
