/**
 * LIRA-364 — the desktop side of the monthly KPI snapshot: a standalone shop
 * captures at start-up (before any handler can save a sale) and then hourly; a
 * PC paired with a web shop never captures, because the server's snapshot is
 * the shop's one.
 *
 * RULE 17 — written before kpiSnapshotTimer.ts existed.
 */
jest.mock("@liratek/core", () => ({
  getKpiSnapshotService: jest.fn(),
  kpiLogger: { info: jest.fn(), error: jest.fn() },
}));

import { kpiLogger } from "@liratek/core";
import {
  startKpiSnapshotTimer,
  stopKpiSnapshotTimer,
} from "../kpiSnapshotTimer";

describe("kpiSnapshotTimer (LIRA-364)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    stopKpiSnapshotTimer();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("standalone: captures at once, synchronously, then every hour", () => {
    const capture = jest.fn();
    startKpiSnapshotTimer({ standalone: true, capture });
    expect(capture).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60 * 60 * 1000);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("paired with a web shop: never captures", () => {
    const capture = jest.fn();
    startKpiSnapshotTimer({ standalone: false, capture });
    jest.advanceTimersByTime(3 * 60 * 60 * 1000);
    expect(capture).not.toHaveBeenCalled();
  });

  it("a failed capture is logged and never stops the app", () => {
    const capture = jest.fn(() => {
      throw new Error("locked");
    });
    expect(() =>
      startKpiSnapshotTimer({ standalone: true, capture }),
    ).not.toThrow();
    expect(kpiLogger.error).toHaveBeenCalled();
  });
});
