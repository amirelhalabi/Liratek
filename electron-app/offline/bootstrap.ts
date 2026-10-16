/**
 * LIRA-306 — wires the offline pieces into the desktop's start-up (plan
 * diagram B). main.ts calls, in order:
 *
 *   1. `prepareOfflineBoot()`  — reads pairing.json and the copies, decides
 *      the mode (bootDecision). Never throws: any failure → standalone.
 *   2. (main opens the database the decision names, or today's file)
 *   3. `installOfflineRecorder()` — BEFORE any register*Handlers().
 *   4. (main registers the handlers, incl. offlineHandlers)
 *   5. `startOfflineRuntime()` — the runtime the offline:* channels read,
 *      the 30 s sync loop (check-in, copy refresh, upload, finishing).
 *
 * Electron itself is passed in (safeStorage, shell, app.relaunch), so this
 * module stays loadable by ts-jest; the desktop behaviour is verified on
 * Windows/CI only.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import {
  MIGRATIONS,
  getOfflineOutboxRepository,
  getRateRepository,
  getRowCaptureRepository,
  localDay,
  logger,
  setPcOfflineMode,
  verifyPassword,
  type OfflineRates,
} from "@liratek/core";
import { decideBoot, type BootDecision } from "./bootDecision.js";
import { PairingStore, type SafeStorageLike } from "./pairingStore.js";
import {
  listMirrors,
  readCopyInfo,
  workingCopyPath,
  type DatabaseCtor,
} from "./offlineFiles.js";
import { installRecorder, type IpcMainLike, type Recorder } from "./recorder.js";
import { ReadWriteLog, WriteGuard } from "./writeGuard.js";
import { SyncClient, type FetchLike } from "./syncClient.js";
import { OfflineSender } from "./sender.js";
import { Finisher, makeBackToWeb, makeGoOffline } from "./modeSwitch.js";
import { buildManifest } from "./manifest.js";
import { setOfflineRuntime } from "./runtime.js";

export const DEFAULT_OFFLINE_API_URL = "https://api.liratek.shop";

export interface OfflineBoot {
  offlineDir: string;
  store: PairingStore;
  decision: BootDecision;
  /** copy id of the file this process opened (working copy or mirror) */
  copyId: string | null;
}

export function appSchemaVersion(): number {
  return MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
}

export function prepareOfflineBoot(i: {
  userData: string;
  safeStorage: SafeStorageLike;
  DatabaseCtor: DatabaseCtor;
}): OfflineBoot {
  const offlineDir = path.join(i.userData, "offline");
  const store = new PairingStore(offlineDir, { safeStorage: i.safeStorage });
  try {
    const pairing = store.read();
    const workingCopy = pairing
      ? readCopyInfo(workingCopyPath(offlineDir), i.DatabaseCtor)
      : null;
    const mirrors = pairing ? listMirrors(offlineDir, i.DatabaseCtor) : [];
    const decision = decideBoot({
      offlineDir,
      pairing,
      workingCopy,
      mirrors,
      appSchemaVersion: appSchemaVersion(),
      now: new Date(),
    });
    const opened = decision.dbFile
      ? readCopyInfo(decision.dbFile, i.DatabaseCtor)
      : null;
    logger.info(
      {
        mode: decision.mode,
        ready: decision.ready,
        reason: decision.notReadyReason,
        file: decision.dbFile ? path.basename(decision.dbFile) : null,
      },
      "desktop boot mode decided",
    );
    if (decision.mode === "offline") setPcOfflineMode(true);
    return { offlineDir, store, decision, copyId: opened?.copyId ?? null };
  } catch (error) {
    logger.error(
      { error },
      "offline boot decision failed — starting standalone",
    );
    return {
      offlineDir,
      store,
      decision: decideBoot({
        offlineDir,
        pairing: null,
        workingCopy: null,
        mirrors: [],
        appSchemaVersion: appSchemaVersion(),
        now: new Date(),
      }),
      copyId: null,
    };
  }
}

/** Opens the decision's file (paired modes). Returns null in blocked mode. */
export function openPairedDatabase(
  boot: OfflineBoot,
  Ctor: DatabaseCtor,
): BetterSqlite3.Database | null {
  const d = boot.decision;
  if (!d.dbFile) return null;
  const db = new Ctor(d.dbFile, { readonly: d.readonly, fileMustExist: true });
  if (!d.readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

function currentRates(): OfflineRates {
  const out: OfflineRates = {};
  try {
    for (const r of getRateRepository().findAll()) {
      const code = String(r.to_code).toUpperCase();
      if (!/^[A-Z]{3,4}$/.test(code)) continue;
      if (!(r.sell_rate > 0 && r.buy_rate > 0 && r.market_rate > 0)) continue;
      out[code] = {
        sell: r.sell_rate,
        buy: r.buy_rate,
        market: r.market_rate,
        direction: r.is_stronger === -1 ? -1 : 1,
      };
    }
  } catch (error) {
    logger.warn({ error }, "offline: could not read the exchange rates");
  }
  return out;
}

export function installOfflineRecorder(
  boot: OfflineBoot,
  ipcMain: IpcMainLike,
  deps: {
    db: () => BetterSqlite3.Database;
    actorOf: (senderId: number) => number | null;
    appVersion: string;
  },
): { recorder: Recorder; guard: WriteGuard; readLog: ReadWriteLog } {
  const guard = new WriteGuard(deps.db);
  const readLog = new ReadWriteLog(
    path.join(boot.offlineDir, "read-writes.json"),
  );
  const recorder = installRecorder(ipcMain, {
    mode: () => boot.decision.mode,
    db: deps.db,
    guard,
    readWriteLog: readLog,
    outbox: getOfflineOutboxRepository(),
    rowCapture: getRowCaptureRepository(),
    pairing: () => {
      const p = boot.store.read();
      return { lastSeq: p?.lastSeq ?? 0, serverMaxSeq: p?.serverMaxSeq ?? 0 };
    },
    onSeqUsed: (seq) => {
      const p = boot.store.read();
      if (p && seq > p.lastSeq) boot.store.update({ lastSeq: seq });
    },
    actorOf: deps.actorOf,
    copyId: () => boot.copyId ?? "00000000-0000-4000-8000-000000000000",
    rates: currentRates,
    appVersion: deps.appVersion,
    schemaVersion: appSchemaVersion(),
    now: () => new Date(),
    clientDay: (d) => localDay(d),
    tzOffsetMinutes: (d) => -d.getTimezoneOffset(),
    uuid: () => crypto.randomUUID(),
  });
  const mode = boot.decision.mode;
  if (mode === "offline" || mode === "finishing") guard.lockdown();
  return { recorder, guard, readLog };
}

function toFetchLike(f: typeof fetch): FetchLike {
  return async (url, init) => {
    const res = await f(url, {
      method: init?.method ?? "GET",
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      headers: { get: (n: string) => res.headers.get(n) },
      json: () => res.json() as Promise<unknown>,
      arrayBuffer: () => res.arrayBuffer(),
    };
  };
}

export function startOfflineRuntime(
  boot: OfflineBoot,
  parts: { recorder: Recorder; guard: WriteGuard; readLog: ReadWriteLog },
  deps: {
    db: () => BetterSqlite3.Database | null;
    closeDb: () => void;
    DatabaseCtor: DatabaseCtor;
    relaunch: () => void;
    openExternal: (url: string) => Promise<void>;
    installUpdate: () => Promise<{ success: boolean; error?: string }>;
    autoDownloadUpdate: () => Promise<void>;
    appVersion: string;
    fetch?: typeof fetch;
  },
): void {
  const { decision, store, offlineDir } = boot;
  const fetchLike = toFetchLike(deps.fetch ?? fetch);
  const mode = decision.mode;
  const exclusive = <T>(fn: () => T): Promise<T> =>
    parts.recorder.runExclusive(() => parts.guard.withWritable(fn));
  const hasWorking = () => fs.existsSync(workingCopyPath(offlineDir));
  const outbox = getOfflineOutboxRepository();
  const pendingCount = () =>
    (mode === "offline" || mode === "finishing") && deps.db()
      ? outbox.waitingCount()
      : 0;

  let sync: SyncClient | null = null;
  const sender =
    mode === "offline" || mode === "finishing"
      ? new OfflineSender({
          store,
          fetch: fetchLike,
          now: Date.now,
          appVersion: deps.appVersion,
          schemaVersion: appSchemaVersion(),
          outbox,
          exclusive,
          onReachable: () => sync?.noteReachable(),
          onUnreachable: () => sync?.noteUnreachable(),
        })
      : undefined;

  const finisher =
    mode === "finishing" && sender
      ? new Finisher({
          offlineDir,
          store,
          deviceNo: store.read()?.deviceNo ?? 0,
          DatabaseCtor: deps.DatabaseCtor,
          now: Date.now,
          isReachable: () => sync?.isReachable() ?? false,
          unreachableSeconds: () => sync?.unreachableSeconds() ?? 0,
          sendWaiting: () => sender.sendWaiting(),
          buildManifest: () => {
            const db = deps.db();
            const p = store.read();
            if (!db || !p) throw new Error("no working copy");
            return buildManifest({
              db,
              deviceNo: p.deviceNo,
              copyId: boot.copyId ?? "",
              readWrites: parts.readLog.entries(),
            }).body;
          },
          sendManifest: async (body) => {
            const p = store.read();
            const key = store.deviceKey();
            if (!p || !key) return false;
            try {
              const res = await fetchLike(
                `${p.serverUrl.replace(/\/+$/, "")}/api/offline/manifest`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-LiraTek-Device-Key": key,
                  },
                  body: JSON.stringify(body),
                  signal: AbortSignal.timeout(60_000),
                },
              );
              const env = (await res.json()) as {
                success?: boolean;
                data?: { matched?: boolean };
              };
              if (env.success && env.data && env.data.matched === false) {
                logger.warn(
                  "offline manifest: the server found rows no event explains (review list)",
                );
              }
              return env.success === true;
            } catch (error) {
              logger.warn({ error }, "offline manifest: not sent yet");
              return false;
            }
          },
          lastSeq: () => Math.max(store.read()?.lastSeq ?? 0, outbox.maxSeq()),
          closeDb: deps.closeDb,
          clearReadLog: () => parts.readLog.clear(),
          relaunch: deps.relaunch,
        })
      : null;

  if (mode !== "standalone") {
    const pcState = mode;
    sync = new SyncClient({
      offlineDir,
      store,
      fetch: fetchLike,
      now: Date.now,
      appVersion: deps.appVersion,
      appSchemaVersion: appSchemaVersion(),
      getState: () => pcState,
      pendingCount,
      openFile: () => decision.dbFile,
      DatabaseCtor: deps.DatabaseCtor,
      sender,
      onTick: finisher ? () => finisher.tick() : undefined,
    });
    sync.start();
    if (mode === "standby" || mode === "blocked")
      void deps.autoDownloadUpdate();
  }

  const webBase =
    process.env.LIRATEK_WEB_APP_URL_TEMPLATE ?? "https://{slug}.liratek.shop";
  setOfflineRuntime({
    decision,
    store,
    sync,
    defaultServerUrl:
      process.env.LIRATEK_OFFLINE_API_URL ?? DEFAULT_OFFLINE_API_URL,
    webAppUrl: (slug) => webBase.replace("{slug}", encodeURIComponent(slug)),
    fetch: fetchLike,
    now: Date.now,
    pendingCount,
    hasWorkingCopy: hasWorking,
    copyAgeSeconds: () => {
      const file = decision.dbFile;
      const info = file
        ? readCopyInfo(file, deps.DatabaseCtor)
        : (listMirrors(offlineDir, deps.DatabaseCtor)[0] ?? null);
      return info
        ? Math.max(
            0,
            Math.floor((Date.now() - Date.parse(info.builtAt)) / 1000),
          )
        : null;
    },
    verifyLocalAdmin: (username, password) => {
      const db = deps.db();
      if (!db) return false;
      const row = db
        .prepare(
          `SELECT password_hash FROM users WHERE username = ? AND role = 'admin' AND is_active = 1 LIMIT 1`,
        )
        .get(username) as { password_hash?: string } | undefined;
      return (
        !!row?.password_hash && verifyPassword(password, row.password_hash)
      );
    },
    hasShopData: () =>
      hasWorking() || listMirrors(offlineDir, deps.DatabaseCtor).length > 0,
    removeShopData: () => {
      deps.closeDb();
      for (const m of listMirrors(offlineDir, deps.DatabaseCtor)) {
        for (const f of [m.file, `${m.file}-wal`, `${m.file}-shm`])
          fs.rmSync(f, { force: true });
      }
    },
    relaunch: deps.relaunch,
    openExternal: deps.openExternal,
    installUpdate: deps.installUpdate,
    goOffline: makeGoOffline({
      offlineDir,
      store,
      DatabaseCtor: deps.DatabaseCtor,
      now: Date.now,
      newestMirror: () =>
        listMirrors(offlineDir, deps.DatabaseCtor).find(
          (m) => m.tenantId === store.read()?.tenantId,
        )?.file ?? null,
      relaunch: deps.relaunch,
    }),
    backToWeb: makeBackToWeb({ store, relaunch: deps.relaunch }),
    sendNow: async () =>
      sender ? sender.sendWaiting() : { sent: 0, waiting: 0 },
  });
}
