/**
 * loto:update-metadata — Zod validation parity
 * (TRANSPORT_PARITY_AUDIT_PLAN.md §6.4 follow-up 3).
 *
 * Before this fix the handler validated nothing beyond `requireRole` while
 * the REST twin already validated against `lotoUpdateMetadataSchema`
 * (packages/core/src/validators/loto.ts) — REST was silently stricter than
 * desktop. The handler now validates against the SAME schema
 * (`LotoUpdateMetadataSchema`, re-exported in electron-app/schemas/index.ts).
 *
 * Same mocking shape as `inventoryHandlers.batchUpdateRoleGate.test.ts`:
 * `@liratek/core` is mocked via `jest.requireActual` + override so the real
 * schema still runs — an invalid payload must be refused WITHOUT ever
 * reaching the service.
 *
 * Rule-17 note (discharged 2026-09-13): stripped the `validatePayload` call
 * from `loto:update-metadata` in `lotoHandlers.ts`, changing
 * `service.updateLotoMetadata(v.data.id, { note: v.data.note }, editedBy)`
 * back to `service.updateLotoMetadata(data.id, { note: data.note },
 * editedBy)` (raw passthrough, no schema). Ran `npx jest --config
 * jest.config.cjs --roots "<rootDir>/handlers" --testPathPatterns
 * "lotoHandlers.updateMetadataValidation"` — both rejection cases failed,
 * e.g.:
 *   expect(jest.fn()).not.toHaveBeenCalled()
 *   Expected number of calls: 0
 *   Received number of calls: 1
 *   1: 0, {"note": "x"}, "user-7"
 * (same shape for the over-long-note case). 2 failed, 1 passed, 3 total.
 * Reverted from a pre-edit copy; `git diff --stat -- electron-app/handlers/lotoHandlers.ts`
 * printed nothing afterward.
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

describe("loto:update-metadata validation", () => {
  const mockService = {
    updateLotoMetadata: jest.fn(),
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

  it("passes a valid payload through to the service with all fields intact", async () => {
    mockService.updateLotoMetadata.mockReturnValue({
      success: true,
      entity: { id: 11 },
    });
    const handler = handlers.get("loto:update-metadata")!;

    const result = await handler(
      { sender: { id: 1 } },
      { id: 11, note: "Reprinted receipt" },
    );

    expect(mockService.updateLotoMetadata).toHaveBeenCalledWith(
      11,
      { note: "Reprinted receipt" },
      expect.any(String),
    );
    expect(result).toEqual({ success: true, data: { id: 11 } });
  });

  it("rejects an invalid payload (non-positive id) at the door WITHOUT calling the service", async () => {
    const handler = handlers.get("loto:update-metadata")!;

    const result = (await handler(
      { sender: { id: 1 } },
      { id: 0, note: "x" },
    )) as { success: boolean; error?: string };

    expect(mockService.updateLotoMetadata).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("rejects an over-long note (> 500 chars) WITHOUT calling the service", async () => {
    const handler = handlers.get("loto:update-metadata")!;

    const result = (await handler(
      { sender: { id: 1 } },
      { id: 11, note: "a".repeat(501) },
    )) as { success: boolean; error?: string };

    expect(mockService.updateLotoMetadata).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});
