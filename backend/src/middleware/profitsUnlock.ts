/**
 * Profits password gate — server-side unlock tracking (frozen contract,
 * agent C's slice: `PROFITS_GATE_CONTRACT.md`).
 *
 * A correct `POST /api/profits/unlock` grants the calling user a rolling
 * `PROFITS_UNLOCK_TTL_MS` window during which `requireProfitsUnlock` lets
 * `/api/profits/*` data routes through without re-entering the password.
 * Navigating away from `/profits` on the client revokes it immediately via
 * `POST /api/profits/lock`; letting the TTL lapse without an explicit lock
 * revokes it lazily (the next gated request just fails `hasProfitsUnlock`).
 *
 * State lives in a module-level `Map<string, number>` keyed
 * `${tenantId}:${userId}` -> unlock timestamp (epoch ms). This mirrors the
 * rest of this codebase: `server.ts` runs no clustering and
 * `express-rate-limit` (`rateLimit.ts`) already keeps its counters in an
 * in-memory store the same way. IMPORTANT: this makes an unlock per-process
 * — if the backend is ever run behind multiple worker processes (e.g. Node
 * cluster, PM2 cluster mode, multiple containers behind a load balancer),
 * an unlock granted on one worker will NOT be visible on requests routed to
 * another worker. Moving to shared storage (Redis, a DB table) would be
 * required before that deployment shape is safe.
 */
import { Response, NextFunction } from "express";
import { PROFITS_UNLOCK_TTL_MS } from "@liratek/core";
import type { AuthRequest } from "./auth.js";

/** `${tenantId}:${userId}` -> unlock timestamp (epoch ms). Per-process only — see file header. */
const unlocks = new Map<string, number>();

function unlockKey(
  tenantId: number | null | undefined,
  userId: number,
): string {
  return `${tenantId ?? "null"}:${userId}`;
}

/**
 * Drop every entry whose TTL has already lapsed. Called opportunistically on
 * each grant so the map cannot grow without bound across the process
 * lifetime (a lock/unmount also removes its own entry, but an unlock that
 * simply expires without an explicit lock would otherwise linger forever).
 */
function sweepExpired(now: number): void {
  for (const [key, stamp] of unlocks) {
    if (now - stamp >= PROFITS_UNLOCK_TTL_MS) {
      unlocks.delete(key);
    }
  }
}

/** Grant (or refresh) a profits unlock for this tenant+user. `now` is injectable for tests. */
export function grantProfitsUnlock(
  tenantId: number | null | undefined,
  userId: number,
  now: number = Date.now(),
): void {
  sweepExpired(now);
  unlocks.set(unlockKey(tenantId, userId), now);
}

/** Revoke a profits unlock immediately (client unmount / explicit lock). */
export function revokeProfitsUnlock(
  tenantId: number | null | undefined,
  userId: number,
): void {
  unlocks.delete(unlockKey(tenantId, userId));
}

/** True while a still-live unlock exists for this tenant+user. `now` is injectable for tests. */
export function hasProfitsUnlock(
  tenantId: number | null | undefined,
  userId: number,
  now: number = Date.now(),
): boolean {
  const stamp = unlocks.get(unlockKey(tenantId, userId));
  if (stamp === undefined) return false;
  return now - stamp < PROFITS_UNLOCK_TTL_MS;
}

/**
 * Route guard for the 7 profit data endpoints. Mount AFTER `authenticateJWT`
 * (same constraint as `requireRole` — it only reads `req.user`, it does not
 * itself authenticate).
 *
 * 401 when there is no authenticated user at all; 403 `"Profits locked"`
 * when the user IS authenticated but has no live unlock — this is the one
 * router in the app where a role check does not gate these routes at all
 * (rule: admin no longer passes on role alone, everyone types the password).
 */
export function requireProfitsUnlock(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: "Not authenticated" });
    return;
  }

  if (!hasProfitsUnlock(req.user.tenantId, req.user.userId)) {
    res.status(403).json({ success: false, error: "Profits locked" });
    return;
  }

  next();
}
