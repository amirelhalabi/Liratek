// electron-app/handlers/__tests__/authHandlers.changeOwnPassword.test.ts
//
// LIRA-293 — `auth:change-own-password`, the desktop mirror of
// POST /api/password-reset/change (rule 19). The user comes from the
// desktop session guard (requireRole), never from the payload; the payload
// is validated against core's `changeOwnPasswordSchema` (one password rule);
// the caller's OWN session token is resolved from the encrypted session file
// and passed so the OTHER sessions are signed out and this one is kept. If
// that token cannot be resolved, nothing is revoked (passing "" would revoke
// the caller's own session too). No email on desktop, so no notice.
//
// Same mocking style as authHandlers.sessions.test.ts.

import { ipcMain } from "electron";
import { registerAuthHandlers } from "../authHandlers";
import {
  AppError,
  changeOwnPasswordSchema,
  getAuthService,
} from "@liratek/core";
import { requireRole, getEncryptedSession } from "../../session";
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
  return { ...actual, getAuthService: jest.fn() };
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

jest.mock("../auditHelper", () => ({ audit: jest.fn() }));

const CHANNEL = "auth:change-own-password";

/** A payload in the schema's own field names (rule 24). */
function payload(currentPassword: string, newPassword: string) {
  const input = { currentPassword, newPassword };
  return changeOwnPasswordSchema.parse(input);
}

describe("auth:change-own-password (LIRA-293)", () => {
  let changePassword: jest.Mock;
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const event = { sender: { id: 1 } };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    changePassword = jest
      .fn()
      .mockResolvedValue({ success: true, sessionsRevoked: 2 });
    (getAuthService as jest.Mock).mockReturnValue({ changePassword });
    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      role: "staff",
      userId: 42,
    });
    (getEncryptedSession as jest.Mock).mockReturnValue({
      userId: 42,
      token: "tok-mine",
    });
    registerAuthHandlers();
  });

  it("is registered", () => {
    expect(handlers.has(CHANNEL)).toBe(true);
  });

  it("changes the CALLER's password and keeps their own session", async () => {
    const res = await handlers.get(CHANNEL)!(
      event,
      payload("Old!Passw0rd", "xY7-pq_Rt.9mZ"),
    );
    expect(changePassword).toHaveBeenCalledWith(
      42,
      "Old!Passw0rd",
      "xY7-pq_Rt.9mZ",
      {
        keepSessionToken: "tok-mine",
      },
    );
    expect(res).toEqual({
      success: true,
      data: { sessionsRevoked: 2, noticeSent: false },
    });
    expect(audit).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        entity_id: "42",
        summary: "Changed own password",
      }),
    );
  });

  it("validates the payload: a weak new password never reaches the service", async () => {
    const res = (await handlers.get(CHANNEL)!(event, {
      currentPassword: "Old!Passw0rd",
      newPassword: "weak",
    })) as { success: boolean };
    expect(res.success).toBe(false);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("validates the payload: a missing current password never reaches the service", async () => {
    const res = (await handlers.get(CHANNEL)!(event, {
      newPassword: "xY7-pq_Rt.9mZ",
    })) as {
      success: boolean;
    };
    expect(res.success).toBe(false);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("refuses without a signed-in session", async () => {
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Not authenticated",
    });
    const res = (await handlers.get(CHANNEL)!(
      event,
      payload("Old!Passw0rd", "xY7-pq_Rt.9mZ"),
    )) as {
      success: boolean;
    };
    expect(res.success).toBe(false);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("a wrong current password answers the same WRONG_PASSWORD code as the web", async () => {
    changePassword.mockRejectedValue(
      new AppError(
        "WRONG_PASSWORD",
        "Your current password is not correct.",
        401,
        true,
      ),
    );
    const res = await handlers.get(CHANNEL)!(
      event,
      payload("Nope!Passw0rd", "xY7-pq_Rt.9mZ"),
    );
    expect(res).toEqual({
      success: false,
      error: "Your current password is not correct.",
      code: "WRONG_PASSWORD",
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it('if the caller\'s own session token cannot be resolved, nothing is revoked (never "")', async () => {
    (getEncryptedSession as jest.Mock).mockReturnValue({
      userId: 99,
      token: "someone-else",
    });
    await handlers.get(CHANNEL)!(
      event,
      payload("Old!Passw0rd", "xY7-pq_Rt.9mZ"),
    );
    expect(changePassword).toHaveBeenCalledWith(
      42,
      "Old!Passw0rd",
      "xY7-pq_Rt.9mZ",
      {
        keepSessionToken: null,
      },
    );
  });
});
