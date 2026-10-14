/**
 * LIRA-312 (T031) — wrong-number IPC handlers: role gates, validation and
 * conditional audit.
 *
 * Owner decision 2026-10-12: recording a wrong number and entering credits
 * received are open to cashiers (staff) and admins; undo stays the existing
 * admin-only `transactions:void`. The payload fixtures are parsed through
 * the core schemas, so the field names come from the schema (rule 24).
 *
 * Written together with the handlers — not proven failing-first (rule 17).
 */

import { ipcMain } from "electron";
import { registerWrongNumberHandlers } from "../wrongNumberHandlers";
import {
  getWrongNumberService,
  recordWrongNumberSchema,
  wrongNumberCreditsSchema,
} from "@liratek/core";
import { isAuthenticated, requireRole } from "../../session";
import { audit } from "../auditHelper";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return { ...actual, getWrongNumberService: jest.fn() };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
  isAuthenticated: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

const RECORD = recordWrongNumberSchema.parse({
  provider: "iPick",
  mobile_service_item_id: 3,
  wrong_number: "03111111",
  right_number: "03222333",
  sale_transaction_id: 40,
  expense_date: "2026-10-14",
});
const CREDITS = wrongNumberCreditsSchema.parse({
  wrong_number_card_id: 5,
  amount_usd: 6.68,
  carrier_line_id: 2,
});

describe("wrong-numbers:* IPC handlers (LIRA-312)", () => {
  const service = {
    list: jest.fn(),
    recordWrongNumber: jest.fn(),
    recordCreditsReceived: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const event = { sender: { id: 1 } };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    (getWrongNumberService as jest.Mock).mockReturnValue(service);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, role: "staff", userId: 7 });
    (isAuthenticated as jest.Mock).mockReturnValue(true);
    registerWrongNumberHandlers();
  });

  it.each([
    ["wrong-numbers:record", RECORD],
    ["wrong-numbers:credits", CREDITS],
  ])("%s allows admin and staff", async (channel, payload) => {
    service.recordWrongNumber.mockReturnValue({ success: true, data: { id: 5, expense_transaction_id: 9 } });
    service.recordCreditsReceived.mockReturnValue({ success: true, data: { transaction_id: 11 } });
    await handlers.get(channel)!(event, payload);
    expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
  });

  it.each([
    ["wrong-numbers:record", RECORD],
    ["wrong-numbers:credits", CREDITS],
  ])("%s refuses an unauthenticated caller before the service runs", async (channel, payload) => {
    (requireRole as jest.Mock).mockReturnValue({ ok: false, error: "Not authenticated" });
    const result = await handlers.get(channel)!(event, payload);
    expect(result).toEqual({ success: false, error: "Not authenticated" });
    expect(service.recordWrongNumber).not.toHaveBeenCalled();
    expect(service.recordCreditsReceived).not.toHaveBeenCalled();
  });

  it("record passes the validated payload and the session user to the service, and audits", async () => {
    service.recordWrongNumber.mockReturnValue({ success: true, data: { id: 5, expense_transaction_id: 9 } });
    await handlers.get("wrong-numbers:record")!(event, RECORD);
    expect(service.recordWrongNumber).toHaveBeenCalledWith(RECORD, 7);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("an invalid payload is refused before the service", async () => {
    const result = (await handlers.get("wrong-numbers:record")!(event, {
      ...RECORD,
      wrong_number: "",
    })) as { success: boolean };
    expect(result.success).toBe(false);
    expect(service.recordWrongNumber).not.toHaveBeenCalled();
  });

  it("a refused service call is not audited", async () => {
    service.recordCreditsReceived.mockReturnValue({
      success: false,
      error: "Pick an active Alfa shop line.",
    });
    const result = await handlers.get("wrong-numbers:credits")!(event, CREDITS);
    expect(result).toEqual({ success: false, error: "Pick an active Alfa shop line." });
    expect(audit).not.toHaveBeenCalled();
  });

  it("list needs a signed-in session", async () => {
    (isAuthenticated as jest.Mock).mockReturnValue(false);
    expect(await handlers.get("wrong-numbers:list")!(event, {})).toEqual({
      success: false,
      error: "Not authenticated",
    });
    expect(service.list).not.toHaveBeenCalled();
  });
});
