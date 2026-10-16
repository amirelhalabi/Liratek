// LIRA-326 — recharge-basket:checkout IPC handler: role gate, shared core
// schema (rule 14/23), the authenticated operator injected over the wire
// userId, audit on success only, and the core envelope passed through.
//
// Written alongside the handler (new channel): not proven failing-first in the
// rule-17 sense beyond "the channel did not exist" — there was no prior
// behaviour to fail against.

import { ipcMain } from "electron";
import {
  rechargeBasketCheckoutSchema,
  rechargePartnerOrderSchema,
  type RechargeBasketCheckoutPayload,
  type RechargePartnerOrderPayload,
} from "@liratek/core";
import { requireRole } from "../../session";
import { audit } from "../auditHelper";

const mockCheckout = jest.fn();
const mockPartnerSubmit = jest.fn();

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getRechargeBasketService: () => ({
      checkout: (...a: unknown[]) => mockCheckout(...a),
    }),
    getRechargePartnerOrderService: () => ({
      submit: (...a: unknown[]) => mockPartnerSubmit(...a),
    }),
    getUserRepository: () => ({
      findByIdSafe: () => ({ username: "cashier1" }),
    }),
  };
});

jest.mock("../../session", () => ({ requireRole: jest.fn() }));
jest.mock("../auditHelper", () => ({ audit: jest.fn() }));

import { registerRechargeBasketHandlers } from "../rechargeBasketHandlers";

type Handler = (...args: unknown[]) => Promise<unknown>;

const PAYLOAD: RechargeBasketCheckoutPayload = {
  cartItems: [
    {
      id: "katsh",
      module: "katsh",
      label: "Katsh: mtc 7.58",
      amount: 800000,
      currency: "LBP",
      ipcChannel: "financial:create",
      formData: {
        _batch: true,
        items: [{ provider: "Katsh", amount: 800000 }],
      },
    },
  ],
  payments: [
    { method: "CASH", currency_code: "LBP", amount: 800000, direction: "IN" },
  ],
  exchangeRate: 89500,
  clientName: "Rami",
  clientPhone: "70111222",
  userId: 999, // wire value — must be overwritten by the session's operator
};

describe("recharge-basket:checkout IPC handler", () => {
  const handlers = new Map<string, Handler>();
  const event = { sender: { id: 1 } };

  beforeAll(() => {
    (ipcMain.handle as jest.Mock).mockImplementation((ch, fn) => {
      handlers.set(ch, fn);
    });
    registerRechargeBasketHandlers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      role: "staff",
      userId: 42,
    });
    mockCheckout.mockResolvedValue({
      success: true,
      sessionId: 7,
      results: [],
      checkoutTotalUsd: 0,
      checkoutTotalLbp: 800000,
    });
  });

  const invoke = (payload: unknown) =>
    handlers.get("recharge-basket:checkout")!(event, payload);

  it("is registered and gated to admin + staff", async () => {
    await invoke(PAYLOAD);
    expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
  });

  it("a refused role never reaches the service", async () => {
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden",
    });
    const result = await invoke(PAYLOAD);
    expect(result).toEqual({ success: false, error: "Forbidden" });
    expect(mockCheckout).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("forwards every schema key, with the authenticated operator as userId and username", async () => {
    await invoke(PAYLOAD);
    expect(mockCheckout).toHaveBeenCalledTimes(1);
    const [req, ctx] = mockCheckout.mock.calls[0];
    // rule 23/24: the expected request is the schema's own parse of the
    // payload, so a key the schema strips cannot hide here.
    const parsed = rechargeBasketCheckoutSchema.parse(PAYLOAD);
    expect(req).toEqual({ ...parsed, userId: 42 });
    expect(req.clientPhone).toBe("70111222");
    expect(ctx).toEqual({ username: "cashier1" });
  });

  it("an invalid envelope is refused before the service", async () => {
    const result = (await invoke({ ...PAYLOAD, cartItems: [] })) as {
      success: boolean;
    };
    expect(result.success).toBe(false);
    expect(mockCheckout).not.toHaveBeenCalled();
  });

  it("returns the core envelope and audits a successful basket", async () => {
    const result = await invoke(PAYLOAD);
    expect(result).toMatchObject({ success: true, sessionId: 7 });
    expect(audit).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        entity_type: "customer_session",
        entity_id: "7",
      }),
    );
  });

  it("a failed checkout is returned as-is and not audited", async () => {
    mockCheckout.mockResolvedValue({ success: false, error: "nope" });
    const result = await invoke(PAYLOAD);
    expect(result).toEqual({ success: false, error: "nope" });
    expect(audit).not.toHaveBeenCalled();
  });
});

// LIRA-327 — recharge-basket:partner-order: the basket-wide For Partner
// submit. New channel, written with the handler: not proven failing-first
// beyond "the channel did not exist".
const ORDER: RechargePartnerOrderPayload = {
  partnerId: 7,
  sales: [
    {
      provider: "Katsh",
      serviceType: "SEND",
      amount: 90000,
      cost: 82340,
      currency: "LBP",
      commission: 7660,
      payments: [],
      note: "Pubg 60 UC",
    },
    {
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 10,
      cost: 9,
      currency: "USD",
      commission: 1,
      payments: [],
      itemKey: "W/PSN/10",
    },
  ],
  userId: 999, // wire value — must be overwritten by the session's operator
};

describe("recharge-basket:partner-order IPC handler", () => {
  const handlers = new Map<string, Handler>();
  const event = { sender: { id: 1 } };

  beforeAll(() => {
    (ipcMain.handle as jest.Mock).mockImplementation((ch, fn) => {
      handlers.set(ch, fn);
    });
    registerRechargeBasketHandlers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      role: "staff",
      userId: 42,
    });
    mockPartnerSubmit.mockReturnValue({ success: true, ids: [1, 2] });
  });

  const invoke = (payload: unknown) =>
    handlers.get("recharge-basket:partner-order")!(event, payload);

  it("is gated to admin + staff; a refused role never reaches the service", async () => {
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden",
    });
    const result = await invoke(ORDER);
    expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
    expect(result).toEqual({ success: false, error: "Forbidden" });
    expect(mockPartnerSubmit).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("forwards the schema's own parse with the authenticated operator, and audits", async () => {
    const result = await invoke(ORDER);
    expect(result).toEqual({ success: true, ids: [1, 2] });
    expect(mockPartnerSubmit).toHaveBeenCalledTimes(1);
    const parsed = rechargePartnerOrderSchema.parse(ORDER);
    expect(mockPartnerSubmit.mock.calls[0][0]).toEqual({
      ...parsed,
      userId: 42,
    });
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("an invalid order (no sales) is refused before the service", async () => {
    const result = (await invoke({ ...ORDER, sales: [] })) as {
      success: boolean;
    };
    expect(result.success).toBe(false);
    expect(mockPartnerSubmit).not.toHaveBeenCalled();
  });

  it("a failed submit is passed through, with no audit", async () => {
    mockPartnerSubmit.mockReturnValue({ success: false, error: "Nope" });
    const result = await invoke(ORDER);
    expect(result).toEqual({ success: false, error: "Nope" });
    expect(audit).not.toHaveBeenCalled();
  });
});
