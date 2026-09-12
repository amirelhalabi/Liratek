/**
 * Custom-services REST `/update-metadata` `category` forwarding regression
 * test (TRANSPORT_PARITY_AUDIT_PLAN.md §6.4 follow-up 3, REST half).
 *
 * The bug: `custom_services` rows have a `category` column, and
 * `CustomServiceService.updateCustomServiceMetadata` +
 * `CustomServiceRepository.updateMetadata` already accept/persist it, and
 * `customServiceUpdateMetadataSchema` (packages/core/src/validators/
 * customService.ts) already validates it — but `../customServices.ts`'s
 * `POST /update-metadata` route hand-picked only `description` /
 * `client_name` / `phone_number` / `note` out of the (already-validated)
 * body and never forwarded `category` to the service. The IPC twin
 * (`custom-services:update-metadata` in
 * electron-app/handlers/customServiceHandlers.ts) forwards it; this route
 * now mirrors that.
 *
 * Pattern mirrors lotoUpdateMetadataRoles.api.test.ts / authSessions.api.test.ts
 * (the established convention in this directory): `../../server.js` and
 * `../../middleware/auth.js` are faked with the header-driven `x-test-role`
 * stand-in; `@liratek/core` keeps its REAL schema
 * (`customServiceUpdateMetadataSchema`) via `jest.requireActual` — so this
 * test proves the route forwards a field that survives REAL validation, not
 * just a field a stub schema happens to allow — and only
 * `getCustomServiceService` is swapped for a stub plus `getAuditService().log`
 * silenced (this is a ROUTE-wiring test: which fields the route passes down,
 * not CustomServiceService/CustomServiceRepository internals, which are the
 * core agent's own suites).
 *
 * Rule-17 note: the failing-first proof (temporarily reverting the route's
 * `updateCustomServiceMetadata` call to omit `category: req.body.category`,
 * watching the test below fail, then reverting) is still owed — this file
 * was written under a constraint forbidding test runs; whoever runs the
 * suite next should do that proof once and record it here.
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

const updateCustomServiceMetadata = jest.fn();

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getCustomServiceService: () => ({
      updateCustomServiceMetadata,
    }),
  };
});

import express, { type Express } from "express";
import request from "supertest";
import { getAuditService } from "@liratek/core";
import customServicesRoutes from "../customServices.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/custom-services", customServicesRoutes);
  return app;
}

describe("POST /api/custom-services/update-metadata — category forwarding", () => {
  let app: Express;
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    app = buildApp();
    updateCustomServiceMetadata.mockReset();
    logSpy = jest.spyOn(getAuditService(), "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("forwards category to the service alongside the other metadata fields", async () => {
    updateCustomServiceMetadata.mockReturnValue({
      success: true,
      entity: { id: 7, category: "Insurance" },
      oldValues: { category: "Uncategorized" },
    });

    const res = await request(app)
      .post("/api/custom-services/update-metadata")
      .set("x-test-role", "staff")
      .send({
        id: 7,
        description: "desc",
        client_name: "Jane",
        phone_number: "555-1234",
        note: "note",
        category: "Insurance",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { id: 7, category: "Insurance" },
    });
    expect(updateCustomServiceMetadata).toHaveBeenCalledTimes(1);
    // The field that used to be silently dropped: the route must pass it
    // through to the service exactly like the other four fields.
    expect(updateCustomServiceMetadata).toHaveBeenCalledWith(
      7,
      {
        description: "desc",
        client_name: "Jane",
        phone_number: "555-1234",
        note: "note",
        category: "Insurance",
      },
      "tester",
    );
  });

  it("passes category through even when it is the ONLY field being edited", async () => {
    updateCustomServiceMetadata.mockReturnValue({
      success: true,
      entity: { id: 9, category: "Repair" },
      oldValues: { category: "Uncategorized" },
    });

    const res = await request(app)
      .post("/api/custom-services/update-metadata")
      .set("x-test-role", "admin")
      .send({ id: 9, category: "Repair" });

    expect(res.status).toBe(200);
    expect(updateCustomServiceMetadata).toHaveBeenCalledWith(
      9,
      {
        description: undefined,
        client_name: undefined,
        phone_number: undefined,
        note: undefined,
        category: "Repair",
      },
      "tester",
    );
  });

  it("rejects an unauthenticated request before touching the service", async () => {
    const res = await request(app)
      .post("/api/custom-services/update-metadata")
      .send({ id: 7, category: "Insurance" });

    expect(res.status).toBe(401);
    expect(updateCustomServiceMetadata).not.toHaveBeenCalled();
  });
});
