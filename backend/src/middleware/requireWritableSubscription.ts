/**
 * Block WRITES for a tenant whose subscription has lapsed to `read_only`.
 *
 * The whole enforcement model, in one middleware. Reads are never blocked:
 * a lapsed shop must always be able to see and export its own
 * `debt_ledger` — that is money its customers owe IT, and withholding it
 * turns a late payment into a furious ex-customer whose books you are
 * holding. That is an owner decision (D4: grace → read-only, never a
 * lockout), not an implementation convenience.
 *
 * FAILS OPEN on every uncertainty, for the same reason the desktop check
 * does: the failure that costs a customer money is worse than the one that
 * costs a licence fee. No tenant on the request, no subscription row, or a
 * thrown lookup all let the write through.
 */

import type { Request, Response, NextFunction } from "express";
import { getSubscriptionService } from "@liratek/core";
import { verifyJwt } from "./auth.js";
import { logger } from "../server.js";

/** Methods that can change data. Everything else is a read. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Paths that stay writable even in `read_only`, matched against the path
 * WITHIN the mounted router plus its mount point (`req.originalUrl`).
 *
 * This list is the entire difference between "read-only" and "locked out",
 * and it is one omission away from being wrong:
 *
 * - **auth**: refusing `POST /api/auth/login` would stop a lapsed shop from
 *   signing in to read the data D4 promises it can still read. Logout too —
 *   trapping someone in a session is not enforcement.
 * - **signup**: a brand-new tenant has no subscription row when it posts, so
 *   this could not be evaluated meaningfully anyway.
 * - **subscription/admin**: the shop must be able to enter a licence key and
 *   the owner must be able to mark it paid. Blocking the fix is how a
 *   read-only state becomes permanent.
 */
const ALWAYS_WRITABLE = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/signup",
  "/api/auth/signup-status",
  "/api/subscription",
  "/api/admin",
];

function isAlwaysWritable(originalUrl: string): boolean {
  // Compare against the path only — a query string must not smuggle a match
  // and must not prevent one either.
  const path = originalUrl.split("?")[0] ?? "";
  return ALWAYS_WRITABLE.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Which tenant is asking.
 *
 * `req.user` if some earlier middleware already authenticated (the case if
 * this is ever mounted per-router), otherwise decoded from the bearer token
 * with the SAME `verifyJwt` the auth middleware uses — not a second
 * verification of its own.
 *
 * That fallback is what makes a single global mount possible. Mounting this
 * app-wide BEFORE the routers means `req.user` is not populated yet, because
 * every router runs its own `authenticateJWT`; a version that only read
 * `req.user` would therefore see `undefined` on every request, fail open every
 * time, and enforce nothing at all — silently, with all its tests passing.
 * That is the same shape as the documented `requireRole`-without-`requireAuth`
 * trap.
 *
 * One accepted imprecision: a token whose SESSION was revoked still carries a
 * real tenantId here, so a lapsed tenant using a revoked token gets 402 rather
 * than the 401 the auth layer would have given it. Both are refusals, and the
 * alternative — validating the session a second time — would double every
 * request's work to improve an error code.
 */
function resolveTenantId(req: Request): number | null {
  if (req.user) return req.user.tenantId ?? null;

  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;

  const payload = verifyJwt(header.slice(7));
  return payload?.tenantId ?? null;
}

export function requireWritableSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!WRITE_METHODS.has(req.method)) return next();
  if (isAlwaysWritable(req.originalUrl)) return next();

  const tenantId = resolveTenantId(req);
  // No tenant on the request: either unauthenticated (some other middleware's
  // problem) or a platform user, who has no subscription to lapse.
  if (tenantId === null) return next();

  let canWrite = true;
  try {
    canWrite = getSubscriptionService().canWrite(tenantId);
  } catch (error) {
    // A failed lookup must not stop a shop trading.
    logger.error(
      { error, tenantId },
      "subscription check failed; allowing the write",
    );
    return next();
  }

  if (canWrite) return next();

  logger.warn(
    { tenantId, method: req.method, path: req.originalUrl },
    "write blocked: subscription is read-only",
  );

  // IPC-identical envelope, and HTTP 402 rather than 403: this is not a
  // permission the user could be granted by an admin, it is an account state.
  // The adapter branches on `success`, so the status code is informational --
  // but a distinct one makes this diagnosable in a log without opening bodies.
  res.status(402).json({
    success: false,
    error:
      "Your subscription has lapsed, so the app is read-only. " +
      "You can still view and export everything. Contact support to restore writing.",
    code: "SUBSCRIPTION_READ_ONLY",
  });
}
