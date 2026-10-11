/**
 * LIRA-306 T135 — switching modes (FR-008, FR-039; plan diagram B):
 *
 *  - `offline:go-offline` needs standby + a ready copy + ≥ 30 s without the
 *    server; it creates the working copy from the newest copy, stores
 *    mode=offline and relaunches;
 *  - `offline:back-to-web` needs a signed-in user, offline mode and the
 *    server reachable; it stores mode=finishing and relaunches;
 *  - finishing: no new actions (recorder), uploads the rest, sends the
 *    manifest, moves the working copy to finished/ (newest 3), settles
 *    counters/sequence, stores mode=standby and relaunches;
 *  - finishing → offline after 30 s without the server (same working copy);
 *  - `offline:send-now` uploads and answers { sent, waiting }.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

type Handler = (
  event: { sender: { id: number } },
  ...args: unknown[]
) => Promise<unknown>;
const handlers = new Map<string, Handler>();
jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn((name: string, fn: Handler) => handlers.set(name, fn)),
  },
}));
const authed = new Set<number>();
jest.mock("../../session", () => ({
  isAuthenticated: (id: number) => authed.has(id),
}));

import { registerOfflineHandlers } from "../../handlers/offlineHandlers";
import { setOfflineRuntime, type OfflineRuntime } from "../runtime";
import { PairingStore, type SafeStorageLike } from "../pairingStore";
import type { BootDecision } from "../bootDecision";
import { makeGoOffline, makeBackToWeb, Finisher } from "../modeSwitch";
import { listFinished, workingCopyPath } from "../offlineFiles";

const SCHEMA = fs.readFileSync(
  path.join(__dirname, "../../create_db.sql"),
  "utf8",
);
const safe: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().slice(4),
};
const KEY = `ltd_7_abcdef012345_${"a".repeat(64)}`;
const ev = { sender: { id: 1 } };

let dir = "";
let store: PairingStore;
let relaunch: jest.Mock;
let mirror = "";

function decision(
  mode: BootDecision["mode"],
  over: Partial<BootDecision> = {},
): BootDecision {
  return {
    mode,
    dbFile: null,
    readonly: true,
    tenantId: 7,
    ready: true,
    notReadyReason: null,
    copyAgeWarning: false,
    resumed: false,
    steps: {} as BootDecision["steps"],
    ...over,
  };
}

function makeMirror(): string {
  const file = path.join(dir, "mirror-20261011T100000000Z.db");
  const m = new Database(file);
  m.exec(SCHEMA);
  m.exec(
    `INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (7, 'Corner Tech', 'cornertech', 'active')`,
  );
  m.prepare(
    `INSERT INTO offline_copy_meta (tenant_id, copy_id, built_at, schema_version, high_water_json, created_at, updated_at)
     VALUES (7, 'c0000000-0000-4000-8000-000000000001', '2026-10-11T10:00:00.000Z', 210, '{}', 'x', 'x')`,
  ).run();
  m.close();
  return file;
}

function runtime(over: Partial<OfflineRuntime> = {}): OfflineRuntime {
  return {
    decision: decision("standby"),
    store,
    sync: {
      unreachableSeconds: () => 45,
      isReachable: () => false,
      kick: async () => undefined,
    },
    defaultServerUrl: "https://api.test",
    webAppUrl: (s) => `https://${s}.liratek.shop`,
    fetch: async () => {
      throw new Error("unused");
    },
    now: () => Date.parse("2026-10-11T10:30:00.000Z"),
    pendingCount: () => 0,
    hasWorkingCopy: () => fs.existsSync(workingCopyPath(dir)),
    copyAgeSeconds: () => 60,
    verifyLocalAdmin: () => true,
    hasShopData: () => true,
    removeShopData: () => undefined,
    relaunch,
    openExternal: async () => undefined,
    installUpdate: async () => ({ success: true }),
    goOffline: makeGoOffline({
      offlineDir: dir,
      store,
      DatabaseCtor: Database,
      now: () => Date.parse("2026-10-11T10:30:00.000Z"),
      newestMirror: () => mirror,
      relaunch: () => relaunch(),
    }),
    backToWeb: makeBackToWeb({ store, relaunch: () => relaunch() }),
    sendNow: async () => ({ sent: 2, waiting: 0 }),
    ...over,
  };
}

const call = (ch: string, ...args: unknown[]) =>
  handlers.get(ch)!(ev, ...args) as Promise<Record<string, unknown>>;

beforeAll(() => registerOfflineHandlers());
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lira306-mode-"));
  store = new PairingStore(dir, { safeStorage: safe });
  store.savePairing(
    {
      tenantId: 7,
      shopSlug: "cornertech",
      shopName: "Corner Tech",
      serverUrl: "https://api.test",
      deviceNo: 3,
      serverSchemaVersion: 210,
    },
    KEY,
  );
  relaunch = jest.fn();
  mirror = makeMirror();
  authed.clear();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("offline:go-offline", () => {
  it("refused before 30 s without the server, or without a ready copy, or outside standby", async () => {
    setOfflineRuntime(
      runtime({
        sync: {
          unreachableSeconds: () => 29,
          isReachable: () => false,
          kick: async () => undefined,
        },
      }),
    );
    expect((await call("offline:go-offline")).success).toBe(false);
    setOfflineRuntime(
      runtime({
        decision: decision("standby", {
          ready: false,
          notReadyReason: "Waiting for a fresh copy",
        }),
      }),
    );
    expect(await call("offline:go-offline")).toMatchObject({
      success: false,
      error: "Waiting for a fresh copy",
    });
    setOfflineRuntime(runtime({ decision: decision("offline") }));
    expect((await call("offline:go-offline")).success).toBe(false);
    expect(fs.existsSync(workingCopyPath(dir))).toBe(false);
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("creates the working copy from the newest copy, stores mode=offline, relaunches", async () => {
    store.update({ lastUsedIds: { sales: 4 } });
    setOfflineRuntime(runtime());
    expect(await call("offline:go-offline")).toEqual({
      success: true,
      data: {},
    });
    expect(fs.existsSync(workingCopyPath(dir))).toBe(true);
    expect(store.read()?.mode).toBe("offline");
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});

describe("offline:back-to-web and offline:send-now", () => {
  it("back-to-web needs a signed-in user, offline mode and the server reachable", async () => {
    setOfflineRuntime(
      runtime({
        decision: decision("offline"),
        sync: {
          unreachableSeconds: () => 0,
          isReachable: () => true,
          kick: async () => undefined,
        },
      }),
    );
    expect((await call("offline:back-to-web")).success).toBe(false); // not signed in
    authed.add(1);
    setOfflineRuntime(
      runtime({
        decision: decision("offline"),
        sync: {
          unreachableSeconds: () => 5,
          isReachable: () => false,
          kick: async () => undefined,
        },
      }),
    );
    expect(await call("offline:back-to-web")).toMatchObject({ success: false });
    setOfflineRuntime(
      runtime({
        decision: decision("standby"),
        sync: {
          unreachableSeconds: () => 0,
          isReachable: () => true,
          kick: async () => undefined,
        },
      }),
    );
    expect((await call("offline:back-to-web")).success).toBe(false);
    expect(relaunch).not.toHaveBeenCalled();
    setOfflineRuntime(
      runtime({
        decision: decision("offline"),
        sync: {
          unreachableSeconds: () => 0,
          isReachable: () => true,
          kick: async () => undefined,
        },
      }),
    );
    expect(await call("offline:back-to-web")).toEqual({
      success: true,
      data: {},
    });
    expect(store.read()?.mode).toBe("finishing");
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("send-now (signed in) answers { sent, waiting }", async () => {
    authed.add(1);
    setOfflineRuntime(runtime({ decision: decision("offline") }));
    expect(await call("offline:send-now")).toEqual({
      success: true,
      data: { sent: 2, waiting: 0 },
    });
  });
});

describe("Finisher (finishing mode)", () => {
  function finisher(
    over: {
      reachable?: () => boolean;
      unreachable?: () => number;
      waiting?: () => number;
      manifestOk?: () => boolean;
    } = {},
  ) {
    const sent: unknown[] = [];
    let closed = false;
    const f = new Finisher({
      offlineDir: dir,
      store,
      deviceNo: 3,
      DatabaseCtor: Database,
      now: () => Date.parse("2026-10-11T11:00:00.000Z"),
      isReachable: over.reachable ?? (() => true),
      unreachableSeconds: over.unreachable ?? (() => 0),
      sendWaiting: async () => ({
        sent: 0,
        waiting: (over.waiting ?? (() => 0))(),
      }),
      buildManifest: () => ({
        copyId: "c0000000-0000-4000-8000-000000000001",
        tables: {},
        readWrites: [],
      }),
      sendManifest: async (body) => {
        sent.push(body);
        return (over.manifestOk ?? (() => true))();
      },
      lastSeq: () => 17,
      closeDb: () => {
        closed = true;
      },
      clearReadLog: () => undefined,
      relaunch: () => relaunch(),
    });
    return { f, sent, isClosed: () => closed };
  }

  beforeEach(async () => {
    setOfflineRuntime(runtime());
    await call("offline:go-offline");
    relaunch.mockClear();
    store.update({ mode: "finishing" });
  });

  it("uploads the rest, sends the manifest, keeps the working copy as finished, returns to standby", async () => {
    const { f, sent, isClosed } = finisher();
    await f.tick();
    expect(sent).toHaveLength(1);
    expect(isClosed()).toBe(true);
    expect(fs.existsSync(workingCopyPath(dir))).toBe(false);
    expect(listFinished(dir)).toHaveLength(1);
    expect(store.read()).toMatchObject({
      mode: "standby",
      lastSeq: 17,
      lastPeriod: { finishedAt: "2026-10-11T11:00:00.000Z", settledAt: null },
    });
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("waits while events are still waiting or the manifest is refused", async () => {
    const a = finisher({ waiting: () => 3 });
    await a.f.tick();
    expect(a.sent).toEqual([]);
    const b = finisher({ manifestOk: () => false });
    await b.f.tick();
    expect(fs.existsSync(workingCopyPath(dir))).toBe(true);
    expect(store.read()?.mode).toBe("finishing");
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("30 s without the server → back to offline on the same working copy", async () => {
    const { f } = finisher({ reachable: () => false, unreachable: () => 30 });
    await f.tick();
    expect(store.read()?.mode).toBe("offline");
    expect(fs.existsSync(workingCopyPath(dir))).toBe(true);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});
