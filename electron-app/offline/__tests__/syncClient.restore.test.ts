/**
 * LIRA-377 T045 — the till PC's side of a web shop restore
 * (contracts/offline-checkin.md). Fake fetch + fake clock; real files and
 * real better-sqlite3 copies (Node ABI), so mirrors are listed and verified
 * exactly as in production.
 *
 * Every case starts with a FRESH mirror on disk and a recent
 * `lastSnapshotAt`, so the normal timer path would NOT download — a
 * snapshot request in these tests can only come from the restore branch.
 *
 *  - a new restore id → mirror copies discarded (never the open file, never
 *    the working copy), `refreshCopy()` at once whatever the state, the id
 *    stored, the banner notice set;
 *  - the same id → nothing;
 *  - first check-in after upgrading (no id stored) with a restore that is
 *    not newer than this PC's copy → the id is stored, nothing else;
 *  - `lastSeq` / `lastUsedIds` / `serverMaxSeq` / `serverMaxOfflineIds`
 *    never reset;
 *  - a refresh that fails is retried on the next check-in;
 *  - `SHOP_RESTORING` → plain retry next tick, never "re-pair".
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { PairingStore, type SafeStorageLike } from "../pairingStore";
import {
  SyncClient,
  type FetchLike,
  type FetchResponseLike,
  type PcState,
} from "../syncClient";
import { fileStamp, listMirrors, workingCopyPath } from "../offlineFiles";

const safe: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().slice(4),
};
const KEY = `ltd_7_abcdef012345_${"a".repeat(64)}`;
const APP = 210;
const OLD_COPY = "c0000000-0000-4000-8000-0000000000a1";
const NEW_COPY = "c0000000-0000-4000-8000-0000000000b2";

let dir = "";
let store: PairingStore;
let clock = Date.parse("2026-11-10T12:30:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** A copy database file at `file` with one offline_copy_meta row. */
function writeCopy(file: string, copyId: string, builtAtMs: number): void {
  const db = new Database(file);
  db.exec(`CREATE TABLE offline_copy_meta (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, copy_id TEXT, built_at TEXT,
    schema_version INTEGER, high_water_json TEXT, device_no INTEGER, opened_at TEXT, created_at TEXT, updated_at TEXT)`);
  db.exec(`CREATE TABLE marker (id INTEGER PRIMARY KEY, note TEXT)`);
  db.prepare(`INSERT INTO marker (note) VALUES ('offline sale')`).run();
  db.prepare(
    `INSERT INTO offline_copy_meta (tenant_id, copy_id, built_at, schema_version, high_water_json, created_at, updated_at)
     VALUES (7, ?, ?, ?, '{}', 'x', 'x')`,
  ).run(copyId, iso(builtAtMs), APP);
  db.close();
}

function writeMirror(copyId: string, builtAtMs: number): string {
  const file = path.join(dir, `mirror-${fileStamp(builtAtMs)}.db`);
  writeCopy(file, copyId, builtAtMs);
  return file;
}

function copyBytes(copyId: string, builtAtMs: number): Buffer {
  const file = path.join(dir, `src-${Math.random().toString(16).slice(2)}`);
  writeCopy(file, copyId, builtAtMs);
  const bytes = fs.readFileSync(file);
  fs.unlinkSync(file);
  return zlib.gzipSync(bytes);
}

function jsonRes(body: unknown): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (n: string) =>
        n.toLowerCase() === "content-type" ? "application/json" : null,
    },
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function binRes(bytes: Buffer, copyId: string): FetchResponseLike {
  const h: Record<string, string> = {
    "content-type": "application/octet-stream",
    "x-copy-id": copyId,
    "x-snapshot-schema-version": String(APP),
    "x-snapshot-tenant-id": "7",
  };
  return {
    ok: true,
    status: 200,
    headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
    json: async () => {
      throw new Error("not json");
    },
    arrayBuffer: async () =>
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
  };
}

interface Restore {
  id: number;
  restoredTo: string | null;
  restoredAt: string | null;
  byName: string | null;
}

const RESTORE_13: Restore = {
  id: 13,
  restoredTo: "2026-11-10T12:00:00.000Z",
  restoredAt: "2026-11-10T12:20:09.000Z",
  byName: "owner",
};

/** The server: check-in answers `restore`; the snapshot serves NEW_COPY. */
function server(
  opts: {
    restore?: Restore | null;
    checkinEnvelope?: Record<string, unknown>;
    snapshotFails?: boolean;
  } = {},
): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url) => {
      urls.push(url);
      if (url.endsWith("/checkin")) {
        if (opts.checkinEnvelope) return jsonRes(opts.checkinEnvelope);
        return jsonRes({
          success: true,
          data: {
            serverSchemaVersion: APP,
            serverTime: iso(clock),
            snapshotDue: false,
            maxSeq: 12,
            maxOfflineIds: { sales: 3_000_000_000_007 },
            heldItems: [],
            renumberUnsent: false,
            restore: opts.restore === undefined ? null : opts.restore,
          },
        });
      }
      if (opts.snapshotFails) throw new Error("ECONNRESET");
      return binRes(copyBytes(NEW_COPY, clock), NEW_COPY);
    },
  };
}

function client(
  fetchImpl: FetchLike,
  over: { state?: PcState; openFile?: string | null } = {},
): SyncClient {
  return new SyncClient({
    offlineDir: dir,
    store,
    fetch: fetchImpl,
    now: () => clock,
    appVersion: "1.2.3",
    appSchemaVersion: APP,
    getState: () => over.state ?? "standby",
    pendingCount: () => 0,
    openFile: () => over.openFile ?? null,
    DatabaseCtor: Database,
  });
}

const snapshots = (urls: string[]) =>
  urls.filter((u) => u.includes("/snapshot"));

let freshMirror = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lira377-restore-"));
  store = new PairingStore(dir, { safeStorage: safe });
  store.savePairing(
    {
      tenantId: 7,
      shopSlug: "cornertech",
      shopName: "Corner Tech",
      serverUrl: "https://api.test",
      deviceNo: 3,
      serverSchemaVersion: APP,
    },
    KEY,
  );
  clock = Date.parse("2026-11-10T12:30:00.000Z");
  // a copy built and downloaded 1 minute ago: the timer would not refresh
  freshMirror = writeMirror(OLD_COPY, clock - 60_000);
  store.update({
    lastSeq: 40,
    lastUsedIds: { sales: 5 },
    serverMaxSeq: 12,
    serverMaxOfflineIds: { sales: 3_000_000_000_007 },
    lastSnapshotAt: iso(clock - 60_000),
    copyId: OLD_COPY,
  });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function expectCountersKept(): void {
  expect(store.read()).toMatchObject({
    lastSeq: 40,
    lastUsedIds: { sales: 5 },
    serverMaxSeq: 12,
    serverMaxOfflineIds: { sales: 3_000_000_000_007 },
  });
}

describe("a restore the PC has not seen", () => {
  it("discards the mirror copies, downloads a new copy at once, stores the id and shows the notice", async () => {
    store.update({ lastRestoreId: 12 });
    const s = server({ restore: RESTORE_13 });
    await client(s.fetch).checkin();

    expect(fs.existsSync(freshMirror)).toBe(false);
    expect(snapshots(s.urls)).toHaveLength(1);
    expect(listMirrors(dir, Database).map((m) => m.copyId)).toEqual([NEW_COPY]);
    expect(store.read()).toMatchObject({
      lastRestoreId: 13,
      restoreNotice: {
        restoreId: 13,
        restoredTo: "2026-11-10T12:00:00.000Z",
        restoredAt: "2026-11-10T12:20:09.000Z",
        byName: "owner",
      },
    });
    expectCountersKept();
  });

  it("never deletes the mirror the app has open (standby), only the others", async () => {
    store.update({ lastRestoreId: 12 });
    const older = writeMirror(OLD_COPY, clock - 120_000);
    const s = server({ restore: RESTORE_13 });
    await client(s.fetch, { openFile: freshMirror }).checkin();

    expect(fs.existsSync(freshMirror)).toBe(true);
    expect(fs.existsSync(older)).toBe(false);
    expect(snapshots(s.urls)).toHaveLength(1);
    expect(store.read()?.restoreNotice?.restoreId).toBe(13);
  });

  it("offline PC: the working copy is never touched; the copy is still refreshed and the notice set", async () => {
    store.update({ lastRestoreId: 12 });
    const work = workingCopyPath(dir);
    writeCopy(work, OLD_COPY, clock - 3_600_000);
    const before = fs.readFileSync(work);
    const s = server({ restore: RESTORE_13 });
    await client(s.fetch, { state: "offline", openFile: work }).checkin();

    expect(fs.existsSync(work)).toBe(true);
    expect(fs.readFileSync(work).equals(before)).toBe(true);
    expect(fs.existsSync(freshMirror)).toBe(false);
    expect(snapshots(s.urls)).toHaveLength(1);
    expect(store.read()).toMatchObject({
      lastRestoreId: 13,
      restoreNotice: { restoreId: 13, byName: "owner" },
    });
    expectCountersKept();
  });

  it("a refresh that fails is retried on the next check-in even though the copy timer is not due", async () => {
    store.update({ lastRestoreId: 12 });
    const down = server({ restore: RESTORE_13, snapshotFails: true });
    await client(down.fetch).checkin();
    expect(snapshots(down.urls)).toHaveLength(1);
    expect(store.read()?.lastRestoreId).toBe(13);

    clock += 30_000;
    const up = server({ restore: RESTORE_13 });
    await client(up.fetch).checkin();
    expect(snapshots(up.urls)).toHaveLength(1);
    expect(listMirrors(dir, Database).map((m) => m.copyId)).toEqual([NEW_COPY]);

    // once refreshed, the same id does nothing more
    clock += 30_000;
    const again = server({ restore: RESTORE_13 });
    await client(again.fetch).checkin();
    expect(snapshots(again.urls)).toEqual([]);
  });
});

describe("nothing new", () => {
  it("the same id → no discard, no download, no notice", async () => {
    store.update({ lastRestoreId: 13 });
    const s = server({ restore: RESTORE_13 });
    await client(s.fetch).checkin();

    expect(fs.existsSync(freshMirror)).toBe(true);
    expect(snapshots(s.urls)).toEqual([]);
    expect(store.read()?.restoreNotice ?? null).toBeNull();
    expectCountersKept();
  });

  it("no restore at all → nothing", async () => {
    const s = server({ restore: null });
    await client(s.fetch).checkin();
    expect(fs.existsSync(freshMirror)).toBe(true);
    expect(snapshots(s.urls)).toEqual([]);
    expect(store.read()?.lastRestoreId ?? null).toBeNull();
    expect(store.read()?.restoreNotice ?? null).toBeNull();
  });

  it("first check-in after upgrading, restore older than this PC's copy → only the id is stored", async () => {
    // no lastRestoreId in pairing.json (an older desktop build wrote it)
    const old: Restore = {
      ...RESTORE_13,
      restoredAt: iso(clock - 3 * 86_400_000),
    };
    const s = server({ restore: old });
    await client(s.fetch).checkin();

    expect(fs.existsSync(freshMirror)).toBe(true);
    expect(snapshots(s.urls)).toEqual([]);
    expect(store.read()?.lastRestoreId).toBe(13);
    expect(store.read()?.restoreNotice ?? null).toBeNull();
    expectCountersKept();
  });

  it("first check-in after upgrading, restore NEWER than this PC's copy → handled like a new restore", async () => {
    const recent: Restore = { ...RESTORE_13, restoredAt: iso(clock - 10_000) };
    const s = server({ restore: recent });
    await client(s.fetch).checkin();

    expect(fs.existsSync(freshMirror)).toBe(false);
    expect(snapshots(s.urls)).toHaveLength(1);
    expect(store.read()).toMatchObject({
      lastRestoreId: 13,
      restoreNotice: { restoreId: 13 },
    });
    expectCountersKept();
  });
});

describe("SHOP_RESTORING during the swap", () => {
  it("check-in: plain refusal, retried next tick — never 're-pair', counters untouched", async () => {
    const restoring = server({
      checkinEnvelope: {
        success: false,
        code: "SHOP_RESTORING",
        error: "The shop is being restored, try again in a moment",
      },
    });
    const c = client(restoring.fetch);
    await c.checkin();
    expect(store.read()?.lastError).toBe(
      "The shop is being restored, try again in a moment",
    );
    expect(store.read()?.lastError).not.toMatch(/re-pair/i);
    expect(c.isReachable()).toBe(true);
    expect(snapshots(restoring.urls)).toEqual([]);
    expect(fs.existsSync(freshMirror)).toBe(true);
    expectCountersKept();

    // next tick: the server is back and the message clears
    clock += 30_000;
    const back = server({ restore: null });
    await client(back.fetch).checkin();
    expect(store.read()?.lastError).toBeNull();
  });
});
