/**
 * The auth-row cleanup timer: runs the core sweep with the current time,
 * logs counts, and never lets a failure escape the interval.
 */
const mockSweepAll = jest.fn();

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("@liratek/core", () => ({
  getAuthTokenCleanupService: () => ({ sweepAll: mockSweepAll }),
}));

import { logger } from "../../server.js";
import {
  AUTH_CLEANUP_BOOT_DELAY_MS,
  AUTH_CLEANUP_INTERVAL_MS,
  runAuthCleanupOnce,
  startAuthCleanupSweep,
  stopAuthCleanupSweep,
} from "../authCleanupSweep.js";

const EMPTY = {
  signinCodes: 0,
  ssoHandoffTokens: 0,
  passwordResetTokens: 0,
  emailVerificationTokens: 0,
  sweptDatabaseCount: 1,
  platformFailed: false,
  failedTenantIds: [] as number[],
};

describe("authCleanupSweep", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSweepAll.mockReturnValue(EMPTY);
  });

  afterEach(() => {
    stopAuthCleanupSweep();
    jest.useRealTimers();
  });

  it("passes the current time as an ISO string and logs counts at info", () => {
    mockSweepAll.mockReturnValue({ ...EMPTY, signinCodes: 3, passwordResetTokens: 2 });
    runAuthCleanupOnce();

    const [now] = mockSweepAll.mock.calls[0] as [string];
    expect(new Date(now).toISOString()).toBe(now);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ signinCodes: 3, passwordResetTokens: 2 }),
      "auth token cleanup completed",
    );
  });

  it("stays quiet when nothing was deleted and nothing failed", () => {
    runAuthCleanupOnce();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs when a database failed even if nothing was deleted", () => {
    mockSweepAll.mockReturnValue({ ...EMPTY, failedTenantIds: [9] });
    runAuthCleanupOnce();
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it("never throws: a failing sweep is logged as an error", () => {
    mockSweepAll.mockImplementation(() => {
      throw new Error("db gone");
    });
    expect(() => runAuthCleanupOnce()).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      "auth token cleanup failed",
    );
  });

  it("runs once shortly after boot, then hourly; stop clears both timers", () => {
    jest.useFakeTimers();
    expect(AUTH_CLEANUP_INTERVAL_MS).toBe(60 * 60 * 1000);

    startAuthCleanupSweep();
    expect(mockSweepAll).not.toHaveBeenCalled();

    jest.advanceTimersByTime(AUTH_CLEANUP_BOOT_DELAY_MS);
    expect(mockSweepAll).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(AUTH_CLEANUP_INTERVAL_MS);
    expect(mockSweepAll).toHaveBeenCalledTimes(2);

    stopAuthCleanupSweep();
    jest.advanceTimersByTime(3 * AUTH_CLEANUP_INTERVAL_MS);
    expect(mockSweepAll).toHaveBeenCalledTimes(2);
  });

  it("stopping before the boot run fires cancels it too", () => {
    jest.useFakeTimers();
    startAuthCleanupSweep();
    stopAuthCleanupSweep();
    jest.advanceTimersByTime(AUTH_CLEANUP_BOOT_DELAY_MS + AUTH_CLEANUP_INTERVAL_MS);
    expect(mockSweepAll).not.toHaveBeenCalled();
  });
});
