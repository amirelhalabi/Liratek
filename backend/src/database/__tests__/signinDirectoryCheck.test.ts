/**
 * LIRA-288 T019/T020 — the sign-in directory's operator command and boot
 * drift check (database/signinDirectoryCheck.ts). The directory service is
 * a fake here; its own diff/rebuild are proven against real files in core's
 * SigninDirectoryService.test.ts.
 *
 *   - command, dry run (default): prints {missing, extra, stale,
 *     failedTenantIds} as JSON; exit 1 when anything differs or a shop could
 *     not be read, 0 when clean; never writes;
 *   - command, --write: rebuilds and prints the counts; exit 1 only if a
 *     shop could not be read;
 *   - boot check: logs a WARNING (never throws, never fixes) when the
 *     directory differs; silent when clean; runs once, after a delay, and
 *     never holds the process open.
 */
import {
  checkSigninDirectory,
  runSigninDirectoryCommand,
  scheduleSigninDirectoryCheck,
  type SigninDirectoryCommandService,
} from "../signinDirectoryCheck.js";

const ROW = {
  kind: "email" as const,
  value: "rami@gmail.com",
  target_tenant_id: 2,
  target_user_id: 21,
  username: "rami",
  display_email: null,
};

function fakeService(
  diff: ReturnType<SigninDirectoryCommandService["diff"]>,
): SigninDirectoryCommandService & { rebuildAll: jest.Mock; diff: jest.Mock } {
  return {
    diff: jest.fn(() => diff),
    rebuildAll: jest.fn(() => ({ shops: 3, rows: 5, failedTenantIds: [] })),
  };
}

const CLEAN = { missing: [], extra: [], stale: [], failedTenantIds: [] };
const DRIFT = { missing: [ROW], extra: [], stale: [], failedTenantIds: [] };

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, write: (s: string) => out.push(s), error: (s: string) => err.push(s) };
}

describe("runSigninDirectoryCommand", () => {
  it("dry run, clean: prints the empty diff, exit 0, writes nothing", () => {
    const svc = fakeService(CLEAN);
    const p = io();
    expect(runSigninDirectoryCommand([], svc, "2026-10-08T12:00:00.000Z", p)).toBe(0);
    expect(JSON.parse(p.out.join(""))).toEqual(CLEAN);
    expect(svc.rebuildAll).not.toHaveBeenCalled();
  });

  it("dry run, drift: prints it, exit 1, writes nothing", () => {
    const svc = fakeService(DRIFT);
    const p = io();
    expect(runSigninDirectoryCommand([], svc, "2026-10-08T12:00:00.000Z", p)).toBe(1);
    expect(JSON.parse(p.out.join("")).missing).toEqual([ROW]);
    expect(svc.rebuildAll).not.toHaveBeenCalled();
  });

  it("dry run, an unreadable shop is a failure too (exit 1)", () => {
    const p = io();
    expect(
      runSigninDirectoryCommand([], fakeService({ ...CLEAN, failedTenantIds: [4] }), "x", p),
    ).toBe(1);
  });

  it("--write rebuilds with the given now and prints the counts, exit 0", () => {
    const svc = fakeService(DRIFT);
    const p = io();
    expect(runSigninDirectoryCommand(["--write"], svc, "2026-10-08T12:00:00.000Z", p)).toBe(0);
    expect(svc.rebuildAll).toHaveBeenCalledWith("2026-10-08T12:00:00.000Z");
    expect(JSON.parse(p.out.join(""))).toEqual({ shops: 3, rows: 5, failedTenantIds: [] });
  });

  it("an unknown argument prints the usage, exit 2", () => {
    const p = io();
    expect(runSigninDirectoryCommand(["--wirte"], fakeService(CLEAN), "x", p)).toBe(2);
    expect(p.err.join("")).toMatch(/usage/i);
  });
});

describe("boot drift check", () => {
  const logger = () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() });

  it("warns with the counts when the directory differs; never fixes it", () => {
    const log = logger();
    const svc = fakeService(DRIFT);
    expect(checkSigninDirectory(svc, log)).toEqual({ ok: false, missing: 1, extra: 0, stale: 0, failedTenantIds: [] });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![0]).toMatchObject({ missing: 1, extra: 0, stale: 0 });
    expect(svc.rebuildAll).not.toHaveBeenCalled();
  });

  it("is silent at warn level when clean", () => {
    const log = logger();
    expect(checkSigninDirectory(fakeService(CLEAN), log).ok).toBe(true);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("never throws: a failing diff is logged", () => {
    const log = logger();
    const svc = fakeService(CLEAN);
    svc.diff.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => checkSigninDirectory(svc, log)).not.toThrow();
    expect(log.error).toHaveBeenCalled();
  });

  it("runs once after the delay, on a timer that never holds the process open", () => {
    jest.useFakeTimers();
    try {
      const log = logger();
      const svc = fakeService(DRIFT);
      const stop = scheduleSigninDirectoryCheck(svc, log, 1000);
      expect(svc.diff).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1000);
      expect(svc.diff).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(10_000);
      expect(svc.diff).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      jest.useRealTimers();
    }
  });
});
