/**
 * NOT RUN — proven at the end-of-batch gate (OWNER_NOTES_REMAINING_BUILD.md
 * #14 slice 2 batch process rule: implement first, verify at the end).
 *
 * profitHandlers.ts — `profits:module-detail` IPC channel (2026-09-24,
 * OWNER_NOTES_REMAINING_BUILD.md #14 slice 2 — Profits page "Show
 * transactions" drill-down). This channel must sit behind the SAME
 * `requireProfitsAccess` gate as the other 8 profits channels, and forward
 * its `(moduleKey, from, to)` args unchanged to
 * `ProfitService.getModuleDetail`.
 *
 * Mirrors `profitHandlers.commissions.test.ts`'s own harness (mocked
 * `electron`, `@liratek/core`, `../../session`) — no real DB, no real
 * Electron.
 */

import { ipcMain } from "electron";
import { registerProfitHandlers } from "../profitHandlers";
import { getProfitService } from "@liratek/core";
import { requireProfitsAccess } from "../../session";

jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn(),
  },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getProfitService: jest.fn(),
    getProfitsAccessService: jest.fn(() => ({
      isPasswordSet: jest.fn(),
      setPassword: jest.fn(),
      verify: jest.fn(),
    })),
    getCommissionsReportService: jest.fn(() => ({ getReport: jest.fn() })),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
  requireProfitsAccess: jest.fn(),
  grantProfitsUnlock: jest.fn(),
  revokeProfitsUnlock: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("profitHandlers — profits:module-detail (PROF-DD, #14 slice 2)", () => {
  let mockProfitService: { getModuleDetail: jest.Mock; [k: string]: jest.Mock };
  let handlers: Map<string, (...args: any[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    mockProfitService = {
      getSummary: jest.fn(),
      getByModule: jest.fn(),
      getByDate: jest.fn(),
      getByPaymentMethod: jest.fn(),
      getByUser: jest.fn(),
      getByClient: jest.fn(),
      getPendingProfit: jest.fn(),
      getModuleDetail: jest.fn().mockReturnValue({
        module: "SALE",
        counted: [],
        not_counted: [],
        counted_total_profit_usd: 0,
        counted_total_profit_lbp: 0,
      }),
    };
    (getProfitService as jest.Mock).mockReturnValue(mockProfitService);

    (requireProfitsAccess as jest.Mock).mockReturnValue({ ok: true });

    registerProfitHandlers();
  });

  it("registers the profits:module-detail channel", () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(
      "profits:module-detail",
      expect.any(Function),
    );
  });

  it("gates on requireProfitsAccess and forwards (moduleKey, from, to) unchanged", () => {
    const handler = handlers.get("profits:module-detail")!;
    const fakeEvent = { sender: { id: 99 } };

    const result = handler(fakeEvent, "SALE", "2026-09-01", "2026-09-30");

    expect(requireProfitsAccess).toHaveBeenCalledWith(99);
    expect(mockProfitService.getModuleDetail).toHaveBeenCalledWith(
      "SALE",
      "2026-09-01",
      "2026-09-30",
    );
    expect(result).toEqual(
      expect.objectContaining({ module: "SALE", counted: [] }),
    );
  });

  it("throws (never returns data) when the gate rejects — locked/unauthorized", () => {
    (requireProfitsAccess as jest.Mock).mockReturnValue({
      ok: false,
      error: "Profits locked",
    });
    const handler = handlers.get("profits:module-detail")!;
    const fakeEvent = { sender: { id: 99 } };

    expect(() =>
      handler(fakeEvent, "SALE", "2026-09-01", "2026-09-30"),
    ).toThrow("Profits locked");
    expect(mockProfitService.getModuleDetail).not.toHaveBeenCalled();
  });
});
