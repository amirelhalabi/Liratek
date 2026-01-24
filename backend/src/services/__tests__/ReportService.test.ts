/**
 * ReportService Unit Tests
 *
 * Tests PDF generation and database backup functionality.
 * Mocks Electron BrowserWindow, app, fs, and path modules.
 */

import { jest } from '@jest/globals';
import { ReportService } from "../ReportService";

// Mock Electron modules
const mockDestroy = jest.fn();
const mockLoadURL = jest.fn().mockResolvedValue(undefined);
const mockPrintToPDF = jest.fn().mockResolvedValue(Buffer.from("PDF content"));

jest.mock("electron", () => ({
  BrowserWindow: jest.fn().mockImplementation(() => ({
    destroy: mockDestroy,
    loadURL: mockLoadURL,
    webContents: {
      printToPDF: mockPrintToPDF,
    },
  })),
  app: {
    getPath: jest.fn((name: string) => {
      if (name === "documents") return "/mock/documents";
      if (name === "userData") return "/mock/userData";
      return "/mock/path";
    }),
  },
}));

// Mock fs module
const mockExistsSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockCopyFileSync = jest.fn();

jest.mock("fs", () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  mkdirSync: (...args: any[]) => mockMkdirSync(...args),
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
  copyFileSync: (...args: any[]) => mockCopyFileSync(...args),
}));

// Mock path module
jest.mock("path", () => ({
  join: (...args: string[]) => args.join("/"),
}));

describe("ReportService", () => {
  let service: ReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReportService();
    // Default: directory exists
    mockExistsSync.mockReturnValue(true);
  });

  // ===========================================================================
  // generatePdf Tests
  // ===========================================================================

  describe("generatePdf", () => {
    it("should generate PDF successfully with provided HTML", async () => {
      const html = "<html><body><h1>Test Report</h1></body></html>";

      const result = await service.generatePdf(html, "test-report.pdf");

      expect(result.success).toBe(true);
      expect(result.path).toBe(
        "/mock/documents/LiratekReports/test-report.pdf",
      );
      expect(mockLoadURL).toHaveBeenCalledWith(
        expect.stringContaining("data:text/html;charset=UTF-8,"),
      );
      expect(mockPrintToPDF).toHaveBeenCalledWith({
        printBackground: true,
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
        pageSize: "A4",
      });
      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(mockDestroy).toHaveBeenCalled();
    });

    it("should generate PDF with default filename when not provided", async () => {
      const html = "<html><body>Content</body></html>";

      const result = await service.generatePdf(html);

      expect(result.success).toBe(true);
      expect(result.path).toMatch(/report_\d+\.pdf$/);
    });

    it("should use default HTML when content is empty", async () => {
      const result = await service.generatePdf("");

      expect(result.success).toBe(true);
      expect(mockLoadURL).toHaveBeenCalledWith(
        expect.stringContaining(
          encodeURIComponent("<html><body><pre>No content</pre></body></html>"),
        ),
      );
    });

    it("should create reports directory if it doesn't exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await service.generatePdf("<html></html>");

      expect(result.success).toBe(true);
      expect(mockMkdirSync).toHaveBeenCalledWith(
        "/mock/documents/LiratekReports",
        { recursive: true },
      );
    });

    it("should not create directory if it already exists", async () => {
      mockExistsSync.mockReturnValue(true);

      await service.generatePdf("<html></html>");

      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it("should handle loadURL error", async () => {
      mockLoadURL.mockRejectedValueOnce(new Error("Failed to load URL"));

      const result = await service.generatePdf("<html></html>");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to load URL");
      expect(mockDestroy).toHaveBeenCalled();
    });

    it("should handle printToPDF error", async () => {
      mockPrintToPDF.mockRejectedValueOnce(new Error("Print failed"));

      const result = await service.generatePdf("<html></html>");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Print failed");
      expect(mockDestroy).toHaveBeenCalled();
    });

    it("should handle writeFileSync error", async () => {
      mockWriteFileSync.mockImplementationOnce(() => {
        throw new Error("Write failed");
      });

      const result = await service.generatePdf("<html></html>");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Write failed");
      expect(mockDestroy).toHaveBeenCalled();
    });

    it("should always destroy window even on error", async () => {
      mockLoadURL.mockRejectedValueOnce(new Error("Error"));

      await service.generatePdf("<html></html>");

      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // backupDatabase Tests
  // ===========================================================================

  describe("backupDatabase", () => {
    it("should backup database successfully", async () => {
      mockExistsSync.mockReturnValue(true);

      const result = await service.backupDatabase();

      expect(result.success).toBe(true);
      expect(result.path).toMatch(/backup_.*\.sqlite$/);
      expect(mockCopyFileSync).toHaveBeenCalledWith(
        "/mock/userData/phone_shop.db",
        expect.stringMatching(/LiratekBackups\/backup_.*\.sqlite$/),
      );
    });

    it("should create backups directory if it doesn't exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await service.backupDatabase();

      expect(result.success).toBe(true);
      expect(mockMkdirSync).toHaveBeenCalledWith(
        "/mock/documents/LiratekBackups",
        { recursive: true },
      );
    });

    it("should not create directory if it already exists", async () => {
      mockExistsSync.mockReturnValue(true);

      await service.backupDatabase();

      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it("should handle copy error", async () => {
      mockCopyFileSync.mockImplementationOnce(() => {
        throw new Error("Copy failed");
      });

      const result = await service.backupDatabase();

      expect(result.success).toBe(false);
      expect(result.error).toBe("Copy failed");
    });

    it("should handle mkdir error", async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockImplementationOnce(() => {
        throw new Error("Cannot create directory");
      });

      const result = await service.backupDatabase();

      expect(result.success).toBe(false);
      expect(result.error).toBe("Cannot create directory");
    });

    it("should generate unique backup filename with timestamp", async () => {
      const result = await service.backupDatabase();

      expect(result.success).toBe(true);
      // Verify the path contains a timestamp pattern
      expect(result.path).toMatch(
        /backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}.*\.sqlite$/,
      );
    });
  });
});
