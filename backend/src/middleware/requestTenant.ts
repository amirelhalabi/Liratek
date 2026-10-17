/**
 * Which tenant a request speaks for, for the app-wide subscription gates
 * (`requireOpenTrial`, `requireWritableSubscription`). Extracted from
 * `requireWritableSubscription.ts` (LIRA-332) so the two gates share ONE
 * resolution instead of two copies.
 *
 * `req.user` if some earlier middleware already authenticated (the case if a
 * gate is ever mounted per-router), otherwise decoded from the bearer token
 * with the SAME `verifyJwt` the auth middleware uses — not a second
 * verification of its own.
 *
 * That fallback is what makes a single global mount possible. Mounting a gate
 * app-wide BEFORE the routers means `req.user` is not populated yet, because
 * every router runs its own `authenticateJWT`; a version that only read
 * `req.user` would therefore see `undefined` on every request, fail open
 * every time, and enforce nothing at all — silently, with all its tests
 * passing. That is the same shape as the documented
 * `requireRole`-without-`requireAuth` trap.
 *
 * Never throws: a bearer that is not a valid LiraTek JWT (an expired token,
 * a device key someone put in the wrong header) resolves to `null`, and the
 * gates treat `null` as "no tenant" and fail open. Platform super-admin
 * tokens carry `tenantId: null`. Impersonation tokens carry the shop's id.
 *
 * One accepted imprecision: a token whose SESSION was revoked still carries a
 * real tenantId here, so a gate may refuse it rather than the auth layer
 * giving it a 401. Both are refusals, and validating the session a second
 * time would double every request's work to improve an error code.
 */

import type { Request } from "express";
import { verifyJwt } from "./auth.js";

export function resolveRequestTenantId(req: Request): number | null {
  if (req.user) return req.user.tenantId ?? null;

  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;

  try {
    const payload = verifyJwt(header.slice(7));
    return payload?.tenantId ?? null;
  } catch {
    return null;
  }
}
