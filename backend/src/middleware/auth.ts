import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { logger } from "../server.js";
import { getAuthService, runWithTenant, JWT_SECRET } from "@liratek/core";
import type { SafeUser } from "@liratek/core";

/**
 * JWT payload v2 (multi-tenant — plan §3).
 *
 * `userId` is always the EFFECTIVE identity (whose data/permissions apply);
 * `impersonatorId` is always the real super admin behind it, present ONLY on
 * impersonation tokens (minted in WP6). Legacy v1 tokens ({userId, role}
 * signed without a sessionToken, or without a tenantId claim) are REJECTED —
 * every accepted token maps to a revocable DB session row.
 */
export interface LiratekJwtPayload {
  userId: number;
  role: "super_admin" | "admin" | "staff";
  /** Mandatory — links the JWT to a DB session row. Signature-only tokens are rejected. */
  sessionToken: string;
  /** null ONLY for super_admin (platform realm). */
  tenantId: number | null;
  /** Present ONLY on impersonation tokens — the real super admin's user id. */
  impersonatorId?: number;
}

/** Shape attached to `req.user` after successful authentication. */
export interface AuthenticatedUser {
  userId: number;
  username: string;
  role: "super_admin" | "admin" | "staff";
  tenantId: number | null;
  sessionToken: string;
  impersonatorId?: number;
}

// Extend Express Request to include user from JWT auth
declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
  }
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * Validate the decoded JWT into the strict v2 payload shape.
 * Returns null for anything malformed — including the two legacy holes:
 *   - tokens without a `sessionToken` (signature-only, no revocable session)
 *   - tokens without a `tenantId` claim (pre-multi-tenant; force re-login
 *     rather than guessing a tenant)
 * Also enforces realm consistency: `tenantId === null` ⟺ `role === 'super_admin'`.
 */
function parseJwtPayload(decoded: unknown): LiratekJwtPayload | null {
  if (typeof decoded !== "object" || decoded === null) return null;
  const d = decoded as Record<string, unknown>;

  if (typeof d.userId !== "number") return null;
  if (d.role !== "super_admin" && d.role !== "admin" && d.role !== "staff") {
    return null;
  }
  // Legacy hole closed: a JWT without a sessionToken is rejected — every
  // request must validate against a revocable DB session.
  if (typeof d.sessionToken !== "string" || d.sessionToken.length === 0) {
    return null;
  }
  const tenantId = d.tenantId;
  if (tenantId !== null && typeof tenantId !== "number") return null;
  // Realm consistency: platform tokens (tenantId null) are exactly the
  // super_admin ones; every tenant role carries a concrete tenant id.
  if ((tenantId === null) !== (d.role === "super_admin")) return null;

  const impersonatorId =
    typeof d.impersonatorId === "number" ? d.impersonatorId : undefined;

  return {
    userId: d.userId,
    role: d.role,
    sessionToken: d.sessionToken,
    tenantId,
    ...(impersonatorId !== undefined ? { impersonatorId } : {}),
  };
}

/**
 * Verify a raw JWT string against `JWT_SECRET` and parse it into the strict
 * v2 payload shape (see `parseJwtPayload`). Returns `null` for ANY failure —
 * bad/expired signature, or a payload that doesn't match the v2 shape
 * (missing `sessionToken`, missing/mismatched `tenantId`, legacy v1 token).
 *
 * Shared by `authenticateJWT` (HTTP, below) and the Socket.IO handshake
 * middleware (`backend/src/websocket/io.ts`) so both paths decode the same
 * way with the same secret — one place to fix if the payload shape changes.
 *
 * Callers that need the revocable-session guarantee (any HTTP route) MUST
 * additionally call `authService.validateSession(payload.sessionToken)` —
 * this function only proves the token is signed and well-shaped, not that
 * the session behind it is still active.
 *
 * Does not check `JWT_SECRET` presence — callers should handle that config
 * error themselves (see `authenticateJWT`'s explicit check, which returns a
 * distinct 500 rather than folding into this function's generic `null`).
 */
export function verifyJwt(token: string): LiratekJwtPayload | null {
  if (!JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return parseJwtPayload(decoded);
  } catch {
    return null;
  }
}

export function authenticateJWT(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token provided" });
    return;
  }

  const token = authHeader.substring(7);

  try {
    if (!JWT_SECRET) {
      logger.error("JWT_SECRET not configured");
      res.status(500).json({ error: "Server configuration error" });
      return;
    }

    const payload = verifyJwt(token);
    if (!payload) {
      logger.warn("Rejected JWT with invalid or legacy payload shape");
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    // Every request validates the DB session — no signature-only fast path.
    const authService = getAuthService();
    authService
      .validateSession(payload.sessionToken)
      .then((user: SafeUser | null) => {
        if (!user) {
          logger.warn({ userId: payload.userId }, "Session expired or invalid");
          res.status(401).json({ error: "Session expired" });
          return;
        }

        req.user = {
          userId: payload.userId,
          username: user.username,
          role: payload.role,
          tenantId: payload.tenantId,
          sessionToken: payload.sessionToken,
          ...(payload.impersonatorId !== undefined
            ? { impersonatorId: payload.impersonatorId }
            : {}),
        };

        const { tenantId } = payload;
        if (tenantId === null) {
          // Platform realm (super_admin only — enforced by parseJwtPayload):
          // run WITHOUT tenant context. Tenant data routes are protected
          // fail-closed — any repository call throws TenantContextError
          // (surfacing as the route's 500) instead of reading anyone's data.
          // Control-plane routes (/api/admin/*, WP5+) opt into
          // runWithoutTenant() explicitly.
          next();
          return;
        }

        // Tenant realm: bind the tenant to the whole downstream chain.
        // AsyncLocalStorage keeps this context across await points inside
        // route handlers, so every repository call in this request resolves
        // getCurrentTenantId() to the JWT's tenant.
        runWithTenant(tenantId, () => next());
      })
      .catch((error: unknown) => {
        logger.error({ error }, "Session validation error");
        res.status(401).json({ error: "Session validation failed" });
      });
  } catch (error) {
    logger.error({ error }, "JWT verification failed");
    res.status(401).json({ error: "Invalid token" });
  }
}

// Alias for consistency
export const requireAuth = authenticateJWT;

export function requireRole(roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}

/**
 * Control-plane guard (plan §5): platform super admins ONLY.
 *
 * Requires role 'super_admin' AND tenantId null AND no impersonatorId — an
 * impersonation token is a tenant session and must never re-escalate back
 * into the control plane, even if it somehow carries the super_admin role.
 * Mount AFTER authenticateJWT.
 */
export function requireSuperAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  if (
    req.user.role !== "super_admin" ||
    req.user.tenantId !== null ||
    req.user.impersonatorId !== undefined
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
}
