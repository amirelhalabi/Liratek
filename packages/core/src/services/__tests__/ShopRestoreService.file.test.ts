/**
 * LIRA-377 T037 — the checks on an UPLOADED backup file (research R9,
 * FR-006/FR-007), through `ShopRestoreService.prepareFile`. Written FIRST
 * against a stub (rule 17).
 *
 * The upload is a real "Download backup" file (`buildTenantBackupFile`) of
 * shop 3 — deliberately not shop 1, so a check that silently assumes the
 * desktop's tenant 1 is caught — then tampered with per case. After every
 * refusal the live shop file is byte-identical and the work dir is empty.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { closeDatabase, initDatabase } from "../../db/connection.js";
import { MIGRATIONS, rollbackTo, runMigrations } from "../../db/migrations/index.js";
import { buildTenantBackupFile } from "../../db/tenantSnapshot.js";
import { ShopRestoresRepository } from "../../repositories/ShopRestoresRepository.js";
import { ShopRestoreRepository } from "../../repositories/ShopRestoreRepository.js";
import { ShopRestoreFileRepository } from "../../repositories/ShopRestoreFileRepository.js";
import type { ShopFilePort } from "../restorePorts.js";
import { ShopRestoreService, type RestoreActor } from "../ShopRestoreService.js";

const CREATE_DB_SQL = fs.readFileSync(path.join(__dirname, "../../../../../electron-app/create_db.sql"), "utf-8");
const SHOP = 3;
const SHOP_NAME = "Corner Tech";
const LATEST = Math.max(...MIGRATIONS.map((m) => m.version));

let tmp: string;
let template: string;
let platform: Database.Database;
let dirs: { tenantsDir: string; workDir: string; pointsDir: string };
let live: string;
let liveBytes: Buffer;
let backup: string;
let service: ShopRestoreService;
let restores: ShopRestoresRepository;

const NOW = new Date(Date.now() + 60_000).toISOString();
const actor = (): RestoreActor => ({ tenantId: SHOP, userId: 1, username: "admin", role: "admin", now: NOW });

function tenantScopedTables(db: Database.Database): string[] {
  const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((r) => r.name);
  return names.filter((t) => (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).some((c) => c.name === "tenant_id"));
}

function makeShopFile(file: string, tenantId: number, name: string): void {
  fs.copyFileSync(template, file);
  const db = new Database(file);
  db.pragma("foreign_keys = OFF");
  db.exec(`DELETE FROM tenant_subscriptions`);
  for (const t of tenantScopedTables(db)) db.prepare(`UPDATE "${t}" SET tenant_id = ? WHERE tenant_id IS NOT NULL`).run(tenantId);
  db.prepare(`UPDATE tenants SET id = ?, name = ?, slug = ?`).run(tenantId, name, `shop-${tenantId}`);
  db.close();
}

let uploads = 0;
/** A copy of the clean backup, edited by `edit` (foreign keys off). */
function upload(edit?: (db: Database.Database) => void): string {
  uploads += 1;
  const p = path.join(dirs.workDir, `${SHOP}-${uploads}.upload`);
  fs.mkdirSync(dirs.workDir, { recursive: true });
  fs.copyFileSync(backup, p);
  if (edit) {
    const db = new Database(p);
    db.pragma("foreign_keys = OFF");
    edit(db);
    db.close();
  }
  return p;
}

const workFiles = (): string[] => (fs.existsSync(dirs.workDir) ? fs.readdirSync(dirs.workDir) : []);

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-restore-file-"));
  template = path.join(tmp, "template.db");
  const t = new Database(template);
  t.exec(CREATE_DB_SQL);
  initDatabase(t);
  runMigrations(t);
  closeDatabase();
  t.close();

  platform = new Database(":memory:");
  platform.exec(CREATE_DB_SQL);
  initDatabase(platform);
  runMigrations(platform);
  platform
    .prepare(`INSERT INTO tenants (id, name, slug, status, contact_email, created_at, updated_at) VALUES (?, ?, 'cornertech', 'active', 'owner@cornertech.test', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`)
    .run(SHOP, SHOP_NAME);

  dirs = { tenantsDir: path.join(tmp, "tenants"), workDir: path.join(tmp, "restore-work"), pointsDir: path.join(tmp, "restore-points") };
  fs.mkdirSync(dirs.tenantsDir, { recursive: true });
  live = path.join(dirs.tenantsDir, `${SHOP}.db`);
  makeShopFile(live, SHOP, SHOP_NAME);
  const liveDb = new Database(live);
  liveDb.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (?, 'In the backup', '701')`).run(SHOP);
  backup = path.join(tmp, "backup.db");
  buildTenantBackupFile({ tenantId: SHOP, destPath: backup, sourceDb: liveDb });
  liveDb.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (?, 'After the backup', '702')`).run(SHOP);
  liveDb.close();
  liveBytes = fs.readFileSync(live);

  const shopFile: ShopFilePort = {
    async migrateCandidate(p) {
      const db = new Database(p);
      runMigrations(db);
      db.close();
    },
    async swap() {
      throw new Error("not used here");
    },
  };
  restores = new ShopRestoresRepository();
  service = new ShopRestoreService({
    restores,
    candidates: new ShopRestoreRepository(),
    files: new ShopRestoreFileRepository(),
    ports: {
      shopFile,
      source: {
        async fetchAt() {
          throw new Error("not used here");
        },
      },
      dirs,
      createDbSql: () => CREATE_DB_SQL,
    },
    userEmail: () => null,
    audit: () => undefined,
    syncDirectory: () => undefined,
    enqueueEmail: () => undefined,
  });
});

afterAll(() => {
  closeDatabase();
  platform.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  platform.exec(`DELETE FROM shop_restores`);
});

afterEach(() => {
  expect(fs.readFileSync(live).equals(liveBytes)).toBe(true);
});

describe("prepareFile — refusals (FR-006)", () => {
  async function refused(p: string) {
    const out = await service.prepareFile(actor(), { uploadPath: p, clientTzOffsetMin: 120 });
    expect(out.ok).toBe(false);
    expect(workFiles()).toEqual([]);
    expect(restores.getOpenForTenant(SHOP)).toBeNull();
    return out;
  }

  it("a text file is NOT_A_SHOP_FILE", async () => {
    const p = path.join(dirs.workDir, "x.upload");
    fs.mkdirSync(dirs.workDir, { recursive: true });
    fs.writeFileSync(p, "hello, this is not a database at all".repeat(100));
    expect(await refused(p)).toMatchObject({ code: "NOT_A_SHOP_FILE" });
  });

  it("an SQLite file that is not a shop (no tenants table) is NOT_A_SHOP_FILE", async () => {
    const p = path.join(dirs.workDir, "y.upload");
    fs.mkdirSync(dirs.workDir, { recursive: true });
    const db = new Database(p);
    db.exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)`);
    db.close();
    expect(await refused(p)).toMatchObject({ code: "NOT_A_SHOP_FILE" });
  });

  it("a damaged file (valid header, broken pages) is FILE_DAMAGED", async () => {
    const p = upload();
    const buf = fs.readFileSync(p);
    buf.fill(0x5a, 4096 * 3, Math.min(buf.length, 4096 * 40));
    fs.writeFileSync(p, buf);
    expect(await refused(p)).toMatchObject({ code: "FILE_DAMAGED" });
  });

  it("another shop's file is OTHER_SHOP and names that shop", async () => {
    const p = upload((db) => {
      for (const t of tenantScopedTables(db)) db.prepare(`UPDATE "${t}" SET tenant_id = 4 WHERE tenant_id IS NOT NULL`).run();
      db.prepare(`UPDATE tenants SET id = 4, name = 'Rival Phones'`).run();
    });
    expect(await refused(p)).toMatchObject({ code: "OTHER_SHOP", shopName: "Rival Phones" });
  });

  it("a file with two tenants rows is MIXED_SHOPS", async () => {
    const p = upload((db) => db.prepare(`INSERT INTO tenants (id, name, slug, status) VALUES (4, 'Rival Phones', 'rival', 'active')`).run());
    expect(await refused(p)).toMatchObject({ code: "MIXED_SHOPS" });
  });

  it("a file with a row of another shop is MIXED_SHOPS", async () => {
    const p = upload((db) => db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (4, 'Not ours', '709')`).run());
    expect(await refused(p)).toMatchObject({ code: "MIXED_SHOPS" });
  });

  it("a file from a newer app version is NEWER_VERSION", async () => {
    const p = upload((db) => db.prepare(`INSERT INTO schema_migrations (version, name) VALUES (?, 'from_the_future')`).run(LATEST + 1));
    expect(await refused(p)).toMatchObject({ code: "NEWER_VERSION" });
  });

  it("a planted trigger is UNEXPECTED_SCHEMA_OBJECT", async () => {
    const p = upload((db) =>
      db.exec(`CREATE TRIGGER steal_after_restore AFTER INSERT ON clients BEGIN UPDATE users SET role = 'admin'; END`),
    );
    expect(await refused(p)).toMatchObject({ code: "UNEXPECTED_SCHEMA_OBJECT" });
  });

  it("a planted view is UNEXPECTED_SCHEMA_OBJECT", async () => {
    const p = upload((db) => db.exec(`CREATE VIEW everything AS SELECT * FROM users`));
    expect(await refused(p)).toMatchObject({ code: "UNEXPECTED_SCHEMA_OBJECT" });
  });
});

describe("prepareFile — accepted", () => {
  it("this shop's own backup: prepared, restoredTo = the file's last write, candidate carries the file's data", async () => {
    const p = upload();
    const out = await service.prepareFile(actor(), { uploadPath: p, clientTzOffsetMin: 120 });
    if (!out.ok) throw new Error(`refused: ${out.code} ${out.message}`);
    expect(out.data.shopName).toBe(SHOP_NAME);
    expect(out.data.preview.restoredTo).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    expect(Date.parse(out.data.preview.restoredTo)).toBeLessThanOrEqual(Date.parse(NOW));
    const row = restores.getById(out.data.restoreId)!;
    expect(row).toMatchObject({ kind: "file", status: "prepared", restored_to: out.data.preview.restoredTo });
    expect(fs.existsSync(p)).toBe(false); // the upload became the candidate
    const cand = new Database(row.candidate_path!, { readonly: true });
    try {
      expect((cand.prepare(`SELECT full_name FROM clients ORDER BY id`).all() as { full_name: string }[]).map((r) => r.full_name)).toEqual(["In the backup"]);
    } finally {
      cand.close();
    }
    service.cancel(actor(), { restoreId: out.data.restoreId });
  });

  it("Litestream's own tables (_litestream_seq/_lock, in every replicated file) are neither MIXED_SHOPS nor UNEXPECTED", async () => {
    const p = upload((db) => {
      db.exec(`CREATE TABLE _litestream_seq (id INTEGER PRIMARY KEY, seq INTEGER); INSERT INTO _litestream_seq VALUES (1, 42);`);
      db.exec(`CREATE TABLE _litestream_lock (id INTEGER); INSERT INTO _litestream_lock VALUES (1);`);
    });
    const out = await service.prepareFile(actor(), { uploadPath: p, clientTzOffsetMin: 0 });
    if (!out.ok) throw new Error(`refused: ${out.code} ${out.message}`);
    service.cancel(actor(), { restoreId: out.data.restoreId });
  });

  it("a file from an older app version is brought up to date and accepted (FR-007)", async () => {
    const p = upload((db) => rollbackTo(db, LATEST - 1));
    const out = await service.prepareFile(actor(), { uploadPath: p, clientTzOffsetMin: 0 });
    if (!out.ok) throw new Error(`refused: ${out.code} ${out.message}`);
    const row = restores.getById(out.data.restoreId)!;
    const cand = new Database(row.candidate_path!, { readonly: true });
    try {
      expect((cand.prepare(`SELECT MAX(version) AS v FROM schema_migrations`).get() as { v: number }).v).toBe(LATEST);
    } finally {
      cand.close();
    }
    service.cancel(actor(), { restoreId: out.data.restoreId });
  });
});
