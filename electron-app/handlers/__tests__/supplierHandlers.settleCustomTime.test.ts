/**
 * Settle Account "Set custom time" — `suppliers:settle-account` (desktop).
 *
 * - `transaction_time` survives the shared schema and reaches the service
 *   (Zod strips unknown keys silently, rule 23).
 * - A future time is refused by the REAL SupplierService (the same check as
 *   every other backdated form), before the repository is reached.
 * - A malformed time, or a time on the legacy whole-row payload, is refused
 *   by validation and never reaches the service.
 *
 * Field name taken from the core schema (rule 24). Not proven failing-first:
 * written after the schema change (rule 17).
 */
import { ipcMain } from "electron";
import { registerSupplierHandlers } from "../supplierHandlers";
import { getSupplierService, supplierSettleAccountSchema } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getSupplierService: jest.fn(),
    getFinancialService: jest.fn(() => ({})),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

const TIME_KEY = Object.keys(supplierSettleAccountSchema.shape).find(
  (k) => k === "transaction_time",
) as string;

describe("supplierHandlers — settle-account with Set custom time", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const event = { sender: { id: 1 } };
  const amountFirst = {
    account_supplier_id: 28,
    per_currency: {
      USD: {
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 110 }],
      },
    },
    expected_owed: { usd: 110, lbp: 0 },
  };

  function register(service: unknown) {
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    (getSupplierService as jest.Mock).mockReturnValue(service);
    registerSupplierHandlers();
  }

  const call = (payload: unknown) =>
    Promise.resolve().then(() =>
      handlers.get("suppliers:settle-account")!(event, payload),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 9 });
  });

  it("the schema has the key", () => {
    expect(TIME_KEY).toBe("transaction_time");
  });

  it("forwards a past time to the service", async () => {
    const service = {
      settleAccount: jest.fn().mockReturnValue({ success: true, id: 2 }),
    };
    register(service);
    const r = await call({
      ...amountFirst,
      [TIME_KEY]: "2026-10-26T14:00:00.000Z",
    });
    expect(r).toEqual({ success: true, id: 2 });
    expect(service.settleAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        [TIME_KEY]: "2026-10-26T14:00:00.000Z",
        created_by: 9,
      }),
    );
  });

  it("a future time is refused by the real service", async () => {
    const { SupplierService } = jest.requireActual("@liratek/core");
    register(new SupplierService());
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const r = await call({ ...amountFirst, [TIME_KEY]: future });
    expect(r).toEqual({
      success: false,
      error: "transaction_time cannot be in the future",
    });
  });

  it.each([
    ["a malformed time", { ...amountFirst, transaction_time: "Monday" }],
    [
      "a time on the legacy whole-row payload",
      {
        account_supplier_id: 1,
        direction: "PAY",
        selections: [{ kind: "FINANCIAL_SERVICE", id: 1 }],
        amount_usd: 10,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        transaction_time: "2026-10-26T14:00:00.000Z",
      },
    ],
  ])("%s is refused before the service", async (_label, payload) => {
    const service = {
      settleAccount: jest.fn().mockReturnValue({ success: true, id: 2 }),
    };
    register(service);
    const r = (await call(payload)) as { success: boolean };
    expect(r.success).toBe(false);
    expect(service.settleAccount).not.toHaveBeenCalled();
  });
});
