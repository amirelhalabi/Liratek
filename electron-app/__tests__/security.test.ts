/**
 * Electron Security Configuration Tests
 *
 * Verifies that security-critical BrowserWindow settings are correctly
 * configured: contextIsolation, nodeIntegration, and sandbox.
 *
 * These tests read the source file as text and assert on the configuration
 * values, since the actual Electron APIs are not available in a test runner.
 */

import * as fs from "fs";
import * as path from "path";

const mainSource = fs.readFileSync(
  path.join(__dirname, "..", "main.ts"),
  "utf-8",
);

const printHandlersSource = fs.readFileSync(
  path.join(__dirname, "..", "handlers", "printHandlers.ts"),
  "utf-8",
);

describe("Electron Security Configuration", () => {
  describe("Main window (main.ts)", () => {
    it("has contextIsolation enabled", () => {
      expect(mainSource).toMatch(/contextIsolation:\s*true/);
    });

    it("has nodeIntegration disabled", () => {
      expect(mainSource).toMatch(/nodeIntegration:\s*false/);
    });

    it("has sandbox enabled", () => {
      expect(mainSource).toMatch(/sandbox:\s*true/);
    });

    it("uses a preload script (not direct node access)", () => {
      expect(mainSource).toMatch(/preload:\s*path\.join/);
    });
  });

  describe("Print window (printHandlers.ts)", () => {
    it("has contextIsolation enabled", () => {
      expect(printHandlersSource).toMatch(/contextIsolation:\s*true/);
    });

    it("has nodeIntegration disabled", () => {
      expect(printHandlersSource).toMatch(/nodeIntegration:\s*false/);
    });

    it("creates the print window as hidden (show: false)", () => {
      expect(printHandlersSource).toMatch(/show:\s*false/);
    });
  });
});
