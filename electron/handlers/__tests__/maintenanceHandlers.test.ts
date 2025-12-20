/**
 * MaintenanceHandlers Unit Tests
 *
 * Tests IPC handler registration and delegation to MaintenanceService.
 */

import { ipcMain } from "electron";
import { registerMaintenanceHandlers } from "../maintenanceHandlers";

// Mock dependencies
jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn(),
  },
}));

jest.mock("../../session", () => ({
  requireRole: jest.fn().mockReturnValue({ ok: true, userId: 1 }),
}));

// Mock MaintenanceService
const mockService = {
  saveJob: jest.fn().mockReturnValue({ success: true, id: 1 }),
  getJobs: jest.fn().mockReturnValue([
    { id: 1, device_name: "iPhone 14", status: "pending" },
  ]),
  deleteJob: jest.fn().mockReturnValue({ success: true }),
};

jest.mock("../../services/MaintenanceService", () => ({
  MaintenanceService: jest.fn().mockImplementation(() => mockService),
}));

describe("MaintenanceHandlers", () => {
  let handlers: Map<string, Function>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    // Capture registered handlers
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    registerMaintenanceHandlers();
  });

  describe("Handler Registration", () => {
    it("should register all maintenance handlers", () => {
      expect(ipcMain.handle).toHaveBeenCalledWith("maintenance:save", expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith("maintenance:get-jobs", expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith("maintenance:delete", expect.any(Function));
    });
  });

  describe("maintenance:save", () => {
    it("should save a maintenance job", async () => {
      const handler = handlers.get("maintenance:save")!;
      const jobData = {
        device_name: "Samsung S23",
        issue_description: "Screen cracked",
        estimated_cost: 150,
      };

      const result = await handler({ sender: { id: 1 } }, jobData);

      expect(mockService.saveJob).toHaveBeenCalledWith(jobData);
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
