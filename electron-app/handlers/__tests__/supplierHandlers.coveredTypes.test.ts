/**
 * LIRA-256 — OMT statement commission types, desktop (IPC) side.
 *
 * - `suppliers:account-expected-statement` gains an optional 2nd argument,
 *   validated with the shared core schema. It is a RAW-shape read (returns
 *   the statement, never an envelope), so an invalid value REJECTS the
 *   invoke promise instead of returning `{ success: false }`.
 *   RULE 17 — run red before the handler change (forwarded `(7)` only; the
 *   BOGUS case resolved).
 * - The two settle channels forward `covered_omt_service_types`.
 *   Not proven failing-first: forwarding is automatic once the schema key
 *   exists (`...v.data`); this is a rule-23 regression net.
 */
import { ipcMain } from "electron";
import { registerSupplierHandlers } from "../supplierHandlers";
import { getSupplierService } from "@liratek/core";
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

describe("supplierHandlers — LIRA-256 covered types", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const service = {
    getAccountExpectedStatement: jest
      .fn()
      .mockReturnValue({ account_supplier_id: 7 }),
    settleTransactions: jest.fn().mockReturnValue({ success: true, id: 1 }),
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

  const call = (channel: string, ...args: unknown[]) =>
    Promise.resolve().then(() => handlers.get(channel)!(event, ...args));

  describe("suppliers:account-expected-statement", () => {
    it("forwards (id, covered) when a list is given", async () => {
      await call("suppliers:account-expected-statement", 7, ["INTRA"]);
      expect(service.getAccountExpectedStatement).toHaveBeenCalledWith(7, [
        "INTRA",
      ]);
    });

    it("forwards (id, undefined) when no list is given (all types)", async () => {
      await call("suppliers:account-expected-statement", 7);
      expect(service.getAccountExpectedStatement).toHaveBeenCalledWith(
        7,
        undefined,
      );
    });

    it.each([[["BOGUS"]], [[]]])(
      "rejects %j without calling the service",
      async (bad) => {
        await expect(
          call("suppliers:account-expected-statement", 7, bad),
        ).rejects.toThrow();
        expect(service.getAccountExpectedStatement).not.toHaveBeenCalled();
      },
    );
  });

  const settleData = {
    supplier_id: 1,
    financial_service_ids: [1],
    amount_usd: 10,
    amount_lbp: 0,
    commission_usd: 0,
    commission_lbp: 0,
  };
  const accountData = {
    account_supplier_id: 1,
    direction: "PAY",
    selections: [{ kind: "FINANCIAL_SERVICE", id: 1 }],
    amount_usd: 10,
    amount_lbp: 0,
    commission_usd: 0,
    commission_lbp: 0,
  };

  it.each([
    ["suppliers:settle-transactions", settleData, "settleTransactions"],
    ["suppliers:settle-account", accountData, "settleAccount"],
  ] as const)(
    "%s forwards covered_omt_service_types",
    async (channel, data, method) => {
      const r = await call(channel, {
        ...data,
        covered_omt_service_types: ["INTRA"],
      });
      expect(r).toEqual(expect.objectContaining({ success: true }));
      expect(service[method]).toHaveBeenCalledWith(
        expect.objectContaining({
          covered_omt_service_types: ["INTRA"],
          created_by: 9,
        }),
      );
    },
  );

  it.each([
    ["suppliers:settle-transactions", settleData, "settleTransactions"],
    ["suppliers:settle-account", accountData, "settleAccount"],
  ] as const)(
    "%s refuses an invalid value with an envelope",
    async (channel, data, method) => {
      const r = (await call(channel, {
        ...data,
        covered_omt_service_types: ["BOGUS"],
      })) as {
        success: boolean;
        error?: string;
      };
      expect(r.success).toBe(false);
      expect(typeof r.error).toBe("string");
      expect(service[method]).not.toHaveBeenCalled();
    },
  );
});
