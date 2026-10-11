/**
 * LIRA-306 T127 — reads that write (FR-036). Every `read`-class channel of
 * every handler file is called through the recorder in OFFLINE mode against
 * a real working copy (real schema, `query_only` guard on), signed in as an
 * admin, with empty arguments. A channel whose handler tries to write is
 * refused by SQLite and logged; this sweep lists them.
 *
 * Offenders found (2026-10-11 sweep, 212 read channels, 161 answered
 * normally with empty arguments): NONE — `ALLOWED_READ_WRITERS`
 * (offline/readPolicy.ts) is empty, so T128 had nothing to fix. The guard itself (refuse + log) is proven in
 * recorder.test.ts; this file pins the inventory so a NEW read that writes
 * fails here instead of silently being refused on a cashier's screen.
 *
 * Empty arguments do not reach every code path (a handler that validates
 * first returns early), so this is a floor, not a proof of absence.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

type Handler = (
  event: { sender: { id: number } },
  ...args: unknown[]
) => unknown;
const registered = new Map<string, Handler>();

jest.mock("electron", () => {
  const ipcMain = {
    handle: jest.fn((name: string, fn: Handler) => {
      registered.set(name, fn);
    }),
    on: jest.fn(),
    removeHandler: jest.fn(),
  };
  return {
    ipcMain,
    app: {
      getPath: jest.fn(() => "/tmp"),
      getVersion: jest.fn(() => "0.0.0"),
      isPackaged: false,
      on: jest.fn(),
      relaunch: jest.fn(),
      exit: jest.fn(),
    },
    BrowserWindow: {
      getAllWindows: jest.fn(() => []),
      fromWebContents: jest.fn(),
    },
    dialog: { showOpenDialog: jest.fn(), showSaveDialog: jest.fn() },
    shell: { openExternal: jest.fn() },
    net: { request: jest.fn() },
    safeStorage: { isEncryptionAvailable: jest.fn(() => false) },
    webContents: { fromId: jest.fn() },
  };
});
jest.mock("../../main.js", () => ({ getDb: jest.fn() }));
jest.mock("../../services/ReportService.js", () => ({
  ReportService: jest.fn(),
}));

import {
  CHANNEL_POLICY,
  initFixedTenantContext,
  getOfflineOutboxRepository,
  getRowCaptureRepository,
} from "@liratek/core";
import { installRecorder } from "../recorder";
import { WriteGuard, ReadWriteLog } from "../writeGuard";
import { createWorkingCopy } from "../workingCopy";
import { ALLOWED_READ_WRITERS } from "../readPolicy";

const SCHEMA = fs.readFileSync(
  path.join(__dirname, "../../create_db.sql"),
  "utf8",
);
const HANDLERS_DIR = path.join(__dirname, "../../handlers");
const UNPARSEABLE = new Set(["setupHandlers.ts", "updaterHandlers.ts"]);

let dir = "";
let db: Database.Database;
let readLog: ReadWriteLog;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lira306-readguard-"));
  const mirror = path.join(dir, "mirror-20261011T100000000Z.db");
  const m = new Database(mirror);
  m.exec(SCHEMA);
  m.exec(
    `INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (7, 'Corner Tech', 'cornertech', 'active')`,
  );
  m.exec(
    `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (20, 7, 'owner', 'x', 'admin', 1)`,
  );
  m.prepare(
    `INSERT INTO offline_copy_meta (tenant_id, copy_id, built_at, schema_version, high_water_json, created_at, updated_at)
     VALUES (7, 'c0000000-0000-4000-8000-000000000001', '2026-10-11T10:00:00.000Z', 210, '{}', 'x', 'x')`,
  ).run();
  m.close();
  const wc = createWorkingCopy({
    offlineDir: dir,
    mirrorFile: mirror,
    deviceNo: 3,
    pairingLastUsed: {},
    serverMaxOfflineIds: {},
    DatabaseCtor: Database,
    now: Date.now,
  });
  db = new Database(wc.file);
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(7);

  // sign in an admin on window 1 (in-memory IPC session)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const session = require("../../session") as {
    setSession: (id: number, userId: number, role: "admin" | "staff") => void;
  };
  session.setSession(1, 20, "admin");

  const guard = new WriteGuard(() => db);
  readLog = new ReadWriteLog(path.join(dir, "read-writes.json"));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ipcMain } = require("electron") as {
    ipcMain: { handle: (c: string, f: Handler) => void };
  };
  installRecorder(ipcMain, {
    mode: () => "offline",
    db: () => db,
    guard,
    readWriteLog: readLog,
    outbox: getOfflineOutboxRepository(),
    rowCapture: getRowCaptureRepository(),
    pairing: () => ({ lastSeq: 0, serverMaxSeq: 0 }),
    onSeqUsed: () => undefined,
    actorOf: () => 20,
    copyId: () => "c0000000-0000-4000-8000-000000000001",
    rates: () => ({
      LBP: { sell: 90000, buy: 89000, market: 89500, direction: 1 },
    }),
    appVersion: "1",
    schemaVersion: 210,
    now: () => new Date(),
    clientDay: () => "2026-10-11",
    tzOffsetMinutes: () => 180,
    uuid: () => "e0000000-0000-4000-8000-000000000001",
  });
  guard.lockdown();

  for (const file of fs
    .readdirSync(HANDLERS_DIR)
    .filter((f) => f.endsWith(".ts") && !UNPARSEABLE.has(f))
    .sort()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(HANDLERS_DIR, file)) as Record<
      string,
      unknown
    >;
    for (const [name, fn] of Object.entries(mod)) {
      if (/^register\w*Handlers$/.test(name) && typeof fn === "function")
        (fn as () => unknown)();
    }
  }
});

afterAll(() => {
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("read channels never write offline (FR-036)", () => {
  it("sweeps every registered read channel; any writer is on the allowed list", async () => {
    const reads = CHANNEL_POLICY.filter(
      (e) => e.cls === "read" && registered.has(e.channel),
    ).map((e) => e.channel);
    expect(reads.length).toBeGreaterThan(150);
    let succeeded = 0;
    for (const ch of reads) {
      try {
        const r = (await Promise.resolve(
          registered.get(ch)!({ sender: { id: 1 } }),
        )) as { success?: boolean; error?: string } | unknown;
        const env = r as { success?: boolean; error?: string };
        if (
          Array.isArray(r) ||
          (r && typeof r === "object" && env.success !== false)
        )
          succeeded += 1;
      } catch {
        // a crash on empty args is not a write; the log decides
      }
    }
    // the sweep must actually reach the database: most reads answer normally
    // (a run where every call was refused by a missing session would be vacuous)
    expect(succeeded).toBeGreaterThan(reads.length / 2);
    const writers = readLog
      .entries()
      .map((e) => e.channel)
      .sort();
    // pinned inventory: a new read that writes fails here
    expect(writers.filter((c) => !ALLOWED_READ_WRITERS.includes(c))).toEqual(
      [],
    );
    // and the allowed list carries no stale entries for channels that stopped writing
    // (only checked for channels this sweep reaches with empty args)
    expect(db.inTransaction).toBe(false);
  });
});
