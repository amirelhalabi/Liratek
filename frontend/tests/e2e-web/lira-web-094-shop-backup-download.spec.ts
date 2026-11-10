/**
 * Settings › Backup (web app) — a shop admin downloads a SQLite file of
 * THEIR OWN shop, and the file really holds only that shop.
 *
 * Opens Settings → Backup as the seeded admin (shop 1, slug "default"),
 * saves the What's new screenshot (rule 30), clicks Download, captures the
 * browser download, then opens the file with better-sqlite3 and checks it
 * independently of the builder's own self-check:
 *  - `integrity_check` = ok;
 *  - every table with a `tenant_id` column holds ONLY shop 1's rows — no
 *    other shop, and no NULL either: NULL-tenant rows are platform rows (the
 *    `superadmin` user has tenant_id NULL), which never belong to a shop;
 *  - tables without `tenant_id`: `tenants` is exactly shop 1's row,
 *    `schema_migrations` may hold rows, every other one is empty (the list is
 *    hard-coded here on purpose, so a widened allowlist in core fails here);
 *  - `sessions` is empty — the login this spec just made wrote one.
 *
 * The web DB normally holds ONE shop, which would make the "only my shop"
 * check vacuous (rule 28a). So a canary second shop with a client is seeded
 * straight into the shared DB before the download and removed afterwards;
 * its slug and client name must not appear anywhere in the file.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { test, expect, loginAsAdmin, gotoAndSettle } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(
  __dirname,
  "..",
  "..",
  "test-results",
  "e2e-web",
  "phone_shop.web.db",
);
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/shop-backup-download.png",
);

const OWN_TENANT_ID = 1;
const OWN_SLUG = "default";
const CANARY_SLUG = "e2e-backup-canary-shop";
const CANARY_CLIENT = "E2E Backup Canary Client";
/** Tables WITHOUT tenant_id that may hold rows in a backup. */
const GLOBAL_TABLES_WITH_ROWS = new Set(["tenants", "schema_migrations"]);

function removeCanary(db: Database.Database): void {
  const row = db
    .prepare(`SELECT id FROM tenants WHERE slug = ?`)
    .get(CANARY_SLUG) as { id: number } | undefined;
  if (!row) return;
  db.prepare(`DELETE FROM clients WHERE tenant_id = ?`).run(row.id);
  db.prepare(`DELETE FROM tenants WHERE id = ?`).run(row.id);
}

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

test("shop backup: Settings → Backup downloads only this shop's data", async ({
  page,
}, testInfo) => {
  const db = new Database(DB_PATH);
  let canaryId = 0;
  try {
    // A leftover from an aborted earlier run would otherwise collide on slug.
    removeCanary(db);
    canaryId = Number(
      db
        .prepare(`INSERT INTO tenants (name, slug) VALUES (?, ?)`)
        .run("E2E Backup Canary", CANARY_SLUG).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (?, ?, ?)`,
    ).run(canaryId, CANARY_CLIENT, "70999094");
    expect(canaryId).not.toBe(OWN_TENANT_ID);

    await loginAsAdmin(page);
    // Landscape for the What's new card. The tab bar scrolls sideways and
    // brings the active tab into view. Opened by address so no hover
    // highlight is left on the tab in the screenshot; `?tab=` is read only
    // when Settings mounts, so go there directly.
    await page.setViewportSize({ width: 1760, height: 900 });
    await gotoAndSettle(page, "/#/settings?tab=backup");
    await expect(
      page.getByRole("button", { name: "Backup", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("heading", { name: "Download backup" }),
    ).toBeVisible({ timeout: 15_000 });
    const downloadButton = page.getByRole("button", {
      name: "Download backup",
      exact: true,
    });
    await expect(downloadButton).toBeEnabled();

    // Pointer off the tab bar, so no hover highlight in the screenshot.
    await page.mouse.move(1700, 880);
    mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
    await page.screenshot({ path: SCREENSHOT });

    const namePattern = new RegExp(
      `^liratek-${OWN_SLUG}-\\d{4}-\\d{2}-\\d{2}-\\d{4}\\.db$`,
    );
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/backup/download"),
      { timeout: 30_000 },
    );
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await downloadButton.click();
    const response = await responsePromise;
    const download = await downloadPromise;

    // The server names the file (shop slug + the browser's local stamp)…
    const headers = await response.allHeaders();
    const serverName = /filename="?([^";]+)"?/i.exec(
      headers["content-disposition"] ?? "",
    )?.[1];
    expect(serverName).toMatch(namePattern);
    // …and the browser must save it under that same name. Soft, so the data
    // checks below still run if only the name is wrong.
    const fileName = download.suggestedFilename();
    expect
      .soft(
        fileName,
        `saved name must be the server's; Access-Control-Expose-Headers was "${headers["access-control-expose-headers"] ?? ""}"`,
      )
      .toBe(serverName);
    await expect(page.getByRole("alert")).toHaveCount(0);

    const saved = testInfo.outputPath(fileName);
    await download.saveAs(saved);

    const copy = new Database(saved, { readonly: true, fileMustExist: true });
    try {
      expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");

      const tables = (
        copy
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
          )
          .all() as { name: string }[]
      ).map((r) => r.name);
      expect(tables.length).toBeGreaterThan(50);

      const foreign: string[] = [];
      const unexpectedGlobal: string[] = [];
      let scopedTables = 0;
      let ownRows = 0;
      for (const table of tables) {
        const cols = (
          copy.prepare(`PRAGMA table_info(${quote(table)})`).all() as {
            name: string;
          }[]
        ).map((c) => c.name);
        if (cols.includes("tenant_id")) {
          scopedTables++;
          const bad = (
            copy
              .prepare(
                `SELECT COUNT(*) AS c FROM ${quote(table)} WHERE tenant_id IS NULL OR tenant_id != ?`,
              )
              .get(OWN_TENANT_ID) as { c: number }
          ).c;
          if (bad > 0) foreign.push(`${table}: ${bad}`);
          ownRows += (
            copy.prepare(`SELECT COUNT(*) AS c FROM ${quote(table)}`).get() as {
              c: number;
            }
          ).c;
        } else if (!GLOBAL_TABLES_WITH_ROWS.has(table)) {
          const n = (
            copy.prepare(`SELECT COUNT(*) AS c FROM ${quote(table)}`).get() as {
              c: number;
            }
          ).c;
          if (n > 0) unexpectedGlobal.push(`${table}: ${n}`);
        }
      }
      expect(foreign, "rows of another shop or of the platform").toEqual([]);
      expect(unexpectedGlobal, "rows in tables without tenant_id").toEqual([]);
      expect(scopedTables).toBeGreaterThan(50);
      // The shop's own data is really there (not an empty-but-valid file).
      expect(ownRows).toBeGreaterThan(0);

      expect(copy.prepare(`SELECT id, slug FROM tenants`).all()).toEqual([
        { id: OWN_TENANT_ID, slug: OWN_SLUG },
      ]);
      expect(
        (copy.prepare(`SELECT COUNT(*) AS c FROM sessions`).get() as { c: number })
          .c,
      ).toBe(0);

      // The canary shop and the platform's own user never ride along.
      expect(
        copy
          .prepare(`SELECT COUNT(*) AS c FROM clients WHERE full_name = ?`)
          .get(CANARY_CLIENT),
      ).toEqual({ c: 0 });
      expect(
        copy
          .prepare(`SELECT COUNT(*) AS c FROM users WHERE username = 'superadmin'`)
          .get(),
      ).toEqual({ c: 0 });
      expect(
        copy
          .prepare(`SELECT COUNT(*) AS c FROM users WHERE username = 'admin'`)
          .get(),
      ).toEqual({ c: 1 });
    } finally {
      copy.close();
    }
  } finally {
    removeCanary(db);
    db.close();
  }
});
