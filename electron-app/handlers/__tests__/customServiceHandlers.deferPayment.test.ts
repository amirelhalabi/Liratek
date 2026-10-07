/**
 * `custom-services:add` must ignore a client-sent `deferPayment` (the flag
 * that skips the selling-price refusal and all customer-cash posting; only
 * the server-side session checkout replay may set it). REST twin:
 * backend/src/api/__tests__/customServicesCreateDeferPayment.api.test.ts.
 *
 * Desktop already stripped it: the local CustomServiceCreateSchema
 * (electron-app/schemas/index.ts) never had the key and Zod strips unknown
 * keys. This guard pins that so the key is never added there.
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

describe("custom-services:add — deferPayment is server-only", () => {
  const mockService = { addService: jest.fn() };
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

  it("drops a client-sent deferPayment before calling the service", async () => {
    mockService.addService.mockReturnValue({ success: true, id: 3 });
    const handler = handlers.get("custom-services:add")!;

    await handler(
      { sender: { id: 1 } },
      { description: "Screen fix", cost_usd: 10, deferPayment: true },
    );

    expect(mockService.addService).toHaveBeenCalledTimes(1);
    const passed = mockService.addService.mock.calls[0][0];
    expect(passed.description).toBe("Screen fix");
    expect(passed).not.toHaveProperty("deferPayment");
  });
});
