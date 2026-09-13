// electron-app/handlers/__tests__/updaterHandlers_registration.test.ts
//
// REVIVED 2026-09-13 — but see the BLOCKER note below: this suite still
// cannot execute, and the reason is NOT a mock-completeness problem.
//
// Root cause (verified by direct execution, not inferred from reading):
// `../updaterHandlers.ts` computes its own `__filename`/`__dirname` via the
// ESM-only idiom
//     const __filename = fileURLToPath(import.meta.url);
//     const __dirname = path.dirname(__filename);
// (shared with `main.ts`). That is only valid when the file is actually
// compiled/run as an ES module, which is how `electron-app`'s real build
// ships it (`tsconfig.json` has `"module": "ES2022"`, and `dist/package.json`
// declares `"type": "module"`).
//
// `jest.config.cjs` runs ts-jest WITHOUT `useESM`/`extensionsToTreatAsEsm`,
// and ts-jest's compiler (`ts-jest/dist/legacy/compiler/ts-compiler.js`,
// `fixupCompilerOptionsForModuleKind`) FORCES `module: CommonJS` for every
// file when `useESM` is off — unconditionally, regardless of what
// `tsconfig.json` itself says. Under a CommonJS target, `import.meta` isn't
// valid, but with `diagnostics: false` ts-jest swallows that as a mere
// diagnostic and still emits the (invalid) line as-is. The result, once
// Jest wraps the compiled module in its usual
// `function(module, exports, require, __dirname, __filename) {...}`
// closure, is that the module body's own
// `const __filename = ...` collides with the wrapper's `__filename`
// PARAMETER of the same name — a `SyntaxError: Identifier '__filename' has
// already been declared`, thrown while Jest is still PARSING the file, before
// a single line of this test (or any jest.mock() factory) ever runs. This
// is reproducible by running the suite completely unmodified — it is not a
// consequence of anything in this file.
//
// That means it cannot be fixed by editing this test file (mocks only take
// effect after the module under test successfully parses) — nor, per this
// task's cardinal rule, by editing `updaterHandlers.ts` itself. Fixing it
// for real needs one of, both outside this task's permitted scope:
//   (a) `electron-app/jest.config.cjs`: turn on ts-jest's `useESM` +
//       `extensionsToTreatAsEsm: [".ts"]` and run Jest with
//       `--experimental-vm-modules` (an electron-app-wide test-infra change,
//       not a single-file fix); or
//   (b) `updaterHandlers.ts`/`main.ts`: stop deriving `__dirname` from
//       `import.meta.url` (e.g. resolve the app root a different way that
//       doesn't require ESM-only syntax at module scope).
//
// A SECOND, independent problem sits behind the first (found while
// diagnosing, not yet observable because the file can't even parse): the
// packaged-mode branches call `esmRequire("electron-updater")`, where
// `esmRequire = createRequire(import.meta.url)` is a REAL Node
// `Module.createRequire` function. Jest mocks modules by substituting the
// `require` it hands to each transformed file as a closure parameter — it
// does not monkey-patch Node's global module loader — so a `createRequire`
// -produced `require` resolves the REAL "electron-updater" package,
// bypassing `jest.mock("electron-updater", ...)` entirely. This suite (the
// sibling `updaterHandlers.test.ts`) already assumed `jest.mock` would
// intercept `esmRequire`; it wouldn't have, even with (a)/(b) above fixed.
// Left as a note for whoever picks (a) or (b) up next.
//
// Given the above, this file is left matching the CURRENT contract and the
// inline-factory mocking style every passing sibling in this folder uses,
// so it is ready to go the moment the parse blocker is lifted — but it
// currently reports 0 tests collected (suite fails to run), the same as
// before this revival pass.

import { ipcMain } from "electron";
import { registerUpdaterHandlers } from "../updaterHandlers";

jest.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "1.0.0" },
  ipcMain: { handle: jest.fn() },
  BrowserWindow: { getAllWindows: jest.fn(() => []) },
  net: { request: jest.fn() },
}));

describe("updaterHandlers registration", () => {
  it("registers updater channels", () => {
    registerUpdaterHandlers();

    const calls = (ipcMain.handle as unknown as jest.Mock).mock.calls.map(
      (c) => c[0],
    );

    expect(calls).toEqual(
      expect.arrayContaining([
        "updater:get-status",
        "updater:check",
        "updater:download",
        "updater:quit-and-install",
      ]),
    );
  });
});
