// electron-app/handlers/__tests__/updaterHandlers.test.ts
//
// REVIVED 2026-09-13 — see the BLOCKER note below: this suite still cannot
// execute after this pass, and the reason is NOT this file's mocks.
//
// Root cause (verified by direct execution against the unmodified original
// file, before any edit here): `../updaterHandlers.ts` computes its own
// `__filename`/`__dirname` via the ESM-only idiom
//     const __filename = fileURLToPath(import.meta.url);
//     const __dirname = path.dirname(__filename);
// (shared with `main.ts`) — valid only when compiled/run as a real ES
// module, which is how the app actually ships (`tsconfig.json`:
// `"module": "ES2022"`; `dist/package.json`: `"type": "module"`).
//
// `jest.config.cjs` runs ts-jest without `useESM`/`extensionsToTreatAsEsm`.
// ts-jest's compiler (`ts-jest/dist/legacy/compiler/ts-compiler.js`,
// `fixupCompilerOptionsForModuleKind`) unconditionally forces
// `module: CommonJS` whenever `useESM` is off, REGARDLESS of what
// `tsconfig.json` says. `import.meta` isn't valid under CommonJS, but
// `diagnostics: false` lets ts-jest swallow that and emit the line anyway.
// When Jest then wraps the compiled module in its usual
// `function(module, exports, require, __dirname, __filename) {...}`
// closure, the module body's own `const __filename = ...` collides with the
// wrapper's `__filename` PARAMETER — `SyntaxError: Identifier '__filename'
// has already been declared` — thrown while Jest is still PARSING the file,
// before any of this file's `jest.mock()` factories or test bodies run. This
// reproduces on the untouched original file; it is not something this
// file's content controls.
//
// Consequently it cannot be fixed by editing this test (mocks only take
// effect once the module under test parses successfully), nor — per this
// task's cardinal rule — by editing `updaterHandlers.ts`. A real fix needs
// one of, both outside this task's scope:
//   (a) electron-app-wide test-infra change: `jest.config.cjs` turns on
//       ts-jest's `useESM` + `extensionsToTreatAsEsm: [".ts"]`, and Jest is
//       invoked with `--experimental-vm-modules`; or
//   (b) `updaterHandlers.ts`/`main.ts` stop deriving `__dirname` from
//       `import.meta.url`.
//
// SECOND, independent problem found while diagnosing (not yet observable —
// the file can't parse far enough to hit it): the packaged-mode branches
// call `esmRequire("electron-updater")`, where
// `esmRequire = createRequire(import.meta.url)` is a REAL Node
// `Module.createRequire` function. Jest substitutes mocked modules by
// handing each transformed file its own sandboxed `require` as a closure
// parameter — it does not monkey-patch Node's global module loader — so a
// `createRequire`-produced `require` resolves the REAL "electron-updater"
// package from `node_modules`, bypassing `jest.mock("electron-updater", …)`
// below entirely. That means even with (a) or (b) fixed, the three
// "packaged mode" tests below (`check`/`download`/`quitAndInstall` calling
// electron-updater) would still not observe the mock they assert against —
// only the two dev-mode-independent tests (`get-status`, `check returns
// error in dev mode`) are actually verifiable through this mocking
// approach, because they never reach `esmRequire`. Left as-is (matching
// this folder's established mocking style, and the original suite's intent)
// for whoever picks up (a)/(b), with this note so the next person doesn't
// spend an hour rediscovering it.
//
// Mocks below are corrected to cover what `updaterHandlers.ts` actually
// touches (added `BrowserWindow`, `net` — used by `wireAutoUpdaterEvents`/
// `fetchLatestRelease`, neither reachable by these specific tests today,
// but needed so the suite doesn't throw on an incomplete `electron` stub
// once the parse blocker above is lifted).

import { ipcMain, app } from "electron";
import { registerUpdaterHandlers } from "../updaterHandlers";

jest.mock("electron", () => ({
  app: {
    isPackaged: false,
    getVersion: () => "1.0.0",
  },
  ipcMain: { handle: jest.fn() },
  BrowserWindow: { getAllWindows: jest.fn(() => []) },
  net: { request: jest.fn() },
}));

jest.mock("electron-updater", () => ({
  autoUpdater: {
    checkForUpdates: jest.fn(async () => ({
      updateInfo: { version: "1.0.1" },
    })),
    downloadUpdate: jest.fn(async () => "downloaded"),
    quitAndInstall: jest.fn(),
    on: jest.fn(),
    updateInfoAndProvider: { version: "1.0.1" },
  },
}));

jest.mock("../../session", () => ({
  requireRole: () => ({ ok: true }),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("updaterHandlers", () => {
  beforeEach(() => {
    (ipcMain.handle as unknown as jest.Mock).mockClear();
  });

  function getHandler(channel: string) {
    const calls = (ipcMain.handle as unknown as jest.Mock).mock.calls;
    const match = calls.find((c) => c[0] === channel);
    if (!match) throw new Error(`Missing handler: ${channel}`);
    return match[1] as (...args: any[]) => any;
  }

  it("get-status returns version/platform/packaged", async () => {
    registerUpdaterHandlers();
    const handler = getHandler("updater:get-status");

    const res = await handler();
    expect(res.version).toBe("1.0.0");
    expect(res.packaged).toBe(false);
    expect(res.platform).toBe(process.platform);
  });

  it("check returns error in dev mode", async () => {
    (app as any).isPackaged = false;
    registerUpdaterHandlers();

    const handler = getHandler("updater:check");
    const res = await handler({ sender: { id: 1 } });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/disabled in dev/i);
  });

  // NOTE: the three tests below assert against the `jest.mock("electron-updater", …)`
  // above, but — per the header comment — `updaterHandlers.ts` reaches
  // "electron-updater" through `esmRequire` (a real `createRequire`), which
  // bypasses Jest's mock substitution. Even once the parse blocker (header,
  // cause (a)/(b)) is fixed, these three are expected to still fail against
  // the REAL "electron-updater" package rather than this mock, and that is
  // a second, separate fix (make the electron-updater import
  // mockable/injectable) — not something to paper over here.

  it("check calls electron-updater in packaged mode", async () => {
    const { autoUpdater } = require("electron-updater");
    (app as any).isPackaged = true;

    registerUpdaterHandlers();

    const handler = getHandler("updater:check");
    const res = await handler({ sender: { id: 1 } });
    expect(res.success).toBe(true);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled();
    expect(res.updateInfo).toEqual({ version: "1.0.1" });
  });

  it("download calls electron-updater in packaged mode", async () => {
    const { autoUpdater } = require("electron-updater");
    (app as any).isPackaged = true;

    registerUpdaterHandlers();

    const handler = getHandler("updater:download");
    const res = await handler({ sender: { id: 1 } });
    expect(res.success).toBe(true);
    expect(autoUpdater.downloadUpdate).toHaveBeenCalled();
  });

  it("quitAndInstall calls electron-updater in packaged mode", async () => {
    const { autoUpdater } = require("electron-updater");
    (app as any).isPackaged = true;

    registerUpdaterHandlers();

    const handler = getHandler("updater:quit-and-install");
    const res = await handler({ sender: { id: 1 } });
    expect(res.success).toBe(true);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalled();
  });
});
