/**
 * LIRA-389 — desktop half of the Summary view and the list drill-down:
 *
 *  - `transactions:summary` validates its payload with the core schema
 *    (shared with REST) and hands the PARSED request to the core service,
 *    in the `{ success, data }` envelope; a bad payload is refused;
 *  - `transactions:get-recent` forwards the two drill-down keys
 *    (`sale_product_id`, `sale_category` — null included) after validating
 *    them with the core schema, and refuses a malformed one instead of
 *    silently widening the list (rule 23).
 *
 * Written before the handler changes (rule 17).
 */
import { ipcMain } from "electron";
import { registerTransactionHandlers } from "../transactionHandlers";
import {
  getTransactionService,
  getTransactionSummaryService,
  transactionSummarySchema,
  type TransactionSummaryInput,
} from "@liratek/core";

jest.mock("electron", () => ({ ipcMain: { handle: jest.fn() } }));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getTransactionService: jest.fn(),
    getTransactionSummaryService: jest.fn(),
    getReportingService: jest.fn(() => ({})),
    getUserRepository: jest.fn(),
  };
});

const requireRole = jest.fn((..._args: unknown[]) => ({
  ok: true,
  userId: 7,
  role: "staff",
}));
jest.mock("../../session", () => ({
  requireRole: (...args: unknown[]) => requireRole(...args),
}));
jest.mock("../auditHelper", () => ({ audit: jest.fn() }));

describe("LIRA-389 — transactions:summary and the list drill-down keys", () => {
  const txn = { getRecent: jest.fn(() => []) };
  const result = {
    group_by: "product",
    rows: [],
    total: { count: 0, units: 0, volume_usd: 0, volume_lbp: 0 },
    truncated: false,
  };
  const summary = { summarize: jest.fn(() => result) };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    (getTransactionService as jest.Mock).mockReturnValue(txn);
    (getTransactionSummaryService as jest.Mock).mockReturnValue(summary);
    registerTransactionHandlers();
  });

  const event = { sender: { id: 3 } };

  it("summarizes the parsed request, for every role", async () => {
    const payload: TransactionSummaryInput = {
      group_by: "product",
      options: [{ type: "SALE" }, { cash_only: true }],
      search: "laptop",
      day_from: "2026-11-01",
      day_to: "2026-11-30",
    };
    const res = await handlers.get("transactions:summary")!(event, payload);
    expect(res).toEqual({ success: true, data: result });
    expect(summary.summarize).toHaveBeenCalledWith(
      transactionSummarySchema.parse(payload),
    );
    expect(requireRole).toHaveBeenCalledWith(3, ["admin", "staff"]);
  });

  it("refuses a bad payload in the envelope", async () => {
    const res = (await handlers.get("transactions:summary")!(event, {
      group_by: "profit",
    })) as { success: boolean };
    expect(res.success).toBe(false);
    expect(summary.summarize).not.toHaveBeenCalled();
  });

  it("get-recent forwards the drill-down keys, null category included", () => {
    handlers.get("transactions:get-recent")!({}, 50, {
      search: "x",
      sale_product_id: 12,
    });
    expect(txn.getRecent).toHaveBeenLastCalledWith(50, {
      search: "x",
      sale_product_id: 12,
    });
    handlers.get("transactions:get-recent")!({}, 50, { sale_category: null });
    expect(txn.getRecent).toHaveBeenLastCalledWith(50, { sale_category: null });
  });

  it("get-recent refuses a malformed drill-down key", () => {
    expect(() =>
      handlers.get("transactions:get-recent")!({}, 50, {
        sale_product_id: "12; DROP",
      }),
    ).toThrow();
    expect(txn.getRecent).not.toHaveBeenCalled();
  });
});
