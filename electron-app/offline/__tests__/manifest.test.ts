/**
 * LIRA-306 T133 — the N5 manifest the PC sends on "Back to the web app"
 * (FR-035, FR-036; body = core `manifestSchema`, rule 24). Real working copy.
 *
 *  - per MANIFEST_KEY_TABLES: the ids in THIS PC's range present in the
 *    working copy (rows of other PCs / the server are not listed);
 *  - a row no event created is listed (and flagged locally) — the server
 *    turns it into a `pc_data_mismatch` review item;
 *  - a row created then deleted offline is not listed;
 *  - the read-write log is included.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  MANIFEST_KEY_TABLES,
  encodeOfflineId,
  getOfflineOutboxRepository,
  initFixedTenantContext,
  manifestSchema,
  offlineTableIndex,
} from "@liratek/core";
import { buildManifest } from "../manifest";
import { createWorkingCopy } from "../workingCopy";

const SCHEMA = fs.readFileSync(
  path.join(__dirname, "../../create_db.sql"),
  "utf8",
);
const P = 3;
const COPY = "c0000000-0000-4000-8000-000000000001";
let dir = "";
let db: Database.Database;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lira306-man-"));
  const mirror = path.join(dir, "mirror-20261011T100000000Z.db");
  const m = new Database(mirror);
  m.exec(SCHEMA);
  m.exec(
    `INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (7, 'Corner Tech', 'cornertech', 'active')`,
  );
  m.exec(
    `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (7, 'Server row', '1')`,
  );
  m.prepare(
    `INSERT INTO offline_copy_meta (tenant_id, copy_id, built_at, schema_version, high_water_json, created_at, updated_at)
     VALUES (7, ?, '2026-10-11T10:00:00.000Z', 210, '{}', 'x', 'x')`,
  ).run(COPY);
  m.close();
  const wc = createWorkingCopy({
    offlineDir: dir,
    mirrorFile: mirror,
    deviceNo: P,
    pairingLastUsed: {},
    serverMaxOfflineIds: {},
    DatabaseCtor: Database,
    now: Date.now,
  });
  db = new Database(wc.file);
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(7);
});
afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const addClient = (name: string) =>
  Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (7, ?, ?)`,
      )
      .run(name, name).lastInsertRowid,
  );

describe("buildManifest", () => {
  it("lists this PC's rows per key table, flags a row no event created, skips deleted rows, includes read-writes", () => {
    const recorded = addClient("Recorded");
    getOfflineOutboxRepository().insertCreated(
      [{ offlineId: recorded, tableName: "clients" }],
      "e0000000-0000-4000-8000-000000000001",
    );
    const sneaky = addClient("Unrecorded");
    const gone = addClient("Created then deleted");
    db.prepare(`DELETE FROM clients WHERE id = ?`).run(gone);

    const m = buildManifest({
      db,
      deviceNo: P,
      copyId: COPY,
      readWrites: [{ channel: "clients:get-all", changes: 1 }],
    });
    expect(manifestSchema.safeParse(m.body).success).toBe(true);
    expect(m.body.copyId).toBe(COPY);
    expect(m.body.tables).toEqual({ clients: [recorded, sneaky] });
    expect(m.body.readWrites).toEqual([
      { channel: "clients:get-all", changes: 1 },
    ]);
    expect(m.localUnexplained).toEqual([{ table: "clients", ids: [sneaky] }]);
    expect(recorded).toBe(encodeOfflineId(P, offlineTableIndex("clients"), 1));
  });

  it("reads every MANIFEST_KEY_TABLE that exists and only ids in this PC's range", () => {
    const m = buildManifest({ db, deviceNo: P, copyId: COPY, readWrites: [] });
    expect(m.body.tables).toEqual({});
    expect(m.tablesRead).toBeGreaterThan(MANIFEST_KEY_TABLES.length * 0.9);
  });
});
