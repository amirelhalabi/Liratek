/**
 * LIRA-377 T021/T031/T032/T050 — `ShopRestoreService` (time restore, undo,
 * confirm, cancel, points, sweep). Written FIRST against a stub (rule 17).
 *
 * Real files throughout: a platform database (create_db.sql + migrations, in
 * memory, the global connection) holding shop 3 "Corner Tech", and shop 3's
 * own file on disk. The Litestream source and the file swap are fakes: the
 * source copies a prepared "history" file, the swap takes the before-copy
 * and copies the candidate over the live file (the real swap has its own
 * backend test). Every "now" is the test's, never the service's (rule 27).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { closeDatabase, initDatabase } from "../../db/connection.js";
import { runMigrations } from "../../db/migrations/index.js";
import { ShopRestoresRepository } from "../../repositories/ShopRestoresRepository.js";
import { ShopRestoreRepository } from "../../repositories/ShopRestoreRepository.js";
import { ShopRestoreFileRepository } from "../../repositories/ShopRestoreFileRepository.js";
import type { CreateAuditLogData } from "../../repositories/AuditRepository.js";
import type { EnqueueEmailData } from "../../repositories/EmailOutboxRepository.js";
import type { ShopFilePort, ShopFileSwapArgs } from "../restorePorts.js";
import {
  RestoreSourceError,
  ShopRestoreService,
  type RestoreActor,
  type ShopRestoreServiceDeps,
} from "../ShopRestoreService.js";

const CREATE_DB_SQL = fs.readFileSync(path.join(__dirname, "../../../../../electron-app/create_db.sql"), "utf-8");
const SHOP = 3;
const SHOP_NAME = "Corner Tech";
const ADMIN = 1;
const MIN = 60_000;

let tmp: string;
let template: string;
let platform: Database.Database;

const iso = (ms: number): string => new Date(ms).toISOString();
/** Rows written by the fixtures carry the REAL clock (CURRENT_TIMESTAMP);
 * the actor's "now" sits a minute after them. */
const BASE = Date.now();
const NOW = iso(BASE + MIN);

function tenantScopedTables(db: Database.Database): string[] {
  const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((r) => r.name);
  return names.filter((t) => (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).some((c) => c.name === "tenant_id"));
}

/** A shop file for `tenantId` built from the template (create_db + migrations). */
function makeShopFile(file: string, tenantId: number, name: string): void {
  fs.copyFileSync(template, file);
  const db = new Database(file);
  db.pragma("foreign_keys = OFF");
  db.exec(`DELETE FROM tenant_subscriptions`);
  for (const t of tenantScopedTables(db)) db.prepare(`UPDATE "${t}" SET tenant_id = ? WHERE tenant_id IS NOT NULL`).run(tenantId);
  db.prepare(`UPDATE tenants SET id = ?, name = ?, slug = ?`).run(tenantId, name, `shop-${tenantId}`);
  db.close();
}

function addClient(file: string, name: string): void {
  const db = new Database(file);
  db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (?, ?, ?)`).run(SHOP, name, `7${name.length}${Date.now() % 1000}`);
  db.close();
}

function addPairedPc(file: string): void {
  const db = new Database(file);
  db.prepare(
    `INSERT INTO offline_devices (tenant_id, device_no, name, key_id, key_hash, paired_by, paired_at, created_at, updated_at)
     VALUES (?, 1, 'Till 1', 'key-till-1', 'hash', ?, '2026-11-01 10:00:00', '2026-11-01 10:00:00', '2026-11-01 10:00:00')`,
  ).run(SHOP, ADMIN);
  db.close();
}

function clientNames(file: string): string[] {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare(`SELECT full_name FROM clients ORDER BY id`).all() as { full_name: string }[]).map((r) => r.full_name);
  } finally {
    db.close();
  }
}

function addSession(file: string, token: string): void {
  const db = new Database(file);
  db.prepare(`INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES (?, ?, ?, datetime('now', '+1 day'))`).run(SHOP, ADMIN, token);
  db.close();
}

function countRows(file: string, table: string): number {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;
  } finally {
    db.close();
  }
}

interface Harness {
  service: ShopRestoreService;
  dirs: { tenantsDir: string; workDir: string; pointsDir: string };
  live: string;
  history: string;
  fetchCalls: (string | null)[];
  fetchImpl: { fn: (isoUtc: string | null, out: string) => Promise<void> };
  swapCalls: ShopFileSwapArgs[];
  swapImpl: { fail: boolean };
  events: string[];
  audits: CreateAuditLogData[];
  emails: EnqueueEmailData[];
  after: number[];
  restores: ShopRestoresRepository;
}

let n = 0;
function harness(overrides: Partial<ShopRestoreServiceDeps> = {}): Harness {
  n += 1;
  const root = path.join(tmp, `h${n}`);
  const dirs = { tenantsDir: path.join(root, "tenants"), workDir: path.join(root, "restore-work"), pointsDir: path.join(root, "restore-points") };
  fs.mkdirSync(dirs.tenantsDir, { recursive: true });
  const live = path.join(dirs.tenantsDir, `${SHOP}.db`);
  makeShopFile(live, SHOP, SHOP_NAME);
  addClient(live, "Early client");
  // The "history" Litestream would return: the shop as it was before the
  // later client was added.
  const history = path.join(root, "history.sqlite");
  fs.copyFileSync(live, history);
  addClient(live, "Late client");
  addSession(live, "live-session");

  const fetchCalls: (string | null)[] = [];
  const fetchImpl = {
    fn: async (_iso: string | null, out: string) => {
      fs.copyFileSync(history, out);
    },
  };
  const swapCalls: ShopFileSwapArgs[] = [];
  const swapImpl = { fail: false };
  const events: string[] = [];
  const shopFile: ShopFilePort = {
    async migrateCandidate(p) {
      const db = new Database(p);
      runMigrations(db);
      db.close();
    },
    async swap(args) {
      swapCalls.push(args);
      events.push("swap");
      if (swapImpl.fail) throw new Error("disk full");
      const before = path.join(args.beforeCopyDir, String(args.tenantId), `before-${args.stampUtc}.sqlite`);
      fs.mkdirSync(path.dirname(before), { recursive: true });
      const db = new Database(live);
      db.prepare("VACUUM INTO ?").run(before);
      db.close();
      fs.copyFileSync(args.candidatePath, live);
      return { beforeCopyPath: before };
    },
  };
  const audits: CreateAuditLogData[] = [];
  const emails: EnqueueEmailData[] = [];
  const after: number[] = [];
  const restores = new ShopRestoresRepository();
  const service = new ShopRestoreService({
    restores,
    candidates: new ShopRestoreRepository(),
    files: new ShopRestoreFileRepository(),
    ports: {
      shopFile,
      source: {
        async fetchAt(tenantId, isoUtc, out) {
          expect(tenantId).toBe(SHOP);
          fetchCalls.push(isoUtc);
          await fetchImpl.fn(isoUtc, out);
        },
      },
      dirs,
      createDbSql: () => CREATE_DB_SQL,
      afterRestore: (id) => {
        events.push("afterRestore");
        after.push(id);
      },
      supportEmail: () => "help@liratek.test",
    },
    userEmail: () => ({ email: "admin@cornertech.test", email_verified_at: "2026-01-01T00:00:00Z" }),
    audit: (e) => {
      events.push("audit");
      audits.push(e);
    },
    syncDirectory: () => {
      events.push("directory");
    },
    enqueueEmail: (e) => {
      events.push("email");
      emails.push(e);
    },
    ...overrides,
  });
  return { service, dirs, live, history, fetchCalls, fetchImpl, swapCalls, swapImpl, events, audits, emails, after, restores };
}

const actor = (over: Partial<RestoreActor> = {}): RestoreActor => ({
  tenantId: SHOP,
  userId: ADMIN,
  username: "admin",
  role: "admin",
  now: NOW,
  ...over,
});

const workFiles = (h: Harness): string[] => (fs.existsSync(h.dirs.workDir) ? fs.readdirSync(h.dirs.workDir) : []);

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-restore-svc-"));
  template = path.join(tmp, "template.db");
  const db = new Database(template);
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  closeDatabase();
  db.close();

  platform = new Database(":memory:");
  platform.exec(CREATE_DB_SQL);
  initDatabase(platform);
  runMigrations(platform);
  platform
    .prepare(`INSERT INTO tenants (id, name, slug, status, contact_email, created_at, updated_at) VALUES (?, ?, 'cornertech', 'active', 'owner@cornertech.test', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`)
    .run(SHOP, SHOP_NAME);
  platform.prepare(`INSERT INTO tenants (id, name, slug, status) VALUES (4, 'Rival Phones', 'rival', 'active')`).run();
});

afterAll(() => {
  closeDatabase();
  platform.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  platform.exec(`DELETE FROM shop_restores`);
  platform.prepare(`UPDATE tenants SET created_at = '2026-01-01 00:00:00' WHERE id = ?`).run(SHOP);
});

const T_EARLIER = iso(BASE - 30 * MIN);

describe("prepare — restore to a time (T031)", () => {
  it("builds a prepared candidate from the source at that moment, with the preview and the shop name", async () => {
    const h = harness();
    const out = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 120 });
    if (!out.ok) throw new Error(`refused: ${out.code}`);
    expect(h.fetchCalls).toEqual([T_EARLIER]);
    expect(out.data.shopName).toBe(SHOP_NAME);
    expect(out.data.preview.restoredTo).toBe(T_EARLIER);
    expect(out.data.preview).toHaveProperty("lastSaleInCopy");
    expect(out.data.preview).toHaveProperty("lost");
    expect(out.data.preview.youAreMissing).toBe(false);
    expect(out.data.expiresAt).toBe(iso(BASE + 16 * MIN));

    const row = h.restores.getById(out.data.restoreId)!;
    expect(row).toMatchObject({ target_tenant_id: SHOP, kind: "time", status: "prepared", restored_to: T_EARLIER, client_tz_offset_min: 120, requested_by_user_id: ADMIN, requested_by_name: "admin", prepared_at: NOW });
    expect(fs.existsSync(row.candidate_path!)).toBe(true);
    expect(row.candidate_path!.startsWith(h.dirs.workDir)).toBe(true);
    expect(clientNames(row.candidate_path!)).toEqual(["Early client"]);
    expect(countRows(row.candidate_path!, "sessions")).toBe(0);
    // the live file is not touched by prepare
    expect(clientNames(h.live)).toEqual(["Early client", "Late client"]);
  });

  it.each([
    ["in the future (vs the request's own instant)", iso(BASE + 2 * MIN), "OUT_OF_WINDOW"],
    ["older than 7 days", iso(BASE + MIN - 7 * 24 * 60 * MIN - 1000), "OUT_OF_WINDOW"],
  ])("refuses a moment %s without fetching anything", async (_label, when, code) => {
    const h = harness();
    const out = await h.service.prepare(actor(), { kind: "time", restoredTo: when, clientTzOffsetMin: 0 });
    expect(out).toMatchObject({ ok: false, code });
    expect(h.fetchCalls).toEqual([]);
    expect(workFiles(h)).toEqual([]);
  });

  it("refuses a moment before the shop existed (platform created_at, SQLite text)", async () => {
    const h = harness();
    platform.prepare(`UPDATE tenants SET created_at = ? WHERE id = ?`).run(new Date(BASE - 10 * MIN).toISOString().replace("T", " ").slice(0, 19), SHOP);
    const out = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    expect(out).toMatchObject({ ok: false, code: "BEFORE_SHOP_EXISTED" });
    expect(h.fetchCalls).toEqual([]);
  });

  // The temporary paired-PC block (T031) is gone now the replay hold and
  // SHOP_RESTORING have shipped (T042–T044): a shop with a paired till PC
  // restores like any other (rule 24 — guard that the old refusal is not taken).
  it("a shop with an active paired till PC can prepare a restore", async () => {
    const h = harness();
    addPairedPc(h.live);
    const out = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    expect(out).toMatchObject({ ok: true });
    expect(h.fetchCalls).toEqual([T_EARLIER]);
  });

  it("passes NO_BACKUP_AT_TIME through and leaves nothing in the work dir", async () => {
    const h = harness();
    h.fetchImpl.fn = async () => {
      throw new RestoreSourceError("NO_BACKUP_AT_TIME", "no matching backup files available");
    };
    const out = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    expect(out).toMatchObject({ ok: false, code: "NO_BACKUP_AT_TIME" });
    expect(workFiles(h)).toEqual([]);
  });

  describe("clamp when the source says the moment does not exist", () => {
    it("is OUT_OF_WINDOW when the latest copy has a write after the moment (moment is before the kept history)", async () => {
      const h = harness();
      h.fetchImpl.fn = async (when, out) => {
        if (when !== null) throw new RestoreSourceError("OUT_OF_WINDOW", "timestamp does not exist");
        fs.copyFileSync(h.live, out); // latest = rows written at BASE > T_EARLIER
      };
      const out = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
      expect(out).toMatchObject({ ok: false, code: "OUT_OF_WINDOW" });
      expect(h.fetchCalls).toEqual([T_EARLIER, null]);
      expect(workFiles(h)).toEqual([]);
      expect(h.restores.getOpenForTenant(SHOP)).toBeNull();
    });

    it("uses the latest copy when the moment is after the shop's last write", async () => {
      const h = harness();
      const afterLastWrite = iso(BASE + 30_000); // rows were written at ~BASE; actor.now = BASE + 1 min
      h.fetchImpl.fn = async (when, out) => {
        if (when !== null) throw new RestoreSourceError("OUT_OF_WINDOW", "timestamp does not exist");
        fs.copyFileSync(h.live, out);
      };
      const out = await h.service.prepare(actor(), { kind: "time", restoredTo: afterLastWrite, clientTzOffsetMin: 0 });
      if (!out.ok) throw new Error(`refused: ${out.code}`);
      expect(h.fetchCalls).toEqual([afterLastWrite, null]);
      expect(out.data.preview.restoredTo).toBe(afterLastWrite);
    });
  });

  it("one prepare at a time per shop: a second concurrent prepare is RESTORE_RUNNING", async () => {
    const h = harness();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.fetchImpl.fn = async (_w, out) => {
      await gate;
      fs.copyFileSync(h.history, out);
    };
    const first = h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    const second = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    expect(second).toMatchObject({ ok: false, code: "RESTORE_RUNNING" });
    release();
    expect((await first).ok).toBe(true);
    // the lock is released afterwards (try/finally)
    const third = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    expect(third.ok).toBe(true);
  });

  it("another admin's open restore blocks a new prepare; the same admin's earlier prepared one is replaced", async () => {
    const h = harness();
    const mine = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    if (!mine.ok) throw new Error(mine.code);
    const oldCandidate = h.restores.getById(mine.data.restoreId)!.candidate_path!;
    const theirs = await h.service.prepare(actor({ userId: 2, username: "other" }), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    expect(theirs).toMatchObject({ ok: false, code: "RESTORE_RUNNING" });
    const again = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    if (!again.ok) throw new Error(again.code);
    expect(h.restores.getById(mine.data.restoreId)!.status).toBe("expired");
    expect(fs.existsSync(oldCandidate)).toBe(false);
  });

  it("a failure after the fetch is PREPARE_FAILED, deletes the candidate and records nothing open", async () => {
    const h = harness({
      candidates: {
        prepareCandidate: () => {
          throw new Error("boom");
        },
        previewCandidate: () => {
          throw new Error("unreachable");
        },
      },
    });
    const out = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    expect(out).toMatchObject({ ok: false, code: "PREPARE_FAILED" });
    expect(workFiles(h)).toEqual([]);
    expect(h.restores.getOpenForTenant(SHOP)).toBeNull();
  });
});

describe("confirm (T020/T027)", () => {
  async function prepared(h: Harness, who: RestoreActor = actor()): Promise<number> {
    const out = await h.service.prepare(who, { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 120 });
    if (!out.ok) throw new Error(out.code);
    return out.data.restoreId;
  }

  it("NAME_MISMATCH when the typed name is not exactly the platform name; the restore stays prepared", async () => {
    const h = harness();
    const id = await prepared(h);
    for (const typed of ["corner tech", "Corner Tech ", "CornerTech"]) {
      const out = await h.service.confirm(actor(), { restoreId: id, typedShopName: typed });
      expect(out).toMatchObject({ ok: false, code: "NAME_MISMATCH" });
    }
    expect(h.swapCalls).toEqual([]);
    expect(h.restores.getById(id)!.status).toBe("prepared");
  });

  it("NOT_YOURS for another admin, and for another shop's restore", async () => {
    const h = harness();
    const id = await prepared(h);
    expect(await h.service.confirm(actor({ userId: 2 }), { restoreId: id, typedShopName: SHOP_NAME })).toMatchObject({ ok: false, code: "NOT_YOURS" });
    expect(await h.service.confirm(actor({ tenantId: 4 }), { restoreId: id, typedShopName: SHOP_NAME })).toMatchObject({ ok: false, code: "NOT_YOURS" });
    expect(h.swapCalls).toEqual([]);
  });

  it("EXPIRED after 15 minutes: the row is expired and the candidate deleted", async () => {
    const h = harness();
    const id = await prepared(h);
    const cand = h.restores.getById(id)!.candidate_path!;
    const out = await h.service.confirm(actor({ now: iso(BASE + 16 * MIN + 1000) }), { restoreId: id, typedShopName: SHOP_NAME });
    expect(out).toMatchObject({ ok: false, code: "EXPIRED" });
    expect(h.restores.getById(id)!.status).toBe("expired");
    expect(fs.existsSync(cand)).toBe(false);
    expect(h.swapCalls).toEqual([]);
  });

  it("a paired till PC appearing between prepare and confirm does not block the confirm", async () => {
    const h = harness();
    const id = await prepared(h);
    addPairedPc(h.live);
    const out = await h.service.confirm(actor(), { restoreId: id, typedShopName: SHOP_NAME });
    expect(out).toMatchObject({ ok: true });
    expect(h.swapCalls).toHaveLength(1);
  });

  it("a swap failure is RESTORE_FAILED: row failed, live shop unchanged, no audit/email (FR-012)", async () => {
    const h = harness();
    const id = await prepared(h);
    h.swapImpl.fail = true;
    const before = fs.readFileSync(h.live);
    const out = await h.service.confirm(actor(), { restoreId: id, typedShopName: SHOP_NAME });
    expect(out).toMatchObject({ ok: false, code: "RESTORE_FAILED" });
    expect(h.restores.getById(id)).toMatchObject({ status: "failed", error: "disk full" });
    expect(fs.readFileSync(h.live).equals(before)).toBe(true);
    expect(h.audits).toEqual([]);
    expect(h.emails).toEqual([]);
    expect(workFiles(h)).toEqual([]);
  });

  it("success: swap, done row, then audit, directory sync, owner + admin email, merge round; every session gone", async () => {
    const h = harness();
    const id = await prepared(h);
    const out = await h.service.confirm(actor(), { restoreId: id, typedShopName: SHOP_NAME });
    if (!out.ok) throw new Error(out.code);
    expect(out.data).toEqual({ restoreId: id, restoredTo: T_EARLIER, beforeCopy: { takenAt: NOW } });

    expect(h.swapCalls).toHaveLength(1);
    expect(h.swapCalls[0]).toMatchObject({ tenantId: SHOP, beforeCopyDir: h.dirs.pointsDir });
    expect(h.swapCalls[0]!.stampUtc).toMatch(/^\d{8}T\d{6}Z$/);
    const row = h.restores.getById(id)!;
    expect(row).toMatchObject({ status: "done", finished_at: NOW, started_at: NOW });
    expect(fs.existsSync(row.before_copy_path!)).toBe(true);

    // audit AFTER the swap; the moment shown in the shop's time (+120 min)
    expect(h.events.indexOf("audit")).toBeGreaterThan(h.events.indexOf("swap"));
    expect(h.audits).toHaveLength(1);
    const local = new Date(Date.parse(T_EARLIER) + 120 * MIN);
    const pad = (x: number) => String(x).padStart(2, "0");
    const shown = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
    expect(h.audits[0]).toMatchObject({ user_id: ADMIN, username: "admin", role: "admin", action: "shop_restore", entity_type: "shop", summary: `Shop restored to ${shown}` });
    expect(h.events).toContain("directory");
    expect(h.emails.map((e) => e.toEmail).sort()).toEqual(["admin@cornertech.test", "owner@cornertech.test"]);
    expect(new Set(h.emails.map((e) => e.idempotencyKey)).size).toBe(2);
    expect(h.emails[0]).toMatchObject({ template: "shop-restored", now: NOW });
    expect(h.emails[0]!.data).toMatchObject({ shopName: SHOP_NAME, restoredToText: shown, byName: "admin" });
    expect(h.after).toEqual([SHOP]);

    // the live shop is the candidate: early client only, NO session survives,
    // so the caller's next request finds no session row (→ 401).
    expect(clientNames(h.live)).toEqual(["Early client"]);
    expect(countRows(h.live, "sessions")).toBe(0);
    expect(workFiles(h)).toEqual([]);
  });

  it("one email when the admin's address is the owner's, and an email failure never fails the restore", async () => {
    const h = harness({
      userEmail: () => ({ email: "OWNER@cornertech.test", email_verified_at: "2026-01-01T00:00:00Z" }),
      enqueueEmail: () => {
        throw new Error("smtp down");
      },
    });
    const id = await prepared(h);
    const out = await h.service.confirm(actor(), { restoreId: id, typedShopName: SHOP_NAME });
    expect(out.ok).toBe(true);
    expect(h.restores.getById(id)!.status).toBe("done");
  });

  it("a done restore cannot be confirmed twice (EXPIRED)", async () => {
    const h = harness();
    const id = await prepared(h);
    expect((await h.service.confirm(actor(), { restoreId: id, typedShopName: SHOP_NAME })).ok).toBe(true);
    expect(await h.service.confirm(actor(), { restoreId: id, typedShopName: SHOP_NAME })).toMatchObject({ ok: false, code: "EXPIRED" });
    expect(h.swapCalls).toHaveLength(1);
  });
});

describe("cancel", () => {
  it("expires the prepared restore and deletes its candidate; another admin cannot", async () => {
    const h = harness();
    const out = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    if (!out.ok) throw new Error(out.code);
    expect(h.service.cancel(actor({ userId: 2 }), { restoreId: out.data.restoreId })).toMatchObject({ ok: false, code: "NOT_YOURS" });
    expect(h.service.cancel(actor(), { restoreId: out.data.restoreId })).toEqual({ ok: true, data: { restoreId: out.data.restoreId } });
    expect(h.restores.getById(out.data.restoreId)!.status).toBe("expired");
    expect(workFiles(h)).toEqual([]);
  });
});

describe("undo — restore a before-restore copy (T050)", () => {
  async function restoreOnce(h: Harness): Promise<number> {
    const p = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    if (!p.ok) throw new Error(p.code);
    const c = await h.service.confirm(actor(), { restoreId: p.data.restoreId, typedShopName: SHOP_NAME });
    if (!c.ok) throw new Error(c.code);
    return p.data.restoreId;
  }

  it("prepares the before-copy of the same shop: same checks, restoredTo = when the copy was taken", async () => {
    const h = harness();
    const id = await restoreOnce(h);
    expect(clientNames(h.live)).toEqual(["Early client"]);
    const out = await h.service.prepare(actor(), { kind: "undo", restoreId: id, clientTzOffsetMin: 0 });
    if (!out.ok) throw new Error(out.code);
    expect(out.data.preview.restoredTo).toBe(NOW);
    const row = h.restores.getById(out.data.restoreId)!;
    expect(row.kind).toBe("undo");
    expect(clientNames(row.candidate_path!)).toEqual(["Early client", "Late client"]);
    // the before-copy itself is never modified (a copy is prepared)
    const before = h.restores.getById(id)!.before_copy_path!;
    expect(countRows(before, "sessions")).toBe(1);
    // a later request (the before-copy stamp is per second)
    const c = await h.service.confirm(actor({ now: iso(BASE + 3 * MIN) }), { restoreId: out.data.restoreId, typedShopName: SHOP_NAME });
    expect(c).toMatchObject({ ok: true });
    expect(clientNames(h.live)).toEqual(["Early client", "Late client"]);
  });

  it("refuses another shop's restore, a copy older than 7 days, and a deleted copy", async () => {
    const h = harness();
    const id = await restoreOnce(h);
    expect(await h.service.prepare(actor({ tenantId: 4 }), { kind: "undo", restoreId: id, clientTzOffsetMin: 0 })).toMatchObject({ ok: false, code: "NOT_YOURS" });
    expect(await h.service.prepare(actor({ now: iso(BASE + MIN + 7 * 24 * 60 * MIN + 1000) }), { kind: "undo", restoreId: id, clientTzOffsetMin: 0 })).toMatchObject({ ok: false, code: "OUT_OF_WINDOW" });
    fs.rmSync(h.restores.getById(id)!.before_copy_path!);
    expect(await h.service.prepare(actor(), { kind: "undo", restoreId: id, clientTzOffsetMin: 0 })).toMatchObject({ ok: false, code: "NO_BACKUP_AT_TIME" });
    expect(workFiles(h)).toEqual([]);
  });

  it("refuses a before-copy that is damaged (integrity check)", async () => {
    const h = harness();
    const id = await restoreOnce(h);
    const before = h.restores.getById(id)!.before_copy_path!;
    const buf = fs.readFileSync(before);
    buf.fill(0x5a, 4096 * 2, Math.min(buf.length, 4096 * 6));
    fs.writeFileSync(before, buf);
    expect(await h.service.prepare(actor(), { kind: "undo", restoreId: id, clientTzOffsetMin: 0 })).toMatchObject({ ok: false, code: "FILE_DAMAGED" });
  });
});

describe("points (T032)", () => {
  it("earliest = now − 7 days for an old shop; latest = now; before-copies and the last restore", async () => {
    const h = harness();
    const empty = h.service.points(actor());
    expect(empty).toEqual({ earliest: iso(BASE + MIN - 7 * 24 * 60 * MIN), latest: NOW, shopName: SHOP_NAME, beforeCopies: [], lastRestore: null });

    const p = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    if (!p.ok) throw new Error(p.code);
    await h.service.confirm(actor(), { restoreId: p.data.restoreId, typedShopName: SHOP_NAME });
    const pts = h.service.points(actor());
    expect(pts.beforeCopies).toEqual([{ restoreId: p.data.restoreId, takenAt: NOW, byName: "admin" }]);
    expect(pts.lastRestore).toEqual({ restoreId: p.data.restoreId, restoredTo: T_EARLIER, finishedAt: NOW, byName: "admin" });

    // a before-copy whose file is gone is not offered
    fs.rmSync(h.restores.getById(p.data.restoreId)!.before_copy_path!);
    expect(h.service.points(actor()).beforeCopies).toEqual([]);
  });

  it("earliest = the shop's creation when the shop is younger than 7 days", () => {
    const h = harness();
    platform.prepare(`UPDATE tenants SET created_at = '2026-11-09 08:30:00' WHERE id = ?`).run(SHOP);
    expect(h.service.points(actor({ now: "2026-11-10T12:00:00.000Z" })).earliest).toBe("2026-11-09T08:30:00.000Z");
  });
});

describe("sweep (T028)", () => {
  it("expires prepared restores older than 15 minutes and deletes their candidates", async () => {
    const h = harness();
    const p = await h.service.prepare(actor(), { kind: "time", restoredTo: T_EARLIER, clientTzOffsetMin: 0 });
    if (!p.ok) throw new Error(p.code);
    expect(h.service.sweep(iso(BASE + 10 * MIN)).expired).toBe(0);
    expect(h.service.sweep(iso(BASE + 17 * MIN)).expired).toBe(1);
    expect(h.restores.getById(p.data.restoreId)!.status).toBe("expired");
    expect(workFiles(h)).toEqual([]);
  });

  it("deletes before-copies older than 7 days except the newest per shop", () => {
    const h = harness();
    const dir = path.join(h.dirs.pointsDir, String(SHOP));
    fs.mkdirSync(dir, { recursive: true });
    for (const stamp of ["20261101T100000Z", "20261102T100000Z", "20261109T100000Z"]) fs.writeFileSync(path.join(dir, `before-${stamp}.sqlite`), "x");
    const other = path.join(h.dirs.pointsDir, "9");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, "before-20261001T100000Z.sqlite"), "x");
    const res = h.service.sweep("2026-11-10T12:00:00.000Z");
    expect(res.beforeCopiesDeleted).toBe(2);
    expect(fs.readdirSync(dir).sort()).toEqual(["before-20261109T100000Z.sqlite"]);
    expect(fs.readdirSync(other)).toEqual(["before-20261001T100000Z.sqlite"]); // newest of shop 9, kept
  });
});
