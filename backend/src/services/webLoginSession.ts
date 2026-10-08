/**
 * The ONE place a web sign-in turns a fresh DB session into the response the
 * browser stores (rule 14): JWT v2 (session-linked, tenant-carrying), the
 * `login` audit row, and the `{ user, token, sessionToken }` envelope.
 *
 * Shared by `POST /api/auth/login` (password) and
 * `POST /api/auth/google/sso-exchange` (Google hand-off, LIRA-280), so the
 * two can never hand out differently shaped sessions. Extracted verbatim
 * from the /login route.
 */

import type { Response } from "express";
import jwt from "jsonwebtoken";
import {
  JWT_EXPIRES_IN,
  JWT_SECRET,
  createSuccessResponse,
  getAuditService,
  getGoogleAuthService,
  runWithTenant,
} from "@liratek/core";
import type { LiratekJwtPayload } from "../middleware/auth.js";

export interface WebLoginUser {
  id: number;
  username: string;
  role: LiratekJwtPayload["role"];
  tenant_id?: number | null;
}

export interface WebLoginOptions {
  /** The DB session the JWT links to. */
  sessionToken: string;
  /** Audit summary; defaults to the password-login wording. */
  summary?: string;
  /** Extra audit metadata (e.g. `{ via: "google" }`). */
  metadata?: Record<string, unknown>;
}

/**
 * LIRA-294: the account photo for a shop user (their Google link's), or
 * null — a super admin, no link, or any failure (a photo never blocks a
 * sign-in). One helper for the login envelope and GET /api/auth/me.
 */
export function accountPictureUrl(
  tenantId: number | null | undefined,
  userId: number,
): string | null {
  if (tenantId === null || tenantId === undefined) return null;
  try {
    return runWithTenant(tenantId, () =>
      getGoogleAuthService().getPictureUrl(userId),
    );
  } catch {
    return null;
  }
}

/** Signs the JWT, writes the login audit row and sends the success envelope.
 * Returns the JWT (for the caller's own logging). */
export function sendWebLoginResponse(
  res: Response,
  user: WebLoginUser,
  options: WebLoginOptions,
): string {
  if (!JWT_SECRET) throw new Error("JWT_SECRET is required");

  // Create JWT v2: session-linked AND tenant-carrying (plan §3).
  // tenantId comes from the user row (null only for super_admin).
  const payload: LiratekJwtPayload = {
    userId: user.id,
    role: user.role,
    sessionToken: options.sessionToken, // Link JWT to database session
    tenantId: user.tenant_id ?? null,
  };
  const jwtToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

  // Mirrors authHandlers.ts's auth:login audit (action=login,
  // entity_type=session, no entity_id). Fire-and-forget — never blocks
  // the response. tenant_id comes from the just-authenticated user; a
  // platform super_admin (tenant_id null) has no tenant to write the
  // row under, so the log call is skipped for that one case rather than
  // silently failing inside AuditRepository.log()'s getCurrentTenantId().
  const loginTenantId = user.tenant_id ?? null;
  if (loginTenantId !== null) {
    runWithTenant(loginTenantId, () => {
      getAuditService().log({
        user_id: user.id,
        username: user.username,
        role: user.role,
        action: "login",
        entity_type: "session",
        summary: options.summary ?? `User "${user.username}" logged in`,
        ...(options.metadata ? { metadata: options.metadata } : {}),
      });
    });
  }

  res.json(
    createSuccessResponse({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        pictureUrl: accountPictureUrl(user.tenant_id, user.id),
      },
      token: jwtToken,
      sessionToken: options.sessionToken,
    }),
  );
  return jwtToken;
}
