/**
 * financial:update-metadata — Zod validation parity
 * (TRANSPORT_PARITY_AUDIT_PLAN.md §6.4 follow-up 3).
 *
 * Before this fix the handler validated nothing beyond `requireRole` while
 * the REST twin (`POST /api/services/update-metadata`) already validated
 * against `financialUpdateMetadataSchema`
 * (packages/core/src/validators/financial.ts) — REST was silently stricter
 * than desktop. The handler now validates against the SAME schema
 * (`FinancialUpdateMetadataSchema`, re-exported in
 * electron-app/schemas/index.ts). That core schema's three phone fields
 * (`phone_number`/`sender_phone`/`receiver_phone`) were also widened from
 * `max(30)` to `max(50)` in this same change, to match every sibling phone
 * field elsewhere in the codebase (customService.ts/recharge.ts) — asserted
 * below via a 40-character phone string that would have failed the old cap.
 *
 * Same mocking shape as `inventoryHandlers.batchUpdateRoleGate.test.ts`:
 * `@liratek/core` is mocked via `jest.requireActual` + override so the real
 * schema still runs — an invalid payload must be refused WITHOUT ever
 * reaching the service.
 *
 * Rule-17 note: the "invalid payload rejected" assertion below has NOT yet
 * been proven to fail against the pre-fix code (no validation at all) —
 * that failing-first proof is still owed before this counts as a fully
 * guarded regression test.
 */

import { ipcMain } from "electron";
import { registerOMTHandlers } from "../omtHandlers";
import { getFinancialService, getUserRepository } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getFinancialService: jest.fn(),
    getFinancialServiceRepository: jest.fn(() => ({})),
    getTransactionRepository: jest.fn(() => ({})),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("financial:update-metadata validation", () => {
  const mockService = {
    updateFinancialServiceMetadata: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getFinancialService as jest.Mock).mockReturnValue(mockService);
    (getUserRepository as jest.Mock).mockReturnValue({
      findById: jest.fn(() => null),
    });
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerOMTHandlers();
  });

  it("passes a valid payload through to the service with all seven fields intact", async () => {
    mockService.updateFinancialServiceMetadata.mockReturnValue({
      success: true,
      entity: { id: 5 },
    });
    const handler = handlers.get("financial:update-metadata")!;

    // A 40-char phone string — within the new max(50), would have failed
    // the pre-fix max(30) on phone_number/sender_phone/receiver_phone.
    const longPhone = "+961" + "1".repeat(36);
    expect(longPhone).toHaveLength(40);

    const payload = {
      id: 5,
      client_name: "Jane Doe",
      phone_number: longPhone,
      sender_name: "Sender Sam",
      sender_phone: longPhone,
      receiver_name: "Receiver Rita",
      receiver_phone: longPhone,
      note: "Manual correction",
    };

    const result = await handler({ sender: { id: 1 } }, payload);

    expect(mockService.updateFinancialServiceMetadata).toHaveBeenCalledWith(
      5,
      {
        client_name: "Jane Doe",
        phone_number: longPhone,
        sender_name: "Sender Sam",
        sender_phone: longPhone,
        receiver_name: "Receiver Rita",
        receiver_phone: longPhone,
        note: "Manual correction",
      },
      expect.any(String),
    );
    expect(result).toEqual({ success: true, data: { id: 5 } });
  });

  it("rejects an invalid payload (non-positive id) at the door WITHOUT calling the service", async () => {
    const handler = handlers.get("financial:update-metadata")!;

    const result = (await handler(
      { sender: { id: 1 } },
      { id: 0, note: "x" },
    )) as { success: boolean; error?: string };

    expect(mockService.updateFinancialServiceMetadata).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("rejects an over-long note (> 500 chars) WITHOUT calling the service", async () => {
    const handler = handlers.get("financial:update-metadata")!;

    const result = (await handler(
      { sender: { id: 1 } },
      { id: 5, note: "a".repeat(501) },
    )) as { success: boolean; error?: string };

    expect(mockService.updateFinancialServiceMetadata).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});
