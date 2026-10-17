/**
 * LIRA-306 T119 — the PC's check-in and copy refresh (FR-004, FR-006,
 * contracts/rest-offline.md). Fake fetch + fake clock; real files and a real
 * better-sqlite3 copy (Node ABI) so the integrity check is the real one.
 *
 *  - check-in every 30 s while running; the server's `maxSeq` /
 *    `maxOfflineIds` / data version are stored in pairing.json;
 *  - `unreachableSeconds` counts from the last successful contact;
 *  - copy refresh when due (`snapshotDue` or the newest copy ≥ 5 min old),
 *    into `mirror-<ts>.db`, integrity-checked, newest 2 kept, never the open
 *    one; a broken or foreign download is discarded; never in offline mode.
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
} from "../syncClient";
import { listMirrors } from "../offlineFiles";

const safe: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().slice(4),
};
const KEY = `ltd_7_abcdef012345_${"a".repeat(64)}`;
const APP = 210;

let dir = "";
let store: PairingStore;
let clock = Date.parse("2026-10-11T10:00:00.000Z");

function makeCopy(
  over: {
    copyId?: string;
    tenantId?: number;
    schemaVersion?: number;
    corrupt?: boolean;
  } = {},
): Buffer {
  const file = path.join(dir, `src-${Math.random().toString(16).slice(2)}.db`);
  const db = new Database(file);
  db.exec(`CREATE TABLE offline_copy_meta (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, copy_id TEXT, built_at TEXT,
    schema_version INTEGER, high_water_json TEXT, device_no INTEGER, opened_at TEXT, created_at TEXT, updated_at TEXT)`);
  db.prepare(
    `INSERT INTO offline_copy_meta (tenant_id, copy_id, built_at, schema_version, high_water_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, '{}', 'x', 'x')`,
  ).run(
    over.tenantId ?? 7,
    over.copyId ?? "c0000000-0000-4000-8000-000000000001",
    new Date(clock).toISOString(),
    over.schemaVersion ?? APP,
  );
  db.close();
  let bytes = fs.readFileSync(file);
  fs.unlinkSync(file);
  if (over.corrupt)
    bytes = Buffer.concat([
      bytes.subarray(0, 100),
      Buffer.alloc(bytes.length - 100, 7),
    ]);
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

function binRes(
  bytes: Buffer,
  headers: Record<string, string>,
): FetchResponseLike {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: true,
    status: 200,
    headers: { get: (n: string) => lower[n.toLowerCase()] ?? null },
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

const checkinOk = (over: Record<string, unknown> = {}) =>
  jsonRes({
    success: true,
    data: {
      serverSchemaVersion: APP,
      serverTime: new Date(clock).toISOString(),
      snapshotDue: false,
      maxSeq: 12,
      maxOfflineIds: { sales: 3_000_000_000_007 },
      heldItems: [{ eventId: "e1", label: "Debt repayment", amount: null }],
      renumberUnsent: false,
      ...over,
    },
  });

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function client(
  fetchImpl: FetchLike,
  over: {
    state?: () => "standby" | "blocked" | "offline" | "finishing";
    openFile?: () => string | null;
  } = {},
) {
  return new SyncClient({
    offlineDir: dir,
    store,
    fetch: fetchImpl,
    now: () => clock,
    appVersion: "1.2.3",
    appSchemaVersion: APP,
    getState: over.state ?? (() => "standby"),
    pendingCount: () => 0,
    openFile: over.openFile ?? (() => null),
    DatabaseCtor: Database,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lira306-sync-"));
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
  clock = Date.parse("2026-10-11T10:00:00.000Z");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("check-in", () => {
  it("POSTs state/pending/versions/clock with the device key and stores the server's counters", async () => {
    const calls: Call[] = [];
    const c = client(async (url, init) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: init?.headers ?? {},
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return checkinOk();
    });
    await c.checkin();
    // (no copy on disk yet, so a download follows the check-in — covered below)
    const checkins = calls.filter((x) => x.url.endsWith("/checkin"));
    expect(checkins).toHaveLength(1);
    expect(checkins[0]).toMatchObject({
      url: "https://api.test/api/offline/checkin",
      method: "POST",
      headers: { "X-LiraTek-Device-Key": KEY },
      body: {
        state: "standby",
        pendingCount: 0,
        appVersion: "1.2.3",
        schemaVersion: APP,
        pcClock: "2026-10-11T10:00:00.000Z",
      },
    });
    expect(store.read()).toMatchObject({
      serverMaxSeq: 12,
      serverMaxOfflineIds: { sales: 3_000_000_000_007 },
      serverSchemaVersion: APP,
      heldItems: [{ eventId: "e1", label: "Debt repayment", amount: null }],
    });
    expect(c.unreachableSeconds()).toBe(0);
    expect(c.isReachable()).toBe(true);
  });

  // LIRA-332 (T059). Failing-first: before syncClient stored it, `trial`
  // was absent from pairing.json.
  it("stores the shop's trial state from check-in; an older server (no field) reads as null", async () => {
    const trial = { standing: "trial_ended", endsAt: "2026-10-10T21:00:00.000Z" };
    await client(async () => checkinOk({ trial })).checkin();
    expect(store.read()?.trial).toEqual(trial);
    await client(async () => checkinOk()).checkin();
    expect(store.read()?.trial).toBeNull();
  });

  it("network errors never throw; unreachable time counts from the first failed attempt", async () => {
    let up = true;
    const c = client(async () => {
      if (!up) throw new Error("ENOTFOUND");
      return checkinOk();
    });
    await c.checkin();
    up = false;
    clock += 31_000;
    await expect(c.checkin()).resolves.toBeUndefined();
    expect(c.isReachable()).toBe(false);
    clock += 30_000;
    expect(c.unreachableSeconds()).toBe(30);
  });

  it("before any success, unreachable time counts from start", async () => {
    const c = client(async () => {
      throw new Error("down");
    });
    c.markStarted();
    clock += 45_000;
    await c.checkin();
    expect(c.unreachableSeconds()).toBe(45);
  });

  it("a revoked key → 'Re-pair this PC' on screen, reachable but not usable", async () => {
    const c = client(async () =>
      jsonRes({ success: false, code: "DEVICE_REVOKED", error: "revoked" }),
    );
    await c.checkin();
    expect(store.read()?.lastError).toMatch(/re-pair this PC/i);
  });

  it("runs every 30 s on its timer", async () => {
    const calls: string[] = [];
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const c = new SyncClient({
      offlineDir: dir,
      store,
      fetch: async (url) => {
        calls.push(url);
        return checkinOk();
      },
      now: () => clock,
      appVersion: "1",
      appSchemaVersion: APP,
      getState: () => "standby",
      pendingCount: () => 0,
      openFile: () => null,
      DatabaseCtor: Database,
      setInterval: (fn, ms) => {
        timers.push({ fn, ms });
        return 1 as unknown as NodeJS.Timeout;
      },
      clearInterval: () => undefined,
    });
    c.start();
    expect(timers.map((t) => t.ms)).toEqual([30_000]);
    timers[0]!.fn();
    await c.idle();
    expect(
      calls.filter((u) => u.endsWith("/checkin")).length,
    ).toBeGreaterThanOrEqual(1);
    c.stop();
  });
});

describe("reachability between check-ins (30 s apart)", () => {
  it("stays reachable after a success until a check-in actually fails; unreachable time counts from the first failure", async () => {
    let up = true;
    const c = client(async (url) => {
      if (!up) throw new Error("ENOTFOUND");
      return url.endsWith("/checkin")
        ? checkinOk()
        : jsonRes({ success: false, code: "VERSION_MISMATCH", error: "x" });
    });
    await c.checkin();
    clock += 10_000;
    expect(c.isReachable()).toBe(true);
    expect(c.unreachableSeconds()).toBe(0);
    clock += 19_000; // 29 s after the success, still no failed attempt
    expect(c.isReachable()).toBe(true);
    expect(c.unreachableSeconds()).toBe(0);
    up = false;
    clock += 1_000;
    await c.checkin(); // first failure at T+30
    expect(c.isReachable()).toBe(false);
    expect(c.unreachableSeconds()).toBe(0);
    clock += 29_000;
    expect(c.unreachableSeconds()).toBe(29);
    clock += 1_000;
    await c.checkin();
    expect(c.unreachableSeconds()).toBe(30);
    up = true;
    await c.checkin();
    expect(c.isReachable()).toBe(true);
    expect(c.unreachableSeconds()).toBe(0);
  });

  it("every request carries a timeout signal, so a hung request counts as a failure", async () => {
    const signals: unknown[] = [];
    const c = client(async (_url, init) => {
      signals.push((init as { signal?: unknown } | undefined)?.signal);
      return checkinOk();
    });
    await c.checkin();
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((sig) => sig instanceof AbortSignal)).toBe(true);
  });
});

describe("copy refresh", () => {
  function serving(
    copies: Array<{ bytes: Buffer; copyId: string; tenantId?: number }>,
    due = true,
  ): { fetch: FetchLike; urls: string[] } {
    const urls: string[] = [];
    let i = 0;
    return {
      urls,
      fetch: async (url) => {
        urls.push(url);
        if (url.endsWith("/checkin")) return checkinOk({ snapshotDue: due });
        const c = copies[Math.min(i++, copies.length - 1)]!;
        return binRes(c.bytes, {
          "Content-Type": "application/octet-stream",
          "X-Copy-Id": c.copyId,
          "X-Snapshot-Schema-Version": String(APP),
          "X-Snapshot-Tenant-Id": String(c.tenantId ?? 7),
          "X-Snapshot-Built-At": new Date(clock).toISOString(),
        });
      },
    };
  }

  it("downloads when due into mirror-<ts>.db, verified, with the app's data version in the query", async () => {
    const id = "c0000000-0000-4000-8000-0000000000a1";
    const s = serving([{ bytes: makeCopy({ copyId: id }), copyId: id }]);
    const c = client(s.fetch);
    await c.checkin();
    expect(s.urls).toContain(
      `https://api.test/api/offline/snapshot?schemaVersion=${APP}`,
    );
    const mirrors = listMirrors(dir, Database);
    expect(mirrors).toHaveLength(1);
    expect(path.basename(mirrors[0]!.file)).toMatch(
      /^mirror-\d{8}T\d{9}Z\.db$/,
    );
    expect(mirrors[0]).toMatchObject({
      copyId: id,
      tenantId: 7,
      schemaVersion: APP,
    });
    expect(store.read()).toMatchObject({
      copyId: id,
      lastSnapshotAt: "2026-10-11T10:00:00.000Z",
    });
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".part"))).toEqual([]);
  });

  it("not due and the newest copy is younger than 5 min → no download; ≥ 5 min → download", async () => {
    const id1 = "c0000000-0000-4000-8000-0000000000b1";
    const id2 = "c0000000-0000-4000-8000-0000000000b2";
    const s = serving(
      [
        { bytes: makeCopy({ copyId: id1 }), copyId: id1 },
        { bytes: makeCopy({ copyId: id2 }), copyId: id2 },
      ],
      false,
    );
    const c = client(s.fetch);
    await c.refreshCopy();
    clock += 4 * 60_000;
    await c.checkin();
    expect(s.urls.filter((u) => u.includes("/snapshot"))).toHaveLength(1);
    clock += 60_000;
    await c.checkin();
    expect(s.urls.filter((u) => u.includes("/snapshot"))).toHaveLength(2);
  });

  it("keeps the newest 2 copies and never deletes the open one", async () => {
    const ids = [1, 2, 3, 4].map(
      (n) => `c0000000-0000-4000-8000-00000000000${n}`,
    );
    const s = serving(
      ids.map((id) => ({ bytes: makeCopy({ copyId: id }), copyId: id })),
    );
    let open: string | null = null;
    const c = client(s.fetch, { openFile: () => open });
    await c.refreshCopy();
    open = listMirrors(dir, Database)[0]!.file; // the app runs on the first copy
    for (let k = 0; k < 3; k++) {
      clock += 6 * 60_000;
      await c.refreshCopy();
    }
    const left = listMirrors(dir, Database).map((m) => m.copyId);
    expect(left.slice(0, 2)).toEqual([ids[3], ids[2]]);
    expect(left).toContain(ids[0]); // open one kept
    expect(left).not.toContain(ids[1]);
  });

  it("a corrupt download or another shop's copy is discarded (copies on disk unchanged)", async () => {
    const good = "c0000000-0000-4000-8000-0000000000c1";
    const s1 = serving([{ bytes: makeCopy({ copyId: good }), copyId: good }]);
    await client(s1.fetch).refreshCopy();
    const before = listMirrors(dir, Database).map((m) => m.copyId);
    clock += 6 * 60_000;
    const bad = "c0000000-0000-4000-8000-0000000000c2";
    await client(
      serving([
        { bytes: makeCopy({ copyId: bad, corrupt: true }), copyId: bad },
      ]).fetch,
    ).refreshCopy();
    clock += 6 * 60_000;
    const foreign = "c0000000-0000-4000-8000-0000000000c3";
    await client(
      serving([
        { bytes: makeCopy({ copyId: foreign, tenantId: 8 }), copyId: foreign },
      ]).fetch,
    ).refreshCopy();
    clock += 6 * 60_000;
    const mismatch = "c0000000-0000-4000-8000-0000000000c4";
    await client(
      serving([
        {
          bytes: makeCopy({ copyId: "c0000000-0000-4000-8000-0000000000ff" }),
          copyId: mismatch,
        },
      ]).fetch,
    ).refreshCopy();
    expect(listMirrors(dir, Database).map((m) => m.copyId)).toEqual(before);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".part"))).toEqual([]);
  });

  it("VERSION_MISMATCH → no copy, reason stored for the standby screen", async () => {
    const c = client(async (url) =>
      url.includes("/snapshot")
        ? jsonRes({ success: false, code: "VERSION_MISMATCH", error: "older" })
        : checkinOk({ snapshotDue: true }),
    );
    await c.checkin();
    expect(listMirrors(dir, Database)).toEqual([]);
    expect(store.read()?.lastError).toMatch(/older/);
  });

  it("never downloads a copy in offline or finishing mode", async () => {
    for (const st of ["offline", "finishing"] as const) {
      const s = serving([
        { bytes: makeCopy(), copyId: "c0000000-0000-4000-8000-000000000001" },
      ]);
      await client(s.fetch, { state: () => st }).checkin();
      expect(s.urls.filter((u) => u.includes("/snapshot"))).toEqual([]);
    }
  });
});
