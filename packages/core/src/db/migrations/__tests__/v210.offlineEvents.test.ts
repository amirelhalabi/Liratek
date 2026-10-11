/**
 * LIRA-306 T004 — migration v210 `offline_events_model`: the eight tables of
 * specs/306-offline-desktop-fallback/data-model.md, with their columns,
 * CHECKs and UNIQUEs, and a `down()` that drops all eight.
 *
 * Built on the real fresh-install schema (`electron-app/create_db.sql`) with
 * the eight tables dropped first, so the test exercises `up()` itself (the
 * fresh-schema half is guarded by check-schema-equivalence).
 *
 * Note (O-impl-1): `offline_outbox` lives on a PC, where `offline_devices` is
 * empty, so it carries no `device_id` FK; its outcome columns are
 * `delivery` / `server_status` / `last_error` instead of the server's
 * `status` / `error` / `result_json`.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const TABLES = [
  "offline_devices",
  "offline_snapshots",
  "offline_events",
  "offline_id_map",
  "offline_review_items",
  "offline_outbox",
  "offline_outbox_created",
  "offline_copy_meta",
] as const;

const NOW = "2026-10-11T10:00:00.000Z";

function v210() {
  const m = MIGRATIONS.find((x) => x.version === 210);
  if (!m) throw new Error("migration v210 not found");
  return m;
}

function freshPreV210(): Database.Database {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  for (const t of [...TABLES].reverse()) db.exec(`DROP TABLE IF EXISTS ${t}`);
  db.exec(`INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (2, 'Other', 'other', 'active')`);
  return db;
}

function columns(db: Database.Database, table: string) {
  return db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
    notnull: number;
    dflt_value: string | null;
  }>;
}

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'offline_%'`)
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

let db: Database.Database;
beforeEach(() => {
  db = freshPreV210();
  v210().up(db);
});
afterEach(() => db.close());

function addDevice(tenant = 1, deviceNo = 1, keyId = "aaaaaaaaaaaa"): number {
  return Number(
    db
      .prepare(
        `INSERT INTO offline_devices (tenant_id, device_no, name, key_id, key_hash, paired_by, paired_at, created_at, updated_at)
         VALUES (?, ?, 'PC', ?, 'h', 1, ?, ?, ?)`,
      )
      .run(tenant, deviceNo, keyId, NOW, NOW, NOW).lastInsertRowid,
  );
}

function addEvent(o: { device: number; eventId: string; seq: number; status?: string; tz?: number; tenant?: number }) {
  return db
    .prepare(
      `INSERT INTO offline_events (tenant_id, device_id, event_id, device_seq, channel, payload_json, payload_hash,
         actor_user_id, occurred_at, client_day, client_tz_offset_minutes, copy_id, app_version, schema_version,
         schema_shape_json, rates_json, created_json, depends_on_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'sales:process', '{}', 'h', 1, ?, '2026-10-11', ?, 'c', '1.0.0', 210, '{}', '{}', '{}', '[]', ?, ?, ?)`,
    )
    .run(o.tenant ?? 1, o.device, o.eventId, o.seq, NOW, o.tz ?? 180, o.status ?? "received", NOW, NOW);
}

describe("v210 offline_events_model", () => {
  it("is the migration after v209 with the documented name", () => {
    expect(v210().name).toBe("offline_events_model");
    expect(MIGRATIONS[MIGRATIONS.length - 1].version).toBe(210);
  });

  it("creates all eight tables, each with id, tenant_id, created_at, updated_at", () => {
    expect(tableNames(db).sort()).toEqual([...TABLES].sort());
    for (const t of TABLES) {
      const names = columns(db, t).map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(["id", "tenant_id", "created_at", "updated_at"]));
      const tenant = columns(db, t).find((c) => c.name === "tenant_id")!;
      expect(tenant.notnull).toBe(1);
    }
  });

  it("offline_devices: columns, UNIQUE(tenant_id, device_no), UNIQUE(key_id), state CHECK", () => {
    expect(columns(db, "offline_devices").map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "device_no", "name", "key_id", "key_hash", "paired_by", "paired_at", "revoked_at", "revoked_by",
        "last_seen_at", "last_state", "last_pending_count", "last_app_version", "last_schema_version",
        "last_skew_ms", "last_online_skew_ms", "next_expected_seq",
      ]),
    );
    addDevice(1, 1, "aaaaaaaaaaaa");
    expect(() => addDevice(1, 1, "bbbbbbbbbbbb")).toThrow(/UNIQUE/);
    addDevice(2, 1, "cccccccccccc"); // same number, other shop
    expect(() => addDevice(1, 2, "aaaaaaaaaaaa")).toThrow(/UNIQUE/);
    expect(() =>
      db.prepare(`UPDATE offline_devices SET last_state = 'online' WHERE device_no = 1`).run(),
    ).toThrow(/CHECK/);
    const row = db.prepare(`SELECT next_expected_seq, last_pending_count FROM offline_devices WHERE key_id='aaaaaaaaaaaa'`).get() as {
      next_expected_seq: number; last_pending_count: number;
    };
    expect(row).toEqual({ next_expected_seq: 1, last_pending_count: 0 });
  });

  it("offline_events: status CHECK, UNIQUE(tenant_id, event_id), UNIQUE(tenant_id, device_id, device_seq), NOT NULL shape/rates", () => {
    const dev = addDevice();
    ["received", "booked", "skipped", "held", "refused", "applied", "dismissed"].forEach((s, i) =>
      addEvent({ device: dev, eventId: `e-${s}`, seq: 100 + i, status: s }),
    );
    expect(() => addEvent({ device: dev, eventId: "e-x", seq: 1, status: "waiting" })).toThrow(/CHECK/);
    addEvent({ device: dev, eventId: "e1", seq: 1 });
    expect(() => addEvent({ device: dev, eventId: "e1", seq: 2 })).toThrow(/UNIQUE/);
    expect(() => addEvent({ device: dev, eventId: "e2", seq: 1 })).toThrow(/UNIQUE/);
    expect(() => addEvent({ device: dev, eventId: "e3", seq: 0 })).toThrow(/CHECK/);
    expect(() => addEvent({ device: dev, eventId: "e4", seq: 4, tz: 900 })).toThrow(/CHECK/);
    const cols = columns(db, "offline_events");
    for (const name of ["schema_shape_json", "rates_json", "created_json", "depends_on_json", "payload_json", "client_day"]) {
      expect(cols.find((c) => c.name === name)?.notnull).toBe(1);
    }
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["corrected_at", "attempts", "result_json", "error", "processed_at", "resolved_by", "resolved_at"]),
    );
  });

  it("offline_id_map: UNIQUE(tenant_id, offline_id), offline range CHECK, link_kind CHECK", () => {
    const dev = addDevice();
    const ins = (offlineId: number, serverId: number, kind = "created", tenant = 1) =>
      db
        .prepare(
          `INSERT INTO offline_id_map (tenant_id, offline_id, device_id, table_name, server_id, event_id, link_kind, created_at, updated_at)
           VALUES (?, ?, ?, 'clients', ?, 'e1', ?, ?, ?)`,
        )
        .run(tenant, offlineId, dev, serverId, kind, NOW, NOW);
    ins(1_004_000_000_001, 512);
    expect(() => ins(1_004_000_000_001, 513)).toThrow(/UNIQUE/);
    expect(() => ins(999_999_999_999, 1)).toThrow(/CHECK/);
    expect(() => ins(1_004_000_000_002, 1_000_000_000_000)).toThrow(/CHECK/);
    expect(() => ins(1_004_000_000_003, 3, "guessed")).toThrow(/CHECK/);
    ins(1_004_000_000_004, 4, "linked_existing");
  });

  it("offline_review_items: the 14 kinds (incl. rate_changed) and 4 states", () => {
    const dev = addDevice();
    const ins = (kind: string, state = "open") =>
      db
        .prepare(
          `INSERT INTO offline_review_items (tenant_id, event_row_id, device_id, kind, state, details_json, created_at, updated_at)
           VALUES (1, NULL, ?, ?, ?, '{}', ?, ?)`,
        )
        .run(dev, kind, state, NOW, NOW);
    for (const k of [
      "possible_duplicate", "certain_duplicate", "held_checkpoint", "waiting", "refused", "stock_count_off",
      "ticks_dropped", "customer_linked", "clock_corrected", "closed_day_changed", "came_out_differently",
      "user_switched_off", "pc_data_mismatch", "rate_changed",
    ]) ins(k);
    expect(() => ins("other")).toThrow(/CHECK/);
    for (const s of ["applied", "dismissed", "reviewed"]) ins("refused", s);
    expect(() => ins("refused", "closed")).toThrow(/CHECK/);
    const dflt = columns(db, "offline_review_items").find((c) => c.name === "state")!;
    expect(dflt.dflt_value).toBe("'open'");
  });

  it("offline_snapshots: UNIQUE copy_id, NOT NULL high_water_json", () => {
    const ins = (copy: string) =>
      db
        .prepare(
          `INSERT INTO offline_snapshots (tenant_id, copy_id, device_id, schema_version, built_at, high_water_json, created_at, updated_at)
           VALUES (1, ?, NULL, 210, ?, '{}', ?, ?)`,
        )
        .run(copy, NOW, NOW, NOW);
    ins("c1");
    expect(() => ins("c1")).toThrow(/UNIQUE/);
  });

  it("PC tables: outbox delivery CHECK + unique event/seq, outbox_created unique offline_id, copy_meta columns", () => {
    const out = (eventId: string, seq: number, delivery = "waiting") =>
      db
        .prepare(
          `INSERT INTO offline_outbox (tenant_id, event_id, device_seq, channel, payload_json, payload_hash, actor_user_id,
             occurred_at, client_day, client_tz_offset_minutes, copy_id, app_version, schema_version, schema_shape_json,
             rates_json, created_json, depends_on_json, delivery, created_at, updated_at)
           VALUES (1, ?, ?, 'sales:process', '{}', 'h', 1, ?, '2026-10-11', 180, 'c', '1.0.0', 210, '{}', '{}', '{}', '[]', ?, ?, ?)`,
        )
        .run(eventId, seq, NOW, delivery, NOW, NOW);
    out("e1", 1);
    out("e2", 2, "acked");
    out("e3", 3, "done");
    expect(() => out("e1", 4)).toThrow(/UNIQUE/);
    expect(() => out("e5", 1)).toThrow(/UNIQUE/);
    expect(() => out("e6", 6, "lost")).toThrow(/CHECK/);
    expect(columns(db, "offline_outbox").map((c) => c.name)).toEqual(
      expect.arrayContaining(["server_status", "attempts", "last_error"]),
    );
    const created = (id: number) =>
      db
        .prepare(
          `INSERT INTO offline_outbox_created (tenant_id, offline_id, table_name, event_id, created_at, updated_at)
           VALUES (1, ?, 'sales', 'e1', ?, ?)`,
        )
        .run(id, NOW, NOW);
    created(1_007_000_000_001);
    expect(() => created(1_007_000_000_001)).toThrow(/UNIQUE/);
    expect(columns(db, "offline_copy_meta").map((c) => c.name)).toEqual(
      expect.arrayContaining(["copy_id", "built_at", "schema_version", "high_water_json", "device_no", "opened_at"]),
    );
  });

  it("down() drops all eight tables", () => {
    v210().down!(db);
    expect(tableNames(db)).toEqual([]);
  });
});
