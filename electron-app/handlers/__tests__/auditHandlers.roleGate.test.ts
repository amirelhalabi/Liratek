/**
 * audit:get-recent / audit:search / audit:get-by-entity — IPC role-gate test
 * (LIRA-198 desktop half). REST twin: `../../../backend/src/api/__tests__/
 * auditRoleGate.api.test.ts`, which exercises `GET /api/audit/recent`,
 * `POST /api/audit/search` and `GET /api/audit/by-entity`. Rule 19c requires
 * the two role sets to match byte-for-byte; this file is the IPC side of
 * that proof, which previously had ZERO coverage even though the REST side
 * had 5 of its 10 cases on this exact channel set.
 *
 * Harness copied from the named precedent,
 * `inventoryHandlers.categorySupplierRoleGate.test.ts`: mock `electron`'s
 * `ipcMain.handle` to capture each registered handler by channel name, mock
 * `../../session`'s `requireRole` to flip between an accepting and a
 * refusing stub, and mock `@liratek/core` via `jest.requireActual` + one
 * override (`getAuditService`) so everything else in core stays real.
 *
 * ONE DELIBERATE DEVIATION from that precedent, stated up front so it is not
 * read as an oversight: the precedent's whole point is a WRITE channel
 * (`inventory:create-category` etc.) that had no gate at all. `auditHandlers.ts`
 * registers no write channels — its own docblock states audit rows are
 * written server-side by `auditHelper.ts`, never by the renderer — so there
 * is no write channel here to assert "still REFUSED" against. The negative
 * proof this file gives instead is the read-only equivalent: a caller who is
 * NEITHER admin NOR staff (e.g. a "cashier"-only session, or no session) is
 * refused on EVERY read channel this file registers, and the underlying
 * service method is never reached — i.e. `requireRole` is a real gate here,
 * not a no-op the handler ignores.
 *
 * Rule 17 (CLAUDE.md) / rule 24 status — UNVERIFIED, stated honestly: this
 * batch's process rules forbid running yarn test/jest in this phase (gates
 * run once, at the end, by the orchestrator), so the failing-first proof —
 * temporarily reverting `audit:get-recent`/`audit:search` in
 * `auditHandlers.ts` from `requireRole(e.sender.id, ["admin", "staff"])`
 * back to `["admin"])`, running this file, and confirming the two "widened
 * channel" cases below fail (their `requireRole` mock returns `{ ok: false }`
 * and the service spy sees `Number of calls: 0`), then reverting back and
 * re-confirming green — has NOT been executed. Do not read a future green
 * run of this file as proof of anything until that revert/run/revert has
 * actually happened and this paragraph has been replaced with what was
 * observed.
 */

import { ipcMain } from "electron";
import { registerAuditHandlers } from "../auditHandlers";
import { getAuditService } from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getAuditService: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

describe("audit:get-recent / audit:search / audit:get-by-entity — role gate", () => {
  const mockAuditService = {
    getRecent: jest.fn(),
    search: jest.fn(),
    getByEntity: jest.fn(),
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    (getAuditService as jest.Mock).mockReturnValue(mockAuditService);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerAuditHandlers();
  });

  const forbidden = () =>
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden",
    });

  describe("widened channels (this ticket) — staff must be ACCEPTED", () => {
    it("audit:get-recent accepts a staff caller and calls the service", async () => {
      mockAuditService.getRecent.mockReturnValue([{ id: 1 }]);
      const handler = handlers.get("audit:get-recent")!;

      const result = await handler({ sender: { id: 1 } }, 10);

      expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
      expect(mockAuditService.getRecent).toHaveBeenCalledWith(10);
      expect(result).toEqual({ success: true, rows: [{ id: 1 }] });
    });

    it("audit:search accepts a staff caller and calls the service", async () => {
      mockAuditService.search.mockReturnValue({ rows: [], total: 0 });
      const handler = handlers.get("audit:search")!;
      const filters = { entityType: "transaction" };

      const result = await handler({ sender: { id: 1 } }, filters);

      expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
      expect(mockAuditService.search).toHaveBeenCalledWith(filters);
      expect(result).toEqual({ success: true, rows: [], total: 0 });
    });
  });

  describe("audit:get-by-entity (characterization — already admin+staff pre-fix, not itself widened)", () => {
    it("accepts a staff caller and calls the service", async () => {
      mockAuditService.getByEntity.mockReturnValue([{ id: 2 }]);
      const handler = handlers.get("audit:get-by-entity")!;

      const result = await handler({ sender: { id: 1 } }, "transaction", "5");

      expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
      expect(mockAuditService.getByEntity).toHaveBeenCalledWith(
        "transaction",
        "5",
      );
      expect(result).toEqual({ success: true, rows: [{ id: 2 }] });
    });
  });

  it("admin still passes all three channels (not over-tightened)", async () => {
    mockAuditService.getRecent.mockReturnValue([]);
    mockAuditService.search.mockReturnValue({ rows: [], total: 0 });
    mockAuditService.getByEntity.mockReturnValue([]);

    const getRecentResult = await handlers.get("audit:get-recent")!(
      { sender: { id: 1 } },
      undefined,
    );
    const searchResult = await handlers.get("audit:search")!(
      { sender: { id: 1 } },
      {},
    );
    const getByEntityResult = await handlers.get("audit:get-by-entity")!(
      { sender: { id: 1 } },
      "transaction",
      "5",
    );

    expect((getRecentResult as { success: boolean }).success).toBe(true);
    expect((searchResult as { success: boolean }).success).toBe(true);
    expect((getByEntityResult as { success: boolean }).success).toBe(true);
  });

  it("a caller who is NEITHER admin NOR staff is refused on every read channel, WITHOUT the service ever being reached", async () => {
    forbidden();

    const getRecentResult = await handlers.get("audit:get-recent")!(
      { sender: { id: 1 } },
      undefined,
    );
    const searchResult = await handlers.get("audit:search")!(
      { sender: { id: 1 } },
      {},
    );
    const getByEntityResult = await handlers.get("audit:get-by-entity")!(
      { sender: { id: 1 } },
      "transaction",
      "5",
    );

    expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
    expect(mockAuditService.getRecent).not.toHaveBeenCalled();
    expect(mockAuditService.search).not.toHaveBeenCalled();
    expect(mockAuditService.getByEntity).not.toHaveBeenCalled();
    expect(getRecentResult).toEqual({ success: false, error: "Forbidden" });
    expect(searchResult).toEqual({ success: false, error: "Forbidden" });
    expect(getByEntityResult).toEqual({ success: false, error: "Forbidden" });
  });
});
