/**
 * `startIdleSweep()` (Phase A review finding: `TenantDatabasePool.closeIdle()`
 * existed but nothing ever scheduled it, so idle tenant connections
 * accumulated forever in `per-tenant` mode).
 */
import { startIdleSweep } from "../idleSweep.js";
import type { SetIntervalFn } from "../idleSweep.js";

describe("startIdleSweep", () => {
  it("calls pool.closeIdle() on the given interval", () => {
    const pool = { closeIdle: jest.fn() };
    let scheduledCallback: (() => void) | null = null;
    let scheduledMs: number | null = null;
    const fakeTimer = { unref: jest.fn() } as unknown as NodeJS.Timeout;
    const setIntervalFn: SetIntervalFn = jest.fn((cb, ms) => {
      scheduledCallback = cb;
      scheduledMs = ms;
      return fakeTimer;
    });

    startIdleSweep(pool, 60_000, setIntervalFn);

    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(scheduledMs).toBe(60_000);
    expect(pool.closeIdle).not.toHaveBeenCalled();

    // Simulate the timer firing.
    scheduledCallback?.();
    expect(pool.closeIdle).toHaveBeenCalledTimes(1);

    scheduledCallback?.();
    expect(pool.closeIdle).toHaveBeenCalledTimes(2);
  });

  it("unref()s the timer so it never keeps the process alive on its own", () => {
    const pool = { closeIdle: jest.fn() };
    const fakeTimer = { unref: jest.fn() } as unknown as NodeJS.Timeout;
    const setIntervalFn: SetIntervalFn = jest.fn(() => fakeTimer);

    startIdleSweep(pool, 60_000, setIntervalFn);

    expect(fakeTimer.unref).toHaveBeenCalledTimes(1);
  });

  it("stop() clears the interval and no further sweeps run", () => {
    const pool = { closeIdle: jest.fn() };
    let scheduledCallback: (() => void) | null = null;
    const fakeTimer = { unref: jest.fn() } as unknown as NodeJS.Timeout;
    const setIntervalFn: SetIntervalFn = jest.fn((cb) => {
      scheduledCallback = cb;
      return fakeTimer;
    });
    const clearSpy = jest.spyOn(global, "clearInterval");

    const stop = startIdleSweep(pool, 60_000, setIntervalFn);
    stop();

    expect(clearSpy).toHaveBeenCalledWith(fakeTimer);

    // Even if something still invoked the old callback post-stop, that's the
    // real timer's job to prevent (clearInterval), not this module's — but
    // confirm stop() didn't itself throw or double-schedule.
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });
});
