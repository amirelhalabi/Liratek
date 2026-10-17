/**
 * lira-web-073 — LIRA-332 free trial, end to end on the web transport
 * (quickstart §4).
 *
 *  1. The super admin creates a shop: it is NOT on a trial (FR-004).
 *  2. Extend trial to today + 2 (Beirut) → the shop sees the trial strip on
 *     every page ("3 days left", ends soon) with the WhatsApp link.
 *  3. A write while on trial works.
 *  4. The trial is ended by writing `trial_ends_at` into the past (test
 *     setup only: Extend refuses past days by design).
 *  5. Every page renders and shows the "trial ended" alert; reads still work.
 *  6. A write (a sale, a client) is refused with the trial text, and no new
 *     row exists, matched by identity (rule 15).
 *  7. Activate (open-ended) → after a reload, without signing out, the
 *     alert is gone and a write works.
 *
 * The shop is reached through the real "Connect as admin" hand-off, as in
 * lira-web-038 (a second shop has no login host on localhost). A super
 * admin impersonating is gated like the shop, which is the owner decision.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { Page } from "@playwright/test";
import {
  addDaysToDateString,
  buildActivationWhatsAppUrl,
  hashPassword,
  shopDayOf,
} from "@liratek/core";
import { test, expect, loginAsUser, BACKEND_URL } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "..", "test-results", "e2e-web", "phone_shop.web.db");

// The lira-web-001 page list (profits excluded there for its password gate).
const PAGES = [
  "/",
  "/pos",
  "/products",
  "/clients",
  "/debts",
  "/exchange",
  "/omt-whish",
  "/recharge",
  "/loto",
  "/expenses",
  "/maintenance",
  "/custom-services",
  "/vouchers",
  "/suppliers",
  "/partners",
  "/customer-sessions",
  "/settings",
  "/audit",
  "/checkpoint-timeline",
];

function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function api(
  page: Page,
  method: "GET" | "POST",
  url: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await page.request.fetch(`${BACKEND_URL}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status(), json: (await res.json()) as Record<string, unknown> };
}

async function visitAll(page: Page, testId: string): Promise<void> {
  for (const route of PAGES) {
    await page.goto(`/#${route}`);
    await expect(page.locator("#root"), route).not.toContainText("Something went wrong");
    await expect(page.getByTestId(testId), `${route} shows ${testId}`).toBeVisible({
      timeout: 15_000,
    });
  }
}

test.describe.serial("LIRA-332 — free trial", () => {
  test("trial strip → ended (view, no new records) → activate", async ({ page, context }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const su = `l332_root_${ts}`;
    const suPass = "L332RootPass!1";
    withDb((db) =>
      db
        .prepare(
          `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (NULL, ?, ?, 'super_admin', 1)`,
        )
        .run(su, hashPassword(suPass)),
    );
    const shopName = `L332 Shop ${ts}`;
    const slug = `l332-${ts}`;

    // ── 1. The super admin creates a shop: no trial ──
    await loginAsUser(page, su, suPass);
    await expect(page).toHaveURL(/\/admin\/tenants/, { timeout: 15_000 });
    const suToken = (await page.evaluate(() => localStorage.getItem("liratek.jwt"))) as string;
    const created = await api(page, "POST", "/api/admin/tenants", suToken, {
      name: shopName,
      slug,
      adminUsername: `l332_admin_${ts}`,
      adminPassword: "L332AdminPass!1",
    });
    expect(created.status).toBe(201);
    const tenantId = (created.json.data as { tenant: { id: number } }).tenant.id;
    expect(
      withDb((db) =>
        db.prepare(`SELECT trial_ends_at FROM tenant_subscriptions WHERE tenant_id = ?`).get(tenantId),
      ),
    ).toEqual({ trial_ends_at: null });

    // ── 2. Extend trial to today + 2 → 3 days left, ends soon ──
    const lastDay = addDaysToDateString(shopDayOf(new Date()), 2);
    const extended = await api(page, "POST", `/api/admin/subscriptions/${tenantId}/extend-trial`, suToken, {
      lastDay,
    });
    expect(extended.status).toBe(200);

    await page.reload();
    const row = page.locator("tbody tr").filter({ hasText: shopName });
    await expect(row).toContainText(`Trial · 3 days left · ends ${lastDay}`, { timeout: 15_000 });

    const [shop] = await Promise.all([
      context.waitForEvent("page"),
      row.getByRole("button", { name: /Connect as admin/i }).click(),
    ]);
    await shop.waitForLoadState("domcontentloaded");
    const strip = shop.getByTestId("trial-strip");
    await expect(strip).toContainText(
      `Your free trial ends soon: 3 days left, last day ${lastDay}.`,
      { timeout: 15_000 },
    );
    const href = await strip.getByRole("link").getAttribute("href");
    expect(href).toBe(
      buildActivationWhatsAppUrl({ shopName, shopAddress: slug }),
    );
    expect(href).toContain(slug);
    await visitAll(shop, "trial-strip");
    const shopToken = (await shop.evaluate(() =>
      sessionStorage.getItem("liratek.impersonation"),
    )) as string;
    expect(shopToken).toBeTruthy();

    // ── 3. A write while on trial works ──
    const before = `L332 Before ${ts}`;
    const ok = await api(shop, "POST", "/api/clients", shopToken, {
      full_name: before,
      phone_number: `70${String(ts).slice(-6)}`,
    });
    expect(ok.json.success, JSON.stringify(ok.json)).toBe(true);

    // ── 4. End the trial (test setup) ──
    withDb((db) =>
      db
        .prepare(
          `UPDATE tenant_subscriptions SET trial_ends_at = datetime('now', '-1 hour') WHERE tenant_id = ?`,
        )
        .run(tenantId),
    );

    // ── 5. Every page renders with the ended alert; reads still work ──
    await shop.reload();
    await expect(shop.getByTestId("trial-ended")).toContainText(
      "Your free trial has ended. You can still sign in, see and export everything.",
      { timeout: 15_000 },
    );
    await visitAll(shop, "trial-ended");
    const debtors = await api(shop, "GET", "/api/debts/debtors", shopToken);
    expect(debtors.status).toBe(200);
    const clients = await api(shop, "GET", "/api/clients", shopToken);
    expect(JSON.stringify(clients.json)).toContain(before);

    // ── 6. Writes refused with the trial text; nothing created ──
    const sale = await api(shop, "POST", "/api/sales/process", shopToken, { items: [] });
    expect(sale.status).toBe(200);
    expect(sale.json).toEqual({
      success: false,
      code: "TRIAL_ENDED",
      error: "Your free trial has ended. Contact LiraTek on WhatsApp to activate.",
    });
    const after = `L332 After ${ts}`;
    const refused = await api(shop, "POST", "/api/clients", shopToken, {
      full_name: after,
      phone_number: `71${String(ts).slice(-6)}`,
    });
    expect(refused.json.code).toBe("TRIAL_ENDED");
    const countNamed = (name: string) =>
      withDb(
        (db) =>
          (db.prepare(`SELECT COUNT(*) AS n FROM clients WHERE tenant_id = ? AND full_name = ?`).get(tenantId, name) as {
            n: number;
          }).n,
      );
    expect(countNamed(after)).toBe(0);
    expect(countNamed(before)).toBe(1);

    // ── 7. Activate (open-ended) → no alert after a reload, writes work ──
    const activated = await api(page, "POST", `/api/admin/subscriptions/${tenantId}/activate`, suToken, {
      until: null,
    });
    expect(activated.status).toBe(200);
    await shop.reload();
    await expect(shop.locator("#root")).not.toContainText("Something went wrong");
    await expect(shop.getByTestId("trial-ended")).toHaveCount(0, { timeout: 15_000 });
    await expect(shop.getByTestId("trial-strip")).toHaveCount(0);
    const again = await api(shop, "POST", "/api/clients", shopToken, {
      full_name: after,
      phone_number: `71${String(ts).slice(-6)}`,
    });
    expect(again.json.success, JSON.stringify(again.json)).toBe(true);
    expect(countNamed(after)).toBe(1);
  });
});
