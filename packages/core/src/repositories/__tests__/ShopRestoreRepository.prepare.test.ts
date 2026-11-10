/**
 * LIRA-377 T018 — `ShopRestoreRepository.prepareCandidate` (data-model §3,
 * research R6–R8). Written FIRST against a no-op stub (rule 17).
 *
 * Two real shop files built from the real schema (`create_db.sql` +
 * `runMigrations`), seeded differently: "candidate" is the earlier copy,
 * "current" is the live shop. Both carry child offline rows so the strip runs
 * against foreign keys exactly as a Litestream copy would.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { closeDatabase, initDatabase } from "../../db/connection.js";
import { runMigrations } from "../../db/migrations/index.js";
import { isSnapshotSecretSettingKey, SNAPSHOT_STRIPPED_TABLES } from "../../db/tenantSnapshot.js";
import { ShopRestoreRepository } from "../ShopRestoreRepository.js";
import type { TenantEntity } from "../TenantRepository.js";

const CREATE_DB_SQL_PATH = path.join(__dirname, "../../../../../electron-app/create_db.sql");
const NOW = "2026-11-10 10:00:00";
const OFFLINE_SET_FIXED = ["offline_devices", "offline_events", "offline_id_map", "offline_review_items", "offline_snapshots"];

type Row = Record<string, unknown>;
const all = (db: Database.Database, sql: string, ...p: unknown[]): Row[] => db.prepare(sql).all(...p) as Row[];
const count = (db: Database.Database, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;
const tableExists = (db: Database.Database, t: string): boolean =>
  db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t) !== undefined;
const seqMap = (db: Database.Database): Record<string, number> =>
  Object.fromEntries((all(db, `SELECT name, seq FROM sqlite_sequence`) as { name: string; seq: number }[]).map((r) => [r.name, r.seq]));

let tmp: string;
let template: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-restore-prep-"));
  template = path.join(tmp, "template.db");
  const db = new Database(template);
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  closeDatabase();
  db.close();
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function addUser(db: Database.Database, username: string): number {
  return db
    .prepare(`INSERT INTO users (tenant_id, username, password_hash, role) VALUES (1, ?, 'scrypt$x', 'staff')`)
    .run(username).lastInsertRowid as number;
}

function addOfflineDevice(db: Database.Database, deviceNo: number, name: string, keyId: string): number {
  const dev = db
    .prepare(
      `INSERT INTO offline_devices (tenant_id, device_no, name, key_id, key_hash, paired_by, paired_at, next_expected_seq, created_at, updated_at)
       VALUES (1, ?, ?, ?, 'h', 1, ?, ?, ?, ?)`,
    )
    .run(deviceNo, name, keyId, NOW, deviceNo * 10, NOW, NOW).lastInsertRowid as number;
  db.prepare(
    `INSERT INTO offline_snapshots (tenant_id, copy_id, device_id, schema_version, built_at, high_water_json, created_at, updated_at)
     VALUES (1, ?, ?, 230, ?, '{}', ?, ?)`,
  ).run(`copy-${keyId}`, dev, NOW, NOW, NOW);
  const ev = db
    .prepare(
      `INSERT INTO offline_events (tenant_id, device_id, event_id, device_seq, channel, payload_json, payload_hash, actor_user_id,
         occurred_at, client_day, client_tz_offset_minutes, copy_id, app_version, schema_version, schema_shape_json, rates_json,
         created_json, depends_on_json, status, created_at, updated_at)
       VALUES (1, ?, ?, 1, 'sales:process', '{}', 'ph', 1, ?, '2026-11-10', 120, ?, '1.0.0', 230, '{}', '{}', '[]', '[]', 'held', ?, ?)`,
    )
    .run(dev, `ev-${keyId}`, NOW, `copy-${keyId}`, NOW, NOW).lastInsertRowid as number;
  db.prepare(
    `INSERT INTO offline_id_map (tenant_id, offline_id, device_id, table_name, server_id, event_id, link_kind, created_at, updated_at)
     VALUES (1, ?, ?, 'clients', 1, ?, 'created', ?, ?)`,
  ).run(1_000_000_000_000 + dev, dev, `ev-${keyId}`, NOW, NOW);
  db.prepare(
    `INSERT INTO offline_review_items (tenant_id, event_row_id, device_id, kind, details_json, created_at, updated_at)
     VALUES (1, ?, ?, 'waiting', '{}', ?, ?)`,
  ).run(ev, dev, NOW, NOW);
  return dev;
}

function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`INSERT OR REPLACE INTO system_settings (tenant_id, key_name, value) VALUES (1, ?, ?)`).run(key, value);
}

function seedCommonPlumbing(db: Database.Database, tag: string): void {
  db.prepare(`INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (1, 1, ?, datetime('now', '+1 day'))`).run(`tok-${tag}`);
  db.prepare(
    `INSERT INTO idempotency_keys (tenant_id, user_id, route, idem_key, response_json, created_at, updated_at) VALUES (1, 1, '/x', ?, '{}', ?, ?)`,
  ).run(`k-${tag}`, NOW, NOW);
  db.prepare(
    `INSERT INTO user_invitations (tenant_id, email, role, token_hash, expires_at) VALUES (1, ?, 'staff', ?, ?)`,
  ).run(`${tag}@x.com`, `inv-${tag}`, NOW);
  db.prepare(`INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at) VALUES (1, 1, ?, ?)`).run(`r-${tag}`, NOW);
  db.prepare(
    `INSERT INTO email_verification_tokens (tenant_id, user_id, email, token_hash, expires_at) VALUES (1, 1, 'v@x.com', ?, ?)`,
  ).run(`v-${tag}`, NOW);
  db.prepare(`INSERT INTO sync_queue (table_name, record_id, action_type, payload_json) VALUES ('clients', 1, 'INSERT', '{}')`).run();
  db.prepare(`INSERT INTO sync_errors (endpoint, payload_json, error) VALUES ('/x', '{}', 'boom')`).run();
  db.prepare(
    `INSERT INTO offline_copy_meta (tenant_id, copy_id, built_at, schema_version, high_water_json, created_at, updated_at)
     VALUES (1, ?, ?, 230, '{}', ?, ?)`,
  ).run(`meta-${tag}`, NOW, NOW, NOW);
}

/** The earlier copy: users admin(1) + cashier(2); clients 1..2 with its
 * sequence left at 2 (as a downloaded backup's reset sequences would). */
function seedCandidate(db: Database.Database): void {
  addUser(db, "cashier");
  for (let i = 1; i <= 2; i++) {
    db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`).run(`Client ${i}`, `70${i}`);
  }
  seedCommonPlumbing(db, "cand");
  addOfflineDevice(db, 1, "OLD PC", "old-key");
  setSetting(db, "whatsapp_api_key", "OLD-KEY");
  setSetting(db, "candidate_only_token", "stale");
  setSetting(db, "profits_password_hash", "scrypt$cand");
  setSetting(db, "shop_name", "Shop as it was");
  db.prepare(`INSERT INTO user_identities (user_id, tenant_id, provider, subject) VALUES (1, 1, 'google', 'g-cand')`).run();
  db.prepare(`UPDATE tenants SET name = 'Old name', slug = 'old-slug' WHERE id = 1`).run();
}

/** The live shop: one more user (new_admin, 3), clients 1..5 then 5
 * deleted (seq 5, max 4), two PCs with child rows, newer secrets. */
function seedCurrent(db: Database.Database): void {
  addUser(db, "cashier");
  const newAdmin = addUser(db, "new_admin");
  for (let i = 1; i <= 5; i++) {
    db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`).run(`Client ${i}`, `70${i}`);
  }
  db.prepare(`DELETE FROM clients WHERE id = 5`).run();
  seedCommonPlumbing(db, "cur");
  addOfflineDevice(db, 1, "PC1", "key-1");
  addOfflineDevice(db, 2, "PC2", "key-2");
  if (tableExists(db, "offline_outbox")) {
    db.prepare(
      `INSERT INTO offline_outbox (tenant_id, event_id, device_seq, channel, payload_json, payload_hash, actor_user_id, occurred_at,
         client_day, client_tz_offset_minutes, copy_id, app_version, schema_version, schema_shape_json, rates_json, created_json,
         depends_on_json, created_at, updated_at)
       VALUES (1, 'ob-1', 1, 'sales:process', '{}', 'ph', 1, ?, '2026-11-10', 120, 'c', '1.0.0', 230, '{}', '{}', '[]', '[]', ?, ?)`,
    ).run(NOW, NOW, NOW);
  }
  if (tableExists(db, "offline_outbox_created")) {
    db.prepare(
      `INSERT INTO offline_outbox_created (tenant_id, offline_id, table_name, event_id, created_at, updated_at)
       VALUES (1, 1000000000077, 'clients', 'ob-1', ?, ?)`,
    ).run(NOW, NOW);
  }
  setSetting(db, "whatsapp_api_key", "NEW-KEY");
  setSetting(db, "current_only_secret", "fresh");
  setSetting(db, "profits_password_hash", "scrypt$cur");
  setSetting(db, "shop_name", "Shop now");
  db.prepare(`INSERT INTO user_identities (user_id, tenant_id, provider, subject, email) VALUES (1, 1, 'google', 'g-1', 'a@x.com')`).run();
  db.prepare(`INSERT INTO user_identities (user_id, tenant_id, provider, subject) VALUES (?, 1, 'google', 'g-3')`).run(newAdmin);
}

const PLATFORM_TENANT: TenantEntity = {
  id: 1,
  name: "Corner Tech",
  slug: "corner-tech",
  status: "active",
  contact_name: "Owner",
  contact_phone: "70123456",
  notes: "platform notes",
  contact_email: "owner@example.com",
  google_signup_at: null,
  created_at: "2026-01-01 08:00:00",
  updated_at: "2026-11-09 08:00:00",
};

describe("ShopRestoreRepository.prepareCandidate (LIRA-377 T018)", () => {
  let candidatePath: string;
  let currentPath: string;
  let cand: Database.Database;
  let cur: Database.Database;
  let curSeqBefore: Record<string, number>;
  let candSeqBefore: Record<string, number>;
  let candMaxBefore: Record<string, number>;
  let curOffline: Record<string, Row[]>;
  let result: { idFloor: Record<string, number> };

  const offlineSet = (db: Database.Database): string[] =>
    [
      ...OFFLINE_SET_FIXED,
      ...(all(db, `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'offline\\_outbox%' ESCAPE '\\'`) as {
        name: string;
      }[]).map((r) => r.name),
    ].filter((t) => tableExists(db, t));

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(tmp, "case-"));
    candidatePath = path.join(dir, "candidate.db");
    currentPath = path.join(dir, "current.db");
    fs.copyFileSync(template, candidatePath);
    fs.copyFileSync(template, currentPath);
    const c = new Database(candidatePath);
    seedCandidate(c);
    c.prepare(`UPDATE sqlite_sequence SET seq = 2 WHERE name = 'clients'`).run();
    c.close();
    const k = new Database(currentPath);
    seedCurrent(k);
    k.close();

    cur = new Database(currentPath, { readonly: true });
    cand = new Database(candidatePath, { readonly: true });
    curSeqBefore = seqMap(cur);
    candSeqBefore = seqMap(cand);
    candMaxBefore = {};
    for (const name of new Set([...Object.keys(curSeqBefore), ...Object.keys(candSeqBefore)])) {
      if (!tableExists(cand, name)) continue;
      candMaxBefore[name] = (cand.prepare(`SELECT COALESCE(MAX(rowid), 0) AS m FROM "${name}"`).get() as { m: number }).m;
    }
    curOffline = {};
    for (const t of offlineSet(cur)) curOffline[t] = all(cur, `SELECT * FROM "${t}" ORDER BY id`);
    cand.close();

    result = new ShopRestoreRepository().prepareCandidate({ candidatePath, currentPath, platformTenant: PLATFORM_TENANT });
    cand = new Database(candidatePath);
  });
  afterEach(() => {
    cand.close();
    cur.close();
  });

  it("empties every stripped table except the carried ones (sessions, tokens, copy meta, sync plumbing)", () => {
    const carried = new Set([...offlineSet(cand), "user_identities"]);
    const notEmpty = SNAPSHOT_STRIPPED_TABLES.filter((t) => !carried.has(t) && tableExists(cand, t) && count(cand, t) > 0);
    expect(notEmpty).toEqual([]);
    expect(count(cand, "sessions")).toBe(0);
    expect(count(cand, "offline_copy_meta")).toBe(0);
  });

  it("the offline set equals the CURRENT file's rows (carried after the strip)", () => {
    expect(offlineSet(cand).sort()).toEqual(Object.keys(curOffline).sort());
    expect(Object.keys(curOffline)).toEqual(expect.arrayContaining([...OFFLINE_SET_FIXED, "offline_outbox"]));
    for (const [t, rows] of Object.entries(curOffline)) {
      expect({ t, rows: all(cand, `SELECT * FROM "${t}" ORDER BY id`) }).toEqual({ t, rows });
      expect({ t, n: rows.length > 0 }).toEqual({ t, n: true });
    }
    expect(all(cand, `SELECT name FROM offline_devices ORDER BY id`)).toEqual([{ name: "PC1" }, { name: "PC2" }]);
  });

  it("secret settings come from the current file; non-secret settings and the profits hash stay the candidate's", () => {
    const secrets = (db: Database.Database): Row[] =>
      (all(db, `SELECT key_name, value FROM system_settings ORDER BY key_name`) as { key_name: string; value: string }[]).filter((r) =>
        isSnapshotSecretSettingKey(r.key_name),
      );
    expect(secrets(cand)).toEqual(secrets(cur));
    const value = (k: string): unknown =>
      (cand.prepare(`SELECT value FROM system_settings WHERE key_name = ?`).get(k) as { value: string } | undefined)?.value;
    expect(value("whatsapp_api_key")).toBe("NEW-KEY");
    expect(value("current_only_secret")).toBe("fresh");
    expect(value("candidate_only_token")).toBeUndefined();
    expect(value("profits_password_hash")).toBe("scrypt$cand");
    expect(value("shop_name")).toBe("Shop as it was");
  });

  it("carries Google links only for users that exist in the candidate", () => {
    expect(all(cand, `SELECT user_id, subject, email FROM user_identities ORDER BY id`)).toEqual([
      { user_id: 1, subject: "g-1", email: "a@x.com" },
    ]);
  });

  it("overwrites the local tenants mirror from the platform row", () => {
    expect(all(cand, `SELECT id, name, slug, status, contact_name, contact_phone, notes, contact_email FROM tenants`)).toEqual([
      {
        id: 1,
        name: "Corner Tech",
        slug: "corner-tech",
        status: "active",
        contact_name: "Owner",
        contact_phone: "70123456",
        notes: "platform notes",
        contact_email: "owner@example.com",
      },
    ]);
  });

  it("raises every sequence to MAX(current, candidate) and never reissues an id that existed in current", () => {
    const after = seqMap(cand);
    const names = new Set([...Object.keys(curSeqBefore), ...Object.keys(candSeqBefore)]);
    for (const name of names) {
      if (!tableExists(cand, name)) continue;
      const expected = Math.max(curSeqBefore[name] ?? 0, candSeqBefore[name] ?? 0);
      expect({ name, seq: after[name] }).toEqual({ name, seq: expected });
    }
    expect(curSeqBefore.clients).toBe(5);
    const id = cand.prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (1, 'After restore')`).run().lastInsertRowid as number;
    expect(id).toBe(6);
  });

  it("returns idFloor = the candidate's own MAX(id) per table, taken before anything changed", () => {
    expect(result.idFloor).toEqual(candMaxBefore);
    expect(result.idFloor.clients).toBe(2);
    expect(result.idFloor.offline_devices).toBe(1);
  });
});
