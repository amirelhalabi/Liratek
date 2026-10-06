/**
 * POST /api/maintenance/jobs — the client's phone + link reach the service
 * intact on the WEB transport (LIRA-263).
 *
 * The REST route hands `saveMaintenanceJobSchema.parse(req.body)` to
 * `MaintenanceService.saveJob` (validateRequest replaces req.body). This pins
 * what the service receives for the two resave shapes the page sends:
 *  - a phone in a formatted / free-text-stored shape is normalised, never
 *    refused on formatting alone and never blanked;
 *  - a resave with no `client_id` arrives with the key ABSENT (not null), the
 *    signal `saveJob` uses to keep the job's stored client link.
 * The desktop IPC handler validates with the same core schema
 * (electron-app/schemas MaintenanceJobSchema wraps saveMaintenanceJobSchema).
 *
 * Harness copied from maintenanceSave.roleGate.api.test.ts.
 *
 * Rule 17: not proven failing-first at the route level (written after the
 * schema change). The schema-level failing evidence: before LIRA-263,
 * "961 70 123 456" parsed as REJECTED ("Invalid phone number format").
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
import maintenanceRouter from "../maintenance.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance", maintenanceRouter);
  return app;
}

describe("POST /api/maintenance/jobs — client phone + link (LIRA-263)", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it.each([
    ["+961 3 123 456", "03123456"],
    ["03 123 456", "03123456"],
    ["961 70 123 456", "96170123456"],
  ])(
    "a status-change resave with phone %p reaches the service as %p, client_id key absent",
    async (typed, stored) => {
      const saveSpy = jest
        .spyOn(MaintenanceService.prototype, "saveJob")
        .mockReturnValue({ success: true, id: 7 } as any);

      const res = await request(app)
        .post("/api/maintenance/jobs")
        .set("x-test-role", "staff")
        .send({
          id: 7,
          device_name: "iPhone 13",
          price_usd: 50,
          client_name: "Rami Haddad",
          client_phone: typed,
          status: "In_Progress",
        });

      expect(res.body).toEqual({ success: true, id: 7 });
      const received = saveSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(received.client_name).toBe("Rami Haddad");
      expect(received.client_phone).toBe(stored);
      expect("client_id" in received).toBe(false);
    },
  );

  it("an explicitly picked client_id is forwarded unchanged", async () => {
    const saveSpy = jest
      .spyOn(MaintenanceService.prototype, "saveJob")
      .mockReturnValue({ success: true, id: 7 } as any);

    await request(app)
      .post("/api/maintenance/jobs")
      .set("x-test-role", "staff")
      .send({
        id: 7,
        device_name: "iPhone 13",
        price_usd: 50,
        client_id: 42,
        client_name: "Rami Haddad",
        client_phone: "",
      });

    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 42, client_name: "Rami Haddad" }),
      42,
    );
  });
});
