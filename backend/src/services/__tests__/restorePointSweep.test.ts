/**
 * LIRA-377 T028 — the restore-point sweep timer only schedules; the work is
 * core's `ShopRestoreService.sweep(now)` (covered in core). Written first,
 * red against a missing module (rule 17).
 */
import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../database/connection.js", () => ({
  getShopFilePort: () => null,
  getShopRestoreEnvironment: () => null,
}));
jest.mock("../../offline/processorTimer.js", () => ({ scheduleOfflineRound: jest.fn() }));

import type { ShopRestoreService } from "@liratek/core";
import { setShopRestoreServiceForTests } from "../../restore/restoreService.js";
import { runRestorePointSweepOnce, RESTORE_POINT_SWEEP_INTERVAL_MS } from "../restorePointSweep.js";

afterEach(() => setShopRestoreServiceForTests(undefined));

describe("restorePointSweep", () => {
  it("passes the current instant to the service sweep", () => {
    const sweep = jest.fn(() => ({ expired: 1, beforeCopiesDeleted: 0, workFilesDeleted: 0 }));
    setShopRestoreServiceForTests({ sweep } as unknown as ShopRestoreService);
    const before = Date.now();
    runRestorePointSweepOnce();
    expect(sweep).toHaveBeenCalledTimes(1);
    const at = Date.parse((sweep.mock.calls[0] as unknown as [string])[0]);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(RESTORE_POINT_SWEEP_INTERVAL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it("does nothing outside per-tenant mode", () => {
    setShopRestoreServiceForTests(null);
    expect(() => runRestorePointSweepOnce()).not.toThrow();
  });

  it("never throws when the sweep fails", () => {
    setShopRestoreServiceForTests({
      sweep: () => {
        throw new Error("disk gone");
      },
    } as unknown as ShopRestoreService);
    expect(() => runRestorePointSweepOnce()).not.toThrow();
  });
});
