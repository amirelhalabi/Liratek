/**
 * profitHandlers.ts — `profits:commissions` IPC channel
 * (OWNER_NOTES_2026-09-21.md §6, lane LC: PA-4.20 — this channel must sit
 * behind the SAME `requireProfitsAccess` gate as the other 7 profits
 * channels, and forward its `(from, to)` args unchanged to
 * `CommissionsReportService.getReport`).
 *
 * Mirrors omtHandlers.test.ts's own harness (mocked `electron`, `@liratek/
 * core`, `../../session`) — no real DB, no real Electron.
 *
 * RULE 17 (failing-first proof, round-2 review LC-6 #2, this session,
 * `npx jest profitHandlers.commissions --maxWorkers=1`): this file's own
 * red run was never recorded when it shipped in round 1. Closed now: the
 * `ipcMain.handle("profits:commissions", ...)` registration in
 * `profitHandlers.ts` was TEMPORARILY commented out (Edit tool, on this
 * lane's own code) and ALL THREE tests FAILED:
 *
 *   "registers the profits:commissions channel" ›
 *     expect(jest.fn()).toHaveBeenCalledWith(...expected)
 *     Expected: "profits:commissions", Any<Function>
 *     Received: 1: "profits:summary" ... (11 calls, none for commissions)
 *   "gates on requireProfitsAccess and forwards (from, to) unchanged" ›
 *     TypeError: handler is not a function
 *     (handlers.get("profits:commissions") was undefined — never registered)
 *   "throws (never returns data) when the gate rejects" ›
 *     expect(received).toThrow(expected)
 *     Expected substring: "Profits locked"
 *     Received message:   "handler is not a function"
 *
 * The registration was then restored (confirmed via `git diff` clean
 * against the pre-revert state) and the whole file was re-run: 3/3
 * passing.
 */

import { ipcMain } from "electron";
import { registerProfitHandlers } from "../profitHandlers";
import { getCommissionsReportService, getProfitService } from "@liratek/core";
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
    getCommissionsReportService: jest.fn(),
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

describe("profitHandlers — profits:commissions", () => {
  let mockCommissionsService: { getReport: jest.Mock };
  let handlers: Map<string, (...args: any[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getProfitService as jest.Mock).mockReturnValue({
      getSummary: jest.fn(),
      getByModule: jest.fn(),
      getByDate: jest.fn(),
      getByPaymentMethod: jest.fn(),
      getByUser: jest.fn(),
      getByClient: jest.fn(),
      getPendingProfit: jest.fn(),
    });

    mockCommissionsService = {
      getReport: jest.fn().mockReturnValue({
        from: "2026-09-01",
        to: "2026-09-30",
        realized_usd: 10,
        realized_lbp: 0,
        revenue_usd: 100,
        revenue_lbp: 0,
        pending_usd: 0,
        pending_lbp: 0,
        total_owed_usd: 0,
        total_owed_lbp: 0,
        awaiting_settlement_count: 0,
        bill_count: 0,
        byProvider: [],
      }),
    };
    (getCommissionsReportService as jest.Mock).mockReturnValue(
      mockCommissionsService,
    );

    (requireProfitsAccess as jest.Mock).mockReturnValue({ ok: true });

    registerProfitHandlers();
  });

  it("registers the profits:commissions channel", () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(
      "profits:commissions",
      expect.any(Function),
    );
  });

  it("gates on requireProfitsAccess and forwards (from, to) unchanged", () => {
    const handler = handlers.get("profits:commissions")!;
    const fakeEvent = { sender: { id: 99 } };

    const result = handler(fakeEvent, "2026-09-01", "2026-09-30");

    expect(requireProfitsAccess).toHaveBeenCalledWith(99);
    expect(mockCommissionsService.getReport).toHaveBeenCalledWith(
      "2026-09-01",
      "2026-09-30",
    );
    expect(result).toEqual(
      expect.objectContaining({ realized_usd: 10, from: "2026-09-01" }),
    );
  });

  it("throws (never returns data) when the gate rejects — locked/unauthorized", () => {
    (requireProfitsAccess as jest.Mock).mockReturnValue({
      ok: false,
      error: "Profits locked",
    });
    const handler = handlers.get("profits:commissions")!;
    const fakeEvent = { sender: { id: 99 } };

    expect(() => handler(fakeEvent, "2026-09-01", "2026-09-30")).toThrow(
      "Profits locked",
    );
    expect(mockCommissionsService.getReport).not.toHaveBeenCalled();
  });
});
