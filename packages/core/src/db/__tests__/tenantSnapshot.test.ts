/**
 * LIRA-306 T113 — `buildTenantSnapshot()`: the shop copy a paired PC
 * downloads (FR-005, research R15, superseded R9's guards kept).
 *
 * Written failing-first (the module did not exist). Real schema
 * (`electron-app/create_db.sql` + `runMigrations`), two shops (1 and 5) with
 * interleaved ids so "the shop's own MAX(id)" differs from the platform-wide
 * counter, plus a platform super-admin and platform-only rows.
 *
 * Set `LIRATEK_SNAPSHOT_BENCH_DB=<path to a COPY of a real db>` to also time
 * a build on realistic data (the file is copied again and migrated; the path
 * given is never written).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { closeDatabase, initDatabase } from "../connection.js";
import { getCurrentVersion, runMigrations } from "../migrations/index.js";
import {
  buildTenantSnapshot,
  SNAPSHOT_GLOBAL_TABLES_ALLOWED,
  SNAPSHOT_KEPT_COLUMNS,
  SNAPSHOT_KEPT_SETTING_KEYS,
  SNAPSHOT_KEPT_TABLES,
  SNAPSHOT_NULLED_COLUMNS,
  SNAPSHOT_SECRET_SETTING_PATTERN,
  SNAPSHOT_STRIPPED_TABLES,
} from "../tenantSnapshot.js";
import { OFFLINE_ID_TABLES } from "../../offline/idRange.js";

const CREATE_DB_SQL_PATH = path.join(__dirname, "../../../../../electron-app/create_db.sql");

/** Table names that smell of sign-in material (superseded R9 guard 1). */
const SECRET_TABLE_PATTERN = /token|session|secret|code|key|identit|idempot|offline_|invit|outbox|sync_|signin|sso/i;
/** Column names that smell of secrets (R9 guard 3). */
const SECRET_COLUMN_PATTERN = /hash|token|secret|_key$|password|license/i;

type Row = Record<string, unknown>;
const count = (db: Database.Database, sql: string, ...p: unknown[]): number =>
  (db.prepare(sql).get(...p) as { c: number }).c;
const tables = (db: Database.Database): string[] =>
  (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as { name: string }[]
  ).map((r) => r.name);
const columns = (db: Database.Database, t: string): string[] =>
  (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);

function unclassifiedSecretTables(db: Database.Database): string[] {
  return tables(db).filter(
    (t) => SECRET_TABLE_PATTERN.test(t) && !SNAPSHOT_STRIPPED_TABLES.includes(t) && !(t in SNAPSHOT_KEPT_TABLES),
  );
}

function unclassifiedSecretColumns(db: Database.Database): string[] {
  const out: string[] = [];
  for (const t of tables(db)) {
    if (SNAPSHOT_STRIPPED_TABLES.includes(t)) continue;
    for (const c of columns(db, t)) {
      if (!SECRET_COLUMN_PATTERN.test(c)) continue;
      const id = `${t}.${c}`;
      if ((SNAPSHOT_NULLED_COLUMNS[t] ?? []).includes(c) || id in SNAPSHOT_KEPT_COLUMNS) continue;
      out.push(id);
    }
  }
  return out;
}

function seed(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  db.pragma("foreign_keys = ON");
  const now = "2026-10-11T10:00:00.000Z";

  db.prepare(`INSERT INTO tenants (id, name, slug, status) VALUES (5, 'Five', 'five', 'active')`).run();
  db.prepare(`UPDATE tenant_subscriptions SET license_key = 'LIC-ONE' WHERE tenant_id = 1`).run();
  db.prepare(
    `INSERT INTO tenant_subscriptions (tenant_id, plan, status, license_key) VALUES (5, 'standard', 'active', 'LIC-FIVE')`,
  ).run();

  const u5 = db
    .prepare(`INSERT INTO users (tenant_id, username, password_hash, role) VALUES (5, 'cashier5', 'scrypt$five', 'staff')`)
    .run().lastInsertRowid as number;
  const sup = db
    .prepare(`INSERT INTO users (tenant_id, username, password_hash, role) VALUES (NULL, 'super', 'scrypt$super', 'super_admin')`)
    .run().lastInsertRowid as number;
  db.prepare(`INSERT INTO users (tenant_id, username, password_hash, role) VALUES (1, 'staff1', 'scrypt$one', 'staff')`).run();

  // Interleaved: shop 5's client gets id 1; shop 1's three take 2..4.
  db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (5, 'Five client', '500')`).run();
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`).run(`One ${i}`, `10${i}`);
  }

  for (const [t, u, tok] of [
    [5, u5, "tok-5"],
    [1, 1, "tok-1"],
    [null, sup, "tok-super"],
  ] as const) {
    db.prepare(`INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (?, ?, ?, datetime('now', '+1 day'))`).run(
      t,
      u,
      tok,
    );
  }
  db.prepare(
    `INSERT INTO idempotency_keys (tenant_id, user_id, route, idem_key, response_json, created_at, updated_at) VALUES (5, ?, '/x', 'k5', '{}', ?, ?)`,
  ).run(u5, now, now);
  db.prepare(
    `INSERT INTO user_invitations (tenant_id, email, role, token_hash, expires_at) VALUES (5, 'i@x.com', 'staff', 'inv-hash-5', ?)`,
  ).run(now);
  db.prepare(`INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at) VALUES (5, ?, 'reset-hash-5', ?)`).run(
    u5,
    now,
  );
  db.prepare(
    `INSERT INTO email_verification_tokens (tenant_id, user_id, email, token_hash, expires_at) VALUES (5, ?, 'c@x.com', 'ver-hash-5', ?)`,
  ).run(u5, now);
  db.prepare(`INSERT INTO user_identities (user_id, tenant_id, provider, subject) VALUES (?, 5, 'google', 'g-5')`).run(u5);
  const dev = db
    .prepare(
      `INSERT INTO offline_devices (tenant_id, device_no, name, key_id, key_hash, paired_by, paired_at, created_at, updated_at)
       VALUES (5, 1, 'PC1', 'key5', 'devhash', ?, ?, ?, ?)`,
    )
    .run(u5, now, now, now).lastInsertRowid as number;
  db.prepare(
    `INSERT INTO offline_snapshots (tenant_id, copy_id, device_id, schema_version, built_at, high_water_json, created_at, updated_at)
     VALUES (5, 'old-copy', ?, 210, ?, '{}', ?, ?)`,
  ).run(dev, now, now, now);

  for (const [t, k, v] of [
    [5, "shop_name", "Shop Five"],
    [5, "whatsapp_api_key", "EAAG-live-meta-token"],
    [5, "some_service_token", "tok"],
    [5, "smtp_password", "pw"],
    [5, "profits_password_hash", "scrypt$profits5"],
    [1, "whatsapp_api_key", "EAAG-shop-one"],
  ] as const) {
    db.prepare(`INSERT OR REPLACE INTO system_settings (tenant_id, key_name, value) VALUES (?, ?, ?)`).run(t, k, v);
  }

  db.prepare(
    `INSERT INTO email_outbox (idempotency_key, template, to_email, data_json, next_attempt_at, give_up_at)
     VALUES ('o1', 't', 'x@example.com', '{}', datetime('now'), datetime('now', '+1 day'))`,
  ).run();
  db.prepare(`INSERT INTO sync_queue (table_name, record_id, action_type, payload_json) VALUES ('clients', 1, 'INSERT', '{}')`).run();
  db.prepare(`INSERT INTO sync_errors (endpoint, payload_json, error) VALUES ('/x', '{}', 'boom')`).run();
  return db;
}

describe("buildTenantSnapshot (LIRA-306 T113)", () => {
  let tmp: string;
  let outDir: string;
  let source: Database.Database;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-snap-"));
    outDir = path.join(tmp, "work");
    fs.mkdirSync(outDir);
    source = seed(path.join(tmp, "source.db"));
  });
  afterEach(() => {
    source.close();
    closeDatabase();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** Opens the built copy (gunzipped) as its own file. */
  function openCopy(gzip: Buffer, name = "copy.db"): Database.Database {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, zlib.gunzipSync(gzip));
    return new Database(p);
  }

  it("holds only shop 5's rows, its real shop id, its own subscription row with license_key NULL", () => {
    const snap = buildTenantSnapshot({ tenantId: 5, sourceDb: source, tmpRoot: outDir });
    const copy = openCopy(snap.gzip);
    try {
      expect(snap.tenantId).toBe(5);
      expect(copy.prepare(`SELECT id FROM tenants`).all()).toEqual([{ id: 5 }]);
      for (const t of tables(copy)) {
        if (!columns(copy, t).includes("tenant_id")) continue;
        expect({ t, other: count(copy, `SELECT COUNT(*) c FROM "${t}" WHERE tenant_id IS NULL OR tenant_id != 5`) }).toEqual({
          t,
          other: 0,
        });
      }
      expect(count(copy, `SELECT COUNT(*) c FROM clients`)).toBe(1);
      expect(copy.prepare(`SELECT tenant_id, license_key FROM tenant_subscriptions`).all()).toEqual([
        { tenant_id: 5, license_key: null },
      ]);
      // The super-admin and shop 1's users are gone; shop 5's hash is KEPT (offline sign-in).
      expect(copy.prepare(`SELECT username, password_hash FROM users ORDER BY id`).all()).toEqual([
        { username: "cashier5", password_hash: "scrypt$five" },
      ]);
    } finally {
      copy.close();
    }
  });

  it("empties every stripped table (sessions, tokens, invitations, identities, idempotency, offline_*, sync_*, platform-only)", () => {
    const snap = buildTenantSnapshot({ tenantId: 5, sourceDb: source, tmpRoot: outDir });
    const copy = openCopy(snap.gzip);
    try {
      for (const t of SNAPSHOT_STRIPPED_TABLES) {
        if (t === "offline_copy_meta") continue; // the one row the builder writes, asserted below
        if (!tables(copy).includes(t)) continue;
        expect({ t, n: count(copy, `SELECT COUNT(*) c FROM "${t}"`) }).toEqual({ t, n: 0 });
      }
      // The seed really had rows there for shop 5 (the assertion above is not vacuous).
      for (const t of ["sessions", "idempotency_keys", "user_invitations", "password_reset_tokens", "offline_devices", "offline_snapshots", "sync_queue"]) {
        expect(count(source, `SELECT COUNT(*) c FROM "${t}"`)).toBeGreaterThan(0);
      }
    } finally {
      copy.close();
    }
  });

  it("deletes secret settings, keeps ordinary ones and the profits password hash", () => {
    const snap = buildTenantSnapshot({ tenantId: 5, sourceDb: source, tmpRoot: outDir });
    const copy = openCopy(snap.gzip);
    try {
      const keys = (copy.prepare(`SELECT key_name FROM system_settings`).all() as { key_name: string }[]).map((r) => r.key_name);
      expect(keys).toEqual(expect.arrayContaining(["shop_name", "profits_password_hash"]));
      expect(keys).not.toContain("whatsapp_api_key");
      expect(keys).not.toContain("some_service_token");
      expect(keys).not.toContain("smtp_password");
      for (const k of keys) {
        if (SNAPSHOT_SECRET_SETTING_PATTERN.test(k)) expect(Object.keys(SNAPSHOT_KEPT_SETTING_KEYS)).toContain(k);
      }
    } finally {
      copy.close();
    }
  });

  it("sqlite_sequence = the shop's own MAX(id); offline_copy_meta has the copy id, version and high-water marks", () => {
    const snap = buildTenantSnapshot({ tenantId: 5, sourceDb: source, tmpRoot: outDir });
    const copy = openCopy(snap.gzip);
    try {
      // Platform-wide counter for clients is 4; shop 5 owns only id 1.
      expect(count(source, `SELECT seq c FROM sqlite_sequence WHERE name = 'clients'`)).toBe(4);
      const seqs = copy.prepare(`SELECT name, seq FROM sqlite_sequence`).all() as { name: string; seq: number }[];
      expect(seqs.length).toBeGreaterThan(5);
      for (const { name, seq } of seqs) {
        expect({ name, seq }).toEqual({ name, seq: count(copy, `SELECT COALESCE(MAX(rowid), 0) c FROM "${name}"`) });
      }
      expect(seqs.find((s) => s.name === "clients")?.seq).toBe(1);

      const meta = copy.prepare(`SELECT * FROM offline_copy_meta`).all() as Row[];
      expect(meta).toHaveLength(1);
      expect(meta[0]).toMatchObject({
        tenant_id: 5,
        copy_id: snap.copyId,
        built_at: snap.builtAt,
        schema_version: getCurrentVersion(source),
        device_no: null,
        opened_at: null,
      });
      expect(snap.copyId).toMatch(/^[0-9a-f-]{36}$/);
      expect(snap.schemaVersion).toBe(getCurrentVersion(source));
      const hw = JSON.parse(meta[0].high_water_json as string) as Record<string, number>;
      expect(hw).toEqual(snap.highWater);
      // Every id table has a mark; marks are the shop's own maxima taken
      // BEFORE stripping (sessions keeps shop 5's real max, not 0).
      for (const t of OFFLINE_ID_TABLES) expect(typeof hw[t]).toBe("number");
      expect(hw.clients).toBe(1);
      expect(hw.sessions).toBe(count(source, `SELECT MAX(id) c FROM sessions WHERE tenant_id = 5`));
      expect(hw.sessions).toBeGreaterThan(0);
    } finally {
      copy.close();
    }
  });

  it("passes integrity_check and foreign_key_check; build time is reported", () => {
    const snap = buildTenantSnapshot({ tenantId: 5, sourceDb: source, tmpRoot: outDir });
    const copy = openCopy(snap.gzip);
    try {
      expect((copy.pragma("integrity_check") as { integrity_check: string }[])[0].integrity_check).toBe("ok");
      expect(copy.pragma("foreign_key_check")).toEqual([]);
      expect(snap.foreignKeyViolations).toBe(0);
      expect(snap.buildMs).toBeGreaterThanOrEqual(0);
      expect(snap.sizeBytes).toBeGreaterThan(0);
      process.stdout.write(
        `[T113] two-shop fixture: build ${snap.buildMs} ms, ${snap.sizeBytes} B raw, ${snap.gzip.length} B gzip\n`,
      );
    } finally {
      copy.close();
    }
  });

  it("leaves no temp file behind on success", () => {
    buildTenantSnapshot({ tenantId: 5, sourceDb: source, tmpRoot: outDir });
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it("refuses an unscoped table (narrowing hard-fail) and removes its temp files", () => {
    source.exec(`CREATE TABLE leaky_global (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO leaky_global (v) VALUES ('x');`);
    expect(() => buildTenantSnapshot({ tenantId: 5, sourceDb: source, tmpRoot: outDir })).toThrow(/leaky_global/);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it("refuses an unknown shop", () => {
    expect(() => buildTenantSnapshot({ tenantId: 99, sourceDb: source, tmpRoot: outDir })).toThrow(/99/);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  describe("schema guards (fail when a future migration adds something unclassified)", () => {
    it("every table whose name smells of sign-in material is stripped or kept with a reason", () => {
      expect(unclassifiedSecretTables(source)).toEqual([]);
      for (const reason of Object.values(SNAPSHOT_KEPT_TABLES)) expect(reason.length).toBeGreaterThan(10);
    });

    it("every table without tenant_id is empty in the copy unless allowed with a reason", () => {
      const snap = buildTenantSnapshot({ tenantId: 5, sourceDb: source, tmpRoot: outDir });
      const copy = openCopy(snap.gzip);
      try {
        for (const t of tables(copy)) {
          if (columns(copy, t).includes("tenant_id") || t in SNAPSHOT_GLOBAL_TABLES_ALLOWED) continue;
          expect({ t, n: count(copy, `SELECT COUNT(*) c FROM "${t}"`) }).toEqual({ t, n: 0 });
        }
      } finally {
        copy.close();
      }
    });

    it("every column whose name smells of a secret is in a stripped table, nulled, or kept with a reason", () => {
      expect(unclassifiedSecretColumns(source)).toEqual([]);
      expect(SNAPSHOT_KEPT_COLUMNS).toHaveProperty(["users.password_hash"]);
    });

    it("positive control: both name guards DO fire on a new unclassified table/column", () => {
      source.exec(`CREATE TABLE shop_api_tokens (id INTEGER PRIMARY KEY, tenant_id INTEGER, label TEXT)`);
      source.exec(`ALTER TABLE clients ADD COLUMN portal_secret TEXT`);
      expect(unclassifiedSecretTables(source)).toEqual(["shop_api_tokens"]);
      expect(unclassifiedSecretColumns(source)).toEqual(["clients.portal_secret"]);
    });

    it("every classification names a table that exists in create_db.sql (no stale entries)", () => {
      const all = new Set(tables(source));
      for (const t of [...SNAPSHOT_STRIPPED_TABLES, ...Object.keys(SNAPSHOT_KEPT_TABLES), ...Object.keys(SNAPSHOT_GLOBAL_TABLES_ALLOWED)]) {
        expect({ t, exists: all.has(t) }).toEqual({ t, exists: true });
      }
    });
  });

  const benchDb = process.env.LIRATEK_SNAPSHOT_BENCH_DB;
  (benchDb ? it : it.skip)("BENCH: builds a copy of a realistic database and prints the time", () => {
    const p = path.join(tmp, "bench.db");
    const src = new Database(benchDb as string); // a scratch COPY (VACUUM INTO is refused on readonly connections)
    src.prepare("VACUUM INTO ?").run(p);
    src.close();
    const bench = new Database(p);
    try {
      runMigrations(bench);
      const ids = (bench.prepare(`SELECT id FROM tenants ORDER BY id`).all() as { id: number }[]).map((r) => r.id);
      for (const id of ids) {
        const snap = buildTenantSnapshot({ tenantId: id, sourceDb: bench, tmpRoot: outDir });
        process.stdout.write(
          `[T113 BENCH] ${path.basename(benchDb as string)} (${fs.statSync(p).size} B) shop ${id}: build ${snap.buildMs} ms, ` +
            `${snap.sizeBytes} B raw, ${snap.gzip.length} B gzip, schema v${snap.schemaVersion}, fk violations ${snap.foreignKeyViolations}\n`,
        );
        expect(snap.foreignKeyViolations).toBeGreaterThanOrEqual(0);
      }
    } finally {
      bench.close();
    }
  });
});
