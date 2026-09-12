/**
 * loto:checkpoint:update — Zod validation (closes the gap where this was the
 * one checkpoint write channel with NO schema: `service.updateCheckpoint(id,
 * data)` ran on the raw `data` argument, no `validatePayload` call at all).
 *
 * Same mocking shape as `lotoHandlers.updateMetadataValidation.test.ts`:
 * `@liratek/core` is mocked via `jest.requireActual` + override so the real
 * schema still runs — an invalid payload must be refused WITHOUT ever
 * reaching the service.
 *
 * The "valid payload reaches the service with every field intact" case is
 * the strip-trap regression guard named in the schema's own doc comment
 * (packages/core/src/validators/loto.ts) — a schema that silently drops a
 * `LotoCheckpointUpdate` field would pass a looser assertion but fail this
 * one.
 *
 * Rule-17 note: the "invalid payload rejected" / "fields survive intact"
 * assertions below have NOT yet been proven to fail against the pre-fix code
 * (no validation at all, raw passthrough) — that failing-first proof is
 * still owed before this counts as a fully guarded regression test.
 */

import { ipcMain } from "electron";
import { registerLotoHandlers } from "../lotoHandlers";
import { getLotoService, getUserRepository } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getLotoService: jest.fn(),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("loto:checkpoint:update validation", () => {
  const mockService = {
    updateCheckpoint: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getLotoService as jest.Mock).mockReturnValue(mockService);
    (getUserRepository as jest.Mock).mockReturnValue({
      findById: jest.fn(() => null),
    });
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerLotoHandlers();
  });

  it("rejects an invalid payload (bad type on a money field) WITHOUT calling the service", async () => {
    const handler = handlers.get("loto:checkpoint:update")!;

    const result = (await handler({ sender: { id: 1 } }, 7, {
      total_sales: "not-a-number",
    })) as { success: boolean; error?: string };

    expect(mockService.updateCheckpoint).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("passes a valid full payload through to the service with every field intact", async () => {
    mockService.updateCheckpoint.mockReturnValue({ id: 7 });
    const handler = handlers.get("loto:checkpoint:update")!;

    const payload = {
      checkpoint_date: "2026-08-01",
      period_start: "2026-07-25",
      period_end: "2026-08-01",
      total_sales: 1000000,
      total_commission: 50000,
      total_tickets: 10,
      total_prizes: 20000,
      is_settled: 1,
      settled_at: "2026-08-02T10:00:00.000Z",
      settlement_id: 3,
      note: "settled manually",
    };

    const result = await handler({ sender: { id: 1 } }, 7, payload);

    // The strip-trap regression guard: every field the caller sent must
    // still be present in what reaches the service, not silently dropped.
    expect(mockService.updateCheckpoint).toHaveBeenCalledWith(7, payload);
    expect(result).toEqual({ success: true, checkpoint: { id: 7 } });
  });

  it("passes a { note }-only partial through unchanged (the Checkpoint History edit's actual payload)", async () => {
    mockService.updateCheckpoint.mockReturnValue({ id: 7, note: "new note" });
    const handler = handlers.get("loto:checkpoint:update")!;

    const result = await handler({ sender: { id: 1 } }, 7, {
      note: "new note",
    });

    expect(mockService.updateCheckpoint).toHaveBeenCalledWith(7, {
      note: "new note",
    });
    expect(result).toEqual({
      success: true,
      checkpoint: { id: 7, note: "new note" },
    });
  });
});
