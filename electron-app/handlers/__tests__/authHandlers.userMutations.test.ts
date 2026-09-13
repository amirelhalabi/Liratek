// electron-app/handlers/__tests__/authHandlers.userMutations.test.ts
//
// PARITY FIX — `users:set-active` and `users:set-role` discarded the
// boolean AuthService.deactivateUser/reactivateUser/setUserRole return and
// unconditionally audited + returned `{ success: true }`. Those methods
// return `false` when no row was updated: an id that does not exist, or —
// now that the writes are tenant-scoped (UserRepository.updateUser /
// softDeleteById / restore) — an id belonging to another tenant. So
// changing the role/active-status of a nonexistent (or foreign-tenant) user
// id used to report success to the operator AND write an audit_log row for
// a mutation that never happened. REST's mirror routes already branch on
// this; this brings desktop back in line (same class of bug as the
// auth:revoke-session fix in authHandlers.sessions.test.ts — see its (a)).
//
// `users:set-password` already branches on `result.success` correctly and
// is not touched here.
//
// Mocking style mirrors authHandlers.sessions.test.ts in this folder:
// `electron` and `../../session` mocked wholesale, `@liratek/core` mocked
// via jest.requireActual + override (real isAppError, mocked getAuthService
// only), `../../db` stubbed the same way the pre-existing
// authHandlers.test.ts does (registerAuthHandlers() runs an admin-seed
// INSERT on every call), ipcMain.handle captured into a Map so each
// channel's handler can be invoked directly.

import { ipcMain } from "electron";
import { registerAuthHandlers } from "../authHandlers";
import { getAuthService } from "@liratek/core";
import { requireRole } from "../../session";
import { audit } from "../auditHelper";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
}));

jest.mock("../../db", () => ({
  getDatabase: jest.fn(() => ({
    prepare: jest.fn(() => ({
      run: jest.fn(),
      all: jest.fn(),
      get: jest.fn(() => ""),
    })),
  })),
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getAuthService: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  setSession: jest.fn(),
  clearSession: jest.fn(),
  getSession: jest.fn(),
  requireRole: jest.fn(),
  storeEncryptedSession: jest.fn(),
  getEncryptedSession: jest.fn(),
  clearEncryptedSession: jest.fn(),
  storeSessionTokenToFile: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("authHandlers — users:set-active / users:set-role report false, not true, for a no-op mutation", () => {
  let mockAuthService: {
    deactivateUser: jest.Mock;
    reactivateUser: jest.Mock;
    setUserRole: jest.Mock;
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    mockAuthService = {
      deactivateUser: jest.fn(),
      reactivateUser: jest.fn(),
      setUserRole: jest.fn(),
    };
    (getAuthService as jest.Mock).mockReturnValue(mockAuthService);

    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      role: "admin",
      userId: 1,
    });

    registerAuthHandlers();
  });

  describe("users:set-role", () => {
    it("returns success:true and audits when the row was actually changed", async () => {
      mockAuthService.setUserRole.mockReturnValue(true);
      const handler = handlers.get("users:set-role")!;

      const result = await handler(
        { sender: { id: 1 } },
        { id: 5, role: "admin" },
      );

      expect(mockAuthService.setUserRole).toHaveBeenCalledWith(
        5,
        "admin",
        "admin",
      );
      expect(result).toEqual({ success: true });
      expect(audit).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ action: "update", entity_type: "user" }),
      );
    });

    // This is the regression the fix guards: pre-fix, this test FAILS —
    // the handler discarded setUserRole's `false` and returned
    // { success: true } plus an audit_log row for a role change that
    // never touched the database (unknown id, or another tenant's user).
    it("returns success:false and writes NO audit row when no user was updated", async () => {
      mockAuthService.setUserRole.mockReturnValue(false);
      const handler = handlers.get("users:set-role")!;

      const result = await handler(
        { sender: { id: 1 } },
        { id: 999, role: "admin" },
      );

      expect(result).toEqual({ success: false, error: "User not found" });
      // No audit entry for a role change that changed nothing.
      expect(audit).not.toHaveBeenCalled();
    });
  });

  describe("users:set-active", () => {
    it("deactivate: returns success:true and audits when the row was actually changed", async () => {
      mockAuthService.deactivateUser.mockReturnValue(true);
      const handler = handlers.get("users:set-active")!;

      const result = await handler(
        { sender: { id: 1 } },
        { id: 5, is_active: 0 },
      );

      expect(mockAuthService.deactivateUser).toHaveBeenCalledWith(
        5,
        0,
        "admin",
      );
      expect(result).toEqual({ success: true });
      expect(audit).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ action: "update", entity_type: "user" }),
      );
    });

    // Regression guard, deactivate branch: pre-fix this FAILS the same way
    // as the set-role case above — success:true plus an audit row for a
    // deactivation that never happened.
    it("deactivate: returns success:false and writes NO audit row when no user was updated", async () => {
      mockAuthService.deactivateUser.mockReturnValue(false);
      const handler = handlers.get("users:set-active")!;

      const result = await handler(
        { sender: { id: 1 } },
        { id: 999, is_active: 0 },
      );

      expect(result).toEqual({ success: false, error: "User not found" });
      expect(audit).not.toHaveBeenCalled();
    });

    it("reactivate: returns success:true and audits when the row was actually changed", async () => {
      mockAuthService.reactivateUser.mockReturnValue(true);
      const handler = handlers.get("users:set-active")!;

      const result = await handler(
        { sender: { id: 1 } },
        { id: 5, is_active: 1 },
      );

      expect(mockAuthService.reactivateUser).toHaveBeenCalledWith(5, "admin");
      expect(result).toEqual({ success: true });
      expect(audit).toHaveBeenCalled();
    });

    // Regression guard, reactivate branch.
    it("reactivate: returns success:false and writes NO audit row when no user was updated", async () => {
      mockAuthService.reactivateUser.mockReturnValue(false);
      const handler = handlers.get("users:set-active")!;

      const result = await handler(
        { sender: { id: 1 } },
        { id: 999, is_active: 1 },
      );

      expect(result).toEqual({ success: false, error: "User not found" });
      expect(audit).not.toHaveBeenCalled();
    });
  });
});
