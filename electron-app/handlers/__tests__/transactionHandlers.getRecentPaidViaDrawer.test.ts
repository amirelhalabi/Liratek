/**
 * LIRA-323 — IPC parity for the Type filter's `paid_via_drawer` key:
 * `transactions:get-recent` forwards the `typeFilters` tuples to the SAME
 * service the REST route uses, with `paid_via_drawer` intact. The fixture is
 * parsed through the shared core schema first (rule 24), so the field name
 * comes from the schema, not from this file.
 *
 * Rule 17 disclosure: the IPC handler never validated `filters` (it passes
 * them straight through), so this could not fail before the change — it is
 * a guard that a schema put in front of this channel later (rule 23) keeps
 * the key. The failing-first proofs are the core repository test and the
 * REST route test (backend transactionsRecent.api.test.ts).
 */

import { ipcMain } from "electron";
import { registerTransactionHandlers } from "../transactionHandlers";
import {
  getTransactionService,
  transactionTypeFiltersSchema,
} from "@liratek/core";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getTransactionService: jest.fn(),
    getReportingService: jest.fn(() => ({})),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(() => ({ ok: true, userId: 7 })),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("transactions:get-recent — paid_via_drawer forwarding (LIRA-323)", () => {
  const mockTxnService = { getRecent: jest.fn(() => []) };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    (getTransactionService as jest.Mock).mockReturnValue(mockTxnService);
    registerTransactionHandlers();
  });

  it("passes the typeFilters tuple through with paid_via_drawer intact", () => {
    const typeFilters = transactionTypeFiltersSchema.parse([
      {
        type: "FINANCIAL_SERVICE",
        provider: "OMT_APP",
        service_type: "SEND",
        paid_via_drawer: "OMT_App",
      },
    ]);
    expect(typeFilters[0]?.paid_via_drawer).toBe("OMT_App");

    handlers.get("transactions:get-recent")!({}, 50, { typeFilters });

    expect(mockTxnService.getRecent).toHaveBeenCalledWith(50, {
      typeFilters,
    });
  });
});
