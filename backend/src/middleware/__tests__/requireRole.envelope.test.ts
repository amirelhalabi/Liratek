/**
 * LIRA-297 — requireRole refusals carry the IPC envelope shape.
 *
 * IPC's requireRole answers `{ success: false, error }`; callers (the web
 * adapter, the e2e web shim) branch on `result.success`. A bare
 * `{ error }` reads as `success === undefined`, not a refusal.
 *
 * Not proven failing-first: written after the fix (rule 17).
 */
import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import type { Response, NextFunction } from "express";
import { requireRole, type AuthRequest } from "../auth.js";

function mockRes() {
  const res: Partial<Response> & { body?: unknown; code?: number } = {};
  res.status = jest.fn((code: number) => {
    res.code = code;
    return res as Response;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  });
  return res;
}

describe("requireRole envelope", () => {
  it("refuses a wrong role with { success: false, error: 'Forbidden' }", () => {
    const res = mockRes();
    const next = jest.fn() as NextFunction;
    const req = { user: { role: "staff" } } as unknown as AuthRequest;
    requireRole(["admin"])(req, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(403);
    expect(res.body).toEqual({ success: false, error: "Forbidden" });
  });

  it("refuses a missing user with { success: false, error }", () => {
    const res = mockRes();
    const next = jest.fn() as NextFunction;
    requireRole(["admin"])({} as AuthRequest, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(401);
    expect(res.body).toEqual({ success: false, error: "Not authenticated" });
  });

  it("lets a matching role through", () => {
    const res = mockRes();
    const next = jest.fn() as NextFunction;
    const req = { user: { role: "admin" } } as unknown as AuthRequest;
    requireRole(["admin"])(req, res as Response, next);
    expect(next).toHaveBeenCalled();
  });
});
