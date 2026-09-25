/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch). LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C): two brand new
 * IPC channels, `transactions:void-session-basket` and
 * `transactions:refund-session-basket`, replacing the "Basket item — see
 * admin to reverse" dead end. Both fail-to-exist against pre-fix code, so
 * this whole file is a rule-17 failing-first proof by construction.
 *
 * Mirrors holdMoneyHandlers.collectPayload.test.ts's mocking shape.
 */

import { ipcMain } from "electron";
import { registerTransactionHandlers } from "../transactionHandlers";
import { getTransactionService, getReportingService } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getTransactionService: jest.fn(),
    getReportingService: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("transactions:void-session-basket / transactions:refund-session-basket (LIRA-201c)", () => {
  const mockTxnService = {
    voidSessionBasket: jest.fn(),
    refundSessionBasket: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getTransactionService as jest.Mock).mockReturnValue(mockTxnService);
    (getReportingService as jest.Mock).mockReturnValue({});
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 3 });

    registerTransactionHandlers();
  });

  it("registers both session-basket reversal channels", () => {
    expect(handlers.has("transactions:void-session-basket")).toBe(true);
    expect(handlers.has("transactions:refund-session-basket")).toBe(true);
  });

  it("void-session-basket validates sessionId and forwards to the service, returning the IPC-identical envelope", async () => {
    mockTxnService.voidSessionBasket.mockReturnValue({
      sessionId: 7,
      itemCount: 2,
      reversedTransactionIds: [10, 11],
      reversalIds: [20, 21],
    });
    const handler = handlers.get("transactions:void-session-basket")!;

    const result = await handler({ sender: { id: 1 } }, { sessionId: 7 });

    expect(result).toEqual({
      success: true,
      sessionId: 7,
      itemCount: 2,
      reversedTransactionIds: [10, 11],
      reversalIds: [20, 21],
    });
    expect(mockTxnService.voidSessionBasket).toHaveBeenCalledWith(7, 3);
  });

  it("void-session-basket rejects a missing/non-positive sessionId without touching the service", async () => {
    const handler = handlers.get("transactions:void-session-basket")!;

    const result = (await handler({ sender: { id: 1 } }, {})) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(false);
    expect(mockTxnService.voidSessionBasket).not.toHaveBeenCalled();
  });

  it("void-session-basket enforces requireRole before touching the service", async () => {
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Admin access required",
    });
    const handler = handlers.get("transactions:void-session-basket")!;

    const result = await handler({ sender: { id: 1 } }, { sessionId: 7 });

    expect(result).toEqual({
      success: false,
      error: "Admin access required",
    });
    expect(mockTxnService.voidSessionBasket).not.toHaveBeenCalled();
  });

  it("void-session-basket surfaces a thrown business-rule error as { success: false }", async () => {
    mockTxnService.voidSessionBasket.mockImplementation(() => {
      throw new Error(
        "This prize was already settled with Loto on 2026-09-20. Fix it from the Loto page.",
      );
    });
    const handler = handlers.get("transactions:void-session-basket")!;

    const result = await handler({ sender: { id: 1 } }, { sessionId: 7 });

    expect(result).toEqual({
      success: false,
      error:
        "This prize was already settled with Loto on 2026-09-20. Fix it from the Loto page.",
    });
  });

  it("refund-session-basket validates sessionId and forwards to the service", async () => {
    mockTxnService.refundSessionBasket.mockReturnValue({
      sessionId: 8,
      itemCount: 1,
      reversedTransactionIds: [30],
      reversalIds: [31],
    });
    const handler = handlers.get("transactions:refund-session-basket")!;

    const result = await handler({ sender: { id: 1 } }, { sessionId: 8 });

    expect(result).toEqual({
      success: true,
      sessionId: 8,
      itemCount: 1,
      reversedTransactionIds: [30],
      reversalIds: [31],
    });
    expect(mockTxnService.refundSessionBasket).toHaveBeenCalledWith(8, 3);
  });

  it("refund-session-basket enforces requireRole before touching the service", async () => {
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Admin access required",
    });
    const handler = handlers.get("transactions:refund-session-basket")!;

    const result = await handler({ sender: { id: 1 } }, { sessionId: 8 });

    expect(result).toEqual({
      success: false,
      error: "Admin access required",
    });
    expect(mockTxnService.refundSessionBasket).not.toHaveBeenCalled();
  });
});
