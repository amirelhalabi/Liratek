/**
 * LIRA-322 (T016) — `suppliers:settle-account` with the amount-first
 * payload (`per_currency` + `expected_owed`), desktop (IPC) side.
 *
 * - The handler forwards `per_currency` and `expected_owed` untouched, with
 *   the actor from the session (never the payload).
 * - The audit line describes the payload per currency. The old summary read
 *   `v.data.selections.length`, which the amount-first payload does not
 *   carry — the handler threw after the settlement was already written.
 *
 * Rule 17: run against the unchanged handler first.
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

describe("supplierHandlers — LIRA-322 amount-first settle-account", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const service = {
    settleAccount: jest.fn().mockReturnValue({ success: true, id: 2 }),
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

  const call = (...args: unknown[]) =>
    Promise.resolve().then(() =>
      handlers.get("suppliers:settle-account")!(event, ...args),
    );

  const amountFirst = {
    account_supplier_id: 28,
    per_currency: {
      USD: {
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 300 }],
      },
    },
    expected_owed: { usd: 497, lbp: 900000 },
  };

  it("forwards per_currency and expected_owed untouched, actor from the session", async () => {
    const r = await call({ ...amountFirst, created_by: 999 });
    expect(r).toEqual({ success: true, id: 2 });
    expect(service.settleAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        account_supplier_id: 28,
        per_currency: amountFirst.per_currency,
        expected_owed: amountFirst.expected_owed,
        created_by: 9,
      }),
    );
  });

  it("audits the amount-first payload per currency", async () => {
    await call(amountFirst);
    expect(audit).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        action: "settle",
        entity_type: "supplier_account_settlement",
        summary: "Settled OMT account #28 (USD PAY $300.00, LBP —)",
      }),
    );
  });

  it("does not audit a refused settlement", async () => {
    service.settleAccount.mockReturnValueOnce({
      success: false,
      error: "OMT's balance changed",
    });
    const r = await call(amountFirst);
    expect(r).toEqual({ success: false, error: "OMT's balance changed" });
    expect(audit).not.toHaveBeenCalled();
  });

  it("keeps the legacy audit text byte-identical", async () => {
    await call({
      account_supplier_id: 1,
      direction: "PAY",
      selections: [{ kind: "FINANCIAL_SERVICE", id: 1 }],
      amount_usd: 10,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
    });
    expect(audit).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        summary: "Settled OMT account #1 (PAY, 1 row)",
        metadata: {
          account_supplier_id: 1,
          direction: "PAY",
          count: 1,
          surplus_usd: 0,
          surplus_lbp: 0,
        },
      }),
    );
  });
});
