/**
 * ADVERSARIAL REHEARSAL, PART A (core-flavored jest — REAL better-sqlite3).
 * Lives under `scripts/rehearsal/phase-d/`, run explicitly via
 * `jest.core.config.cjs` in this same folder — see `README.md` here for the
 * command. NOT part of `yarn test`/CI: this folder is outside both
 * `packages/core/jest.config.cjs`'s and `backend/jest.config.cjs`'s `roots`.
 * (Backend's jest config globally mocks bare `"better-sqlite3"` imports,
 * which would silently turn `splitTenantDatabase()` into a no-op that still
 * reports `ok: true` with empty findings if this ran under it instead — see
 * this rehearsal's report for that finding in detail.)
 *
 * Builds a "production-like" shared DB from a COPY of the real desktop DB
 * (tenant 1 = CornerTech), adds a second tenant via the app's own
 * provisioning code, snapshots it, dry-runs then really runs the Phase D
 * split tool, and writes a manifest to a fixed scratch path so the backend
 * half of this rehearsal (`runbook.phaseD.rehearsal.test.ts`, same folder)
 * can pick up the split output and continue with HTTP-level verification.
 *
 * Scratch test file — not part of the guarded suite. Never touches the real
 * `~/Documents/LiraTek/liratek.db`; only ever reads a pre-made COPY of it
 * (see `README.md` in this folder for how to place it) and writes new files
 * under a jest temp dir plus one fixed manifest path (`scratchPaths.ts`,
 * shared with Part B so the two files can't drift onto different paths).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import {
  runMigrations,
  hashPassword,
  getTenantProvisioningService,
  getClientService,
  getAuthService,
  runWithTenant,
  resetUserRepository,
  resetSessionRepository,
  resetAuthService,
  resetTenantRepository,
  resetSubscriptionRepository,
  resetTenantProvisioningService,
  resetClientRepository,
  resetClientService,
  splitTenantDatabase,
  checkPlatformSplitStatus,
} from "../../../packages/core/src/index.js";
import { DESKTOP_DB_COPY, MANIFEST_PATH } from "./scratchPaths.js";

jest.setTimeout(60_000);

const TENANT1_KNOWN_PASSWORD = "OwnerKnownPass1!";
const TENANT5_ADMIN_USERNAME = "shop5admin";
const TENANT5_ADMIN_PASSWORD = "Shop5AdminPass1!";
const TENANT5_SLUG = "shop-five";
const KEY_TABLES = ["sales", "transactions", "payments", "clients", "products", "users"];

function configureConnection(db: InstanceType<typeof Database>): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
}

describe("Phase D rehearsal (core half) — production-like DB, snapshot, dry-run + real split", () => {
  let rootDir: string;
  let sharedDbPath: string;
  let preSplitBackupPath: string;

  beforeAll(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "phaseD-core-rehearsal-"));
    sharedDbPath = path.join(rootDir, "liratek-production-like.db");
    fs.copyFileSync(DESKTOP_DB_COPY, sharedDbPath);
  });

  it("builds the production-like DB, provisions tenant 5, snapshots, dry-runs then really splits — writes a manifest for the backend half", () => {
    const db = new Database(sharedDbPath);
    configureConnection(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;

    resetUserRepository();
    resetSessionRepository();
    resetAuthService();
    resetTenantRepository();
    resetSubscriptionRepository();
    resetTenantProvisioningService();
    resetClientRepository();
    resetClientService();

    runMigrations(db);

    // Known password on an existing tenant-1 admin ("owner") — real
    // password unknown to this session; this is a throwaway copy.
    db.prepare(
      `UPDATE users SET password_hash = ? WHERE username = 'owner' AND tenant_id = 1`,
    ).run(hashPassword(TENANT1_KNOWN_PASSWORD));

    const preSplitCounts: Record<string, number> = {};
    for (const t of KEY_TABLES) {
      const row = db.prepare(`SELECT COUNT(*) c FROM "${t}" WHERE tenant_id = 1`).get() as {
        c: number;
      };
      preSplitCounts[t] = row.c;
    }
    expect(preSplitCounts.users).toBe(3);
    expect(preSplitCounts.clients).toBe(1);

    // Provision tenant 5 (production's real second shop, per the plan
    // header) via the ACTUAL app provisioning service — shared mode's
    // default SharedTenantStorageProvisioner (no override installed).
    const svc = getTenantProvisioningService();
    const tenant5 = svc.provisionTenant({
      name: "Test Shop Five",
      slug: TENANT5_SLUG,
      adminUsername: TENANT5_ADMIN_USERNAME,
      adminPassword: TENANT5_ADMIN_PASSWORD,
    });
    const tenant5Id = tenant5.id;

    // FINDING (not a runbook defect, a rehearsal-fidelity note): a desktop
    // install that has only ever run as tenant 1 assigns the NEXT provisioned
    // tenant id 2, not 5 — the plan doc's own "ids 1 and 5" is explicitly
    // flagged there as an unverified assumption about the REAL production
    // registry's history (prior deleted/failed provisioning attempts consumed
    // 2-4), which this local rehearsal cannot reproduce. Recorded, not
    // asserted to a specific value.

    const tenant5AdminUserRow = db
      .prepare(`SELECT id FROM users WHERE tenant_id = ? AND username = ?`)
      .get(tenant5Id, TENANT5_ADMIN_USERNAME) as { id: number };
    runWithTenant(tenant5Id, () => {
      getClientService().createClient(
        { full_name: "Shop Five Test Client", phone_number: "70999888" },
        tenant5AdminUserRow.id,
      );
    });

    // Pre-split session, minted via the SAME AuthService.login() the HTTP
    // route calls — proves a real, app-code-produced session exists before
    // the split, for the backend half to reconstruct a JWT around and test
    // post-split validity.
    const authService = getAuthService();
    const loginResult = runWithTenant(1, () =>
      authService.login("owner", TENANT1_KNOWN_PASSWORD, {
        realm: 1,
        deviceType: "web",
      }),
    ) as unknown as Promise<{
      success: boolean;
      token?: string;
      user?: { id: number; role: string; tenant_id: number | null };
    }>;

    return loginResult.then((login) => {
      expect(login.success).toBe(true);
      const preSplitSessionToken = login.token!;
      const preSplitUserId = login.user!.id;
      const preSplitRole = login.user!.role;

      db.close();
      delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;

      // ── Step 1 (§ 12.4 step 2): snapshot ──
      preSplitBackupPath = path.join(rootDir, "liratek.db.pre-split-backup");
      const src = new Database(sharedDbPath, { readonly: true });
      src.exec(`VACUUM INTO '${preSplitBackupPath.replace(/\\/g, "/")}'`);
      src.close();
      expect(fs.existsSync(preSplitBackupPath)).toBe(true);

      // ── Step 2 (§ 12.4 step 3): dry run ──
      const dryOut = path.join(rootDir, "split-dry-out");
      const dryReport = splitTenantDatabase({
        sourceDbPath: preSplitBackupPath,
        outputDir: dryOut,
        write: false,
      });
      expect(dryReport.dryRun).toBe(true);
      expect(dryReport.tenantIds.sort()).toEqual([1, tenant5Id].sort());
      expect(dryReport.ok).toBe(true);
      expect(dryReport.unexpectedGlobalRows).toEqual([]);
      expect(dryReport.unsafeTableNames).toEqual([]);
      expect(dryReport.unexpectedTablesWithoutTenantId).toEqual([]);

      // ── Step 3 (§ 12.4 step 4): real split ──
      const realOut = path.join(rootDir, "split-out");
      const realReport = splitTenantDatabase({
        sourceDbPath: preSplitBackupPath,
        outputDir: realOut,
        write: true,
      });
      if (!realReport.ok) {
        // eslint-disable-next-line no-console
        console.error("DEBUG realReport", JSON.stringify(realReport, null, 2));
      }
      expect(realReport.ok).toBe(true);
      expect(realReport.mismatches).toEqual([]);
      for (const fc of realReport.fileChecks) {
        expect(fc.foreignKeyViolations).toBe(0);
        expect(fc.integrityCheck).toBe("ok");
      }

      // Independent count check (not trusting the tool's own verifiedCounts).
      for (const t of KEY_TABLES) {
        const checkDb = new Database(realReport.tenantFiles[1], { readonly: true });
        const row = checkDb.prepare(`SELECT COUNT(*) c FROM "${t}"`).get() as { c: number };
        checkDb.close();
        expect(row.c).toBe(preSplitCounts[t]);
      }

      // ── Move into place (§ 12.4 step 5), translated to scratch paths ──
      const dataDir = path.join(rootDir, "data");
      const tenantsDir = path.join(dataDir, "tenants");
      fs.mkdirSync(tenantsDir, { recursive: true });
      const platformDbPath = path.join(dataDir, "liratek.db");
      fs.renameSync(realReport.platformFile, platformDbPath);
      fs.renameSync(realReport.tenantFiles[1], path.join(tenantsDir, "1.db"));
      fs.renameSync(realReport.tenantFiles[tenant5Id], path.join(tenantsDir, `${tenant5Id}.db`));

      // ── Safety lock on the MOVED platform file: splitRequired false ──
      const movedPlatformDb = new Database(platformDbPath, { readonly: true });
      const statusAfter = checkPlatformSplitStatus(movedPlatformDb);
      movedPlatformDb.close();
      expect(statusAfter.splitRequired).toBe(false);
      expect(statusAfter.totalRows).toBe(0);

      // ── Companion: safety lock on an UNSPLIT copy (never split at all) ──
      const unsplitDir = path.join(rootDir, "unsplit-scenario");
      fs.mkdirSync(unsplitDir, { recursive: true });
      const unsplitPath = path.join(unsplitDir, "liratek.db");
      fs.copyFileSync(DESKTOP_DB_COPY, unsplitPath);
      const unsplitDb = new Database(unsplitPath);
      configureConnection(unsplitDb);
      runMigrations(unsplitDb);
      const statusUnsplit = checkPlatformSplitStatus(unsplitDb);
      unsplitDb.close();
      expect(statusUnsplit.splitRequired).toBe(true);
      expect(statusUnsplit.totalRows).toBeGreaterThan(0);
      expect(statusUnsplit.tablesWithShopRows.some((t) => t.table === "clients")).toBe(true);

      // ── Write the manifest for the backend half ──
      fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
      fs.writeFileSync(
        MANIFEST_PATH,
        JSON.stringify(
          {
            rootDir,
            dataDir,
            tenantsDir,
            platformDbPath,
            preSplitBackupPath,
            unsplitPath,
            tenant1Id: 1,
            tenant5Id,
            tenant5Slug: TENANT5_SLUG,
            tenant1KnownPassword: TENANT1_KNOWN_PASSWORD,
            tenant5AdminUsername: TENANT5_ADMIN_USERNAME,
            tenant5AdminPassword: TENANT5_ADMIN_PASSWORD,
            preSplitCounts,
            preSplitSessionToken,
            preSplitUserId,
            preSplitRole,
          },
          null,
          2,
        ),
      );

      // NOTE: rootDir is deliberately NOT cleaned up here — the backend half
      // needs these files to still exist. It is under os.tmpdir() and is
      // small (a handful of ~1.3MB sqlite files); left for manual/OS cleanup.
    });
  });
});
