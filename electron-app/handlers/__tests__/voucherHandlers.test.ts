/**
 * LIRA-339 (T041) — `voucher:create` forwards the tender keys (payments,
 * exchange_rate, transaction_time) and `voucher:cancel(id, data?)` validates
 * with the shared core cancel schema and forwards payments / exchange_rate /
 * client_day as `cancelVoucher(id, input, cancelledBy)`. Field names come from
 * the core schemas (rule 24): fixtures are parsed through them.
 */

import { ipcMain } from "electron";
import { registerVoucherHandlers } from "../voucherHandlers";
import {
  getVoucherService,
  voucherCreateSchema,
  voucherCancelSchema,
} from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({ ipcMain: { handle: jest.fn() } }));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return { ...actual, getVoucherService: jest.fn() };
});

jest.mock("../../session", () => ({ requireRole: jest.fn() }));

describe("voucher IPC handlers (LIRA-339)", () => {
  const mockService = {
    createVoucher: jest.fn(),
    cancelVoucher: jest.fn(),
    getVouchers: jest.fn(),
    validateVoucher: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const evt = { sender: { id: 1 } };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((ch, h) => {
      handlers.set(ch, h);
    });
    (getVoucherService as jest.Mock).mockReturnValue(mockService);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 3 });
    registerVoucherHandlers();
  });

  it("create forwards payments, exchange_rate and transaction_time", async () => {
    mockService.createVoucher.mockReturnValue({ success: true });
    const payload = voucherCreateSchema.parse({
      clientId: 7,
      amount: 50,
      currency: "USD",
      payments: [
        { method: "CASH", currency_code: "USD", amount: 30 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 20 },
      ],
      exchange_rate: 89500,
      transaction_time: "2026-10-24 10:00:00",
    });
    await handlers.get("voucher:create")!(evt, payload);
    expect(mockService.createVoucher).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 7,
        payments: payload.payments,
        exchange_rate: payload.exchange_rate,
        transaction_time: payload.transaction_time,
      }),
      3,
    );
  });

  it("cancel validates and forwards payments, exchange_rate and client_day", async () => {
    mockService.cancelVoucher.mockReturnValue({ success: true });
    const data = voucherCancelSchema.parse({
      payments: [{ method: "WHISH", currency_code: "USD", amount: 10 }],
      exchange_rate: 89500,
      client_day: "2026-10-24",
    });
    const res = await handlers.get("voucher:cancel")!(evt, 5, data);
    expect(res).toEqual({ success: true });
    expect(mockService.cancelVoucher).toHaveBeenCalledWith(
      5,
      expect.objectContaining(data),
      3,
    );
  });

  it("cancel without data still works (fallback cash refund)", async () => {
    mockService.cancelVoucher.mockReturnValue({ success: true });
    await handlers.get("voucher:cancel")!(evt, 5);
    expect(mockService.cancelVoucher).toHaveBeenCalledWith(5, {}, 3);
  });

  it("cancel refuses an account leg (drawer methods only)", async () => {
    const res = (await handlers.get("voucher:cancel")!(evt, 5, {
      payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 5 }],
    })) as { success: boolean };
    expect(res.success).toBe(false);
    expect(mockService.cancelVoucher).not.toHaveBeenCalled();
  });

  it("cancel is admin-only", async () => {
    await handlers.get("voucher:cancel")!(evt, 5);
    expect(requireRole).toHaveBeenCalledWith(1, ["admin"]);
    (requireRole as jest.Mock).mockReturnValue({ ok: false, error: "Forbidden" });
    const res = await handlers.get("voucher:cancel")!(evt, 5);
    expect(res).toEqual({ success: false, error: "Forbidden" });
  });
});
