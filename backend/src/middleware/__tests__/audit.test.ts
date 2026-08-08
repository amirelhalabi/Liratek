/**
 * auditRest() unit tests (LIRA-104) — the REST-side twin of
 * electron-app/handlers/auditHelper.ts's audit()/auditFromAuth().
 *
 * Proves the contract every REST route in this ticket relies on:
 *   (a) the actor (user_id/username/role) always comes from `req.user`
 *       (populated by authenticateJWT from the verified JWT) — never from
 *       anything else the caller could pass;
 *   (b) it is fire-and-forget — a missing req.user, or the underlying
 *       service throwing, never throws back into the caller;
 *   (c) it forwards to the SAME `getAuditService().log()` the IPC helper
 *       calls (rule 14 — one write path for both transports).
 */
import { jest } from "@jest/globals";

const logMock = jest.fn();

jest.mock("@liratek/core", () => ({
  getAuditService: () => ({ log: logMock }),
}));

import { auditRest } from "../audit.js";
import type { AuthRequest } from "../auth.js";

function fakeReq(user?: AuthRequest["user"]): AuthRequest {
  return { user } as AuthRequest;
}

describe("auditRest", () => {
  beforeEach(() => {
    logMock.mockClear();
  });

  it("forwards the actor from req.user, not the data argument", () => {
    const req = fakeReq({
      userId: 7,
      username: "alice",
      role: "admin",
      tenantId: 1,
      sessionToken: "tok",
    });

    auditRest(req, {
      action: "create",
      entity_type: "client",
      summary: "Created client",
    });

    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith({
      action: "create",
      entity_type: "client",
      summary: "Created client",
      user_id: 7,
      username: "alice",
      role: "admin",
    });
  });

  it("is a no-op (never throws) when req.user is missing", () => {
    const req = fakeReq(undefined);

    expect(() =>
      auditRest(req, {
        action: "create",
        entity_type: "client",
        summary: "Created client",
      }),
    ).not.toThrow();
    expect(logMock).not.toHaveBeenCalled();
  });

  it("never throws even when the underlying service.log() throws", () => {
    logMock.mockImplementation(() => {
      throw new Error("db exploded");
    });
    const req = fakeReq({
      userId: 1,
      username: "bob",
      role: "staff",
      tenantId: 1,
      sessionToken: "tok",
    });

    expect(() =>
      auditRest(req, {
        action: "update",
        entity_type: "product",
        summary: "Updated product",
      }),
    ).not.toThrow();
  });

  it("passes through entity_id/old_values/new_values/metadata untouched", () => {
    const req = fakeReq({
      userId: 3,
      username: "carol",
      role: "admin",
      tenantId: 2,
      sessionToken: "tok",
    });

    auditRest(req, {
      action: "edit_metadata",
      entity_type: "debt_ledger",
      entity_id: "42",
      summary: "Edited debt record #42 metadata",
      old_values: { note: "old" },
      new_values: { note: "new" },
      metadata: { extra: true },
    });

    expect(logMock).toHaveBeenCalledWith({
      action: "edit_metadata",
      entity_type: "debt_ledger",
      entity_id: "42",
      summary: "Edited debt record #42 metadata",
      old_values: { note: "old" },
      new_values: { note: "new" },
      metadata: { extra: true },
      user_id: 3,
      username: "carol",
      role: "admin",
    });
  });
});
