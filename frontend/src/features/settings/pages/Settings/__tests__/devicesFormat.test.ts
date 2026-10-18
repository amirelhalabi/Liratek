import type { SafeSession } from "@liratek/core";
import {
  activityAge,
  deviceName,
  groupSessionsByUser,
  isStale,
} from "../devicesFormat";

const NOW = new Date("2026-10-19T12:00:00.000Z").getTime();

function session(over: Partial<SafeSession>): SafeSession {
  return {
    id: 1,
    device_type: "web",
    device_info: null,
    ip_address: null,
    created_at: "2026-10-19 10:00:00",
    last_activity_at: "2026-10-19 11:59:50",
    expires_at: "2026-10-19 19:59:50",
    remember_me: false,
    user_id: 10,
    username: "amir",
    role: "admin",
    is_current: false,
    ...over,
  };
}

describe("deviceName", () => {
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "Chrome on macOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
      "Edge on Windows",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari on iPhone",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Firefox on Linux",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
      "Chrome on Android",
    ],
  ])("names %s", (ua, expected) => {
    expect(deviceName(ua)).toBe(expected);
  });

  it("returns null for text that is not a browser identity", () => {
    expect(deviceName("android phone")).toBeNull();
    expect(deviceName(null)).toBeNull();
  });
});

describe("activityAge", () => {
  it("reads under a minute as active now", () => {
    expect(activityAge("2026-10-19 11:59:30", NOW)).toEqual({
      unit: "now",
      n: 0,
    });
  });
  it("counts minutes, hours and days", () => {
    expect(activityAge("2026-10-19 11:53:00", NOW)).toEqual({
      unit: "minutes",
      n: 7,
    });
    expect(activityAge("2026-10-19 09:00:00", NOW)).toEqual({
      unit: "hours",
      n: 3,
    });
    expect(activityAge("2026-10-12 04:13:08", NOW)).toEqual({
      unit: "days",
      n: 7,
    });
  });
});

describe("isStale", () => {
  it("is true only after more than 3 days idle", () => {
    expect(isStale("2026-10-16 11:00:00", NOW)).toBe(true);
    expect(isStale("2026-10-16 13:00:00", NOW)).toBe(false);
  });
});

describe("groupSessionsByUser", () => {
  it("puts the viewer's own group first, then the others by username", () => {
    const groups = groupSessionsByUser(
      [
        session({ id: 1, user_id: 20, username: "rami", role: "staff" }),
        session({ id: 2, user_id: 10, is_current: true }),
        session({ id: 3, user_id: 30, username: "bilal", role: "staff" }),
        session({ id: 4, user_id: 20, username: "rami", role: "staff" }),
      ],
      10,
    );
    expect(groups.map((g) => g.userId)).toEqual([10, 30, 20]);
    expect(groups[2].sessions.map((s) => s.id)).toEqual([1, 4]);
    expect(groups[2]).toMatchObject({ username: "rami", role: "staff" });
  });
});
