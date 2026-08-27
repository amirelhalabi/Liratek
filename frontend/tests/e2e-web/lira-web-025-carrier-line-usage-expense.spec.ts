/**
 * lira-web-025 — LIRA-145 carrier-line usage expense, over the WEB transport.
 *
 * REST twin of `frontend/tests/e2e-electron/lira-145-carrier-line-usage-expense.spec.ts`.
 * Same money contract, different transport (rule 19): consuming a shop line's
 * credits books a `Line_Usage` expense that debits the CARRIER's credit
 * drawer (`MTC`), never a cash drawer, and the linked
 * `carrier_line_movements` row makes the generic void restore everything.
 *
 * Why a sibling exists at all (the parity gaps only this file can catch):
 *
 *  1. **The panel must reach the HTTP branch.** `CarrierLinesPanel` is
 *     rendered inside the Recharge page, and both calls it makes —
 *     `api.getActiveCarrierLines()` and `api.recordCarrierLineUsage()` — go
 *     through `ipcOrHttp`. In a browser `window.api` does not exist, so a
 *     regression to a raw `window.api.carrierLines.*` call (the exact defect
 *     lira-web-020 was written for, twice over, in this same page) throws
 *     before any money moves and the panel silently shows nothing. Test (a)
 *     drives the REAL page in a REAL browser, so only the HTTP branch can
 *     satisfy it.
 *  2. **Envelope parity.** `POST /api/carrier-lines/record-usage` must answer
 *     a business rejection with **HTTP 200** and `{success:false,error}` —
 *     the adapter branches on `result.success`, and `requestJson` THROWS on
 *     any non-2xx, which would swallow the envelope. Its own file's older
 *     siblings return 400 on failure; test (b) pins that this route does not
 *     copy them.
 *  3. **Role parity.** The owner's decision is that **staff** may record
 *     usage (matching `expenses:update-metadata`, not the admin-only
 *     carrier-line CRUD routes around it). A role gate is the single easiest
 *     thing to regress into `["admin"]` when the file next gets edited, and
 *     no other test in either suite covers it — test (d).
 *
 * Rule 15 for this suite: the web DB in `test-results/e2e-web` ACCUMULATES
 * across runs, so every line is freshly created with a run-unique phone, the
 * transaction is matched by `source_id` (the expense id the route itself
 * returns) or by that unique phone inside `summary`, and every money
 * assertion is a delta snapshotted immediately before the action.
 *
 * Rule 17 (NOT RUN by this workstream — the owner runs `yarn test:e2e:web`):
 * the failing-first recipes are the same four listed in the desktop spec's
 * header, plus one that is web-only — change this route's `res.json(result)`
 * to `res.status(400).json(result)` and test (b) fails on the status
 * assertion while every other test keeps passing.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
// Same import global-setup.ts and lira-web-019 already use — this suite runs
// under the Node ABI, so a direct better-sqlite3 open is safe here.
import Database from "better-sqlite3";
import { hashPassword } from "@liratek/core";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";
import type { Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Mirrors global-setup.ts / lira-web-019 path resolution exactly.
const DB_PATH = path.join(
  __dirname,
  "..",
  "..",
  "test-results",
  "e2e-web",
  "phone_shop.web.db",
);

const STAFF_USERNAME = "e2e025staff";
const STAFF_PASSWORD = "E2e025Staff!1";

const FROM = "2000-01-01";
const TO = "2099-12-31";

const LINE_USAGE_CATEGORY = "Line_Usage";

type Headers = Record<string, string>;

/**
 * Seed (idempotently) a REAL `staff`-role user directly in the shared web test
 * DB. Same reasoning lira-web-019 documents at length: `POST /api/users` is an
 * unfinished placeholder that writes no row, and `authenticateJWT` requires a
 * live `sessions` row behind the token, so a self-signed JWT cannot stand in
 * for a real login. The UPDATE runs unconditionally so a prior run's leftover
 * row can never decide this spec's outcome.
 */
function seedStaffUser(): void {
  const db = new Database(DB_PATH);
  try {
    db.prepare(
      `INSERT OR IGNORE INTO users (tenant_id, username, password_hash, role, is_active)
       VALUES (1, ?, ?, 'staff', 1)`,
    ).run(STAFF_USERNAME, hashPassword(STAFF_PASSWORD));
    db.prepare(
      `UPDATE users SET password_hash = ?, role = 'staff', is_active = 1 WHERE username = ?`,
    ).run(hashPassword(STAFF_PASSWORD), STAFF_USERNAME);
  } finally {
    db.close();
  }
}

async function loginHeaders(
  page: Page,
  username: string,
  password: string,
): Promise<Headers> {
  const res = await (
    await page.request.post(`${BACKEND_URL}/api/auth/login`, {
      data: { username, password },
    })
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return { Authorization: `Bearer ${res.data.token as string}` };
}

async function adminHeaders(page: Page): Promise<Headers> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  expect(token).toBeTruthy();
  return { Authorization: `Bearer ${token as string}` };
}

// ---------------------------------------------------------------------------
// Snapshot — mirrors the desktop spec's MoneySnapshot, read over REST
// ---------------------------------------------------------------------------

type MoneySnapshot = {
  lineCredits: number;
  mtcCreditsSum: number;
  mtcDrawerUsd: number;
  generalUsd: number;
  generalLbp: number;
  expenseTotalUsd: number;
  expenseTotalLbp: number;
  expenseCount: number;
  supplierPoolUsd: number;
  supplierPoolLbp: number;
};

async function snapshot(
  page: Page,
  headers: Headers,
  lineId: number,
): Promise<MoneySnapshot> {
  const linesRes = await (
    await page.request.get(`${BACKEND_URL}/api/carrier-lines`, { headers })
  ).json();
  expect(linesRes.success, JSON.stringify(linesRes)).toBeTruthy();
  const lines = (linesRes.data ?? []) as Array<{
    id: number;
    carrier: string;
    credits: number;
    is_active: number;
  }>;

  const drawerRes = await (
    await page.request.get(`${BACKEND_URL}/api/recharge/drawer-balances`, {
      headers,
    })
  ).json();
  expect(drawerRes.success, JSON.stringify(drawerRes)).toBeTruthy();
  const drawers = (drawerRes.balances ?? []) as Array<{
    name: string;
    usdBalance: number;
    lbpBalance: number;
  }>;
  const pick = (name: string, cur: "usd" | "lbp") => {
    const row = drawers.find((d) => d.name === name);
    return cur === "usd" ? (row?.usdBalance ?? 0) : (row?.lbpBalance ?? 0);
  };

  const profitRes = await (
    await page.request.get(
      `${BACKEND_URL}/api/profits/summary?from=${FROM}&to=${TO}`,
      { headers },
    )
  ).json();
  expect(profitRes.success, JSON.stringify(profitRes)).toBeTruthy();
  const expenses = profitRes.data.expenses as {
    total_usd: number;
    total_lbp: number;
    count: number;
  };

  const supRes = await (
    await page.request.get(`${BACKEND_URL}/api/suppliers/balances`, { headers })
  ).json();
  expect(supRes.success, JSON.stringify(supRes)).toBeTruthy();
  const balances = (supRes.balances ?? []) as Array<{
    total_usd?: number;
    total_lbp?: number;
  }>;

  return {
    lineCredits: lines.find((l) => l.id === lineId)?.credits ?? 0,
    mtcCreditsSum: lines
      .filter((l) => l.carrier === "mtc" && l.is_active === 1)
      .reduce((sum, l) => sum + l.credits, 0),
    mtcDrawerUsd: pick("MTC", "usd"),
    generalUsd: pick("General", "usd"),
    generalLbp: pick("General", "lbp"),
    expenseTotalUsd: expenses.total_usd,
    expenseTotalLbp: expenses.total_lbp,
    expenseCount: expenses.count,
    supplierPoolUsd: balances.reduce((s, b) => s + (b.total_usd ?? 0), 0),
    supplierPoolLbp: balances.reduce((s, b) => s + (b.total_lbp ?? 0), 0),
  };
}

/** A fresh ACTIVE MTC line with a run-unique phone (admin-only route).
 *  Never `setPrimary` — this flow has nothing to do with the primary line. */
async function seedMtcLine(
  page: Page,
  headers: Headers,
  phone: string,
  label: string,
  credits: number,
): Promise<number> {
  const created = await (
    await page.request.post(`${BACKEND_URL}/api/carrier-lines`, {
      headers,
      data: { carrier: "mtc", phone_number: phone, label, credits },
    })
  ).json();
  expect(created.success, JSON.stringify(created)).toBeTruthy();
  return created.data.id as number;
}

/** The EXPENSE transaction for this run, matched by `source_id` — the expense
 *  id, which is unique per row — never by position. */
async function txnBySourceId(
  page: Page,
  headers: Headers,
  expenseId: number,
): Promise<Record<string, unknown> | null> {
  const res = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/recent?limit=200&type=EXPENSE&source_table=expenses`,
      { headers },
    )
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  const rows = (res.transactions ?? []) as Array<Record<string, unknown>>;
  return rows.find((t) => t.source_id === expenseId) ?? null;
}

// ---------------------------------------------------------------------------
// Driving the REAL panel in the browser
// ---------------------------------------------------------------------------

/** Resolve the per-row "Record usage" trigger for one line — testid
 *  `carrier-line-usage-open-<id>`, unique per row. Kept in sync with the
 *  desktop spec deliberately. */
async function clickUsageOpen(page: Page, lineId: number): Promise<void> {
  await page.getByTestId(`carrier-line-usage-open-${lineId}`).click();
  await expect(page.getByTestId("carrier-line-usage-new-balance")).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("LIRA-145 carrier-line usage expense over REST", () => {
  test("(a) the real Recharge panel records usage through the HTTP branch: carrier drawer and line move together, no cash moves", async ({
    page,
  }) => {
    const headers = await adminHeaders(page);

    const stamp = Date.now();
    const phone = `03${String(stamp).slice(-6)}`;
    const label = `W025-A-${stamp}`;
    const note = `W025 usage A ${stamp}`;
    const SEED = 41.25;
    const NEW_BALANCE = 28.75;
    const USED = 12.5;

    const lineId = await seedMtcLine(page, headers, phone, label, SEED);
    const before = await snapshot(page, headers, lineId);
    expect(before.lineCredits).toBeCloseTo(SEED, 2);

    // The REAL page, in a REAL browser — no window.api anywhere, so every
    // call the panel makes must resolve on the HTTP branch of ipcOrHttp.
    await page.goto("/#/recharge");
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );
    // MTC is the first PROVIDER_CONFIGS entry, so a fresh mount lands on it.
    await expect(page.getByTestId(`carrier-line-${lineId}`)).toBeVisible({
      timeout: 20_000,
    });

    await clickUsageOpen(page, lineId);
    await expect(page.getByTestId("carrier-line-usage-used")).toBeVisible();
    await page
      .getByTestId("carrier-line-usage-new-balance")
      .fill(String(NEW_BALANCE));
    await page.getByTestId("carrier-line-usage-note").fill(note);
    await expect(page.getByTestId("carrier-line-usage-preview")).toContainText(
      /12\.5/,
      { timeout: 5_000 },
    );
    const submit = page.getByTestId("carrier-line-usage-submit");
    await expect(submit).toBeEnabled();
    await submit.click();

    // Polled as a fixed-precision STRING (not `toBeCloseTo`) so the matcher
    // used here is one `expect.poll` is documented to support everywhere —
    // same shape the desktop twin uses.
    await expect
      .poll(
        async () =>
          (await snapshot(page, headers, lineId)).lineCredits.toFixed(2),
        { timeout: 15_000 },
      )
      .toBe(NEW_BALANCE.toFixed(2));

    const after = await snapshot(page, headers, lineId);

    // Both halves of the §0.1 sum invariant move by the same number.
    expect(after.mtcCreditsSum - before.mtcCreditsSum).toBeCloseTo(-USED, 2);
    expect(after.mtcDrawerUsd - before.mtcDrawerUsd).toBeCloseTo(-USED, 2);
    // No cash moves — the credits were paid for at top-up time.
    expect(after.generalUsd - before.generalUsd).toBeCloseTo(0, 2);
    expect(after.generalLbp - before.generalLbp).toBeCloseTo(0, 0);
    // Booked at face value, USD only.
    expect(after.expenseTotalUsd - before.expenseTotalUsd).toBeCloseTo(USED, 2);
    expect(after.expenseTotalLbp - before.expenseTotalLbp).toBeCloseTo(0, 0);
    expect(after.expenseCount - before.expenseCount).toBe(1);
    // No counterparty obligation changed (prepaid-units model).
    expect(after.supplierPoolUsd - before.supplierPoolUsd).toBeCloseTo(0, 2);
    expect(after.supplierPoolLbp - before.supplierPoolLbp).toBeCloseTo(0, 0);

    // Identity: the EXPENSE row carrying this run's unique phone.
    const recent = await (
      await page.request.get(
        `${BACKEND_URL}/api/transactions/recent?limit=200&type=EXPENSE&source_table=expenses`,
        { headers },
      )
    ).json();
    const rows = (recent.transactions ?? []) as Array<{
      id: number;
      status: string;
      amount_usd: number;
      amount_lbp: number;
      client_name: string | null;
      summary: string | null;
      payments: unknown[];
    }>;
    const mine = rows.filter((t) => (t.summary ?? "").includes(phone));
    expect(mine).toHaveLength(1);
    const row = mine[0];
    expect(row.status).toBe("ACTIVE");
    expect(row.amount_usd).toBeCloseTo(-USED, 2);
    expect(row.amount_lbp).toBeCloseTo(0, 0);
    expect(row.summary).toBe(
      `Expense: ${LINE_USAGE_CATEGORY} - Line usage: MTC ${phone} (${label}) — ${note}`,
    );
    expect(row.client_name).toBeFalsy();
    // The single leg sits on the MTC provider-stock drawer, which
    // `_attachPaymentLegs` classifies as internal — so a customer-facing cash
    // leg appearing here means the cost got routed through a cash drawer.
    expect(row.payments).toHaveLength(0);
  });

  test("(b) a business rejection answers HTTP 200 with { success: false } (envelope parity, rule 19c)", async ({
    page,
  }) => {
    const headers = await adminHeaders(page);

    const stamp = Date.now();
    const phone = `03${String(stamp).slice(-6)}`;
    const lineId = await seedMtcLine(
      page,
      headers,
      phone,
      `W025-B-${stamp}`,
      6,
    );
    const before = await snapshot(page, headers, lineId);

    // A balance that went UP is not a consumption.
    const higher = await page.request.post(
      `${BACKEND_URL}/api/carrier-lines/record-usage`,
      { headers, data: { carrierLineId: lineId, newCredits: 9 } },
    );
    expect(higher.status()).toBe(200);
    const higherBody = await higher.json();
    expect(higherBody.success).toBe(false);
    expect(String(higherBody.error ?? "")).toBeTruthy();

    // A stale optimistic-concurrency guard is refused the same way.
    const stale = await page.request.post(
      `${BACKEND_URL}/api/carrier-lines/record-usage`,
      {
        headers,
        data: {
          carrierLineId: lineId,
          newCredits: 5,
          expectedCurrentCredits: 99,
        },
      },
    );
    expect(stale.status()).toBe(200);
    const staleBody = await stale.json();
    expect(staleBody.success).toBe(false);
    expect(String(staleBody.error ?? "")).toMatch(/changed/i);

    // Neither rejection left a partial write behind (the repository runs the
    // whole thing inside one better-sqlite3 transaction).
    const after = await snapshot(page, headers, lineId);
    expect(after.lineCredits).toBeCloseTo(6, 2);
    expect(after.mtcDrawerUsd - before.mtcDrawerUsd).toBeCloseTo(0, 2);
    expect(after.expenseCount - before.expenseCount).toBe(0);
  });

  test("(c) voiding the EXPENSE over REST nets the line, the carrier drawer and the active-expense total back to zero", async ({
    page,
  }) => {
    const headers = await adminHeaders(page);

    const stamp = Date.now();
    const phone = `03${String(stamp).slice(-6)}`;
    const SEED = 33.5;
    const NEW_BALANCE = 20.25;
    const USED = 13.25;

    const lineId = await seedMtcLine(
      page,
      headers,
      phone,
      `W025-C-${stamp}`,
      SEED,
    );
    const before = await snapshot(page, headers, lineId);

    const recorded = await (
      await page.request.post(`${BACKEND_URL}/api/carrier-lines/record-usage`, {
        headers,
        data: {
          carrierLineId: lineId,
          newCredits: NEW_BALANCE,
          expectedCurrentCredits: SEED,
          note: `W025 usage C ${stamp}`,
        },
      })
    ).json();
    expect(recorded.success, JSON.stringify(recorded)).toBeTruthy();
    expect(recorded.data.creditsUsed).toBeCloseTo(USED, 2);
    const expenseId = recorded.data.expenseId as number;
    const txnId = recorded.data.transactionId as number;

    // The route's own transactionId really is the row wrapping that expense —
    // the linkage every reversal below depends on.
    const linked = await txnBySourceId(page, headers, expenseId);
    expect(linked).not.toBeNull();
    expect((linked as { id: number }).id).toBe(txnId);

    // Sanity: the usage moved all three, so "nets to zero" is not vacuous.
    const afterUsage = await snapshot(page, headers, lineId);
    expect(afterUsage.mtcDrawerUsd - before.mtcDrawerUsd).toBeCloseTo(-USED, 2);
    expect(afterUsage.expenseTotalUsd - before.expenseTotalUsd).toBeCloseTo(
      USED,
      2,
    );
    expect(afterUsage.lineCredits).toBeCloseTo(NEW_BALANCE, 2);

    const voided = await (
      await page.request.post(`${BACKEND_URL}/api/transactions/${txnId}/void`, {
        headers,
      })
    ).json();
    expect(voided.success, JSON.stringify(voided)).toBeTruthy();

    // Rule 20: create + void nets to 0 across EVERY ledger touched.
    const restored = await snapshot(page, headers, lineId);
    expect(restored.lineCredits).toBeCloseTo(SEED, 2);
    expect(restored.mtcCreditsSum - before.mtcCreditsSum).toBeCloseTo(0, 2);
    expect(restored.mtcDrawerUsd - before.mtcDrawerUsd).toBeCloseTo(0, 2);
    expect(restored.expenseTotalUsd - before.expenseTotalUsd).toBeCloseTo(0, 2);
    expect(restored.expenseTotalLbp - before.expenseTotalLbp).toBeCloseTo(0, 0);
    expect(restored.expenseCount - before.expenseCount).toBe(0);
    expect(restored.generalUsd - before.generalUsd).toBeCloseTo(0, 2);
    expect(restored.generalLbp - before.generalLbp).toBeCloseTo(0, 0);
    expect(restored.supplierPoolUsd - before.supplierPoolUsd).toBeCloseTo(0, 2);
    expect(restored.supplierPoolLbp - before.supplierPoolLbp).toBeCloseTo(0, 0);

    const detail = await (
      await page.request.get(`${BACKEND_URL}/api/transactions/${txnId}`, {
        headers,
      })
    ).json();
    expect(detail.success, JSON.stringify(detail)).toBeTruthy();
    expect(detail.transaction.status).toBe("VOIDED");
  });

  test("(d) role parity: STAFF may record usage (owner decision), matching the IPC channel's requireRole", async ({
    page,
  }) => {
    const admin = await adminHeaders(page);

    const stamp = Date.now();
    const phone = `03${String(stamp).slice(-6)}`;
    const lineId = await seedMtcLine(page, admin, phone, `W025-D-${stamp}`, 10);

    seedStaffUser();
    const staff = await loginHeaders(page, STAFF_USERNAME, STAFF_PASSWORD);

    const res = await page.request.post(
      `${BACKEND_URL}/api/carrier-lines/record-usage`,
      { headers: staff, data: { carrierLineId: lineId, newCredits: 7.5 } },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    // A regression to requireRole(["admin"]) makes this 403 with no
    // `success` field — the assertion below names exactly that.
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    expect(body.data.creditsUsed).toBeCloseTo(2.5, 2);
    expect(body.data.newCredits).toBeCloseTo(7.5, 2);

    // Leave the books where they were: void the staff-booked expense.
    const voided = await (
      await page.request.post(
        `${BACKEND_URL}/api/transactions/${body.data.transactionId}/void`,
        { headers: admin },
      )
    ).json();
    expect(voided.success, JSON.stringify(voided)).toBeTruthy();
  });
});
