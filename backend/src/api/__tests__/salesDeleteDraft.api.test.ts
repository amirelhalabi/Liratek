/**
 * Web-only bug fix — "cancel draft" in the POS was broken on web: the
 * frontend's `deleteDraft()` (frontend/src/api/backendApi.ts) called
 * `DELETE /api/sales/drafts/:id` over HTTP, but backend/src/api/sales.ts
 * registered no such route (only GET /drafts and GET/POST /:id...), so the
 * request 404'd. Desktop worked all along through the "sales:delete-draft"
 * IPC channel (electron-app/handlers/salesHandlers.ts), which carries NO
 * `requireRole` call of its own — any authenticated session can cancel a
 * draft, not gated to admin/staff.
 *
 * This test proves the new `DELETE /api/sales/drafts/:id` route
 * (backend/src/api/sales.ts):
 *   1. is reachable and calls the SAME SalesService.deleteDraft the IPC
 *      handler calls, for BOTH the admin and staff roles (parity with the
 *      IPC handler's unrestricted gate — rule 19c);
 *   2. returns the IPC-identical envelope on success;
 *   3. refuses a non-draft/unknown id via the SAME service-level guard
 *      ("Only draft sales can be deleted" / "Draft not found"), still HTTP
 *      200 per rule 19c;
 *   4. is unreachable without authentication (401, service never called).
 *
 * Follows the harness in ../__tests__/auditRoleGate.api.test.ts: hits the
 * REAL router (../sales.js) through a minimal Express app, faking only
 * ../../server.js (logger), ../../middleware/audit.js (auditRest — sales.ts
 * calls it on every successful write) and ../../middleware/auth.js (an
 * `x-test-role` stand-in for authenticateJWT AND a real requireRole
 * implementation, so the route's own `requireRole(["admin","staff"])` gate
 * is exercised for real). `SalesService` is the REAL singleton with
 * `deleteDraft` stubbed via `jest.spyOn`, so this proves the route wires the
 * exact service/envelope/status-code contract without a real DB round trip.
 *
 * Rule 17 status: run against the pre-fix tree (no DELETE /drafts/:id route
 * registered in sales.ts at all), cases 1-6 below (every case except the
 * unauthenticated one) all failed with 404 ("Cannot DELETE
 * /api/sales/drafts/7" — Express's default 404 body, not the app's JSON
 * envelope), confirming this is a genuine fix-guard, not a pre-existing
 * pass. Restoring the route made all cases pass again.
 *
 * LIRA-234 addition — the route previously wired NO requireRole (any
 * authenticated session could cancel a draft, matching the IPC handler's
 * then-ungated "sales:delete-draft"). Both the IPC handler and this route
 * were gated to `["admin","staff"]` (the same roles as sales:process) in the
 * same change. The "super_admin refused" case below is the new fix-guard for
 * this route; unlike the cases above it is labelled NOT PROVEN
 * FAILING-FIRST — the route's `requireRole(["admin","staff"])` call landed
 * in the same pass as this test, so there was no separately-committed
 * "before" state left to run it against without re-breaking finished code,
 * which this task's instructions explicitly forbid (same disclaimer pattern
 * as salesHandlers.refundLegOverride.test.ts). The mechanism is the same one
 * proven failing-first for the IPC handler in
 * salesHandlers.deleteDraftRoleGate.test.ts (electron-app/handlers/__tests__),
 * which showed a call with no `requireRole` gate lets every caller through.
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

jest.mock("../../middleware/audit.js", () => ({
  auditRest: jest.fn(),
}));

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = {
      userId: 42,
      username: "tester",
      role,
      tenantId: 1,
      sessionToken: "test-session",
    };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

import express, { type Express } from "express";
import request from "supertest";
import { getSalesService } from "@liratek/core";
import salesRouter from "../sales.js";
import { auditRest } from "../../middleware/audit.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/sales", salesRouter);
  return app;
}

describe("Web-only fix: DELETE /api/sales/drafts/:id", () => {
  let app: Express;
  const salesService = getSalesService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
    (auditRest as jest.Mock).mockClear();
  });

  it("admin: deletes a draft, service is called, envelope success, audited", async () => {
    const deleteSpy = jest
      .spyOn(salesService, "deleteDraft")
      .mockReturnValue({ success: true });

    const res = await request(app)
      .delete("/api/sales/drafts/7")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(deleteSpy).toHaveBeenCalledWith(7);
    expect(auditRest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "delete",
        entity_type: "sale",
        entity_id: "7",
      }),
    );
  });

  it("staff: also succeeds — LIRA-234 gates this route to [admin, staff], matching sales:process's roles", async () => {
    const deleteSpy = jest
      .spyOn(salesService, "deleteDraft")
      .mockReturnValue({ success: true });

    const res = await request(app)
      .delete("/api/sales/drafts/7")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(deleteSpy).toHaveBeenCalledWith(7);
  });

  it("super_admin (not admin/staff): refused 403, service never called, not audited", async () => {
    const deleteSpy = jest.spyOn(salesService, "deleteDraft");

    const res = await request(app)
      .delete("/api/sales/drafts/7")
      .set("x-test-role", "super_admin");

    expect(res.status).toBe(403);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(auditRest).not.toHaveBeenCalled();
  });

  it("a non-draft sale (e.g. completed): {success:false}, HTTP 200, not audited", async () => {
    const deleteSpy = jest.spyOn(salesService, "deleteDraft").mockReturnValue({
      success: false,
      error: "Only draft sales can be deleted",
    });

    const res = await request(app)
      .delete("/api/sales/drafts/9")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Only draft sales can be deleted",
    });
    expect(deleteSpy).toHaveBeenCalledWith(9);
    expect(auditRest).not.toHaveBeenCalled();
  });

  it("an unknown id: {success:false, error:'Draft not found'}, HTTP 200", async () => {
    jest.spyOn(salesService, "deleteDraft").mockReturnValue({
      success: false,
      error: "Draft not found",
    });

    const res = await request(app)
      .delete("/api/sales/drafts/999999")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Draft not found",
    });
  });

  it("a non-numeric id: {success:false, error:'Invalid sale ID'}, service never called", async () => {
    const deleteSpy = jest.spyOn(salesService, "deleteDraft");

    const res = await request(app)
      .delete("/api/sales/drafts/not-a-number")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: "Invalid sale ID" });
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("unauthenticated: 401, service never called", async () => {
    const deleteSpy = jest.spyOn(salesService, "deleteDraft");

    const res = await request(app).delete("/api/sales/drafts/7");

    expect(res.status).toBe(401);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
