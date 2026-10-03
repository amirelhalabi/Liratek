/**
 * lira-web-038 — LIRA-099: multi-tenant admin/impersonation e2e proof (WP9).
 *
 * Drives the REAL super-admin control plane in a real browser: login as a
 * platform super_admin -> /admin/tenants renders -> provision a tenant
 * through the real `AddTenantModal` -> "Connect as admin" opens a new tab
 * (`window.open`, handleConnect in Tenants/index.tsx) carrying the
 * impersonation handoff -> the impersonated tab shows `ImpersonationBanner`
 * -> a write made under impersonation lands ONLY in the target tenant (the
 * isolation half) -> Disconnect ends the session and the original
 * super-admin tab is unaffected.
 *
 * Every entity below is `Date.now()`-unique (rule 15, shared accumulating
 * DB): the super_admin user, the provisioned tenant's name/slug/admin
 * credentials, and the partner created while impersonating. Rows are
 * matched by name/action/entity_id, never by position.
 *
 * NOTE on the audit assertion (corrects the ticket's literal wording): the
 * `audit_log.impersonator_id` column is documented and PROVEN (B-D3,
 * `backend/src/__tests__/wp5_wp6_admin_tenant.api.test.ts` line ~755) to
 * always be written as NULL on the impersonation audit rows -- the real
 * impersonator identity is carried in `metadata.impersonatorUserId` instead,
 * on BOTH the platform row (tenant_id NULL, entity_type 'tenant') and the
 * shop-note row (tenant_id = target, entity_type 'session'). This spec
 * asserts the actual shipped contract (metadata), not the column.
 *
 * A super_admin cannot be created through the UI/REST (there is no signup
 * path for the platform realm) -- seeded directly in the shared e2e-web DB,
 * the same escape hatch `seedStaffUser` in fixtures.ts uses and documents for
 * staff users.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { hashPassword } from "@liratek/core";
import { test, expect, loginAsUser, BACKEND_URL } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(
  __dirname,
  "..",
  "..",
  "test-results",
  "e2e-web",
  "phone_shop.web.db",
);

/**
 * Seed a platform super_admin (tenant_id NULL) directly in the shared e2e-web
 * DB. No REST/UI path exists to create one (POST /api/admin/* all require an
 * EXISTING super_admin JWT) -- same rationale as `seedStaffUser` in
 * fixtures.ts, which this mirrors almost exactly.
 */
function seedSuperAdmin(username: string, password: string): void {
  const db = new Database(DB_PATH);
  try {
    db.prepare(
      `INSERT INTO users (tenant_id, username, password_hash, role, is_active)
       VALUES (NULL, ?, ?, 'super_admin', 1)`,
    ).run(username, hashPassword(password));
  } finally {
    db.close();
  }
}

type AuditRow = {
  id: number;
  tenant_id: number | null;
  user_id: number;
  role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  impersonator_id: number | null;
  metadata: string | null;
};

function queryAudit(
  tenantId: number | null,
  action: string,
  entityType: string,
): AuditRow[] {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const sql =
      tenantId === null
        ? `SELECT id, tenant_id, user_id, role, action, entity_type, entity_id, impersonator_id, metadata
           FROM audit_log WHERE tenant_id IS NULL AND action = ? AND entity_type = ?
           ORDER BY id DESC`
        : `SELECT id, tenant_id, user_id, role, action, entity_type, entity_id, impersonator_id, metadata
           FROM audit_log WHERE tenant_id = ? AND action = ? AND entity_type = ?
           ORDER BY id DESC`;
    return tenantId === null
      ? (db.prepare(sql).all(action, entityType) as AuditRow[])
      : (db.prepare(sql).all(tenantId, action, entityType) as AuditRow[]);
  } finally {
    db.close();
  }
}

function getUserId(username: string): number {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db
      .prepare(`SELECT id FROM users WHERE username = ?`)
      .get(username) as { id: number } | undefined;
    if (!row) throw new Error(`user not found: ${username}`);
    return row.id;
  } finally {
    db.close();
  }
}

test.describe("LIRA-099 — admin/impersonation", () => {
  test("super_admin provisions a tenant, impersonates it, the write is tenant-isolated, audited, and Disconnect returns to the super_admin context", async ({
    page,
    context,
  }) => {
    const ts = Date.now();
    const suUsername = `l099_root_${ts}`;
    const suPassword = "L099RootPass!1";
    seedSuperAdmin(suUsername, suPassword);

    const tenantName = `L099 Tenant ${ts}`;
    const tenantSlug = `l099-tenant-${ts}`;
    const tenantAdminUser = `l099_admin_${ts}`;
    const tenantAdminPass = "L099AdminPass!1";
    const partnerName = `L099 Partner ${ts}`;

    // ── 1. Super-admin login -> redirected into the control plane ──
    await loginAsUser(page, suUsername, suPassword);
    await expect(page).toHaveURL(/\/admin\/tenants/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible();

    // ── 2. Provision a tenant through the REAL AddTenantModal ──
    await page.getByRole("button", { name: "Add tenant" }).click();
    await page.getByPlaceholder("Acme Retail").fill(tenantName);
    // Slug auto-fills from the name via slugify(); overwrite with our own
    // unique one so two runs in the same millisecond-collision-unlikely but
    // still-deterministic window never collide on the UNIQUE constraint.
    await page.getByPlaceholder("acme-retail").fill(tenantSlug);
    await page.locator('label:has-text("Admin username") + input').fill(tenantAdminUser);
    await page
      .locator('label:has-text("Admin password") + input')
      .fill(tenantAdminPass);
    await page.getByRole("button", { name: "Create tenant" }).click();

    const tenantRow = page.locator("tbody tr").filter({ hasText: tenantName });
    await expect(tenantRow).toBeVisible({ timeout: 15_000 });
    await expect(tenantRow.getByText("active")).toBeVisible();

    // ── 3. "Connect as admin" -> real window.open() handoff ──
    const [impersonatedPage] = await Promise.all([
      context.waitForEvent("page"),
      tenantRow.getByRole("button", { name: /Connect as admin/i }).click(),
    ]);
    await impersonatedPage.waitForLoadState("domcontentloaded");

    // ImpersonationBanner (role="status") names the impersonated admin + tenant.
    const banner = impersonatedPage.getByRole("status");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText(tenantAdminUser);
    await expect(banner).toContainText(tenantName);

    const impersonationToken = await impersonatedPage.evaluate(() =>
      sessionStorage.getItem("liratek.impersonation"),
    );
    expect(impersonationToken).toBeTruthy();
    const impersonationAuth = {
      Authorization: `Bearer ${impersonationToken as string}`,
    };

    // ── 4. A write made under impersonation: create a partner over REST,
    // same page-driven pattern lira-web-008 uses, now under the
    // impersonated tenant's own token. ──
    const created = await (
      await impersonatedPage.request.post(`${BACKEND_URL}/api/partners`, {
        headers: impersonationAuth,
        data: { name: partnerName, phone: "03999111" },
      })
    ).json();
    expect(created.success, JSON.stringify(created)).toBeTruthy();

    // UI round-trip: the impersonated tab's own /partners page renders it.
    await impersonatedPage.goto("/#/partners");
    await expect(
      impersonatedPage.locator("#root"),
    ).not.toContainText("Something went wrong");
    await expect(impersonatedPage.getByText(partnerName).first()).toBeVisible({
      timeout: 15_000,
    });

    // ── 5. Isolation: tenant 1's admin (a DIFFERENT tenant) must never see
    // the new tenant's partner. ──
    const tenant1Token = await page.evaluate(async () => {
      const res = await fetch(
        `${(globalThis as unknown as { __LIRATEK_BACKEND_URL: string }).__LIRATEK_BACKEND_URL}/api/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "admin", password: "admin123" }),
        },
      );
      const body = await res.json();
      return body.data.token as string;
    });
    const tenant1Partners = await (
      await page.request.get(`${BACKEND_URL}/api/partners`, {
        headers: { Authorization: `Bearer ${tenant1Token}` },
      })
    ).json();
    const tenant1Names: string[] = (
      tenant1Partners.partners ?? []
    ).map((p: { name: string }) => p.name);
    expect(tenant1Names).not.toContain(partnerName);

    // ── 6. Audit trail — the SHIPPED contract (B-D3): impersonator_id is
    // always NULL on these rows; the real actor lives in metadata. ──
    const superAdminId = getUserId(suUsername);

    // Platform row: tenant_id NULL, actor = the super admin's own identity.
    const platformRows = queryAudit(null, "IMPERSONATION_START", "tenant");
    const platformRow = platformRows.find(
      (r) => r.user_id === superAdminId && r.role === "super_admin",
    );
    expect(
      platformRow,
      `no platform IMPERSONATION_START row for super admin #${superAdminId}; rows: ${JSON.stringify(platformRows)}`,
    ).toBeTruthy();

    // Shop-note row: lives in the TARGET tenant's own tenant_id scope.
    // tenantRow's href/id isn't exposed in the DOM, so recover the tenant id
    // from the tenant-admin's own user row (unique username, just seeded).
    const tenantAdminId = getUserId(tenantAdminUser);
    const db = new Database(DB_PATH, { readonly: true });
    const tenantIdRow = db
      .prepare(`SELECT tenant_id FROM users WHERE id = ?`)
      .get(tenantAdminId) as { tenant_id: number };
    db.close();
    const targetTenantId = tenantIdRow.tenant_id;

    const shopRows = queryAudit(targetTenantId, "IMPERSONATION_START", "session");
    const shopRow = shopRows.find((r) => r.user_id === tenantAdminId);
    expect(
      shopRow,
      `no shop-note IMPERSONATION_START row for tenant admin #${tenantAdminId}; rows: ${JSON.stringify(shopRows)}`,
    ).toBeTruthy();
    expect(shopRow!.impersonator_id).toBeNull();
    const meta = JSON.parse(shopRow!.metadata ?? "{}") as {
      impersonatorUserId?: number;
    };
    expect(meta.impersonatorUserId).toBe(superAdminId);

    // ── 7. Disconnect -> impersonated tab drops to /login; the ORIGINAL
    // super-admin tab (separate localStorage session, never touched) stays
    // authenticated in its own control-plane context. ──
    await banner.getByRole("button", { name: "Disconnect" }).click();
    await expect(impersonatedPage).toHaveURL(/\/login/, { timeout: 15_000 });

    await page.reload();
    await expect(page).toHaveURL(/\/admin\/tenants/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible();

    await impersonatedPage.close();
  });
});
