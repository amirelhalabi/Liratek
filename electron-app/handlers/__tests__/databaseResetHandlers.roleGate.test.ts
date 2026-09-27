/**
 * database:resetPreview / database:reset — admin-only role gate
 * (`electron-app/handlers/databaseResetHandlers.ts:43` and `:60`,
 * `requireRole(event.sender.id, ["admin"])`). Desktop IPC twin of
 * `backend/src/api/__tests__/databaseResetRoleGate.api.test.ts`, which
 * covers the same gate on the REST transport
 * (`backend/src/api/databaseReset.ts:52`).
 *
 * A destructive, irreversible wipe of all operational data must never be
 * reachable by "staff" on either transport. Nothing previously asserted the
 * staff-refusal side of this gate on desktop; this file (plus the backend
 * sibling above) is that coverage.
 *
 * Same mocking shape as `inventoryHandlers.categorySupplierRoleGate.test.ts`
 * / `inventoryHandlers.batchUpdateRoleGate.test.ts`: `@liratek/core` is
 * mocked via `jest.requireActual` + override so the real
 * `DatabaseResetSchema` (a re-export of the real core `databaseResetSchema`,
 * rule 14) still runs for real, and `../session.js`'s `requireRole` is
 * mocked directly so a non-admin caller is refused WITHOUT the handler ever
 * reaching the service. `../backupHandlers.js`'s `getBackupServiceInstance`
 * is also mocked — the admin/allowed case for `database:reset` runs the
 * full pre-wipe-backup step, and none of `getDatabase`, `resolveDatabasePath`,
 * `getAuditService`, `getUserRepository`, or the backup service may touch a
 * real file or DB.
 *
 * Rule-17 note (discharged 2026-09-26). `requireRole` is fully mocked in
 * this test file (its return value is driven directly by the test via
 * `mockReturnValue`/`forbidden()`, not by evaluating the roles array
 * against a session) — so widening the source's `["admin"]` to
 * `["admin", "staff"]`, the technique used on the REST sibling (where
 * `../../middleware/auth.js` IS re-implemented with real role-checking
 * logic keyed on `x-test-role`), would have had NO observable effect here.
 * The equivalent proof for a fully-mocked `requireRole` is removing the
 * gate's early return entirely — the technique
 * `inventoryHandlers.categorySupplierRoleGate.test.ts` already established
 * for this exact harness shape.
 *
 *   1. In `databaseResetHandlers.ts`'s `database:reset` handler, removed
 *      just the line `if (!auth.ok) return { success: false, error:
 *      auth.error };` (kept `const auth = requireRole(...)` itself, since
 *      `auth.userId`/`auth.role` are read further down for the audit-log
 *      call — `diagnostics: false` in `jest.config.cjs` means ts-jest does
 *      not type-check, so the resulting union-narrowing gap did not block
 *      the test from compiling/running).
 *   2. Ran `npx jest handlers/__tests__/databaseResetHandlers.roleGate.test.ts
 *      --maxWorkers=1` against that change. Real output: `Tests: 1 failed,
 *      3 passed, 4 total`. The failure was "database:reset refuses a
 *      non-admin caller WITHOUT reaching the service":
 *      `expect(mockBackupService.createBackup).not.toHaveBeenCalled()` —
 *      `Expected number of calls: 0, Received number of calls: 1` (called
 *      with `"fake.db"`). With the gate removed, a forbidden caller's
 *      request ran straight through to the pre-wipe backup step; the mocked
 *      `createBackup()` returned `undefined`, which the handler's own
 *      `if (!backupResult.success)` then threw on, logged as
 *      `"database:reset backup step failed"`, and turned into a caught
 *      `{ success: false, error: "Backup failed — reset aborted: ..." }` —
 *      a DIFFERENT failure than the `"Forbidden"` the test expects, which is
 *      exactly the bug this gate exists to prevent (a staff caller reaching
 *      real destructive machinery instead of being turned away at the
 *      door). The other three cases (preview-refuses, preview-allows,
 *      reset-allows) were unaffected and stayed green.
 *   3. `databaseResetHandlers.ts` was restored byte-identically (`git diff
 *      --stat -- electron-app/handlers/databaseResetHandlers.ts` printed
 *      nothing but a line-ending warning afterward) and the file re-run —
 *      `Tests: 4 passed, 4 total` again.
 *
 * The `database:resetPreview` gate was not separately mutated — the same
 * mocked-`requireRole` reasoning applies to it identically, and the REST
 * sibling test's rule-17 proof already covers the preview route on the
 * other transport.
 */

import { ipcMain } from "electron";
import { registerDatabaseResetHandlers } from "../databaseResetHandlers";
import {
  getDatabaseResetService,
  getDatabase,
  resolveDatabasePath,
  getAuditService,
  getUserRepository,
} from "@liratek/core";
import { requireRole } from "../../session";
import { getBackupServiceInstance } from "../backupHandlers";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getDatabaseResetService: jest.fn(),
    getDatabase: jest.fn(),
    resolveDatabasePath: jest.fn(),
    getAuditService: jest.fn(),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../backupHandlers", () => ({
  getBackupServiceInstance: jest.fn(),
}));

describe("database:resetPreview / database:reset — role gate", () => {
  const mockService = {
    preview: jest.fn(),
    reset: jest.fn(),
  };
  const mockDb = { pragma: jest.fn() };
  const mockAuditService = { log: jest.fn() };
  const mockUserRepo = { findById: jest.fn() };
  const mockBackupService = { createBackup: jest.fn() };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getDatabaseResetService as jest.Mock).mockReturnValue(mockService);
    (getDatabase as jest.Mock).mockReturnValue(mockDb);
    (resolveDatabasePath as jest.Mock).mockReturnValue({ path: "fake.db" });
    (getAuditService as jest.Mock).mockReturnValue(mockAuditService);
    (getUserRepository as jest.Mock).mockReturnValue(mockUserRepo);
    (getBackupServiceInstance as jest.Mock).mockReturnValue(
      mockBackupService,
    );
    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      userId: 7,
      role: "admin",
    });

    registerDatabaseResetHandlers();
  });

  const forbidden = () =>
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden",
    });

  it("database:resetPreview refuses a non-admin caller WITHOUT reaching the service", async () => {
    forbidden();
    const handler = handlers.get("database:resetPreview")!;

    const result = await handler({ sender: { id: 1 } });

    expect(requireRole).toHaveBeenCalledWith(1, ["admin"]);
    expect(mockService.preview).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "Forbidden" });
  });

  it("database:reset refuses a non-admin caller WITHOUT reaching the service", async () => {
    forbidden();
    const handler = handlers.get("database:reset")!;

    const result = await handler(
      { sender: { id: 1 } },
      { confirmation: "RESET ALL DATA" },
    );

    expect(requireRole).toHaveBeenCalledWith(1, ["admin"]);
    expect(mockService.reset).not.toHaveBeenCalled();
    expect(mockBackupService.createBackup).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "Forbidden" });
  });

  it("database:resetPreview allows an admin caller through", async () => {
    mockService.preview.mockReturnValue({
      counts: { product_categories: 3 },
      totalRows: 3,
    });
    const handler = handlers.get("database:resetPreview")!;

    const result = await handler({ sender: { id: 1 } });

    expect(requireRole).toHaveBeenCalledWith(1, ["admin"]);
    expect(mockService.preview).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      data: { counts: { product_categories: 3 }, totalRows: 3 },
    });
  });

  it("database:reset allows an admin caller through, runs the pre-wipe backup, and forwards the confirmation phrase", async () => {
    mockBackupService.createBackup.mockReturnValue({
      success: true,
      path: "backup-2026.db",
    });
    mockService.reset.mockReturnValue({
      success: true,
      data: { deletedRows: { transactions: 5 }, totalDeleted: 5 },
    });
    mockUserRepo.findById.mockReturnValue({ id: 7, username: "owner" });

    const handler = handlers.get("database:reset")!;
    const result = await handler(
      { sender: { id: 1 } },
      { confirmation: "RESET ALL DATA" },
    );

    expect(requireRole).toHaveBeenCalledWith(1, ["admin"]);
    expect(mockBackupService.createBackup).toHaveBeenCalledWith("fake.db");
    expect(mockService.reset).toHaveBeenCalledWith({
      confirmation: "RESET ALL DATA",
      backupPath: "backup-2026.db",
    });
    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 7,
        action: "reset",
        entity_type: "database",
      }),
    );
    expect(result).toEqual({
      success: true,
      data: { deletedRows: { transactions: 5 }, totalDeleted: 5 },
    });
  });
});
