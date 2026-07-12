/**
 * Regression test for parseDbDate.
 *
 * SQLite CURRENT_TIMESTAMP writes UTC values with no timezone marker
 * ("YYYY-MM-DD HH:MM:SS"). A plain `new Date(iso)` on that string is
 * interpreted by the JS engine as *local* time, silently shifting every
 * checkpoint/transaction time by the viewer's UTC offset (e.g. 3h off in
 * Beirut, UTC+3). This is exactly the bug reported against the Checkpoint
 * Timeline: the Dashboard used parseDbDate and showed the correct time,
 * while the Timeline used a bare `new Date(iso)` and showed the wrong one.
 *
 * These assertions use toISOString() (always UTC) so they hold regardless
 * of the timezone the test runner happens to be in.
 */
import { parseDbDate } from "../parseDbDate";

describe("parseDbDate", () => {
  it("pins a bare SQLite CURRENT_TIMESTAMP string to UTC", () => {
    expect(parseDbDate("2026-07-11 15:40:00").toISOString()).toBe(
      "2026-07-11T15:40:00.000Z",
    );
  });

  it("pins a bare ISO string (T separator, no zone) to UTC the same way", () => {
    expect(parseDbDate("2026-07-11T15:40:00").toISOString()).toBe(
      "2026-07-11T15:40:00.000Z",
    );
  });

  it("does NOT reinterpret a timestamp that already carries a Z", () => {
    expect(parseDbDate("2026-07-11T15:40:00Z").toISOString()).toBe(
      "2026-07-11T15:40:00.000Z",
    );
  });

  it("does NOT reinterpret a timestamp that already carries an offset", () => {
    expect(parseDbDate("2026-07-11T18:40:00+03:00").toISOString()).toBe(
      "2026-07-11T15:40:00.000Z",
    );
  });

  it("disagrees with naive `new Date(iso)` parsing outside UTC — the exact regression", () => {
    // In any timezone that isn't UTC, treating the bare string as local
    // instead of UTC changes the resulting instant. This is the failure
    // mode the buggy `formatTime` (`new Date(iso)` with no parseDbDate)
    // exhibited before the fix.
    const bare = "2026-07-11 15:40:00";
    const naive = new Date(bare);
    const pinned = parseDbDate(bare);
    if (new Date().getTimezoneOffset() !== 0) {
      expect(pinned.getTime()).not.toBe(naive.getTime());
    }
    expect(pinned.toISOString()).toBe("2026-07-11T15:40:00.000Z");
  });
});
