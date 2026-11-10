/**
 * LIRA-377 T006/T007 — migration v231 `shop_restores`:
 *  (a) creates the platform-only `shop_restores` table (data-model §1) with
 *      its CHECKs, its `(target_tenant_id, id DESC)` index and the partial
 *      unique index that allows at most ONE open restore per shop;
 *  (b) rebuilds `offline_review_items` so its `kind` CHECK also accepts
 *      `restore_removed`, keeping every row, every FK and every index.
 *
 * Driven through the real runner (`runMigrations` / `rollbackTo`, FKs off
 * outside the transaction, as in production) on the real fresh-install
 * schema: create_db.sql -> rollbackTo(230) -> runMigrations -> rollbackTo(230)
 * so both `down()` paths (fresh-schema table and rebuilt table) run.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS, rollbackTo, runMigrations } from "../index";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const NOW = "2026-11-10T10:00:00.000Z";

function fkList(db: Database.Database) {
  return db.prepare(`PRAGMA foreign_key_list(offline_review_items)`).all();
}

function reviewIndexes(db: Database.Database): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'index' AND tbl_name = 'offline_review_items' AND sql IS NOT NULL
          ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) !== undefined
  );
}

function reviewRows(db: Database.Database) {
  return db
    .prepare(
      `SELECT id, tenant_id, event_row_id, device_id, kind, state, details_json,
              resolved_by, resolved_at, created_at, updated_at
         FROM offline_review_items ORDER BY id`,
    )
    .all();
}

function insertReview(db: Database.Database, device: number, kind: string, eventRowId: number | null = null) {
  return db
    .prepare(
      `INSERT INTO offline_review_items (tenant_id, event_row_id, device_id, kind, state, details_json, created_at, updated_at)
       VALUES (1, ?, ?, ?, 'open', '{}', ?, ?)`,
    )
    .run(eventRowId, device, kind, NOW, NOW);
}

function insertRestore(db: Database.Database, tenant: number, status: string, kind = "time") {
  return db
    .prepare(
      `INSERT INTO shop_restores (target_tenant_id, kind, status, restored_to, client_tz_offset_min,
         requested_by_user_id, requested_by_name, prepared_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 120, 1, 'Owner', ?, ?, ?)`,
    )
    .run(tenant, kind, status, NOW, NOW, NOW, NOW);
}

let db: Database.Database;
let device: number;
let eventRow: number;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  rollbackTo(db, 230);
  db.exec(`INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (2, 'Other', 'other', 'active')`);
  device = Number(
    db
      .prepare(
        `INSERT INTO offline_devices (tenant_id, device_no, name, key_id, key_hash, paired_by, paired_at, created_at, updated_at)
         VALUES (1, 1, 'PC', 'aaaaaaaaaaaa', 'h', 1, ?, ?, ?)`,
      )
      .run(NOW, NOW, NOW).lastInsertRowid,
  );
  eventRow = Number(
    db
      .prepare(
        `INSERT INTO offline_events (tenant_id, device_id, event_id, device_seq, channel, payload_json, payload_hash,
           actor_user_id, occurred_at, client_day, client_tz_offset_minutes, copy_id, app_version, schema_version,
           schema_shape_json, rates_json, created_json, depends_on_json, status, created_at, updated_at)
         VALUES (1, ?, 'e1', 1, 'sales:process', '{}', 'h', 1, ?, '2026-11-10', 120, 'c', '1.0.0', 230, '{}', '{}', '{}', '[]', 'held', ?, ?)`,
      )
      .run(device, NOW, NOW, NOW).lastInsertRowid,
  );
  insertReview(db, device, "possible_duplicate", eventRow);
  insertReview(db, device, "rate_changed");
});
afterEach(() => db.close());

describe("v231 shop_restores", () => {
  it("is the migration directly after v230", () => {
    const i = MIGRATIONS.findIndex((m) => m.version === 231);
    expect(i).toBeGreaterThan(0);
    expect(MIGRATIONS[i].name).toBe("shop_restores");
    expect(MIGRATIONS[i - 1].version).toBe(230);
  });

  it("before v231: no shop_restores and restore_removed is refused", () => {
    expect(tableExists(db, "shop_restores")).toBe(false);
    expect(() => insertReview(db, device, "restore_removed")).toThrow(/CHECK/);
  });

  it("up: keeps every review row, FK and index, and accepts restore_removed", () => {
    const fksBefore = fkList(db);
    const indexesBefore = reviewIndexes(db);
    const rowsBefore = reviewRows(db);
    expect(rowsBefore).toHaveLength(2);

    runMigrations(db);

    expect(fkList(db)).toEqual(fksBefore);
    expect(reviewIndexes(db)).toEqual(indexesBefore);
    expect(indexesBefore).toEqual([
      "idx_offline_review_items_event",
      "idx_offline_review_items_state",
    ]);
    expect(reviewRows(db)).toEqual(rowsBefore);
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
    expect(tableExists(db, "offline_review_items_new")).toBe(false);

    insertReview(db, device, "restore_removed");
    expect(() => insertReview(db, device, "other")).toThrow(/CHECK/);
    // New ids keep counting from the copied rows (AUTOINCREMENT survives).
    const maxId = (db.prepare(`SELECT MAX(id) AS m FROM offline_review_items`).get() as { m: number }).m;
    expect(maxId).toBe(3);
  });

  it("up: shop_restores columns, CHECKs and indexes", () => {
    runMigrations(db);
    const cols = (db.prepare(`PRAGMA table_info(shop_restores)`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols.sort()).toEqual(
      [
        "id", "target_tenant_id", "kind", "status", "restored_to", "client_tz_offset_min",
        "requested_by_user_id", "requested_by_name", "candidate_path", "before_copy_path",
        "preview_json", "id_floor_json", "error", "prepared_at", "started_at", "finished_at",
        "created_at", "updated_at",
      ].sort(),
    );
    expect(() => insertRestore(db, 1, "prepared", "other")).toThrow(/CHECK/);
    expect(() => insertRestore(db, 1, "pending")).toThrow(/CHECK/);
    const idx = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'shop_restores' AND sql IS NOT NULL ORDER BY name`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(idx).toEqual(["idx_shop_restores_one_open", "idx_shop_restores_target"]);
    // Seeds nothing.
    expect((db.prepare(`SELECT COUNT(*) AS n FROM shop_restores`).get() as { n: number }).n).toBe(0);
  });

  it("at most one open (prepared/running) restore per shop", () => {
    runMigrations(db);
    insertRestore(db, 1, "prepared");
    expect(() => insertRestore(db, 1, "running")).toThrow(/UNIQUE/);
    expect(() => insertRestore(db, 1, "prepared")).toThrow(/UNIQUE/);
    insertRestore(db, 1, "done");
    insertRestore(db, 1, "failed");
    insertRestore(db, 1, "expired");
    insertRestore(db, 2, "prepared"); // another shop
    // Once the open one finishes, a new one may start.
    db.prepare(`UPDATE shop_restores SET status = 'done' WHERE target_tenant_id = 1 AND status = 'prepared'`).run();
    insertRestore(db, 1, "running");
  });

  it("down: drops shop_restores, deletes restore_removed rows, restores the old CHECK", () => {
    const fksBefore = fkList(db);
    const indexesBefore = reviewIndexes(db);
    const rowsBefore = reviewRows(db);
    runMigrations(db);
    insertReview(db, device, "restore_removed");
    insertRestore(db, 1, "done");

    rollbackTo(db, 230);

    expect(tableExists(db, "shop_restores")).toBe(false);
    expect(reviewRows(db)).toEqual(rowsBefore);
    expect(fkList(db)).toEqual(fksBefore);
    expect(reviewIndexes(db)).toEqual(indexesBefore);
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
    expect(() => insertReview(db, device, "restore_removed")).toThrow(/CHECK/);
    insertReview(db, device, "pc_data_mismatch");

    // And up again works on the rebuilt (quoted-name) table.
    runMigrations(db);
    insertReview(db, device, "restore_removed");
  });
});
