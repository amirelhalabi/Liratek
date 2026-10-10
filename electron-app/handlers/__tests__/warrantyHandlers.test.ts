/**
 * LIRA-296 (T012) — IPC `warranty:search` (desktop twin of
 * `GET /api/warranty/search`).
 *
 * Same harness as carrierLineHandlers.owedDeliveries.test.ts: mocked
 * `electron`, `@liratek/core` service getter and `../../session`; the
 * schemas module is REAL so validation is proven against the real contract.
 */
import { ipcMain } from "electron";
import { registerWarrantyHandlers } from "../warrantyHandlers";
import { getWarrantyService } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return { ...actual, getWarrantyService: jest.fn() };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({ audit: jest.fn() }));

describe("warrantyHandlers — warranty:search (LIRA-296)", () => {
  let handlers: Map<string, (...args: any[]) => unknown>;
  const search = jest.fn();
  const event = { sender: { id: 7 } };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    search.mockReturnValue([{ saleItemId: 1, state: "COVERED" }]);
    (getWarrantyService as jest.Mock).mockReturnValue({ search });
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 42 });
    registerWarrantyHandlers();
  });

  it("registers the channel", () => {
    expect(handlers.has("warranty:search")).toBe(true);
  });

  it("is gated to admin and staff", () => {
    handlers.get("warranty:search")!(event, { client_day: "2026-10-10" });
    expect(requireRole).toHaveBeenCalledWith(7, ["admin", "staff"]);
  });

  it("refuses when the role check fails, without searching", () => {
    (requireRole as jest.Mock).mockReturnValue({ ok: false, error: "Forbidden" });
    const result = handlers.get("warranty:search")!(event, {
      client_day: "2026-10-10",
    });
    expect(result).toEqual({ success: false, error: "Forbidden" });
    expect(search).not.toHaveBeenCalled();
  });

  it("validates the payload with the shared schema", () => {
    const result = handlers.get("warranty:search")!(event, {
      client_day: "10/10/2026",
    }) as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/client_day/);
    expect(search).not.toHaveBeenCalled();
  });

  it("passes the parsed query to the service and returns the envelope", () => {
    const result = handlers.get("warranty:search")!(event, {
      q: " Rami ",
      client_day: "2026-10-10",
    });
    expect(search).toHaveBeenCalledWith({
      q: "Rami",
      client_day: "2026-10-10",
      limit: 50,
    });
    expect(result).toEqual({
      success: true,
      data: [{ saleItemId: 1, state: "COVERED" }],
    });
  });

  it("turns a thrown error into a failure envelope", () => {
    search.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(
      handlers.get("warranty:search")!(event, { client_day: "2026-10-10" }),
    ).toEqual({ success: false, error: "boom" });
  });
});
