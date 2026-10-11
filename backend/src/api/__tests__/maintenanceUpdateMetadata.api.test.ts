/**
 * POST /api/maintenance/update-metadata — the REST twin of the IPC channel
 * `maintenance:update-metadata` (LIRA-306 T093, closes E4: the channel had no
 * REST route, so a repair job's details could not be edited on the web app
 * and the offline replay had no route to mirror).
 *
 * Same gate as the IPC handler (admin + staff), the shared core schema
 * (`maintenanceUpdateMetadataSchema`, real — not stubbed), the SAME core
 * service method (`MaintenanceService.updateMaintenanceMetadata`), `editedBy`
 * from the JWT's username (never the body), and the IPC-identical envelope at
 * HTTP 200 even on a refusal (rule 19c).
 *
 * Harness copied from maintenance.envelope.api.test.ts.
 *
 * Rule 17: written before the route existed and run against it — every
 * routed case failed with `expect(res.status).toBe(200)` receiving 404.
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
import { MaintenanceService } from "@liratek/core";
import { auditRest } from "../../middleware/audit.js";
import maintenanceRouter from "../maintenance.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance", maintenanceRouter);
  return app;
}

const ENTITY = { id: 7, device_name: "iPhone 13 Pro", note: "fixed" };

describe("POST /api/maintenance/update-metadata", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
    (auditRest as jest.Mock).mockClear();
  });

  it("staff: forwards the four fields + id to updateMaintenanceMetadata, editedBy from the JWT, IPC envelope", async () => {
    const spy = jest
      .spyOn(MaintenanceService.prototype, "updateMaintenanceMetadata")
      .mockReturnValue({
        success: true,
        entity: ENTITY,
        oldValues: { device_name: "iPhone 13" },
      } as any);

    const res = await request(app)
      .post("/api/maintenance/update-metadata")
      .set("x-test-role", "staff")
      .send({
        id: 7,
        client_name: "Rami",
        device_name: "iPhone 13 Pro",
        issue_description: "Screen",
        note: "fixed",
        edited_by: "someone-else", // never trusted — stripped by the schema
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: ENTITY });
    expect(spy).toHaveBeenCalledWith(
      7,
      {
        client_name: "Rami",
        device_name: "iPhone 13 Pro",
        issue_description: "Screen",
        note: "fixed",
      },
      "tester",
    );
    expect(auditRest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "edit_metadata",
        entity_type: "maintenance_job",
        entity_id: "7",
      }),
    );
  });

  it("a service refusal answers HTTP 200 + { success: false, error }", async () => {
    jest
      .spyOn(MaintenanceService.prototype, "updateMaintenanceMetadata")
      .mockReturnValue({
        success: false,
        error: "Maintenance job not found",
      } as any);

    const res = await request(app)
      .post("/api/maintenance/update-metadata")
      .set("x-test-role", "admin")
      .send({ id: 999, note: "x" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Maintenance job not found",
    });
    expect(auditRest).not.toHaveBeenCalled();
  });

  it("a body without an id is refused by the shared schema before the service runs", async () => {
    const spy = jest.spyOn(
      MaintenanceService.prototype,
      "updateMaintenanceMetadata",
    );

    const res = await request(app)
      .post("/api/maintenance/update-metadata")
      .set("x-test-role", "staff")
      .send({ note: "no id" });

    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("an unauthenticated request is refused", async () => {
    const res = await request(app)
      .post("/api/maintenance/update-metadata")
      .send({ id: 7, note: "x" });
    expect(res.status).toBe(401);
  });
});
