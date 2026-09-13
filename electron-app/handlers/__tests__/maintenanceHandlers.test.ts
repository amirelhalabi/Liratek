/**
 * MaintenanceHandlers Unit Tests
 *
 * Tests IPC handler registration and delegation to MaintenanceService.
 *
 * Revived 2026-09-13: MaintenanceService moved into `@liratek/core`
 * (`packages/core/src/services/MaintenanceService.ts`); this suite still
 * mocked a local `../../services/MaintenanceService` path that no longer
 * exists, so every test failed at import time with "Cannot find module
 * '../../services/MaintenanceService'". The handler resolves its service via
 * `getMaintenanceService()` imported from `@liratek/core`, so the fix mocks
 * `@liratek/core` itself (jest.requireActual + override, the pattern
 * established by exchangeLotHandlers.test.ts / authHandlers.sessions.test.ts
 * in this folder) — real MaintenanceJobSchema/validatePayload (from
 * "../schemas/index.js", untouched here) keep validating "maintenance:save"
 * payloads exactly as production does.
 *
 * "maintenance:save" also drifted on its OWN terms: the original payload
 * (`{ device_name, issue_description, estimated_cost }`) is missing
 * `cost_usd`/`price_usd`, both required by the REAL MaintenanceJobSchema, and
 * `estimated_cost` isn't a schema field at all (Zod strips it silently).
 * Completed the payload and updated the service-call assertion to match the
 * schema's actual output, including its `currency`/`status` defaults.
 */

import { ipcMain } from "electron";
import { registerMaintenanceHandlers } from "../maintenanceHandlers";
import { getMaintenanceService } from "@liratek/core";

// Mock dependencies
jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn(),
  },
}));

jest.mock("../../session", () => ({
  requireRole: jest.fn().mockReturnValue({ ok: true, userId: 1 }),
}));

// Mock MaintenanceService instance returned by getMaintenanceService()
const mockService = {
  saveJob: jest.fn().mockReturnValue({ success: true, id: 1 }),
  getJobs: jest
    .fn()
    .mockReturnValue([{ id: 1, device_name: "iPhone 14", status: "pending" }]),
  deleteJob: jest.fn().mockReturnValue({ success: true }),
};

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getMaintenanceService: jest.fn(),
  };
});

describe("MaintenanceHandlers", () => {
  let handlers: Map<string, Function>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    // Capture registered handlers
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getMaintenanceService as jest.Mock).mockReturnValue(mockService);

    registerMaintenanceHandlers();
  });

  describe("Handler Registration", () => {
    it("should register all maintenance handlers", () => {
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "maintenance:save",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "maintenance:get-jobs",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "maintenance:delete",
        expect.any(Function),
      );
    });
  });

  describe("maintenance:save", () => {
    it("should save a maintenance job", async () => {
      const handler = handlers.get("maintenance:save")!;
      // ASSERTION CHANGED: the original payload used `estimated_cost`, which
      // isn't a MaintenanceJobSchema field at all (Zod strips it silently),
      // and omitted `cost_usd`/`price_usd`, both required by the REAL schema
      // this handler validates against. Completed with those two fields.
      const jobData = {
        device_name: "Samsung S23",
        issue_description: "Screen cracked",
        cost_usd: 100,
        price_usd: 150,
      };

      const result = await handler({ sender: { id: 1 } }, jobData);

      // The handler forwards `v.data` (the VALIDATED payload), not the raw
      // input — MaintenanceJobSchema fills in `currency`/`status` defaults.
      expect(mockService.saveJob).toHaveBeenCalledWith({
        ...jobData,
        currency: "USD",
        status: "Received",
      });
      expect(result).toEqual({ success: true, id: 1 });
    });

    it("should reject non-admin users", async () => {
      const { requireRole } = require("../../session");
      requireRole.mockReturnValue({ ok: false, error: "Admin required" });

      const handler = handlers.get("maintenance:save")!;
      const result = await handler({ sender: { id: 1 } }, {});

      expect(result).toEqual({ success: false, error: "Admin required" });
    });
  });

  describe("maintenance:get-jobs", () => {
    it("should get all jobs without filter", async () => {
      const handler = handlers.get("maintenance:get-jobs")!;
      const result = await handler({}, undefined);

      expect(mockService.getJobs).toHaveBeenCalledWith(undefined);
      expect(result).toHaveLength(1);
    });

    it("should get jobs with status filter", async () => {
      const handler = handlers.get("maintenance:get-jobs")!;
      await handler({}, "pending");

      expect(mockService.getJobs).toHaveBeenCalledWith("pending");
    });
  });

  describe("maintenance:delete", () => {
    it("should delete a job when admin", async () => {
      const { requireRole } = require("../../session");
      requireRole.mockReturnValue({ ok: true, userId: 1 });

      const handler = handlers.get("maintenance:delete")!;
      const result = await handler({ sender: { id: 1 } }, 1);

      expect(mockService.deleteJob).toHaveBeenCalledWith(1);
      expect(result).toEqual({ success: true });
    });

    it("should reject non-admin users", async () => {
      const { requireRole } = require("../../session");
      requireRole.mockReturnValue({ ok: false, error: "Admin required" });

      const handler = handlers.get("maintenance:delete")!;
      const result = await handler({ sender: { id: 1 } }, 1);

      expect(result).toEqual({ success: false, error: "Admin required" });
    });
  });
});
