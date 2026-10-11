/**
 * LIRA-306 T125 — the offline recorder (FR-009–FR-011, FR-014,
 * contracts/ipc-offline.md "Recorder"). A fake `ipcMain` (the recorder wraps
 * its `handle`), a REAL better-sqlite3 working copy on the real schema, and
 * the real core outbox / row-capture repositories.
 *
 * Payloads are built from the channel's own recorded schema (`sampleFor`,
 * rule 24), never hand-typed field lists.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  encodeOfflineId,
  offlineTableIndex,
  recordedSchema,
  sampleFor,
  initFixedTenantContext,
  getOfflineOutboxRepository,
  getRowCaptureRepository,
  type OutboxRow,
} from "@liratek/core";
import { installRecorder, type Recorder, type RecorderDeps } from "../recorder";
import { WriteGuard, ReadWriteLog } from "../writeGuard";
import { createWorkingCopy } from "../workingCopy";
import type { OfflineMode } from "../bootDecision";

type Handler = (
  event: { sender: { id: number } },
  ...args: unknown[]
) => unknown;
const SCHEMA = fs.readFileSync(
  path.join(__dirname, "../../create_db.sql"),
  "utf8",
);
const P = 3;
const COPY_ID = "c0000000-0000-4000-8000-000000000001";
const RATES = {
  LBP: { sell: 90000, buy: 89000, market: 89500, direction: 1 as const },
};

let dir = "";
let db: Database.Database;
let registered: Map<string, Handler>;
let fakeIpc: { handle: (ch: string, fn: Handler) => void };
let mode: OfflineMode;
let pairing: { lastSeq: number; serverMaxSeq: number };
let seqUsed: number[];
let recorder: Recorder;
let guard: WriteGuard;
let readLog: ReadWriteLog;
let uuidN = 0;
const ev = { sender: { id: 1 } };

function clientPayload(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const schema = recordedSchema("clients:create")!;
  const base = sampleFor(schema) as Record<string, unknown>;
  delete base.id;
  return { ...base, full_name: "Rami", phone_number: "70123456", ...over };
}

function outbox(): OutboxRow[] {
  return db
    .prepare(`SELECT * FROM offline_outbox ORDER BY device_seq`)
    .all() as OutboxRow[];
}
function clients(): Array<{ id: number; full_name: string }> {
  return db
    .prepare(`SELECT id, full_name FROM clients ORDER BY id`)
    .all() as Array<{ id: number; full_name: string }>;
}
const call = (ch: string, ...args: unknown[]) =>
  Promise.resolve(registered.get(ch)!(ev, ...args)) as Promise<
    Record<string, unknown>
  >;

function insertClient(payload: Record<string, unknown>): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (7, ?, ?)`,
      )
      .run(String(payload.full_name), String(payload.phone_number))
      .lastInsertRowid,
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lira306-rec-"));
  const mirror = path.join(dir, "mirror-20261011T100000000Z.db");
  const m = new Database(mirror);
  m.exec(SCHEMA);
  m.exec(
    `INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (7, 'Corner Tech', 'cornertech', 'active')`,
  );
  m.prepare(
    `INSERT INTO offline_copy_meta (tenant_id, copy_id, built_at, schema_version, high_water_json, created_at, updated_at)
     VALUES (7, ?, '2026-10-11T10:00:00.000Z', 210, '{}', 'x', 'x')`,
  ).run(COPY_ID);
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

  registered = new Map();
  fakeIpc = { handle: (ch, fn) => registered.set(ch, fn) };
  mode = "offline";
  pairing = { lastSeq: 0, serverMaxSeq: 0 };
  seqUsed = [];
  uuidN = 0;
  guard = new WriteGuard(() => db);
  readLog = new ReadWriteLog(path.join(dir, "read-writes.json"));
  const deps: RecorderDeps = {
    mode: () => mode,
    db: () => db,
    guard,
    readWriteLog: readLog,
    outbox: getOfflineOutboxRepository(),
    rowCapture: getRowCaptureRepository(),
    pairing: () => pairing,
    onSeqUsed: (s) => seqUsed.push(s),
    actorOf: () => 20,
    copyId: () => COPY_ID,
    rates: () => RATES,
    appVersion: "1.2.3",
    schemaVersion: 210,
    now: () => new Date("2026-10-11T10:10:00.000Z"),
    clientDay: () => "2026-10-11",
    tzOffsetMinutes: () => 180,
    uuid: () => `e0000000-0000-4000-8000-${String(++uuidN).padStart(12, "0")}`,
  };
  recorder = installRecorder(fakeIpc, deps);
  if (mode === "offline") guard.lockdown();
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  try {
    db.close();
  } catch {
    // closed
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("recordable channels in offline mode", () => {
  it("writes the business row AND the outbox event in one transaction, with every FR-011 field", async () => {
    fakeIpc.handle("clients:create", async (_e, data) => ({
      success: true,
      id: insertClient(data as Record<string, unknown>),
    }));
    const payload = clientPayload();
    const r = await call("clients:create", payload);
    expect(r.success).toBe(true);
    const cid = encodeOfflineId(P, offlineTableIndex("clients"), 1);
    expect(r.id).toBe(cid);
    const rows = outbox();
    expect(rows).toHaveLength(1);
    const o = rows[0]!;
    const parsed = recordedSchema("clients:create")!.parse(payload);
    expect(o).toMatchObject({
      event_id: "e0000000-0000-4000-8000-000000000001",
      device_seq: 1,
      channel: "clients:create",
      actor_user_id: 20,
      occurred_at: "2026-10-11T10:10:00.000Z",
      client_day: "2026-10-11",
      client_tz_offset_minutes: 180,
      copy_id: COPY_ID,
      app_version: "1.2.3",
      schema_version: 210,
      delivery: "waiting",
    });
    expect(JSON.parse(o.payload_json)).toEqual(parsed);
    expect(o.payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(o.schema_shape_json)).toMatchObject({ type: "object" });
    expect(JSON.parse(o.rates_json)).toEqual(RATES);
    expect(JSON.parse(o.created_json)).toEqual({ clients: [cid] });
    expect(JSON.parse(o.depends_on_json)).toEqual([]);
    expect(seqUsed).toEqual([1]);
    expect(db.inTransaction).toBe(false);
  });

  it("seq = max(outbox, pairing.json lastSeq, server maxSeq) + 1 — a second outage continues", async () => {
    fakeIpc.handle("clients:create", async (_e, data) => ({
      success: true,
      id: insertClient(data as Record<string, unknown>),
    }));
    pairing = { lastSeq: 40, serverMaxSeq: 41 };
    await call("clients:create", clientPayload());
    expect(outbox().map((o) => o.device_seq)).toEqual([42]);
    pairing = { lastSeq: 42, serverMaxSeq: 10 };
    await call("clients:create", clientPayload({ phone_number: "70999999" }));
    expect(outbox().map((o) => o.device_seq)).toEqual([42, 43]);
  });

  it("{success:false} → nothing kept", async () => {
    fakeIpc.handle("clients:create", async (_e, data) => {
      insertClient(data as Record<string, unknown>);
      return { success: false, error: "Phone already used" };
    });
    expect(await call("clients:create", clientPayload())).toEqual({
      success: false,
      error: "Phone already used",
    });
    expect(clients().filter((c) => c.full_name === "Rami")).toEqual([]);
    expect(outbox()).toEqual([]);
  });

  it("a non-envelope result → rolled back AND an explicit { success:false }", async () => {
    fakeIpc.handle("clients:create", async (_e, data) => {
      insertClient(data as Record<string, unknown>);
      return 42;
    });
    const r = await call("clients:create", clientPayload());
    expect(r).toMatchObject({ success: false });
    expect(clients().filter((c) => c.full_name === "Rami")).toEqual([]);
    expect(outbox()).toEqual([]);
  });

  it("a throw → nothing kept, error envelope", async () => {
    fakeIpc.handle("clients:create", async (_e, data) => {
      insertClient(data as Record<string, unknown>);
      throw new Error("boom");
    });
    expect(await call("clients:create", clientPayload())).toMatchObject({
      success: false,
    });
    expect(clients().filter((c) => c.full_name === "Rami")).toEqual([]);
    expect(outbox()).toEqual([]);
  });

  it("a payload the schema refuses → refused before the handler runs", async () => {
    const h = jest.fn(async () => ({ success: true }));
    fakeIpc.handle("clients:create", h);
    expect(await call("clients:create", { full_name: "" })).toMatchObject({
      success: false,
    });
    expect(h).not.toHaveBeenCalled();
  });

  it("an offline id outside every id position → OFFLINE_UNRECORDABLE, handler not run", async () => {
    const h2 = jest.fn(async () => ({ success: true }));
    fakeIpc.handle("hold-money:create", h2);
    const hold = sampleFor(recordedSchema("hold-money:create")!) as Record<
      string,
      unknown
    >;
    // an amount (not an id position) holding an offline-range number
    const r2 = await call("hold-money:create", {
      ...hold,
      usd_amount: encodeOfflineId(P, 5, 1),
    });
    expect(r2).toMatchObject({ success: false, code: "OFFLINE_UNRECORDABLE" });
    expect(h2).not.toHaveBeenCalled();
  });

  it("depends_on: an event referencing a row created by an earlier event names that event", async () => {
    fakeIpc.handle("clients:create", async (_e, data) => ({
      success: true,
      id: insertClient(data as Record<string, unknown>),
    }));
    fakeIpc.handle("clients:update", async () => ({ success: true }));
    const c = await call("clients:create", clientPayload());
    await call(
      "clients:update",
      clientPayload({ id: c.id, full_name: "Rami K" }),
    );
    const [first, second] = outbox();
    expect(JSON.parse(second!.depends_on_json)).toEqual([first!.event_id]);
  });

  it("a nested service db.transaction() works as a savepoint inside the event transaction", async () => {
    fakeIpc.handle("clients:create", async (_e, data) => {
      const id = db.transaction(() =>
        insertClient(data as Record<string, unknown>),
      )();
      try {
        db.transaction(() => {
          insertClient({ full_name: "Inner", phone_number: "1" });
          throw new Error("inner rollback");
        })();
      } catch {
        // the service handled its own failure
      }
      return { success: true, id };
    });
    const r = await call("clients:create", clientPayload());
    expect(r.success).toBe(true);
    expect(clients().map((c) => c.full_name)).toEqual(["Rami"]);
    expect(JSON.parse(outbox()[0]!.created_json)).toEqual({ clients: [r.id] });
  });

  it("concurrent writes are serialized (one window at a time), each its own event", async () => {
    let inside = 0;
    let maxInside = 0;
    fakeIpc.handle("clients:create", async (_e, data) => {
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      await new Promise((r) => setTimeout(r, 15));
      const id = insertClient(data as Record<string, unknown>);
      inside -= 1;
      return { success: true, id };
    });
    const results = await Promise.all([
      call("clients:create", clientPayload({ phone_number: "1" })),
      call("clients:create", clientPayload({ phone_number: "2" })),
      call("clients:create", clientPayload({ phone_number: "3" })),
    ]);
    expect(results.every((r) => r.success)).toBe(true);
    expect(maxInside).toBe(1);
    expect(outbox().map((o) => o.device_seq)).toEqual([1, 2, 3]);
  });

  it("a read issued during a write window waits for it (never sees the open transaction)", async () => {
    const order: string[] = [];
    fakeIpc.handle("clients:create", async (_e, data) => {
      order.push("write:start");
      await new Promise((r) => setTimeout(r, 20));
      const id = insertClient(data as Record<string, unknown>);
      order.push("write:end");
      return { success: true, id };
    });
    fakeIpc.handle("clients:get-all", async () => {
      order.push(`read:inTx=${db.inTransaction}`);
      return clients();
    });
    await Promise.all([
      call("clients:create", clientPayload()),
      call("clients:get-all"),
    ]);
    expect(order).toEqual(["write:start", "write:end", "read:inTx=false"]);
  });
});

describe("other classes in offline mode", () => {
  it("online-only → OFFLINE_NOT_AVAILABLE, handler not run, total_changes unchanged", async () => {
    const h = jest.fn(async () => ({ success: true }));
    fakeIpc.handle("settings:update", h);
    const before = (
      db.prepare(`SELECT total_changes() AS n`).get() as { n: number }
    ).n;
    expect(await call("settings:update", { key: "x", value: "y" })).toEqual({
      success: false,
      code: "OFFLINE_NOT_AVAILABLE",
      error:
        "Not available while offline — do this on the web app when the internet is back",
    });
    expect(h).not.toHaveBeenCalled();
    expect(
      (db.prepare(`SELECT total_changes() AS n`).get() as { n: number }).n,
    ).toBe(before);
  });

  it("an unclassified channel → refused (fail closed)", async () => {
    const h = jest.fn(async () => ({ success: true }));
    fakeIpc.handle("brand-new:thing", h);
    expect(await call("brand-new:thing")).toMatchObject({
      success: false,
      code: "OFFLINE_UNCLASSIFIED",
    });
    expect(h).not.toHaveBeenCalled();
  });

  it("a read that tries to write is refused by the guard and logged for the manifest (FR-036)", async () => {
    fakeIpc.handle("clients:get-all", async () => {
      insertClient({ full_name: "Sneaky", phone_number: "0" });
      return [];
    });
    const r = await call("clients:get-all");
    expect(r).toMatchObject({ success: false });
    expect(clients().map((c) => c.full_name)).not.toContain("Sneaky");
    expect(readLog.entries()).toEqual([
      { channel: "clients:get-all", changes: 1 },
    ]);
  });

  it("a local channel runs writable and is never recorded (sign-in bookkeeping)", async () => {
    fakeIpc.handle("auth:login", async () => {
      insertClient({ full_name: "login side effect", phone_number: "0" });
      return { success: true };
    });
    expect(await call("auth:login", "u", "p")).toEqual({ success: true });
    expect(outbox()).toEqual([]);
  });
});

describe("other modes", () => {
  it("standalone: handlers run untouched (no queue, no guard, no event)", async () => {
    mode = "standalone";
    guard.release();
    fakeIpc.handle("settings:update", async () => ({
      success: true,
      untouched: true,
    }));
    expect(await call("settings:update", {})).toEqual({
      success: true,
      untouched: true,
    });
    expect(outbox()).toEqual([]);
  });

  it("standby/blocked: only offline:* channels answer; everything else is refused plainly", async () => {
    for (const m of ["standby", "blocked"] as const) {
      mode = m;
      const h = jest.fn(async () => ({ success: true }));
      fakeIpc.handle("clients:get-all", h);
      fakeIpc.handle("offline:status", async () => ({
        success: true,
        data: { mode: m },
      }));
      expect(await call("clients:get-all")).toMatchObject({
        success: false,
        code: "PC_ON_STANDBY",
      });
      expect(h).not.toHaveBeenCalled();
      expect(await call("offline:status")).toEqual({
        success: true,
        data: { mode: m },
      });
    }
  });

  it("finishing: no new actions; reads and offline:* still run", async () => {
    mode = "finishing";
    const h = jest.fn(async () => ({ success: true }));
    fakeIpc.handle("clients:create", h);
    fakeIpc.handle("clients:get-all", async () => clients());
    expect(await call("clients:create", clientPayload())).toMatchObject({
      success: false,
      code: "OFFLINE_FINISHING",
    });
    expect(h).not.toHaveBeenCalled();
    expect(Array.isArray(await call("clients:get-all"))).toBe(true);
  });

  it("runExclusive lets the sender read the outbox only between windows", async () => {
    fakeIpc.handle("clients:create", async (_e, data) => {
      await new Promise((r) => setTimeout(r, 10));
      return {
        success: true,
        id: insertClient(data as Record<string, unknown>),
      };
    });
    const write = call("clients:create", clientPayload());
    const seen = await recorder.runExclusive(() => db.inTransaction);
    await write;
    expect(seen).toBe(false);
  });
});
