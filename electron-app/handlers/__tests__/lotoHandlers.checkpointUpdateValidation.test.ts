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
 * Rule-17 note (discharged 2026-09-13, two separate reverts — one per
 * assertion family):
 *
 * Proof 1 — "rejects an invalid payload" (validation-removal revert).
 * Stripped the `validatePayload` call from `loto:checkpoint:update` in
 * `lotoHandlers.ts`, changing `service.updateCheckpoint(id, v.data)` back to
 * `service.updateCheckpoint(id, data)` (raw passthrough, no schema). Ran
 * `npx jest --config jest.config.cjs --roots "<rootDir>/handlers"
 * --testPathPatterns "checkpointUpdateValidation"` — only the "rejects an
 * invalid payload" case failed:
 *   expect(jest.fn()).not.toHaveBeenCalled()
 *   Expected number of calls: 0
 *   Received number of calls: 1
 *   1: 7, {"total_sales": "not-a-number"}
 * 1 failed, 2 passed, 3 total. The two "fields survive intact" cases stayed
 * green on this revert — expected, not a gap: with no schema at all there is
 * no stripping to catch, so raw passthrough trivially satisfies "every field
 * reaches the service unchanged." That revert was the wrong lever for those
 * two assertions; it could only ever prove the rejection case. Reverted from
 * a pre-edit copy; `git diff --stat -- electron-app/handlers/lotoHandlers.ts`
 * printed nothing afterward.
 *
 * Proof 2 — "fields survive intact" (schema-field-removal revert, per rule
 * 23's strip-trap: a field present in the payload/handler but MISSING from
 * the schema vanishes silently). The real schema definition is
 * `packages/core/src/validators/loto.ts`'s `lotoCheckpointUpdateSchema`
 * (electron-app/schemas/index.ts only re-exports it as
 * `LotoCheckpointUpdateSchema`) — a CORE file, wider blast radius than a
 * handler revert, so backed it up to a temp copy first. Removed the
 * `settlement_id: z.number().int().positive().optional(),` line from
 * `lotoCheckpointUpdateSchema`. Ran the same test command — only the "passes
 * a valid full payload through ... every field intact" case failed:
 *   expect(jest.fn()).toHaveBeenCalledWith(...expected)
 *   - Expected
 *   + Received
 *     ...
 *   -   "settlement_id": 3,
 *       "total_commission": 50000,
 *   Number of calls: 1
 * 1 failed, 2 passed, 3 total — `settlement_id` was silently stripped from
 * `v.data` before it reached the service, exactly the rule-23 defect class.
 * The note-only partial case stayed green (it never sends `settlement_id`).
 * Reverted from a pre-edit copy; `git diff --stat -- packages/core/src/
 * validators/loto.ts` printed nothing afterward.
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
