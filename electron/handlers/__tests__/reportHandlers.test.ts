/**
 * ReportHandlers Unit Tests
 *
 * Tests IPC handler registration and delegation to ReportService.
 */

import { ipcMain } from "electron";
import { registerReportHandlers } from "../reportHandlers";

// Mock dependencies
jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn(),
  },
}));

jest.mock("../../session", () => ({
  requireRole: jest.fn().mockReturnValue({ ok: true, userId: 1 }),
}));

// Mock ReportService
const mockService = {
  generatePdf: jest.fn().mockResolvedValue({ success: true, path: "/path/to/report.pdf" }),
  backupDatabase: jest.fn().mockResolvedValue({ success: true, path: "/path/to/backup.sqlite" }),
};

jest.mock("../../services/ReportService", () => ({
  ReportService: jest.fn().mockImplementation(() => mockService),
}));

describe("ReportHandlers", () => {
  let handlers: Map<string, Function>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    // Capture registered handlers
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    registerReportHandlers();
  });

  describe("Handler Registration", () => {
    it("should register all report handlers", () => {
      expect(ipcMain.handle).toHaveBeenCalledWith("report:generate-pdf", expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith("report:backup-db", expect.any(Function));
    });
  });

  describe("report:generate-pdf", () => {
    it("should generate PDF when admin", async () => {
      const handler = handlers.get("report:generate-pdf")!;
      const data = {
        html: "<html><body>Report Content</body></html>",
        filename: "sales-report.pdf",
      };

      const result = await handler({ sender: { id: 1 } }, data);

      expect(mockService.generatePdf).toHaveBeenCalledWith(data.html, data.filename);
      expect(result).toEqual({ success: true, path: "/path/to/report.pdf" });
    });

    it("should generate PDF with default filename", async () => {
      const handler = handlers.get("report:generate-pdf")!;
      const data = {
        html: "<html><body>Report</body></html>",
      };

      await handler({ sender: { id: 1 } }, data);

      expect(mockService.generatePdf).toHaveBeenCalledWith(data.html, undefined);
    });

    it("should reject non-admin users", async () => {
      const { requireRole } = require("../../session");
      requireRole.mockReturnValue({ ok: false, error: "Admin required" });

      const handler = handlers.get("report:generate-pdf")!;
      const result = await handler({ sender: { id: 1 } }, { html: "" });

      expect(result).toEqual({ success: false, error: "Admin required" });
      expect(mockService.generatePdf).not.toHaveBeenCalled();
    });

    it("should handle PDF generation errors", async () => {
      const { requireRole } = require("../../session");
      requireRole.mockReturnValue({ ok: true, userId: 1 });
      mockService.generatePdf.mockResolvedValue({ success: false, error: "Print failed" });

      const handler = handlers.get("report:generate-pdf")!;
      const result = await handler({ sender: { id: 1 } }, { html: "<html></html>" });

      expect(result).toEqual({ success: false, error: "Print failed" });
    });
  });

  describe("report:backup-db", () => {
    it("should backup database when admin", async () => {
      const { requireRole } = require("../../session");
      requireRole.mockReturnValue({ ok: true, userId: 1 });

      const handler = handlers.get("report:backup-db")!;
      const result = await handler({ sender: { id: 1 } });

      expect(mockService.backupDatabase).toHaveBeenCalled();
      expect(result).toEqual({ success: true, path: "/path/to/backup.sqlite" });
    });

    it("should reject non-admin users", async () => {
      const { requireRole } = require("../../session");
      requireRole.mockReturnValue({ ok: false, error: "Admin required" });

      const handler = handlers.get("report:backup-db")!;
      const result = await handler({ sender: { id: 1 } });

      expect(result).toEqual({ success: false, error: "Admin required" });
      expect(mockService.backupDatabase).not.toHaveBeenCalled();
    });

    it("should handle backup errors", async () => {
      const { requireRole } = require("../../session");
      requireRole.mockReturnValue({ ok: true, userId: 1 });
      mockService.backupDatabase.mockResolvedValue({ success: false, error: "Disk full" });

      const handler = handlers.get("report:backup-db")!;
      const result = await handler({ sender: { id: 1 } });

      expect(result).toEqual({ success: false, error: "Disk full" });
    });
  });
});
