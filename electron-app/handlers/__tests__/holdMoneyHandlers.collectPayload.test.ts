/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch). LIRA-214 (OWNER_NOTES_REMAINING_BUILD.md #24, migration v183):
 * `hold-money:collect` moves from a bare `id` argument to a validated
 * payload (payment legs + optional partial amounts), and `hold-money:void-
 * pickup` is a brand new channel — both fail-to-exist against pre-fix code,
 * so this whole file is a rule-17 failing-first proof by construction.
 *
 * Mirrors salesHandlers.dashboardChart.dc10dc11.test.ts's mocking shape.
 */

import { ipcMain } from "electron";
import { registerHoldMoneyHandlers } from "../holdMoneyHandlers";
import { getHoldMoneyService } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getHoldMoneyService: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("hold-money:collect / hold-money:void-pickup (LIRA-214)", () => {
  const mockService = {
    createHold: jest.fn(),
    collectHold: jest.fn(),
    voidPickup: jest.fn(),
    getPickups: jest.fn(),
    getActiveHolds: jest.fn(),
    getHolds: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getHoldMoneyService as jest.Mock).mockReturnValue(mockService);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 3 });

    registerHoldMoneyHandlers();
  });

  it("registers hold-money:collect, hold-money:void-pickup and hold-money:pickups", () => {
    expect(handlers.has("hold-money:collect")).toBe(true);
    expect(handlers.has("hold-money:void-pickup")).toBe(true);
    expect(handlers.has("hold-money:pickups")).toBe(true);
  });

  it("collect validates the payload and forwards the parsed data to the service", async () => {
    mockService.collectHold.mockReturnValue({ success: true, id: 99 });
    const handler = handlers.get("hold-money:collect")!;

    const result = await handler({ sender: { id: 1 } }, {
      id: 5,
      usd_amount: 20,
      payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
    });

    expect(result).toEqual({ success: true, id: 99 });
    expect(mockService.collectHold).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, usd_amount: 20 }),
      3,
    );
  });

  it("collect rejects a payload missing id", async () => {
    const handler = handlers.get("hold-money:collect")!;
    const result = (await handler({ sender: { id: 1 } }, {
      usd_amount: 20,
    })) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(mockService.collectHold).not.toHaveBeenCalled();
  });

  it("collect enforces requireRole before touching the service", async () => {
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden",
    });
    const handler = handlers.get("hold-money:collect")!;
    const result = (await handler({ sender: { id: 1 } }, { id: 5 })) as {
      success: boolean;
      error?: string;
    };

    expect(result).toEqual({ success: false, error: "Forbidden" });
    expect(mockService.collectHold).not.toHaveBeenCalled();
  });

  it("void-pickup validates pickup_id and forwards to the service", async () => {
    mockService.voidPickup.mockReturnValue({ success: true, id: 12 });
    const handler = handlers.get("hold-money:void-pickup")!;

    const result = await handler({ sender: { id: 1 } }, { pickup_id: 4 });

    expect(result).toEqual({ success: true, id: 12 });
    expect(mockService.voidPickup).toHaveBeenCalledWith(4, 3);
  });

  it("void-pickup rejects a non-positive pickup_id", async () => {
    const handler = handlers.get("hold-money:void-pickup")!;
    const result = (await handler({ sender: { id: 1 } }, {
      pickup_id: -1,
    })) as { success: boolean };

    expect(result.success).toBe(false);
    expect(mockService.voidPickup).not.toHaveBeenCalled();
  });
});
