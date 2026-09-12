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
