/**
 * `isProfitsUnlockLive` — the single TTL predicate extracted (rule 14) from
 * three previously-duplicated copies: `electron-app/session.ts`
 * `hasProfitsUnlock`, and `backend/src/middleware/profitsUnlock.ts`'s own
 * `hasProfitsUnlock` and `sweepExpired`. See `../profitsAccess.ts` for the
 * exact documented semantics (boundary is EXPIRED, future stamp is LIVE).
 */
import {
  isProfitsUnlockLive,
  PROFITS_UNLOCK_TTL_MS,
  canIncludeProfit,
} from "../profitsAccess.js";

describe("isProfitsUnlockLive", () => {
  const NOW = 1_000_000_000_000; // arbitrary fixed epoch ms

  it("returns false when unlockedAt is undefined (never unlocked)", () => {
    expect(isProfitsUnlockLive(undefined, NOW)).toBe(false);
  });

  it("returns false when unlockedAt is null", () => {
    expect(isProfitsUnlockLive(null, NOW)).toBe(false);
  });

  it("returns true well inside the TTL window", () => {
    const unlockedAt = NOW - 1000; // 1s ago, TTL is 15 minutes
    expect(isProfitsUnlockLive(unlockedAt, NOW)).toBe(true);
  });

  it("returns true one millisecond before the boundary", () => {
    const unlockedAt = NOW - (PROFITS_UNLOCK_TTL_MS - 1);
    expect(isProfitsUnlockLive(unlockedAt, NOW)).toBe(true);
  });

  it("returns false EXACTLY at the boundary (strict < , not <=)", () => {
    const unlockedAt = NOW - PROFITS_UNLOCK_TTL_MS;
    expect(isProfitsUnlockLive(unlockedAt, NOW)).toBe(false);
  });

  it("returns false well past the boundary", () => {
    const unlockedAt = NOW - (PROFITS_UNLOCK_TTL_MS + 60_000);
    expect(isProfitsUnlockLive(unlockedAt, NOW)).toBe(false);
  });

  it("treats a future stamp (server clock skew) as live", () => {
    const unlockedAt = NOW + 5000; // unlockedAt is after "now"
    expect(isProfitsUnlockLive(unlockedAt, NOW)).toBe(true);
  });

  it("defaults `now` to Date.now() when omitted", () => {
    const unlockedAt = Date.now() - 1000;
    expect(isProfitsUnlockLive(unlockedAt)).toBe(true);
  });
});

/**
 * LIRA-219 (E-Q6) — the "admin OR unlocked" predicate for the closing
 * checkpoint's profit block. Deliberately looser than `isProfitsUnlockLive`
 * alone / `requireProfitsAccess` (the /profits page's own "everyone types
 * the password" gate) — an admin always sees it, staff only after unlocking.
 */
describe("canIncludeProfit", () => {
  it("is true for an admin who has NOT unlocked Profits", () => {
    expect(canIncludeProfit("admin", false)).toBe(true);
  });

  it("is true for an admin who HAS unlocked Profits", () => {
    expect(canIncludeProfit("admin", true)).toBe(true);
  });

  it("is true for staff who HAVE unlocked Profits", () => {
    expect(canIncludeProfit("staff", true)).toBe(true);
  });

  it("is false for staff who have NOT unlocked Profits", () => {
    expect(canIncludeProfit("staff", false)).toBe(false);
  });

  it("fails closed for an unrecognized role, even when unlocked=false", () => {
    expect(canIncludeProfit("guest", false)).toBe(false);
  });

  it("fails closed for a null/undefined role when not unlocked", () => {
    expect(canIncludeProfit(null, false)).toBe(false);
    expect(canIncludeProfit(undefined, false)).toBe(false);
  });

  it("an unlocked non-admin role still passes (unlock alone is sufficient)", () => {
    expect(canIncludeProfit("guest", true)).toBe(true);
  });
});
