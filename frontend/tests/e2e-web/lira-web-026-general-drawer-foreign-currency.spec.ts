/**
 * lira-web-026 — GENERAL_DRAWER_UNRESTRICTED.md Phase 4, over the WEB
 * transport. REST twin of
 * `frontend/tests/e2e-electron/lira-147-general-drawer-foreign-currency.spec.ts`.
 *
 * Same scenario, split the way this suite's own conventions split it
 * (lira-web-006 for drawer top-ups, lira-web-010 for checkpoints — both pure
 * REST + a light page-level render check, never a hand-driven `Select`):
 *
 *   1. Cash in an unusual EUR amount into General via
 *      `POST /api/drawer-topup` (the REST twin of `DrawerTopUpService.addTopUp`,
 *      `extra_currencies` + an explicit cost-basis override — same core
 *      service the Electron IPC handler calls, so this is a transport check,
 *      not a re-test of the money logic lira-147/the core unit suite already
 *      own).
 *   2. `GET /api/closing/system-expected-balances-dynamic` shows the delta,
 *      and the REAL Dashboard page (a real browser, no `window.api`
 *      anywhere) renders it in the "Cash on Hand" strip — this is the seam
 *      only a page-level check can catch: a regression to a raw
 *      `window.api.*` call anywhere in that render path would throw before
 *      paint in a browser (the exact defect class `lira-web-020`/
 *      `lira-web-025` were written for on other pages).
 *   3. `GET /api/currencies/countable-drawer-currencies` returns the item-8
 *      policy set (EUR in, USDT out, no duplicates) over HTTP — proving the
 *      REST route + `CurrencyService.getCountableCurrenciesByDrawer()` wiring
 *      lira-147 cannot reach (Electron never calls this route).
 *   4. The REAL per-drawer Checkpoint modal (`CheckpointModal` — the same
 *      component lira-147 drives, unchanged between transports) is opened
 *      from the REAL Dashboard and shows exactly one EUR field (pre-filled
 *      from the new balance) and no USDT field — the render-correctness half
 *      of item 8, proven reachable in a browser with no Electron preload
 *      bridge at all.
 *
 * Why step 4 is driven at all (this suite mostly stays REST-only): item 8's
 * whole bug was a RENDER defect (two DOM inputs for one currency) that no
 * REST assertion can see — `getByLabel(...).toHaveCount(...)` needs a real
 * DOM. `lira-web-024`/`lira-web-025` already established the precedent of
 * driving a real page's testids/labels over HTTP in this suite; this file
 * follows it for the one assertion REST cannot make.
 *
 * ── Assertion discipline (CLAUDE.md rule 15) ──────────────────────────────
 *  - This suite's DB (`test-results/e2e-web/phone_shop.web.db`) ACCUMULATES
 *    across runs (README) — every EUR balance assertion is therefore a DELTA
 *    snapshotted immediately before the top-up, never an absolute total.
 *    `EUR_AMOUNT` is deliberately different from lira-147's own 173.25 so
 *    the two suites' figures are never confusable if ever compared side by
 *    side.
 *  - The top-up is additionally matched by IDENTITY: `POST /api/drawer-topup`
 *    returns `id`, and the row is re-read via
 *    `GET /api/drawer-topup/history` and matched by its run-unique `notes`.
 *  - EUR is SELF-PROVISIONED active over REST (`ensureEurActive` below) —
 *    grepped: no `e2e-web` spec ever mutates `currencies.is_active`, so
 *    create_db.sql's own default (EUR active) should already hold, but this
 *    spec does not assume it.
 *  - "USDT never appears" is an absolute check by necessity (there is no
 *    delta for "a currency nobody ever touches") — grepped the whole
 *    `e2e-web` suite first: zero hits for `"USDT"` anywhere, so General's
 *    USDT balance is expected to be 0 for the lifetime of this suite too.
 *    If that is ever wrong the assertion below fails loudly rather than
 *    silently passing.
 *
 * Selectors depended on for step 4 (verified against the current shipped
 * markup — the SAME React components lira-147 drives, so the same care
 * applies): `Checkpoint/index.tsx` + `DrawerCard.tsx`'s modal root
 * (`div.fixed.inset-0`, filtered by the heading text `Checkpoint — General`
 * — no data-testid of its own), per-currency
 * `<label htmlFor="{drawer}-{code}">{code}</label>` + input
 * `id="{drawer}-{code}"`, and `Dashboard.tsx`'s drawer card
 * `<h3>{label}</h3>` + sibling `button[title="Checkpoint"]` (gated on
 * `checkpointsEnabled`, which defaults to true — `FeatureFlagContext.tsx`
 * treats anything other than the literal string `"disabled"` as on, and
 * nothing in this suite writes `feature_session_management`, grepped).
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";
import type { Page } from "@playwright/test";

const RUN_ID = Date.now();
const TOPUP_NOTE = `web026-eur-topup-${RUN_ID}`;
// Unusual amount, deliberately different from lira-147's 173.25 (see header).
const EUR_AMOUNT = 152.75;
// Explicit cost-basis override (see header) — arbitrary, deliberately
// different from create_db.sql's default EUR rates (buy 1.16 / sell 1.20 /
// market 1.18).
const EUR_ACQUISITION_RATE = 1.07;

type Headers = Record<string, string>;

// ─── REST helpers ───────────────────────────────────────────────────────────

/** Admin JWT obtained directly over REST — no browser page needed yet (same
 *  precedent as lira-web-025's `loginHeaders`/`adminHeaders`: a self-signed
 *  token cannot stand in for a real login because `authenticateJWT` requires
 *  a live `sessions` row, so this goes through the real `/api/auth/login`
 *  route). Doing this BEFORE the browser ever loads the app means the
 *  EUR-provisioning + top-up below land in the database first, so the
 *  Dashboard's own `CurrencyProvider` (which loads `currencies` once, at
 *  mount) sees the correct state on its very first, only mount — no
 *  `page.reload()` workaround needed (unlike lira-147's Electron
 *  equivalent, which shares ONE long-lived app instance across the whole
 *  suite and so cannot avoid it). */
async function adminHeaders(page: Page): Promise<Headers> {
  const res = await (
    await page.request.post(`${BACKEND_URL}/api/auth/login`, {
      data: { username: "admin", password: "admin123" },
    })
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return { Authorization: `Bearer ${res.data.token as string}` };
}

async function generalBalances(
  page: Page,
  headers: Headers,
): Promise<Record<string, number>> {
  const res = await (
    await page.request.get(
      `${BACKEND_URL}/api/closing/system-expected-balances-dynamic`,
      { headers },
    )
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return (res.balances?.["General"] as Record<string, number>) ?? {};
}

async function countableGeneral(
  page: Page,
  headers: Headers,
): Promise<string[]> {
  const res = await (
    await page.request.get(
      `${BACKEND_URL}/api/currencies/countable-drawer-currencies`,
      { headers },
    )
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return (res.drawerCurrencies?.["General"] as string[]) ?? [];
}

/** Idempotent: activates EUR only if it is currently inactive. */
async function ensureEurActive(page: Page, headers: Headers): Promise<void> {
  const list = await (
    await page.request.get(`${BACKEND_URL}/api/currencies`, { headers })
  ).json();
  expect(list.success, JSON.stringify(list)).toBeTruthy();
  const currencies = list.currencies as Array<{
    id: number;
    code: string;
    is_active: number;
  }>;
  const eur = currencies.find((c) => c.code === "EUR");
  expect(
    eur,
    "EUR currency row not found via GET /api/currencies",
  ).toBeTruthy();
  if (eur!.is_active) return;

  const updated = await (
    await page.request.put(`${BACKEND_URL}/api/currencies/${eur!.id}`, {
      headers,
      data: { is_active: 1 },
    })
  ).json();
  expect(updated.success, JSON.stringify(updated)).toBeTruthy();
}

/** The drawer_topups row for this run, matched by its unique `notes`. */
async function findTopUpByNote(
  page: Page,
  headers: Headers,
  note: string,
): Promise<{ id: number; amount_usd: number; amount_lbp: number } | null> {
  const res = await (
    await page.request.get(`${BACKEND_URL}/api/drawer-topup/history?limit=20`, {
      headers,
    })
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  const rows = (res.data ?? []) as Array<{
    id: number;
    notes: string | null;
    amount_usd: number;
    amount_lbp: number;
  }>;
  return rows.find((r) => r.notes === note) ?? null;
}

/** Parse the first "€<amount>" figure out of the Cash on Hand strip's own
 *  text — regex-based, same reasoning as lira-147's own helper: survives
 *  locale/thousands-separator formatting differences rather than depending
 *  on an exact string match. */
async function cashOnHandGeneralEur(page: Page): Promise<number | null> {
  const block = page
    .getByText("Cash on Hand", { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"items-stretch")][1]');
  const text = await block.innerText();
  const match = text.match(/€\s?([\d,]+\.\d{2})/);
  return match ? parseFloat(match[1].replace(/,/g, "")) : null;
}

// ─── Test ─────────────────────────────────────────────────────────────────

test("cash-in EUR over REST appears in the Dashboard's Cash on Hand and gets exactly one count field on the General Checkpoint sheet, while zero-balance USDT gets none", async ({
  page,
}) => {
  const headers = await adminHeaders(page);
  await ensureEurActive(page, headers);

  // ── Snapshot before ──────────────────────────────────────────────────
  const before = await generalBalances(page, headers);
  const beforeEur = before["EUR"] ?? 0;
  const beforeUsdt = before["USDT"] ?? 0;
  expect(
    beforeUsdt,
    "General USDT balance was expected to be 0 for this whole suite " +
      "(grepped: e2e-web has zero USDT hits anywhere) — if this fails, " +
      "some other spec now deposits USDT into General and the " +
      "'zero-balance exotic gets no field' assertion below needs " +
      "re-scoping to whatever currency is actually at zero.",
  ).toBe(0);

  // ── Phase 1: cash-in EUR over REST (the core-service seam; the render
  //    seam is Phase 4 below) ──────────────────────────────────────────
  const created = await (
    await page.request.post(`${BACKEND_URL}/api/drawer-topup`, {
      headers,
      data: {
        amount_usd: 0,
        amount_lbp: 0,
        notes: TOPUP_NOTE,
        extra_currencies: [
          {
            currency_code: "EUR",
            amount: EUR_AMOUNT,
            acquisition_usd_per_unit: EUR_ACQUISITION_RATE,
          },
        ],
      },
    })
  ).json();
  expect(created.success, JSON.stringify(created)).toBeTruthy();

  const after = await generalBalances(page, headers);
  const afterEur = after["EUR"] ?? 0;
  expect(afterEur - beforeEur).toBeCloseTo(EUR_AMOUNT, 2);

  const topUpRow = await findTopUpByNote(page, headers, TOPUP_NOTE);
  expect(
    topUpRow,
    `Expected a drawer_topups row with notes="${TOPUP_NOTE}"`,
  ).not.toBeNull();
  expect(topUpRow!.amount_usd).toBeCloseTo(0, 2);
  expect(topUpRow!.amount_lbp).toBeCloseTo(0, 2);

  // ── Phase 2: item-8 policy, straight from the REST route ────────────
  const afterCountable = await countableGeneral(page, headers);
  expect(afterCountable).toContain("USD");
  expect(afterCountable).toContain("LBP");
  expect(afterCountable).toContain("EUR");
  expect(afterCountable).not.toContain("USDT");
  expect(new Set(afterCountable).size).toBe(afterCountable.length);

  // ── Phase 3: the REAL Dashboard, in a REAL browser — no window.api
  //    anywhere, so this only passes on the HTTP branch of ipcOrHttp ───
  await loginAsAdmin(page);
  await expect(page.locator("#root")).not.toContainText("Something went wrong");

  await expect
    .poll(() => cashOnHandGeneralEur(page), { timeout: 15_000 })
    .not.toBeNull();
  const displayedEur = await cashOnHandGeneralEur(page);
  expect(displayedEur).toBeCloseTo(afterEur, 2);

  // ── Phase 4: the REAL per-drawer Checkpoint modal ────────────────────
  const generalHeading = page.getByRole("heading", {
    name: "General",
    exact: true,
  });
  await expect(generalHeading).toBeVisible({ timeout: 15_000 });
  // The heading and its sibling `button[title="Checkpoint"]` share one
  // parent (`div.flex.items-center.justify-between.gap-1.mb-1`) — same
  // structure lira-147 depends on for the identical Electron-rendered page.
  await generalHeading.locator("xpath=..").getByTitle("Checkpoint").click();

  const modal = page
    .locator("div.fixed.inset-0")
    .filter({ hasText: "Checkpoint — General" });
  await expect(modal).toBeVisible({ timeout: 10_000 });

  // Exactly one EUR field, pre-filled from the new balance.
  await expect(modal.getByLabel("EUR")).toHaveCount(1);
  const eurFieldValue = await modal.getByLabel("EUR").inputValue();
  expect(parseFloat(eurFieldValue.replace(/,/g, ""))).toBeCloseTo(afterEur, 2);

  // Zero-balance USDT gets no field at all (D2) — not merely deduped.
  await expect(modal.getByLabel("USDT")).toHaveCount(0);

  // The old duplicate-field delivery mechanism doesn't exist any more.
  await expect(modal.getByTitle("Other currencies")).toHaveCount(0);

  // Leave no checkpoint behind — this spec only verifies the render.
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(modal).toHaveCount(0);
});
