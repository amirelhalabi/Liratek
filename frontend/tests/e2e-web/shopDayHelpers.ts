/**
 * Shared helpers for lira-web-071 (the shop-day spec, docs/testing/SHOP_DAY.md).
 *
 * One page for the whole serial day: `openShopDay` builds the browser context
 * by hand (the suite fixture only decorates the per-test `context`), so it
 * re-applies the two init scripts the fixture adds — the backend URL and the
 * "What's new already seen" key — and logs in ONCE (rate limits, SHOP_DAY §6).
 *
 * Rule 15: rows are found by identity — id above the snapshot taken before
 * the step, plus the details kind, plus a value only this run typed — never
 * by position. Money checks are deltas around the step.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { paymentSnapshotSchema, type PaymentSnapshot } from "@liratek/core";
import { BACKEND_URL, loginAsAdmin, test } from "./fixtures";
import { WHATS_NEW_STORAGE_KEY } from "../../src/features/whatsNew/storageKey";
import type { ReleaseNoteEntry } from "../../src/features/whatsNew/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Fix-dependent expectations (ONE place; align wording with the fixes) ──
//
// Every check that only holds once an open SHOP_DAY §5 bug is fixed reads its
// expected value from here, so matching the fix agents' final wording is a
// one-line edit. They are asserted through `bugCheck` below, not
// `expect.soft`: under `describe.serial` a soft failure still fails its test
// and so skips every later step — the opposite of SHOP_DAY §3's intent.
export const FIXED = {
  /** bug 1: a payout / money-out leg's snapshot direction. */
  payoutDirection: "OUT" as const,
  /** bug 1: the Details panel's Direction cell for that leg. */
  payoutDirectionLabel: "Out",
  /** bug 2: the tag on a sale that had ONE item refunded (rowBadges.ts
   *  "PARTLY REFUNDED"). */
  partlyRefundedTag: /partly refunded/i,
  /** bug 4: maintenance status `Delivered_Paid` in the Details panel
   *  (pinned by shopDayDetailsFixes.test.ts). */
  deliveredPaidLabel: "Delivered and paid",
  /** bug 14: the Mobile Recharge For Partner picker must list partners. */
  noPartnersText: "No partners available",
  /** bug 4: the supplier by name in the Details panel ("Katsh (#27)" in
   *  the fix's unit test, shopDayDetailsFixes.test.ts). */
  supplierNameKatsh: "Katsh (#",
  /** bug 16: a Cash + Whish partner settle's ledger method (fixes.md "Bug 2"
   *  of the fix agents: `partnerSettlementMethod` → 'SPLIT'). */
  splitSettlementMethod: "SPLIT",
} as const;

// ── Open-bug checks (SHOP_DAY §3) ─────────────────────────────────────────
//
// A check that holds only once bug N is fixed is recorded here instead of
// failing its step, so the rest of the day still runs; the spec's LAST test
// fails listing every recorded one. Each is also an annotation on its step,
// so the report names the step. Turn a check into a plain `expect` once its
// fix has landed and been seen passing.

const openBugs: string[] = [];

export function openBugList(): readonly string[] {
  return openBugs;
}

function recordBug(bug: number, label: string, e: unknown): void {
  const first = (e instanceof Error ? e.message : String(e)).split("\n")[0];
  const msg = `bug ${bug} — ${test.info().title}: ${label}: ${first}`;
  openBugs.push(msg);
  test.info().annotations.push({ type: `open bug ${bug}`, description: msg });
}

/** Run `check` (plain `expect`s); a failure is recorded, not thrown. */
export function bugCheck(bug: number, label: string, check: () => void): void {
  try {
    check();
  } catch (e) {
    recordBug(bug, label, e);
  }
}

/** Async form, for web-first locator assertions. */
export async function bugCheckAsync(
  bug: number,
  label: string,
  check: () => Promise<void>,
): Promise<void> {
  try {
    await check();
  } catch (e) {
    recordBug(bug, label, e);
  }
}

// ── Session / page ────────────────────────────────────────────────────────

export type Auth = { Authorization: string };

export interface ShopDay {
  page: Page;
  context: BrowserContext;
  auth: Auth;
  /** Every native confirm()/alert() text seen, in order (all accepted). */
  dialogs: string[];
  /** Unique per run: goes into every name, note and reference. */
  stamp: string;
}

function whatsNewLatestVersion(): string | null {
  try {
    const raw = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "src",
        "features",
        "whatsNew",
        "releaseNotes.generated.json",
      ),
      "utf8",
    );
    const entries = JSON.parse(raw) as ReleaseNoteEntry[];
    return entries[0]?.version ?? null;
  } catch {
    return null;
  }
}

export async function openShopDay(browser: Browser): Promise<ShopDay> {
  const context = await browser.newContext({
    baseURL: "http://localhost:5174",
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  await context.addInitScript((url: string) => {
    (globalThis as { __LIRATEK_BACKEND_URL?: string }).__LIRATEK_BACKEND_URL =
      url;
  }, BACKEND_URL);
  const version = whatsNewLatestVersion();
  if (version) {
    await context.addInitScript(
      ({ key, v }: { key: string; v: string }) => {
        try {
          localStorage.setItem(key, v);
        } catch {
          // blocked storage — the modal may open, as for a real user
        }
      },
      { key: WHATS_NEW_STORAGE_KEY, v: version },
    );
  }
  const page = await context.newPage();
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    void d.accept();
  });
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  expect(token, "logged in").toBeTruthy();
  return {
    page,
    context,
    auth: { Authorization: `Bearer ${token}` },
    dialogs,
    stamp: String(Date.now()).slice(-6),
  };
}

/** An 8-digit phone unique to this run and person: `<70+n><stamp>`
 *  (n = 0…29). Digits only — spaces are rejected (SHOP_DAY §6). */
export function phoneOf(day: ShopDay, n: number): string {
  return `${70 + n}${day.stamp}`;
}

// ── REST (reads, and setup that has no UI) ────────────────────────────────

export async function getJson<T = Record<string, unknown>>(
  day: ShopDay,
  p: string,
): Promise<T> {
  const res = await day.page.request.get(`${BACKEND_URL}${p}`, {
    headers: day.auth,
  });
  return (await res.json()) as T;
}

export async function postJson<T = Record<string, unknown>>(
  day: ShopDay,
  p: string,
  data?: unknown,
): Promise<T> {
  const res = await day.page.request.post(`${BACKEND_URL}${p}`, {
    headers: day.auth,
    data,
  });
  return (await res.json()) as T;
}

// ── Drawers ───────────────────────────────────────────────────────────────

export type Drawers = Record<string, Record<string, number>>;

/** Every drawer × currency (`GET /api/closing/system-expected-balances-dynamic`). */
export async function drawers(day: ShopDay): Promise<Drawers> {
  const r = await getJson<{ success: boolean; balances: Drawers }>(
    day,
    "/api/closing/system-expected-balances-dynamic",
  );
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.balances;
}

export function moved(
  after: Drawers,
  before: Drawers,
  drawer: string,
  currency: string,
): number {
  return (after[drawer]?.[currency] ?? 0) - (before[drawer]?.[currency] ?? 0);
}

/** Assert one drawer moved by `expected` (rule 15 delta). */
export function expectMoved(
  after: Drawers,
  before: Drawers,
  drawer: string,
  currency: string,
  expected: number,
  digits = currency === "LBP" ? -2 : 2,
): void {
  expect(
    moved(after, before, drawer, currency),
    `${drawer} ${currency} delta`,
  ).toBeCloseTo(expected, digits);
}

// ── Transactions ──────────────────────────────────────────────────────────

export interface PaymentLeg {
  direction: "in" | "out";
  amount: number;
  signed_amount: number;
  currency_code: string;
  method: string;
  drawer_name?: string;
}

export interface RecentTxn {
  id: number;
  type: string;
  status: string;
  source_table: string | null;
  source_id: number | null;
  amount_usd: number;
  amount_lbp: number;
  client_id: number | null;
  client_name: string | null;
  client_phone: string | null;
  reverses_id: number | null;
  reversed_by_id: number | null;
  summary: string | null;
  metadata_json: string | null;
  session_id?: number | null;
  payments?: PaymentLeg[];
}

export interface Txn extends RecentTxn {
  meta: Record<string, unknown>;
  details: Record<string, unknown> | undefined;
  snapshot: PaymentSnapshot | undefined;
}

function parseTxn(t: RecentTxn): Txn {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(t.metadata_json || "{}") as Record<string, unknown>;
  } catch {
    meta = {};
  }
  const details = meta.details as Record<string, unknown> | undefined;
  const snap = meta.payment_snapshot;
  return {
    ...t,
    meta,
    details,
    // safeParse: an unrelated row with an off-shape snapshot must not break
    // the lookup; the row under test is checked by `expectSnap*`.
    snapshot:
      snap === undefined
        ? undefined
        : (paymentSnapshotSchema.safeParse(snap).data ?? undefined),
  };
}

/** The highest transaction id right now — the "before" of a step. */
export async function lastTxnId(day: ShopDay): Promise<number> {
  const r = await getJson<{ success: boolean; transactions: RecentTxn[] }>(
    day,
    "/api/transactions/recent?limit=50",
  );
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  // Max id, not [0]: the list is ordered by created_at, and earlier specs
  // write backdated rows.
  return r.transactions.reduce((m, t) => Math.max(m, t.id), 0);
}

/** Every transaction written since `afterId`, oldest first. */
export async function txnsSince(day: ShopDay, afterId: number): Promise<Txn[]> {
  const r = await getJson<{ success: boolean; transactions: RecentTxn[] }>(
    day,
    "/api/transactions/recent?limit=300",
  );
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.transactions
    .filter((t) => t.id > afterId)
    .sort((a, b) => a.id - b.id)
    .map(parseTxn);
}

/** The one row since `afterId` with this details kind that matches `pred`;
 *  polls briefly (the write may land just after the UI settles). */
export async function findTxn(
  day: ShopDay,
  afterId: number,
  kind: string | null,
  pred: (t: Txn) => boolean = () => true,
  what = kind ?? "transaction",
): Promise<Txn> {
  let found: Txn | undefined;
  await expect
    .poll(
      async () => {
        const rows = await txnsSince(day, afterId);
        const hits = rows.filter(
          (t) => (kind === null || t.details?.kind === kind) && pred(t),
        );
        found = hits[hits.length - 1];
        return hits.length;
      },
      { message: `find ${what} since #${afterId}`, timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  return found!;
}

type Line = PaymentSnapshot["lines"][number];

/** The snapshot line for a method/currency/amount (identity, not position). */
export function snapLine(
  t: Txn,
  method: string,
  currency: string,
  amount: number,
): Line | undefined {
  return t.snapshot?.lines.find(
    (l) =>
      l.method === method &&
      l.currency === currency &&
      Math.abs(l.amount - amount) < (currency === "LBP" ? 1 : 0.005),
  );
}

export function expectSnapLine(
  t: Txn,
  method: string,
  currency: string,
  amount: number,
  direction: "IN" | "OUT",
): void {
  const l = snapLine(t, method, currency, amount);
  expect(
    l,
    `#${t.id} has a ${method} ${amount} ${currency} line: ${JSON.stringify(t.snapshot)}`,
  ).toBeTruthy();
  expect(l!.direction, `#${t.id} ${method} ${amount} ${currency}`).toBe(
    direction,
  );
}

/** bug 1 — a payout / money-out leg must read OUT (soft: SHOP_DAY §3). */
export function expectPayoutLine(
  t: Txn,
  method: string,
  currency: string,
  amount: number,
): void {
  const l = snapLine(t, method, currency, amount);
  expect(
    l,
    `#${t.id} has the payout ${method} ${amount} ${currency} line: ${JSON.stringify(t.snapshot)}`,
  ).toBeTruthy();
  bugCheck(1, `#${t.id} ${method} ${amount} ${currency} payout direction`, () =>
    expect(l?.direction).toBe(FIXED.payoutDirection),
  );
}

/**
 * The drawer a payment leg moved agrees with the books: find the leg
 * (method, currency, amount) on the rows written since `afterId`, check its
 * sign, and assert its drawer moved by the sum of every leg those rows put
 * on that drawer and currency. Used where SHOP_DAY does not name the drawer,
 * so the spec does not guess one.
 */
export async function expectLegMovedDrawer(
  day: ShopDay,
  afterId: number,
  before: Drawers,
  method: string,
  currency: string,
  amount: number,
  sign: 1 | -1,
): Promise<string> {
  const rows = await txnsSince(day, afterId);
  const legs = rows.flatMap((r) => r.payments ?? []);
  const tol = currency === "LBP" ? 1 : 0.005;
  const leg = legs.find(
    (l) =>
      l.method === method &&
      l.currency_code === currency &&
      Math.abs(Math.abs(l.signed_amount) - amount) < tol &&
      Math.sign(l.signed_amount) === sign,
  );
  expect(
    leg,
    `a ${sign > 0 ? "+" : "-"}${amount} ${currency} ${method} leg: ${JSON.stringify(legs)}`,
  ).toBeTruthy();
  const drawer = leg!.drawer_name;
  expect(drawer, "the leg names its drawer").toBeTruthy();
  const total = legs
    .filter((l) => l.drawer_name === drawer && l.currency_code === currency)
    .reduce((s, l) => s + l.signed_amount, 0);
  expectMoved(await drawers(day), before, drawer!, currency, total);
  return drawer!;
}

/** Round to cents / whole LBP and compare — "exact cents" checks (bug 15). */
export function isWholeUnit(amount: number, currency: string): boolean {
  const scale = currency === "LBP" ? 1 : 100;
  return Math.abs(Math.round(amount * scale) - amount * scale) < 1e-6;
}

// ── Transactions page / Details panel ─────────────────────────────────────

/**
 * Open the Transactions page's Details panel for `txnId`. `search` narrows the
 * table (it matches summary, client name and user — never the id), then each
 * candidate row's Details is opened until the panel for THIS id shows.
 */
export async function openDetails(
  day: ShopDay,
  txnId: number,
  search: string,
): Promise<Locator> {
  const { page } = day;
  if (!page.url().includes("#/audit")) {
    await page.goto("/#/audit");
  }
  const box = page.getByPlaceholder(/Search summary, client, user/);
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.fill(search);
  await box.press("Enter");
  const table = page.getByTestId("data-table");
  await expect(table).toBeVisible({ timeout: 15_000 });
  const panel = page.getByTestId(`transaction-details-${txnId}`);
  const buttons = table.getByRole("button", { name: "Details", exact: true });
  await expect(buttons.first()).toBeVisible({ timeout: 15_000 });
  const n = Math.min(await buttons.count(), 40);
  for (let i = 0; i < n; i++) {
    await buttons.nth(i).click();
    const any = page.locator('[data-testid^="transaction-details-"]');
    await expect(any).toBeVisible({ timeout: 5_000 });
    if (await panel.isVisible()) return panel;
    await any.getByRole("button", { name: "Close" }).click();
    await expect(any).toHaveCount(0);
  }
  throw new Error(
    `Details panel for #${txnId} not reachable from search "${search}"`,
  );
}

export async function closeDetails(panel: Locator): Promise<void> {
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
}

/** The panel shows each label (a `<dt>`) — the field reached the screen. */
export async function expectPanelLabels(
  panel: Locator,
  labels: string[],
): Promise<void> {
  for (const label of labels) {
    await expect(
      panel
        .locator("dt", { hasText: new RegExp(`^${escapeRe(label)}$`) })
        .first(),
      `Details panel label "${label}"`,
    ).toBeVisible();
  }
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Payment panel (MultiPaymentInput) ─────────────────────────────────────
//
// Line testids end in a random UUID: match by prefix and index (SHOP_DAY §6).

export function payMethod(scope: Locator | Page, i = 0): Locator {
  return scope.locator('[data-testid^="payment-method-"]').nth(i);
}
export function payCurrency(scope: Locator | Page, i = 0): Locator {
  return scope.locator('select[data-testid^="payment-currency-"]').nth(i);
}
export function payAmount(scope: Locator | Page, i = 0): Locator {
  return scope.locator('[data-testid^="payment-amount-"]').nth(i);
}

/** Turn Split on (no-op when already on). */
export async function splitOn(scope: Locator | Page): Promise<void> {
  const toggle = scope.getByTestId("split-toggle").first();
  await expect(toggle).toBeVisible();
  if (!/Split Active/.test((await toggle.textContent()) ?? "")) {
    await toggle.click();
  }
}

export async function addLine(scope: Locator | Page): Promise<void> {
  await scope.getByTestId("add-payment-line").first().click();
}

/** Fill one payment line: method, optional currency, amount. */
export async function payLine(
  scope: Locator | Page,
  i: number,
  method: string,
  amount: number,
  currency?: string,
): Promise<void> {
  await payMethod(scope, i).selectOption(method);
  if (currency) {
    const cur = payCurrency(scope, i);
    if ((await cur.count()) > 0) await cur.selectOption(currency);
  }
  await payAmount(scope, i).fill(String(amount));
}

/** Click a client suggestion (ClientAutocompleteInput) after typing a name. */
export async function pickClientOption(
  page: Page,
  input: Locator,
  name: string,
): Promise<void> {
  await input.fill("");
  await input.pressSequentially(name, { delay: 20 });
  // ClientAutocompleteInput renders `client-option-<id>` (selects on
  // mousedown — a click fires it); other pickers render a plain button/li.
  const option = page
    .locator('[data-testid^="client-option-"], [role="option"], li, button', {
      hasText: name,
    })
    .first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
}

/** The top overlay (modals/sheets are not role=dialog — SHOP_DAY §6). */
export function topModal(page: Page): Locator {
  return page.locator(".fixed.inset-0").last();
}

/** Wait for a POST to `urlPart` and return its parsed JSON body + request. */
export function waitPost(
  page: Page,
  urlPart: string,
): Promise<{
  body: Record<string, unknown>;
  request: Record<string, unknown>;
}> {
  return page
    .waitForResponse(
      (r) => r.url().includes(urlPart) && r.request().method() === "POST",
      { timeout: 30_000 },
    )
    .then(async (r) => {
      let request: Record<string, unknown> = {};
      try {
        request = (r.request().postDataJSON() ?? {}) as Record<string, unknown>;
      } catch {
        request = {};
      }
      return {
        body: (await r.json().catch(() => ({}))) as Record<string, unknown>,
        request,
      };
    });
}

// ── Partners / clients reads ──────────────────────────────────────────────

export async function partnerBalance(
  day: ShopDay,
  partnerId: number,
): Promise<{ usd: number; lbp: number }> {
  const r = await getJson<{
    success: boolean;
    balance: { usd: number; lbp: number };
  }>(day, `/api/partners/${partnerId}/balance`);
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.balance;
}

export async function partnerIdByName(
  day: ShopDay,
  name: string,
): Promise<number> {
  const r = await getJson<{
    success: boolean;
    balances: Array<{ id: number; name: string }>;
  }>(day, "/api/partners/balances?includeInactive=false");
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const p = r.balances.find((b) => b.name === name);
  expect(p, `partner "${name}" exists`).toBeTruthy();
  return p!.id;
}

export async function clientByName(
  day: ShopDay,
  name: string,
): Promise<{ id: number; full_name: string; phone_number: string | null }> {
  const r = await getJson<{
    success: boolean;
    data: {
      clients: Array<{
        id: number;
        full_name: string;
        phone_number: string | null;
      }>;
    };
  }>(day, `/api/clients?search=${encodeURIComponent(name)}`);
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const c = r.data.clients.find((x) => x.full_name === name);
  expect(c, `client "${name}" exists`).toBeTruthy();
  return c!;
}

export async function clientDebt(
  day: ShopDay,
  clientId: number,
): Promise<{ usd: number; lbp: number }> {
  const r = await getJson<{
    success: boolean;
    data: { balance_usd: number; balance_lbp: number };
  }>(day, `/api/debts/clients/${clientId}/balance`);
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return { usd: r.data.balance_usd, lbp: r.data.balance_lbp };
}

export async function supplierBalance(
  day: ShopDay,
  supplierName: string,
): Promise<{ id: number; usd: number; lbp: number }> {
  const list = await getJson<{
    success: boolean;
    suppliers?: Array<{ id: number; name: string }>;
    data?: Array<{ id: number; name: string }>;
  }>(day, "/api/suppliers");
  const all = list.suppliers ?? list.data ?? [];
  const s = all.find((x) => x.name === supplierName);
  expect(s, `supplier "${supplierName}" exists`).toBeTruthy();
  const r = await getJson<{
    success: boolean;
    balances: Array<{
      supplier_id: number;
      total_usd: number;
      total_lbp: number;
    }>;
  }>(day, "/api/suppliers/balances");
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const b = r.balances.find((x) => x.supplier_id === s!.id);
  return { id: s!.id, usd: b?.total_usd ?? 0, lbp: b?.total_lbp ?? 0 };
}
