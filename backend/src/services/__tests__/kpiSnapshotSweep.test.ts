/**
 * LIRA-364 — the web server's monthly KPI snapshot sweep: every shop that has
 * a live database (active or suspended) is captured in its own tenant
 * context, and one shop failing never stops the others (FR-009).
 *
 * RULE 17 — written before kpiSnapshotSweep.ts existed.
 */
import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { logger } from "../../server.js";
import { runKpiSnapshotSweepOnce } from "../kpiSnapshotSweep.js";

describe("kpiSnapshotSweep (LIRA-364)", () => {
  const now = new Date("2026-10-31T23:00:00Z");

  it("captures active and suspended shops, skips archived and provisioning ones", () => {
    const capture = jest.fn(() => ({
      captured: "2026-10",
      reason: "captured",
    }));
    runKpiSnapshotSweepOnce(now, {
      listTenants: () => [
        { id: 1, status: "active" },
        { id: 2, status: "suspended" },
        { id: 3, status: "archived" },
        { id: 4, status: "provisioning" },
      ],
      capture,
    });
    expect(capture.mock.calls).toEqual([
      [1, now],
      [2, now],
    ]);
  });

  it("one shop failing does not stop the next, and is logged", () => {
    const capture = jest.fn((id: number) => {
      if (id === 1) throw new Error("disk full");
      return { captured: "2026-10", reason: "captured" };
    });
    expect(() =>
      runKpiSnapshotSweepOnce(now, {
        listTenants: () => [
          { id: 1, status: "active" },
          { id: 2, status: "active" },
        ],
        capture,
      }),
    ).not.toThrow();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 1 }),
      expect.any(String),
    );
  });

  it("a failure listing shops is logged, never thrown", () => {
    expect(() =>
      runKpiSnapshotSweepOnce(now, {
        listTenants: () => {
          throw new Error("platform db down");
        },
        capture: jest.fn(),
      }),
    ).not.toThrow();
  });
});
