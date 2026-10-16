import { ensureRechargeClient } from "../ensureClient";

type CreateResult = { success: boolean; id?: number; error?: string };

function mockClientsCreate(impl: () => Promise<CreateResult> | CreateResult) {
  const create = jest.fn(impl);
  (window as unknown as { api: { clients: { create: typeof create } } }).api = {
    clients: { create },
  };
  return create;
}

const cashLine = (amount: number) => ({
  id: "cash-1",
  method: "CASH",
  currencyCode: "LBP",
  amount,
});
const debtLine = (amount: number) => ({
  id: "debt-1",
  method: "CUSTOMER_ACCOUNT",
  currencyCode: "LBP",
  amount,
});

describe("ensureRechargeClient", () => {
  beforeEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it("returns the existing client id when one is already picked", async () => {
    const create = mockClientsCreate(() => {
      throw new Error("should not be called");
    });
    const result = await ensureRechargeClient({
      clientId: 42,
      inSession: false,
      name: "Nour",
      phone: "03999888",
      paymentLines: [cashLine(100)],
    });
    expect(result).toEqual({ ok: true, id: 42 });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns null id when no client info and CUSTOMER_ACCOUNT is not used", async () => {
    const create = mockClientsCreate(() => {
      throw new Error("should not be called");
    });
    const result = await ensureRechargeClient({
      clientId: null,
      inSession: false,
      name: "",
      phone: "",
      paymentLines: [cashLine(100)],
    });
    expect(result).toEqual({ ok: true, id: null });
    expect(create).not.toHaveBeenCalled();
  });

  it("fails when CUSTOMER_ACCOUNT is required but no client info is provided", async () => {
    mockClientsCreate(() => ({ success: true, id: 1 }));
    const result = await ensureRechargeClient({
      clientId: null,
      inSession: false,
      name: "",
      phone: "",
      paymentLines: [debtLine(100)],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/registered client/i);
  });

  it("fails when CUSTOMER_ACCOUNT is required and only a name is provided", async () => {
    const create = mockClientsCreate(() => ({ success: true, id: 1 }));
    const result = await ensureRechargeClient({
      clientId: null,
      inSession: false,
      name: "Nour",
      phone: "",
      paymentLines: [debtLine(100)],
    });
    expect(result.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a new client when name+phone are provided and returns the new id", async () => {
    const create = mockClientsCreate(() => ({ success: true, id: 77 }));
    const result = await ensureRechargeClient({
      clientId: null,
      inSession: false,
      name: " Nour ",
      phone: " 03 999 888 ",
      paymentLines: [debtLine(100)],
    });
    expect(result).toEqual({ ok: true, id: 77 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      full_name: "Nour",
      phone_number: "03 999 888",
      whatsapp_opt_in: 0,
    });
  });

  it("aborts with the backend error when client creation fails and CUSTOMER_ACCOUNT was selected", async () => {
    mockClientsCreate(() => ({
      success: false,
      error: "Phone number already registered",
    }));
    const result = await ensureRechargeClient({
      clientId: null,
      inSession: false,
      name: "Nour",
      phone: "03999888",
      paymentLines: [debtLine(100)],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Phone number already registered");
  });

  it("falls back to no-client when creation fails but CUSTOMER_ACCOUNT is not used", async () => {
    mockClientsCreate(() => ({
      success: false,
      error: "Phone number already registered",
    }));
    const result = await ensureRechargeClient({
      clientId: null,
      inSession: false,
      name: "Nour",
      phone: "03999888",
      paymentLines: [cashLine(100)],
    });
    expect(result).toEqual({ ok: true, id: null });
  });

  it("aborts when the IPC call itself throws and CUSTOMER_ACCOUNT was selected", async () => {
    mockClientsCreate(() => {
      throw new Error("IPC offline");
    });
    const result = await ensureRechargeClient({
      clientId: null,
      inSession: false,
      name: "Nour",
      phone: "03999888",
      paymentLines: [debtLine(100)],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/IPC offline|customer account/i);
  });

  it("falls back to no-client when the IPC call throws but CUSTOMER_ACCOUNT is not used", async () => {
    mockClientsCreate(() => {
      throw new Error("IPC offline");
    });
    const result = await ensureRechargeClient({
      clientId: null,
      inSession: false,
      name: "Nour",
      phone: "03999888",
      paymentLines: [cashLine(100)],
    });
    expect(result).toEqual({ ok: true, id: null });
  });

  // Shop-day 2026-10-16: inside a customer session every add-to-cart fired a
  // client create for the session customer, who was registered when the
  // session started — a 409 DUPLICATE_PHONE on every add. The session owns the
  // customer: the server stamps the session client on every basket item at
  // checkout, and the basket collects payment there, so the form's payment
  // lines (even a stale Customer Account line) are not this call's concern.
  it("in a customer session, never creates a client and never blocks on Customer Account", async () => {
    const create = mockClientsCreate(() => ({
      success: false,
      error: "Phone number already registered",
    }));
    const result = await ensureRechargeClient({
      clientId: null,
      inSession: true,
      name: "Samir Aoun",
      phone: "70998811",
      paymentLines: [debtLine(100)],
    });
    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, id: null });
  });

  it("in a customer session, still keeps a client the cashier picked", async () => {
    const create = mockClientsCreate(() => {
      throw new Error("should not be called");
    });
    const result = await ensureRechargeClient({
      clientId: 42,
      inSession: true,
      name: "Samir Aoun",
      phone: "70998811",
      paymentLines: [cashLine(100)],
    });
    expect(result).toEqual({ ok: true, id: 42 });
    expect(create).not.toHaveBeenCalled();
  });
});
