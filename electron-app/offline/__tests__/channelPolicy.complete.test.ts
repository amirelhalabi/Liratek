/**
 * LIRA-306 T009 — every desktop IPC channel is classified in the core channel
 * policy exactly once, and the policy names nothing the desktop does not
 * register (FR-009, SC-006).
 *
 * How: every `handlers/*.ts` module is loaded against a fake `ipcMain`
 * (electron mocked) and each exported `register*Handlers()` is called; the
 * channel names passed to `ipcMain.handle` are the desktop's real surface.
 *
 * `updaterHandlers.ts` and `setupHandlers.ts` cannot be parsed under ts-jest (see jest.config.cjs —
 * `import.meta.url` collides with the CommonJS wrapper), so its channels are
 * read from the source text instead (both use `import.meta.url`); the same text scan is cross-checked
 * against the dynamic load for every other file, which proves the scan finds
 * exactly what registration finds.
 *
 * The eight `offline:*` channels were classified ahead of time
 * (`PLANNED_CHANNELS`); T122/T136 registered them, so the list is empty.
 */
import fs from "node:fs";
import path from "node:path";

const registered: string[] = [];

jest.mock("electron", () => {
  const ipcMain = {
    handle: jest.fn((name: string) => {
      registered.push(name);
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
  };
});

jest.mock("../../main.js", () => ({ getDb: jest.fn() }));
// main.ts and ReportService.ts derive __dirname from import.meta.url, which ts-jest cannot parse.
jest.mock("../../services/ReportService.js", () => ({
  ReportService: jest.fn(),
}));

import { CHANNEL_POLICY, PLANNED_CHANNELS, policyCounts } from "@liratek/core";

const HANDLERS_DIR = path.join(__dirname, "../../handlers");
const UNPARSEABLE = new Set(["setupHandlers.ts", "updaterHandlers.ts"]);

function handlerFiles(): string[] {
  return fs
    .readdirSync(HANDLERS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .sort();
}

function scanChannels(file: string): string[] {
  const src = fs.readFileSync(path.join(HANDLERS_DIR, file), "utf8");
  const out: string[] = [];
  const re = /ipcMain\.handle\(\s*["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

function loadAll(): {
  dynamic: Map<string, string[]>;
  scanned: Map<string, string[]>;
} {
  const dynamic = new Map<string, string[]>();
  const scanned = new Map<string, string[]>();
  for (const file of handlerFiles()) {
    scanned.set(file, scanChannels(file));
    if (UNPARSEABLE.has(file)) continue;
    registered.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(HANDLERS_DIR, file)) as Record<
      string,
      unknown
    >;
    for (const [name, fn] of Object.entries(mod)) {
      if (/^register\w*Handlers$/.test(name) && typeof fn === "function") {
        (fn as () => unknown)();
      }
    }
    dynamic.set(file, [...registered]);
  }
  return { dynamic, scanned };
}

describe("channel policy completeness (FR-009)", () => {
  const { dynamic, scanned } = loadAll();

  it("the text scan finds exactly what registration finds (validates the updater fallback)", () => {
    for (const [file, names] of dynamic) {
      expect({ file, names: [...names].sort() }).toEqual({
        file,
        names: [...(scanned.get(file) ?? [])].sort(),
      });
    }
    expect(dynamic.size).toBeGreaterThanOrEqual(43);
  });

  const all: string[] = [];
  for (const [file, names] of scanned) {
    all.push(...(UNPARSEABLE.has(file) ? names : (dynamic.get(file) ?? [])));
  }

  it("registers each channel once", () => {
    expect(all.length).toBe(new Set(all).size);
    expect(all.length).toBeGreaterThan(400);
  });

  it("every registered channel is classified exactly once", () => {
    const counts = new Map<string, number>();
    for (const e of CHANNEL_POLICY)
      counts.set(e.channel, (counts.get(e.channel) ?? 0) + 1);
    expect([...counts].filter(([, n]) => n > 1).map(([c]) => c)).toEqual([]);
    expect(all.filter((c) => !counts.has(c))).toEqual([]);
  });

  it("the policy names nothing that is not registered (except the planned offline:* channels)", () => {
    const reg = new Set(all);
    const planned = new Set(PLANNED_CHANNELS);
    expect(
      CHANNEL_POLICY.map((e) => e.channel).filter(
        (c) => !reg.has(c) && !planned.has(c),
      ),
    ).toEqual([]);
    // a planned channel that is now registered must leave the planned list
    expect(PLANNED_CHANNELS.filter((c) => reg.has(c))).toEqual([]);
  });

  // LIRA-309 added resale-lines:save + :write-off + :recharge (online_only)
  // and resale-lines:list (read).
  // LIRA-312 added wrong-numbers:record + :credits (online_only) and
  // wrong-numbers:list (read). LIRA-325 added wrong-numbers:sale-card (read).
  // LIRA-326 added recharge-basket:checkout (online_only); LIRA-327 added
  // recharge-basket:partner-order (online_only). LIRA-333 added
  // app:open-external (local); LIRA-330 added debt:get-all-history (read).
  // LIRA-331 added user-preferences:get (read) and :set-language (online_only).
  // LIRA-335 added closing:get-open-differences-after (read) and
  // closing:close-difference + :reopen-difference (online_only).
  it("matches the contract counts: offline 70 / online_only 116 / checkpoint 7 / read 222 / local 25 (440) — voucher:cancel online-only (O-impl-C-1)", () => {
    expect(policyCounts()).toEqual({
      offline: 70,
      online_only: 116,
      checkpoint: 7,
      read: 222,
      local: 25,
      total: 440,
    });
    expect(PLANNED_CHANNELS).toHaveLength(0); // T122 + T136 registered all 8 offline:* channels
  });
});
