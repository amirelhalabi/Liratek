/**
 * custom-services:update-metadata — Zod validation parity + the `category`
 * strip-trap (TRANSPORT_PARITY_AUDIT_PLAN.md §6.4 follow-up 3).
 *
 * Two independent bugs closed together here:
 *
 * 1. The handler validated nothing beyond `requireRole` while the REST twin
 *    (`POST /api/custom-services/update-metadata`) already validated against
 *    `customServiceUpdateMetadataSchema`
 *    (packages/core/src/validators/customService.ts) — REST was silently
 *    stricter than desktop.
 * 2. `category` was dropped by THIS HANDLER independent of the schema
 *    question: `preload.ts`'s `customServices.updateMetadata` binding types
 *    it, `CustomServiceService.updateCustomServiceMetadata` and
 *    `CustomServiceRepository.updateMetadata` both already accept/persist
 *    it, but the handler never forwarded `data.category` to the service
 *    call. Both the schema and the forwarding are fixed here.
 *
 * Same mocking shape as `inventoryHandlers.batchUpdateRoleGate.test.ts`:
 * `@liratek/core` is mocked via `jest.requireActual` + override so the real
 * schema still runs — an invalid payload must be refused WITHOUT ever
 * reaching the service.
 *
 * Rule-17 note (discharged 2026-09-13): two separate reverts, both in
 * `../customServiceHandlers.ts`, one at a time from a pre-edit copy.
 *
 * (1) No validation at all: removed the `validatePayload(
 * CustomServiceUpdateMetadataSchema, data)` call/guard and rewired the
 * service call to read straight off `data` instead of `v.data`. Ran
 * `cd electron-app && npx jest --config jest.config.cjs --roots
 * "<rootDir>/handlers" --testPathPatterns
 * "customServiceHandlers.updateMetadataValidation"` — both invalid-payload
 * tests failed:
 *   expect(jest.fn()).not.toHaveBeenCalled()
 *   Expected number of calls: 0
 *   Received number of calls: 1
 * (the non-positive-id case called the service with
 * `(-3, {...note:"x"...}, "user-7")`; the over-long-note case likewise).
 * 2 failed, 1 passed, 3 total. Reverted from the pre-edit copy;
 * `git diff --stat -- ../customServiceHandlers.ts` printed nothing after.
 *
 * (2) `category` silently dropped (schema kept, forwarding trimmed): with
 * validation restored, removed just the `category: v.data.category,` line
 * from the service call's second argument. Same runner invocation — the
 * "category rescued from the strip-trap" test failed:
 *   expect(jest.fn()).toHaveBeenCalledWith(...expected)
 *   - Expected  "category": "repairs",   (missing from the Received object)
 * 1 failed, 2 passed, 3 total. Reverted from the pre-edit copy;
 * `git diff --stat -- ../customServiceHandlers.ts` printed nothing after.
 */

import { ipcMain } from "electron";
import { registerCustomServiceHandlers } from "../customServiceHandlers";
import { getCustomServiceService, getUserRepository } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getCustomServiceService: jest.fn(),
    getServicePresetService: jest.fn(() => ({})),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("custom-services:update-metadata validation", () => {
  const mockService = {
    updateCustomServiceMetadata: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getCustomServiceService as jest.Mock).mockReturnValue(mockService);
    (getUserRepository as jest.Mock).mockReturnValue({
      findById: jest.fn(() => null),
    });
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerCustomServiceHandlers();
  });

  it("passes a valid payload through to the service with `category` rescued from the strip-trap", async () => {
    mockService.updateCustomServiceMetadata.mockReturnValue({
      success: true,
      entity: { id: 3 },
    });
    const handler = handlers.get("custom-services:update-metadata")!;

    const result = await handler(
      { sender: { id: 1 } },
      {
        id: 3,
        description: "Phone screen repair",
        client_name: "John Doe",
        phone_number: "70123456",
        note: "Customer waiting",
        category: "repairs",
      },
    );

    expect(mockService.updateCustomServiceMetadata).toHaveBeenCalledWith(
      3,
      {
        description: "Phone screen repair",
        client_name: "John Doe",
        phone_number: "70123456",
        note: "Customer waiting",
        category: "repairs",
      },
      expect.any(String),
    );
    expect(result).toEqual({ success: true, data: { id: 3 } });
  });

  it("rejects an invalid payload (non-positive id) at the door WITHOUT calling the service", async () => {
    const handler = handlers.get("custom-services:update-metadata")!;

    const result = (await handler(
      { sender: { id: 1 } },
      { id: -3, note: "x" },
    )) as { success: boolean; error?: string };

    expect(mockService.updateCustomServiceMetadata).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("rejects an over-long note (> 1000 chars) WITHOUT calling the service", async () => {
    const handler = handlers.get("custom-services:update-metadata")!;

    const result = (await handler(
      { sender: { id: 1 } },
      { id: 3, note: "a".repeat(1001) },
    )) as { success: boolean; error?: string };

    expect(mockService.updateCustomServiceMetadata).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});
