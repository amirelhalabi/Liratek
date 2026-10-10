// LIRA-297 item 3 — session:start / session:update / session:cart:add /
// session:linkTransaction now validate against the shared core schemas
// (packages/core/src/validators/session.ts), the same ones the REST routes
// use. Zod strips unknown keys silently (rule 23), so each case sends a
// payload built from the schema's keys (rule 24) and asserts every one
// reaches the service — above all profitUsd/profitLbp on the link.
//
// Not proven failing-first (rule 17): these guard the new schemas against
// stripping a key; the handlers forwarded these fields before as well.

import { ipcMain } from "electron";
import {
  linkSessionTransactionSchema,
  sessionCartAddSchema,
  type LinkSessionTransactionInput,
  type SessionCartAddInput,
} from "@liratek/core";
import { requireRole } from "../../session";

const mockStart = jest.fn();
const mockUpdate = jest.fn();
const mockLink = jest.fn();
const mockLinkActive = jest.fn();
const mockAddCartItem = jest.fn();

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    CustomerSessionService: jest.fn().mockImplementation(() => ({
      startSession: (...a: unknown[]) => mockStart(...a),
      updateSession: (...a: unknown[]) => mockUpdate(...a),
      linkTransactionToSession: (...a: unknown[]) => mockLink(...a),
      linkTransactionToActiveSession: (...a: unknown[]) => mockLinkActive(...a),
    })),
    getCustomerSessionRepository: () => ({
      addCartItem: (...a: unknown[]) => mockAddCartItem(...a),
    }),
    getUserRepository: () => ({
      findByIdSafe: () => ({ username: "cashier1" }),
    }),
  };
});

jest.mock("../../session", () => ({ requireRole: jest.fn() }));
jest.mock("../auditHelper", () => ({ audit: jest.fn() }));

import { registerSessionHandlers } from "../sessionHandlers";

type Handler = (...args: unknown[]) => Promise<unknown>;

const LINK: Required<LinkSessionTransactionInput> = {
  sessionId: 7,
  transactionType: "exchange",
  transactionId: 99,
  amountUsd: 100,
  amountLbp: 0,
  profitUsd: 1.5,
  profitLbp: 2500,
};
const CART: Required<SessionCartAddInput> = {
  item_id: "uuid-1",
  module: "recharge",
  label: "Alfa $10",
  amount: 10,
  currency: "USD",
  form_data: "{}",
  ipc_channel: "recharge:process",
};

describe("session IPC writes — shared core schemas", () => {
  const handlers = new Map<string, Handler>();
  const event = { sender: { id: 1 } };

  beforeAll(() => {
    (ipcMain.handle as jest.Mock).mockImplementation((ch, fn) => {
      handlers.set(ch, fn);
    });
    registerSessionHandlers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      role: "staff",
      userId: 42,
    });
    mockStart.mockResolvedValue({ success: true, sessionId: 5 });
    mockUpdate.mockResolvedValue({ success: true });
    mockLink.mockResolvedValue({ success: true, linked: true });
    mockLinkActive.mockResolvedValue({ success: true, linked: true });
    mockAddCartItem.mockReturnValue(11);
  });

  it("fixtures cover every schema key", () => {
    const k = (o: object) => Object.keys(o).sort();
    expect(k(LINK)).toEqual(k(linkSessionTransactionSchema.shape));
    expect(k(CART)).toEqual(k(sessionCartAddSchema.shape));
  });

  it("session:linkTransaction forwards profit to the service", async () => {
    await handlers.get("session:linkTransaction")!(event, LINK);
    expect(mockLink).toHaveBeenCalledWith(7, "exchange", 99, 100, 0, 1.5, 2500);
  });

  it("session:linkTransaction without sessionId links to the active session", async () => {
    const { sessionId: _s, ...rest } = LINK;
    await handlers.get("session:linkTransaction")!(event, rest);
    expect(mockLinkActive).toHaveBeenCalledWith(
      "exchange",
      99,
      100,
      0,
      1.5,
      2500,
    );
  });

  it("session:linkTransaction refuses a missing amount", async () => {
    const { amountUsd: _a, ...rest } = LINK;
    const res = (await handlers.get("session:linkTransaction")!(
      event,
      rest,
    )) as { success: boolean };
    expect(res.success).toBe(false);
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("session:start keeps every field; actor comes from the signed-in user", async () => {
    await handlers.get("session:start")!(event, {
      customer_name: "Walk-in",
      customer_phone: "70123456",
      customer_notes: "VIP",
      started_by: "fallback",
      user_id: 999,
    });
    expect(mockStart).toHaveBeenCalledWith({
      customer_name: "Walk-in",
      customer_phone: "70123456",
      customer_notes: "VIP",
      started_by: "cashier1",
      user_id: 42,
    });
  });

  it("session:update forwards every field", async () => {
    const data = {
      customer_name: "Ali",
      customer_phone: "71000000",
      customer_notes: "x",
    };
    await handlers.get("session:update")!(event, 9, data);
    expect(mockUpdate).toHaveBeenCalledWith(9, data, 42);
  });

  it("session:cart:add forwards every field; user_id from the signed-in user", async () => {
    const res = await handlers.get("session:cart:add")!(event, 9, {
      ...CART,
      user_id: 999,
    });
    expect(res).toEqual({ success: true, id: 11 });
    expect(mockAddCartItem).toHaveBeenCalledWith(9, { ...CART, user_id: 42 });
  });
});
