/**
 * Continue with Google (LIRA-280) — backend configuration, signed tickets and
 * the OAuth state cookie. The Google protocol itself (PKCE, code exchange,
 * ID-token verification) is core's GoogleAuthService.
 *
 * ── Dormant by default ──
 * `googleConfig()` is null unless GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and a
 * platform (www) base URL are all present. Read at REQUEST time, so turning
 * the feature on is setting secrets, not deploying code. While null, every
 * route refuses (GOOGLE_NOT_CONFIGURED / error=not_configured).
 *
 * ── One redirect URI, on www ──
 * Likely, based on Google's OAuth client rules (unverified): wildcard
 * subdomains are not accepted as redirect URIs, so the whole flow runs on the
 * platform host and a short hand-off token carries the result to the shop's
 * subdomain. `redirectUri` is built from configuration, never from the
 * request host, and the SAME string is used in /start and in the code
 * exchange (Google rejects a mismatch).
 *
 * ── Tickets ──
 * Every ticket (state cookie, link, chooser, sign-up) is a short HS256 JWT
 * with a purpose-specific `aud`, signed with a key DERIVED from JWT_SECRET
 * (HMAC with a fixed label). So a session JWT can never pass as a ticket, a
 * ticket can never pass as a session JWT, and one purpose's ticket can never
 * pass as another's. Tickets are readable by whoever holds them (that is
 * what lets the chooser page list shops); they carry nothing secret beyond
 * the PKCE verifier, which lives only in the httpOnly cookie.
 */

import crypto from "node:crypto";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  JWT_SECRET,
} from "@liratek/core";
import { resolveInviteBaseUrl } from "../email/emailConfig.js";

export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";
export const GOOGLE_START_PATH = "/api/auth/google/start";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** The platform (www) origin, e.g. https://www.liratek.shop. */
  platformBaseUrl: string;
  redirectUri: string;
}

/** The ONE definition of "Google sign-in is switched on" (rule 14). */
export function googleConfig(): GoogleConfig | null {
  const clientId = GOOGLE_CLIENT_ID;
  const clientSecret = GOOGLE_CLIENT_SECRET;
  const platformBaseUrl = resolveInviteBaseUrl();
  if (!clientId || !clientSecret || !platformBaseUrl) return null;
  return {
    clientId,
    clientSecret,
    platformBaseUrl,
    redirectUri: `${platformBaseUrl}${GOOGLE_CALLBACK_PATH}`,
  };
}

// ── Signed tickets ───────────────────────────────────────────────────────

const TICKET_ISSUER = "liratek-google";

export const TICKET_TTL_SECONDS = {
  state: 10 * 60,
  /** Only has to survive one form submit to www. */
  link: 5 * 60,
  choose: 10 * 60,
  /** Long enough to fill the sign-up form. */
  signup: 30 * 60,
  /** LIRA-288 "Join with Google": invite + chosen username, from the join
   * page to the www start. */
  join: 10 * 60,
} as const;

export type TicketPurpose = keyof typeof TICKET_TTL_SECONDS;

function ticketKey(): Buffer {
  if (!JWT_SECRET) throw new Error("JWT_SECRET is required");
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update("liratek:google-auth-tickets:v1")
    .digest();
}

/** Signs `payload` for exactly one purpose. */
export function signTicket(purpose: TicketPurpose, payload: object): string {
  return jwt.sign({ ...payload }, ticketKey(), {
    algorithm: "HS256",
    audience: `google-${purpose}`,
    issuer: TICKET_ISSUER,
    expiresIn: TICKET_TTL_SECONDS[purpose],
  });
}

/** The ticket's claims, or null when forged, expired or of another purpose. */
export function verifyTicket(
  purpose: TicketPurpose,
  token: string | undefined,
): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, ticketKey(), {
      algorithms: ["HS256"],
      audience: `google-${purpose}`,
      issuer: TICKET_ISSUER,
    });
    return typeof decoded === "object" && decoded !== null
      ? (decoded as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ── Ticket shapes (parsed defensively; a valid signature is necessary, the
// shape check is what the TypeScript types then rely on) ───────────────────

export type GoogleIntent = "login" | "signup" | "link" | "join";

/** LIRA-288: what "Join with Google" carries from the join page to the
 * callback — the invite link's token, the username chosen on the page, and
 * the invite's shop (checked at /google/start). */
export interface JoinTicket {
  token: string;
  username: string;
  tenantId: number;
}

export interface StateTicket {
  state: string;
  verifier: string;
  nonce: string;
  intent: GoogleIntent;
  shop?: string;
  /** link intent only: whose account, in which shop (from the link ticket). */
  linkUserId?: number;
  linkTenantId?: number;
  /** join intent only (LIRA-288): from the join ticket. */
  join?: JoinTicket;
}

export interface ChooseShop {
  tenantId: number;
  name: string;
  slug: string;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function readStateTicket(claims: Record<string, unknown> | null): StateTicket | null {
  if (!claims) return null;
  const { state, verifier, nonce, intent, shop, linkUserId, linkTenantId } = claims;
  if (!isStr(state) || !isStr(verifier) || !isStr(nonce)) return null;
  if (intent !== "login" && intent !== "signup" && intent !== "link" && intent !== "join") {
    return null;
  }
  if (intent === "link" && (!isNum(linkUserId) || !isNum(linkTenantId))) return null;
  const join =
    intent === "join"
      ? readJoinTicket({
          token: claims.joinToken,
          username: claims.joinUsername,
          tenantId: claims.joinTenantId,
        })
      : null;
  if (intent === "join" && !join) return null;
  return {
    state,
    verifier,
    nonce,
    intent,
    ...(isStr(shop) ? { shop } : {}),
    ...(isNum(linkUserId) && isNum(linkTenantId) ? { linkUserId, linkTenantId } : {}),
    ...(join ? { join } : {}),
  };
}

/** The join ticket's claims (LIRA-288), or null when malformed. */
export function readJoinTicket(
  claims: Record<string, unknown> | null,
): JoinTicket | null {
  if (
    !claims ||
    !isStr(claims.token) ||
    !isStr(claims.username) ||
    !isNum(claims.tenantId)
  ) {
    return null;
  }
  return { token: claims.token, username: claims.username, tenantId: claims.tenantId };
}

export function readLinkTicket(
  claims: Record<string, unknown> | null,
): { userId: number; tenantId: number } | null {
  if (!claims || !isNum(claims.userId) || !isNum(claims.tenantId)) return null;
  return { userId: claims.userId, tenantId: claims.tenantId };
}

export function readChooseTicket(
  claims: Record<string, unknown> | null,
): { sub: string; shops: ChooseShop[] } | null {
  if (!claims || !isStr(claims.sub) || !Array.isArray(claims.shops)) return null;
  const shops: ChooseShop[] = [];
  for (const raw of claims.shops as unknown[]) {
    if (typeof raw !== "object" || raw === null) return null;
    const s = raw as Record<string, unknown>;
    if (!isNum(s.tenantId) || !isStr(s.name) || !isStr(s.slug)) return null;
    shops.push({ tenantId: s.tenantId, name: s.name, slug: s.slug });
  }
  return { sub: claims.sub, shops };
}

export function readSignupTicket(
  claims: Record<string, unknown> | null,
): { sub: string; email: string; verifiedAt: string; picture: string | null } | null {
  if (!claims || !isStr(claims.sub) || !isStr(claims.email) || !isStr(claims.verifiedAt)) {
    return null;
  }
  return {
    sub: claims.sub,
    email: claims.email,
    verifiedAt: claims.verifiedAt,
    // LIRA-294: optional; re-checked by safeGooglePictureUrl when linked.
    picture: isStr(claims.picture) ? claims.picture : null,
  };
}

// ── State cookie ─────────────────────────────────────────────────────────

export const STATE_COOKIE = "lt_google_oauth";
const COOKIE_PATH = "/api/auth/google";

/**
 * SameSite=Lax, not Strict: the callback is a top-level GET arriving FROM
 * accounts.google.com, and Strict would withhold the cookie on exactly that
 * request, failing every sign-in as a state mismatch. httpOnly: the PKCE
 * verifier must never be readable by page script.
 */
export function setStateCookie(req: Request, res: Response, value: string): void {
  res.cookie(STATE_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || process.env.NODE_ENV === "production",
    path: COOKIE_PATH,
    maxAge: TICKET_TTL_SECONDS.state * 1000,
  });
}

export function clearStateCookie(req: Request, res: Response): void {
  res.clearCookie(STATE_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || process.env.NODE_ENV === "production",
    path: COOKIE_PATH,
  });
}

/** No cookie-parser in this app: read the one cookie by hand. */
export function readStateCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === STATE_COOKIE) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
