/**
 * Pure helpers for the Signed-in Devices tab: a readable device name from the
 * browser's identity string, how long ago a session was last used, when a
 * session counts as stale, and grouping rows by user for the admin view.
 */
import type { SafeSession } from "@liratek/core";
import { parseDbDate } from "@/shared/utils/parseDbDate";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Idle longer than this and the row is faded as stale (owner decision). */
export const STALE_AFTER_MS = 3 * DAY;

// Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari".
const BROWSERS: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\/|FxiOS/, "Firefox"],
  [/Chrome\/|CriOS/, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

/** "Chrome on macOS" from a user-agent, or null when it is not one. */
export function deviceName(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? null;
}

export type ActivityAge = {
  unit: "now" | "minutes" | "hours" | "days";
  n: number;
};

/** How long ago a session was last used, in the largest whole unit. */
export function activityAge(lastActivityAt: string, now: number): ActivityAge {
  const ms = Math.max(0, now - parseDbDate(lastActivityAt).getTime());
  if (ms < MINUTE) return { unit: "now", n: 0 };
  if (ms < HOUR) return { unit: "minutes", n: Math.floor(ms / MINUTE) };
  if (ms < DAY) return { unit: "hours", n: Math.floor(ms / HOUR) };
  return { unit: "days", n: Math.floor(ms / DAY) };
}

export function isStale(lastActivityAt: string, now: number): boolean {
  return now - parseDbDate(lastActivityAt).getTime() > STALE_AFTER_MS;
}

export type UserSessionGroup = {
  userId: number;
  username: string | null;
  role: string | null;
  sessions: SafeSession[];
};

/** One group per user: the viewer's own first, then the rest by username.
 * Rows keep the server's order (most recent activity first). */
export function groupSessionsByUser(
  sessions: SafeSession[],
  viewerId: number | null,
): UserSessionGroup[] {
  const byUser = new Map<number, UserSessionGroup>();
  for (const s of sessions) {
    let group = byUser.get(s.user_id);
    if (!group) {
      group = {
        userId: s.user_id,
        username: s.username,
        role: s.role,
        sessions: [],
      };
      byUser.set(s.user_id, group);
    }
    group.sessions.push(s);
  }
  return [...byUser.values()].sort((a, b) => {
    if (a.userId === viewerId) return -1;
    if (b.userId === viewerId) return 1;
    return (a.username ?? "").localeCompare(b.username ?? "");
  });
}
