// electron-app/handlers/__tests__/authHandlers.sessions.test.ts
//
// FIX 2 — two desktop defects, both in authHandlers.ts:
//
// (a) PARITY. `auth:revoke-session` used to return {success:true, data:false}
//     when nothing was actually revoked (unknown id / already gone / another
//     user's session), so the desktop UI showed "Session ended" for a revoke
//     that revoked nothing. REST's mirror (backend/src/api/auth.ts DELETE
//     /api/auth/sessions/:id) already answers {success:false,error:"Session
//     not found"} on the same condition — rule 19 requires both transports
//     to land that condition on the same side of `success`.
//
// (b) REGRESSION. `auth:restore-session` calls
//     `authService.validateSession(token)` twice (localStorage token, then
//     the encrypted-file token as a fallback), both under ONE outer
//     try/catch. validateSession() used to swallow every error to `null`;
//     it now THROWS on infra errors (AuthService.ts, Part 1) so REST's
//     authenticateJWT can answer 503 vs 401. That flip meant a throw from
//     the FIRST validateSession call hit the outer catch and skipped the
//     encrypted-file fallback entirely — a transient SQLITE_BUSY at boot
//     dropped straight to the login screen instead of getting the second
//     chance it used to have.
//
// (c) getCurrentSessionToken()'s userId-match guard: desktop's encrypted
//     session file is a SINGLE slot (one BrowserWindow, session.ts), so a
//     stale/foreign token left by a previous user on a shared machine must
//     never be handed back as "the caller's own token". Exercised through
//     its two call sites: auth:list-sessions (best-effort — falls back to
//     "" rather than trust a mismatched token) and
//     auth:revoke-other-sessions (refuses outright — trusting a mismatched
//     token there could revoke the CALLER's own live session).
//
// Mocking style mirrors exchangeLotHandlers.test.ts / rechargeHandlers.test.ts
// in this folder: `electron` and `../../session` mocked wholesale,
// `@liratek/core` mocked via jest.requireActual + override (real
// hashPassword/isAppError, mocked getAuthService only — the same technique
// exchangeLotHandlers.test.ts uses because these handlers import their
// service getter from "@liratek/core" directly, not from "../../services"),
// `../../db` stubbed the same way the pre-existing authHandlers.test.ts does
// (registerAuthHandlers() runs an admin-seed INSERT on every call), ipcMain
// .handle captured into a Map so each channel's handler can be invoked
// directly.

import { ipcMain } from "electron";
import { registerAuthHandlers } from "../authHandlers";
import { getAuthService } from "@liratek/core";
import {
  requireRole,
  getEncryptedSession,
  clearEncryptedSession,
} from "../../session";
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

describe("authHandlers — session parity, restore fallback, token guard", () => {
  let mockAuthService: {
    revokeUserSession: jest.Mock;
    revokeOtherSessions: jest.Mock;
    listUserSessions: jest.Mock;
    validateSession: jest.Mock;
    getUserById: jest.Mock;
    login: jest.Mock;
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    mockAuthService = {
      revokeUserSession: jest.fn(),
      revokeOtherSessions: jest.fn(),
      listUserSessions: jest.fn(),
      validateSession: jest.fn(),
      getUserById: jest.fn(),
      login: jest.fn(),
    };
    (getAuthService as jest.Mock).mockReturnValue(mockAuthService);

    // Default: authenticated as an ordinary user (id 42). Individual tests
    // override this where a mismatch is the point.
    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      role: "admin",
      userId: 42,
    });

    registerAuthHandlers();
  });

  // ===========================================================================
  // (a) auth:revoke-session parity
  // ===========================================================================
  describe("auth:revoke-session", () => {
    it("returns success:true when a session was actually revoked", async () => {
      mockAuthService.revokeUserSession.mockResolvedValue(true);
      const handler = handlers.get("auth:revoke-session")!;

      const result = await handler({ sender: { id: 1 } }, 7);

      expect(mockAuthService.revokeUserSession).toHaveBeenCalledWith(7, 42);
      expect(result).toEqual({ success: true, data: true });
      expect(audit).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ action: "delete", entity_type: "session" }),
      );
    });

    it("returns success:false, not success:true, when nothing was revoked (unknown/foreign id)", async () => {
      mockAuthService.revokeUserSession.mockResolvedValue(false);
      const handler = handlers.get("auth:revoke-session")!;

      const result = await handler({ sender: { id: 1 } }, 999);

      expect(result).toEqual({ success: false, error: "Session not found" });
      // No audit entry for a revoke that revoked nothing.
      expect(audit).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // (b) auth:restore-session — a throw from validateSession() must not skip
  // the fallback chain
  // ===========================================================================
  describe("auth:restore-session", () => {
    it("falls back to the encrypted-file token when the localStorage token check THROWS", async () => {
      const dbBlip = new Error("SQLITE_BUSY");
      mockAuthService.validateSession
        .mockRejectedValueOnce(dbBlip) // localStorage token
        .mockResolvedValueOnce({ id: 5, username: "alice", role: "staff" }); // encrypted-file token

      (getEncryptedSession as jest.Mock).mockReturnValue({
        userId: 5,
        token: "encrypted-file-token",
        createdAt: Date.now(),
      });

      const handler = handlers.get("auth:restore-session")!;
      const result = await handler({ sender: { id: 1 } }, "localstorage-token");

      expect(mockAuthService.validateSession).toHaveBeenNthCalledWith(
        1,
        "localstorage-token",
      );
      expect(mockAuthService.validateSession).toHaveBeenNthCalledWith(
        2,
        "encrypted-file-token",
      );
      expect(result).toEqual({
        success: true,
        user: { id: 5, username: "alice", role: "staff" },
        sessionToken: "encrypted-file-token",
      });
      // A transient throw is not proof the localStorage token was invalid —
      // nothing here was cleared for it (there's nothing TO clear for a
      // localStorage token; this just documents the fallback ran instead of
      // the outer catch firing).
      expect(clearEncryptedSession).not.toHaveBeenCalled();
    });

    it("reaches the terminal 'No session' result (not the generic catch-all error) when BOTH checks throw", async () => {
      mockAuthService.validateSession
        .mockRejectedValueOnce(new Error("SQLITE_BUSY")) // localStorage token
        .mockRejectedValueOnce(new Error("SQLITE_BUSY")); // encrypted-file token

      (getEncryptedSession as jest.Mock).mockReturnValue({
        userId: 5,
        token: "encrypted-file-token",
        createdAt: Date.now(),
      });

      const handler = handlers.get("auth:restore-session")!;
      const result = await handler({ sender: { id: 1 } }, "localstorage-token");

      expect(result).toEqual({ success: false, error: "No session" });
      // Neither throw is proof of invalidity — the file must survive a
      // transient blip so the NEXT restore attempt can still use it.
      expect(clearEncryptedSession).not.toHaveBeenCalled();
    });

    it("still clears the encrypted file when the fallback token is genuinely invalid (null, not a throw)", async () => {
      mockAuthService.validateSession
        .mockRejectedValueOnce(new Error("SQLITE_BUSY")) // localStorage token: transient
        .mockResolvedValueOnce(null); // encrypted-file token: genuinely invalid/expired

      (getEncryptedSession as jest.Mock).mockReturnValue({
        userId: 5,
        token: "encrypted-file-token",
        createdAt: Date.now(),
      });

      const handler = handlers.get("auth:restore-session")!;
      const result = await handler({ sender: { id: 1 } }, "localstorage-token");

      expect(result).toEqual({ success: false, error: "No session" });
      // A genuine `null` (as opposed to a throw) is unchanged behavior:
      // still cleared, same as before this fix.
      expect(clearEncryptedSession).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // (c) getCurrentSessionToken()'s userId-match guard (private helper,
  // exercised through its two call sites)
  // ===========================================================================
  describe("getCurrentSessionToken userId-match guard", () => {
    describe("via auth:list-sessions (best-effort fallback to '')", () => {
      it("resolves the token when the file's userId matches the authenticated caller", async () => {
        (requireRole as jest.Mock).mockReturnValue({
          ok: true,
          role: "admin",
          userId: 42,
        });
        (getEncryptedSession as jest.Mock).mockReturnValue({
          userId: 42,
          token: "tok-mine",
          createdAt: Date.now(),
        });
        mockAuthService.listUserSessions.mockResolvedValue([]);

        const handler = handlers.get("auth:list-sessions")!;
        await handler({ sender: { id: 1 } });

        expect(mockAuthService.listUserSessions).toHaveBeenCalledWith(
          42,
          "tok-mine",
        );
      });

      it("falls back to '' — never the foreign token — when the file belongs to a DIFFERENT user", async () => {
        (requireRole as jest.Mock).mockReturnValue({
          ok: true,
          role: "admin",
          userId: 42,
        });
        (getEncryptedSession as jest.Mock).mockReturnValue({
          userId: 999, // a previous user's stale token file
          token: "tok-belongs-to-someone-else",
          createdAt: Date.now(),
        });
        mockAuthService.listUserSessions.mockResolvedValue([]);

        const handler = handlers.get("auth:list-sessions")!;
        await handler({ sender: { id: 1 } });

        expect(mockAuthService.listUserSessions).toHaveBeenCalledWith(42, "");
      });
    });

    describe("via auth:revoke-other-sessions (refuses outright on mismatch)", () => {
      it("resolves the token and proceeds when the file's userId matches", async () => {
        (requireRole as jest.Mock).mockReturnValue({
          ok: true,
          role: "admin",
          userId: 42,
        });
        (getEncryptedSession as jest.Mock).mockReturnValue({
          userId: 42,
          token: "tok-mine",
          createdAt: Date.now(),
        });
        mockAuthService.revokeOtherSessions.mockResolvedValue(3);

        const handler = handlers.get("auth:revoke-other-sessions")!;
        const result = await handler({ sender: { id: 1 } });

        expect(mockAuthService.revokeOtherSessions).toHaveBeenCalledWith(
          42,
          "tok-mine",
        );
        expect(result).toEqual({ success: true, data: { revoked: 3 } });
      });

      it("refuses without calling revokeOtherSessions when the file belongs to a DIFFERENT user", async () => {
        (requireRole as jest.Mock).mockReturnValue({
          ok: true,
          role: "admin",
          userId: 42,
        });
        (getEncryptedSession as jest.Mock).mockReturnValue({
          userId: 999, // a previous user's stale token file
          token: "tok-belongs-to-someone-else",
          createdAt: Date.now(),
        });

        const handler = handlers.get("auth:revoke-other-sessions")!;
        const result = await handler({ sender: { id: 1 } });

        // The critical guard: trusting the mismatched token here would have
        // revoked the CALLER's own live session along with everyone else's.
        expect(mockAuthService.revokeOtherSessions).not.toHaveBeenCalled();
        expect(result).toEqual({
          success: false,
          error: "Could not determine current session",
        });
      });
    });
  });
});
