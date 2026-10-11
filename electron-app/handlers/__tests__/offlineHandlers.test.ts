/**
 * LIRA-306 T121 — the desktop-only `offline:*` channels (contracts/
 * ipc-offline.md, E1): status, pair (incl. re-key), unpair, open-web-app,
 * install-update. Electron is mocked (fake ipcMain); the runtime main.ts
 * builds at boot is a fake. Importing the module does nothing (the channel
 * policy guard loads it with no runtime).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Handler = (
  event: { sender: { id: number } },
  ...args: unknown[]
) => Promise<unknown>;
const handlers = new Map<string, Handler>();

jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn((name: string, fn: Handler) => {
      handlers.set(name, fn);
    }),
  },
}));

import { registerOfflineHandlers, OFFLINE_CHANNELS } from "../offlineHandlers";
import { setOfflineRuntime, type OfflineRuntime } from "../../offline/runtime";
import { PairingStore, type SafeStorageLike } from "../../offline/pairingStore";
import type { BootDecision } from "../../offline/bootDecision";
import type { FetchLike } from "../../offline/syncClient";

const safe = (ok = true): SafeStorageLike => ({
  isEncryptionAvailable: () => ok,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().slice(4),
});
const KEY = `ltd_7_abcdef012345_${"a".repeat(64)}`;
const ev = { sender: { id: 1 } };

let dir = "";
let store: PairingStore;
let relaunch: jest.Mock;
let openExternal: jest.Mock;
let installUpdate: jest.Mock;
let removeShopData: jest.Mock;
let fetchCalls: Array<{ url: string; body: unknown }>;

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

function runtime(over: Partial<OfflineRuntime> = {}): OfflineRuntime {
  const pairFetch: FetchLike = async (url, init) => {
    fetchCalls.push({
      url,
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({
        success: true,
        data: {
          deviceKey: KEY,
          deviceNo: 3,
          tenantId: 7,
          shopName: "Corner Tech",
          shopSlug: "cornertech",
          serverSchemaVersion: 210,
        },
      }),
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };
  return {
    decision: decision("standby"),
    store,
    sync: {
      unreachableSeconds: () => 0,
      isReachable: () => true,
      kick: async () => undefined,
    },
    defaultServerUrl: "https://api.liratek.shop",
    webAppUrl: (slug) => `https://${slug}.liratek.shop`,
    fetch: pairFetch,
    now: () => Date.parse("2026-10-11T10:05:00.000Z"),
    pendingCount: () => 0,
    hasWorkingCopy: () => false,
    copyAgeSeconds: () => 300,
    verifyLocalAdmin: (u, p) => u === "owner" && p === "Owner-pass-2026",
    hasShopData: () => true,
    removeShopData,
    relaunch,
    openExternal,
    installUpdate,
    ...over,
  };
}

const call = (ch: string, ...args: unknown[]) =>
  handlers.get(ch)!(ev, ...args) as Promise<Record<string, unknown>>;
const PAIR = {
  shop: "cornertech",
  username: "owner",
  password: "Owner-pass-2026",
  deviceName: "Front PC",
};

beforeAll(() => registerOfflineHandlers());
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lira306-offh-"));
  store = new PairingStore(dir, { safeStorage: safe() });
  relaunch = jest.fn();
  openExternal = jest.fn(async () => undefined);
  installUpdate = jest.fn(async () => ({ success: true }));
  removeShopData = jest.fn();
  fetchCalls = [];
  setOfflineRuntime(null);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("registration", () => {
  it("registers the T122 channels, every one in the policy's local list", () => {
    for (const ch of [
      "offline:status",
      "offline:pair",
      "offline:unpair",
      "offline:open-web-app",
      "offline:install-update",
    ]) {
      expect(handlers.has(ch)).toBe(true);
      expect(OFFLINE_CHANNELS).toContain(ch);
    }
  });
});

describe("offline:status", () => {
  it("without a runtime (never wired) answers standalone/not paired — never throws", async () => {
    const r = await call("offline:status");
    expect(r).toMatchObject({
      success: true,
      data: { mode: "standalone", paired: false },
    });
  });

  it("standby: PC number, shop, copy age, ready, reachability, waiting count, held items", async () => {
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
    store.update({
      heldItems: [{ eventId: "e1", label: "Debt repayment", amount: 20 }],
      lastError: null,
    });
    setOfflineRuntime(
      runtime({
        sync: {
          unreachableSeconds: () => 42,
          isReachable: () => false,
          kick: async () => undefined,
        },
      }),
    );
    const r = await call("offline:status");
    expect(r).toEqual({
      success: true,
      data: {
        mode: "standby",
        paired: true,
        deviceNo: 3,
        shopName: "Corner Tech",
        copyAgeSeconds: 300,
        copyAgeWarning: false,
        ready: true,
        notReadyReason: null,
        serverReachable: false,
        unreachableSeconds: 42,
        canGoOffline: true,
        pendingCount: 0,
        lastError: null,
        heldItems: [{ eventId: "e1", label: "Debt repayment", amount: 20 }],
      },
    });
  });

  it("canGoOffline needs ≥ 30 s unreachable AND ready AND standby", async () => {
    store.savePairing(
      {
        tenantId: 7,
        shopSlug: "c",
        shopName: "C",
        serverUrl: "https://api.test",
        deviceNo: 3,
        serverSchemaVersion: 210,
      },
      KEY,
    );
    const s = (sec: number) => ({
      unreachableSeconds: () => sec,
      isReachable: () => sec === 0,
      kick: async () => undefined,
    });
    setOfflineRuntime(runtime({ sync: s(29) }));
    expect((await call("offline:status")).data).toMatchObject({
      canGoOffline: false,
    });
    setOfflineRuntime(
      runtime({
        sync: s(30),
        decision: decision("standby", { ready: false, notReadyReason: "x" }),
      }),
    );
    expect((await call("offline:status")).data).toMatchObject({
      canGoOffline: false,
    });
    setOfflineRuntime(
      runtime({ sync: s(30), decision: decision("blocked", { ready: false }) }),
    );
    expect((await call("offline:status")).data).toMatchObject({
      canGoOffline: false,
    });
  });
});

describe("offline:pair", () => {
  it("pairs: sends the admin's sign-in to the server, stores the key encrypted, relaunches into standby", async () => {
    setOfflineRuntime(runtime({ decision: decision("standalone") }));
    const r = await call("offline:pair", PAIR);
    expect(r).toEqual({
      success: true,
      data: { deviceNo: 3, shopName: "Corner Tech" },
    });
    expect(fetchCalls).toEqual([
      { url: "https://api.liratek.shop/api/offline/pair", body: PAIR },
    ]);
    expect(store.deviceKey()).toBe(KEY);
    expect(store.read()).toMatchObject({
      tenantId: 7,
      deviceNo: 3,
      shopSlug: "cornertech",
      serverUrl: "https://api.liratek.shop",
    });
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("re-key sends this PC's own number from pairing.json, never from the form (FR-001a)", async () => {
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
    store.update({ lastSeq: 17 });
    setOfflineRuntime(runtime());
    const r = await call("offline:pair", {
      ...PAIR,
      serverUrl: "https://api.test",
      deviceNo: 99,
    });
    expect(r.success).toBe(true);
    expect(fetchCalls[0]).toEqual({
      url: "https://api.test/api/offline/pair",
      body: { ...PAIR, deviceNo: 3 },
    });
    expect(store.read()?.lastSeq).toBe(17);
  });

  it("refuses a malformed form, and refuses while offline or finishing", async () => {
    setOfflineRuntime(runtime({ decision: decision("standalone") }));
    expect((await call("offline:pair", { shop: "" })).success).toBe(false);
    for (const m of ["offline", "finishing"] as const) {
      setOfflineRuntime(runtime({ decision: decision(m) }));
      expect(await call("offline:pair", PAIR)).toMatchObject({
        success: false,
      });
    }
    expect(fetchCalls).toEqual([]);
  });

  it("passes the server's refusal through (ADMIN_ONLY) and stores nothing", async () => {
    setOfflineRuntime(
      runtime({
        decision: decision("standalone"),
        fetch: async () => ({
          ok: true,
          status: 200,
          headers: { get: () => "application/json" },
          json: async () => ({
            success: false,
            code: "ADMIN_ONLY",
            error: "Only an admin can pair a PC",
          }),
          arrayBuffer: async () => new ArrayBuffer(0),
        }),
      }),
    );
    expect(await call("offline:pair", PAIR)).toEqual({
      success: false,
      code: "ADMIN_ONLY",
      error: "Only an admin can pair a PC",
    });
    expect(store.read()).toBeNull();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("server unreachable → clear error, nothing stored", async () => {
    setOfflineRuntime(
      runtime({
        decision: decision("standalone"),
        fetch: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    );
    const r = await call("offline:pair", PAIR);
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/server/i);
    expect(store.read()).toBeNull();
  });

  it("no safe storage → refused, key never written", async () => {
    store = new PairingStore(dir, { safeStorage: safe(false) });
    setOfflineRuntime(runtime({ decision: decision("standalone") }));
    const r = await call("offline:pair", PAIR);
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/encrypt/i);
    expect(fs.existsSync(path.join(dir, "pairing.json"))).toBe(false);
  });
});

describe("offline:unpair", () => {
  beforeEach(() => {
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
  });

  it("needs the admin password when the PC holds shop data; then clears and relaunches", async () => {
    setOfflineRuntime(runtime());
    expect(
      await call("offline:unpair", { username: "owner", password: "wrong" }),
    ).toMatchObject({ success: false });
    expect(store.read()).not.toBeNull();
    expect(
      await call("offline:unpair", {
        username: "owner",
        password: "Owner-pass-2026",
      }),
    ).toEqual({ success: true, data: {} });
    expect(store.read()).toBeNull();
    expect(removeShopData).toHaveBeenCalled();
    expect(relaunch).toHaveBeenCalled();
  });

  it("no shop data on the PC → no password needed", async () => {
    setOfflineRuntime(
      runtime({ hasShopData: () => false, decision: decision("blocked") }),
    );
    expect(await call("offline:unpair", {})).toEqual({
      success: true,
      data: {},
    });
  });

  it("refused while events wait or a working copy exists", async () => {
    setOfflineRuntime(runtime({ pendingCount: () => 2 }));
    expect(
      await call("offline:unpair", {
        username: "owner",
        password: "Owner-pass-2026",
      }),
    ).toMatchObject({ success: false });
    setOfflineRuntime(runtime({ hasWorkingCopy: () => true }));
    expect(
      await call("offline:unpair", {
        username: "owner",
        password: "Owner-pass-2026",
      }),
    ).toMatchObject({ success: false });
    expect(store.read()).not.toBeNull();
  });
});

describe("offline:open-web-app and offline:install-update", () => {
  it("opens the shop's web address in the system browser", async () => {
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
    setOfflineRuntime(runtime());
    expect(await call("offline:open-web-app")).toEqual({
      success: true,
      data: {},
    });
    expect(openExternal).toHaveBeenCalledWith(
      "https://cornertech.liratek.shop",
    );
  });

  it("not paired → refused", async () => {
    setOfflineRuntime(runtime({ decision: decision("standalone") }));
    expect((await call("offline:open-web-app")).success).toBe(false);
  });

  it("install only in standby/blocked", async () => {
    for (const m of ["standby", "blocked"] as const) {
      setOfflineRuntime(runtime({ decision: decision(m) }));
      expect(await call("offline:install-update")).toMatchObject({
        success: true,
      });
    }
    for (const m of ["offline", "finishing", "standalone"] as const) {
      setOfflineRuntime(runtime({ decision: decision(m) }));
      expect(await call("offline:install-update")).toMatchObject({
        success: false,
      });
    }
    expect(installUpdate).toHaveBeenCalledTimes(2);
  });
});
