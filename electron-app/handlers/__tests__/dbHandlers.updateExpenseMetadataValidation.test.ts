/**
 * expenses:update-metadata — Zod validation parity
 * (TRANSPORT_PARITY_AUDIT_PLAN.md §6.4 follow-up 3).
 *
 * Before this fix the handler validated nothing beyond `requireRole` while
 * the REST twin already validated against `expenseUpdateMetadataSchema`
 * (packages/core/src/validators/expense.ts) — REST was silently stricter
 * than desktop. The handler now validates against the SAME schema
 * (`ExpenseUpdateMetadataSchema`, re-exported in electron-app/schemas/index.ts).
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
import { registerDatabaseHandlers } from "../dbHandlers";
import {
  getSettingsService,
  getExpenseService,
  getActivityService,
  getUserRepository,
} from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
  app: { getPath: jest.fn(() => "/tmp") },
  dialog: {},
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getSettingsService: jest.fn(),
    getExpenseService: jest.fn(),
    getClosingService: jest.fn(() => ({})),
    getActivityService: jest.fn(() => ({})),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("expenses:update-metadata validation", () => {
  const mockExpenseService = {
    updateExpenseMetadata: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getSettingsService as jest.Mock).mockReturnValue({});
    (getExpenseService as jest.Mock).mockReturnValue(mockExpenseService);
    (getUserRepository as jest.Mock).mockReturnValue({
      findById: jest.fn(() => null),
    });
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerDatabaseHandlers();
  });

  it("passes a valid payload through to the service with all fields intact", async () => {
    mockExpenseService.updateExpenseMetadata.mockReturnValue({
      success: true,
      entity: { id: 9 },
    });
    const handler = handlers.get("expenses:update-metadata")!;

    const result = await handler(
      { sender: { id: 1 } },
      {
        id: 9,
        description: "Generator fuel",
        category: "Utilities",
        note: "Paid in cash",
      },
    );

    expect(mockExpenseService.updateExpenseMetadata).toHaveBeenCalledWith(
      9,
      {
        description: "Generator fuel",
        category: "Utilities",
        note: "Paid in cash",
      },
      expect.any(String),
    );
    expect(result).toEqual({ success: true, data: { id: 9 } });
  });

  it("rejects an invalid payload (non-positive id) at the door WITHOUT calling the service", async () => {
    const handler = handlers.get("expenses:update-metadata")!;

    const result = (await handler(
      { sender: { id: 1 } },
      { id: -1, note: "x" },
    )) as { success: boolean; error?: string };

    expect(mockExpenseService.updateExpenseMetadata).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("rejects an over-long description (> 500 chars) WITHOUT calling the service", async () => {
    const handler = handlers.get("expenses:update-metadata")!;

    const result = (await handler(
      { sender: { id: 1 } },
      { id: 9, description: "a".repeat(501) },
    )) as { success: boolean; error?: string };

    expect(mockExpenseService.updateExpenseMetadata).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});
