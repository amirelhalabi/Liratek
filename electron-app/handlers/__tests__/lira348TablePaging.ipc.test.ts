/**
 * LIRA-348 — desktop twin of backend `lira348TablePaging.api.test.ts`:
 * `transactions:get-recent` and `audit:search` take the paging keys
 * (`validators/tablePaging.ts`), validate ONLY those keys, and forward every
 * other filter untouched (rule 23 — no schema is put in front of the keys
 * these channels already pass through).
 *
 * The forwarding cases could pass before the change (both handlers forward
 * their filters raw); the refusal cases are the failing-first proof (rule 17).
 */
import { ipcMain } from "electron";
import { registerTransactionHandlers } from "../transactionHandlers";
import { registerAuditHandlers } from "../auditHandlers";
import {
  getTransactionService,
  getAuditService,
  transactionPageFiltersSchema,
  auditPageFiltersSchema,
} from "@liratek/core";

jest.mock("electron", () => ({ ipcMain: { handle: jest.fn() } }));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getTransactionService: jest.fn(),
    getAuditService: jest.fn(),
    getReportingService: jest.fn(() => ({})),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(() => ({ ok: true, userId: 7 })),
}));
jest.mock("../auditHelper", () => ({ audit: jest.fn() }));

describe("LIRA-348 — paging keys on transactions:get-recent and audit:search", () => {
  const txn = { getRecent: jest.fn(() => []) };
  const auditSvc = { search: jest.fn(() => ({ rows: [], total: 0 })) };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    (getTransactionService as jest.Mock).mockReturnValue(txn);
    (getAuditService as jest.Mock).mockReturnValue(auditSvc);
    registerTransactionHandlers();
    registerAuditHandlers();
  });

  it("transactions:get-recent forwards the paging keys with the other filters", () => {
    const paging = transactionPageFiltersSchema.parse({
      day_from: "2026-10-26",
      day_to: "2026-10-26",
      before: { created_at: "2026-10-26 07:00:01", id: 41 },
    });
    handlers.get("transactions:get-recent")!({}, 150, {
      excludeTypes: ["CLIENT_CREATED"],
      ...paging,
    });
    expect(txn.getRecent).toHaveBeenCalledWith(150, {
      excludeTypes: ["CLIENT_CREATED"],
      ...paging,
    });
  });

  it("transactions:get-recent refuses a malformed day instead of ignoring it", () => {
    expect(() =>
      handlers.get("transactions:get-recent")!({}, 50, {
        day_from: "26/10/2026",
      }),
    ).toThrow();
    expect(txn.getRecent).not.toHaveBeenCalled();
  });

  it("audit:search forwards dayFrom/dayTo/beforeId with the other filters", async () => {
    const paging = auditPageFiltersSchema.parse({
      dayFrom: "2026-10-25",
      dayTo: "2026-10-26",
      beforeId: 900,
    });
    const res = await handlers.get("audit:search")!(
      { sender: { id: 1 } },
      { action: "VOID", limit: 50, ...paging },
    );
    expect(res).toEqual({ success: true, rows: [], total: 0 });
    expect(auditSvc.search).toHaveBeenCalledWith({
      action: "VOID",
      limit: 50,
      ...paging,
    });
  });

  it("audit:search refuses a malformed cursor with the envelope and never queries", async () => {
    const res = (await handlers.get("audit:search")!(
      { sender: { id: 1 } },
      { beforeId: -3 },
    )) as { success: boolean };
    expect(res.success).toBe(false);
    expect(auditSvc.search).not.toHaveBeenCalled();
  });
});
