/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * OWNER_NOTES_REMAINING_BUILD.md #16 fix-round I2 — `custom-services:add`
 * validation parity for the payout `direction` field. Before this fix,
 * `CustomServiceCreateSchema` (electron-app/schemas/index.ts) was a LOCAL
 * duplicate of the core `createCustomServiceSchema` that had the
 * `direction` KEY but neither of the core schema's two payout refines
 * ("OUT" requires partnerMode "VIA"; a payout needs both price AND cost >
 * 0), so a malformed payout sailed through desktop IPC validation while
 * REST (which validates the core schema directly) correctly rejected the
 * same payload — the two transports disagreed on the wire contract (rule
 * 19). This proves the desktop schema now rejects/accepts the SAME shapes
 * REST does, and does so BEFORE the service is ever called.
 *
 * Same mocking shape as `customServiceHandlers.updateMetadataValidation.test.ts`:
 * `@liratek/core` is mocked via `jest.requireActual` + override so the real
 * schema still runs.
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

describe("custom-services:add — payout direction validation (desktop/REST parity, I2)", () => {
  const mockService = {
    addService: jest.fn(),
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

  function baseData(overrides: Record<string, unknown> = {}) {
    return {
      description: "Syria transfer payout",
      price_usd: 100,
      cost_usd: 97,
      partnerId: 1,
      partnerMode: "VIA",
      ...overrides,
    };
  }

  it("rejects direction 'OUT' without partnerMode 'VIA' — WITHOUT calling the service", async () => {
    const handler = handlers.get("custom-services:add")!;

    const result = (await handler(
      { sender: { id: 1 } },
      baseData({ direction: "OUT", partnerMode: undefined, partnerId: undefined }),
    )) as { success: boolean; error?: string };

    expect(mockService.addService).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/only valid for a Via-Partner/);
  });

  it("rejects a payout with price but no cost — WITHOUT calling the service", async () => {
    const handler = handlers.get("custom-services:add")!;

    const result = (await handler(
      { sender: { id: 1 } },
      baseData({ direction: "OUT", cost_usd: 0, cost_lbp: 0 }),
    )) as { success: boolean; error?: string };

    expect(mockService.addService).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(
      /needs both the amount that arrived .* and the amount paid out/,
    );
  });

  it("accepts a well-formed payout and forwards direction 'OUT' to the service", async () => {
    mockService.addService.mockReturnValue({ success: true, id: 42 });
    const handler = handlers.get("custom-services:add")!;

    const result = (await handler(
      { sender: { id: 1 } },
      baseData({ direction: "OUT" }),
    )) as { success: boolean; id?: number };

    expect(mockService.addService).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "OUT", partnerMode: "VIA" }),
    );
    expect(result.success).toBe(true);
  });

  it("still accepts the ordinary Via-Partner IN flow (direction omitted) — regression guard", async () => {
    mockService.addService.mockReturnValue({ success: true, id: 43 });
    const handler = handlers.get("custom-services:add")!;

    const result = (await handler(
      { sender: { id: 1 } },
      baseData({ price_usd: 15, cost_usd: 4 }),
    )) as { success: boolean };

    expect(mockService.addService).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
