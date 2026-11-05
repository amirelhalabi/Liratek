/**
 * LIRA-371 — `suppliers:settle-transactions`, `suppliers:settle-account`
 * and `suppliers:record-cashflow` carry `cash_drawer` to SupplierService and
 * refuse a bad value. Parity check, not proven failing-first: the handlers
 * spread the validated data.
 */
import { ipcMain } from "electron";
import { registerSupplierHandlers } from "../supplierHandlers";
import { getSupplierService } from "@liratek/core";
import { requireRole } from "../../session";
import { audit } from "../auditHelper";

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

const settleBody = {
  supplier_id: 3,
  financial_service_ids: [1],
  amount_usd: 0,
  amount_lbp: 0,
  commission_usd: 0,
  commission_lbp: 0,
};
const accountBody = {
  account_supplier_id: 3,
  per_currency: {
    USD: {
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 772.3 }],
    },
  },
  expected_owed: { usd: 772.3, lbp: 0 },
};
const cashflowBody = {
  supplier_id: 3,
  direction: "PAY",
  payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
};

const CASES = [
  ["suppliers:settle-transactions", "settleTransactions", settleBody],
  ["suppliers:settle-account", "settleAccount", accountBody],
  ["suppliers:record-cashflow", "recordSupplierCashflow", cashflowBody],
] as const;

describe("supplierHandlers — LIRA-371 cash_drawer", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const service = {
    settleTransactions: jest.fn().mockReturnValue({ success: true, id: 2 }),
    settleAccount: jest.fn().mockReturnValue({ success: true, id: 2 }),
    recordSupplierCashflow: jest.fn().mockReturnValue({ success: true, id: 2 }),
  };
  const event = { sender: { id: 1 } };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    (getSupplierService as jest.Mock).mockReturnValue(service);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 9 });
    registerSupplierHandlers();
  });

  it.each(CASES)("%s forwards cash_drawer GENERAL", async (channel, method, body) => {
    const r = await Promise.resolve().then(() =>
      handlers.get(channel)!(event, { ...body, cash_drawer: "GENERAL" }),
    );
    expect(r).toEqual({ success: true, id: 2 });
    expect(service[method]).toHaveBeenCalledWith(
      expect.objectContaining({ cash_drawer: "GENERAL" }),
    );
  });

  it.each(CASES)("%s refuses a bad value", async (channel, method, body) => {
    const r = (await Promise.resolve().then(() =>
      handlers.get(channel)!(event, { ...body, cash_drawer: "OMT_System" }),
    )) as { success: boolean };
    expect(r.success).toBe(false);
    expect(service[method]).not.toHaveBeenCalled();
  });
});
