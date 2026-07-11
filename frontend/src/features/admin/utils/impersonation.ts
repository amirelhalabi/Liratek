import { decodeJwtPayload } from "@/shared/utils/jwt";
import {
  getImpersonationToken,
  setImpersonationToken,
  getImpersonationTenantName,
  setImpersonationTenantName,
  getImpersonationUsername,
  setImpersonationUsername,
} from "@/api/httpClient";

const TOKEN_PARAM = "impersonation_token";
const TENANT_NAME_PARAM = "tenant_name";
const USERNAME_PARAM = "username";

export interface ImpersonationHandoff {
  token: string | null;
  tenantName: string | null;
  username: string | null;
  /** The href with the handoff params stripped, everything else preserved. */
  strippedUrl: string;
}

/**
 * Pure parser, no side effects — extracts the impersonation handoff params
 * from a full href. Kept side-effect-free so it can be unit tested with
 * plain strings and so `bootstrapImpersonationSession` stays a thin wrapper.
 */
export function parseImpersonationHandoff(href: string): ImpersonationHandoff {
  const url = new URL(href);
  const token = url.searchParams.get(TOKEN_PARAM);
  const tenantName = url.searchParams.get(TENANT_NAME_PARAM);
  const username = url.searchParams.get(USERNAME_PARAM);

  url.searchParams.delete(TOKEN_PARAM);
  url.searchParams.delete(TENANT_NAME_PARAM);
  url.searchParams.delete(USERNAME_PARAM);

  const search = url.searchParams.toString();
  const strippedUrl = `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;

  return { token, tenantName, username, strippedUrl };
}

/**
 * Imperative bootstrap — call exactly once, at the earliest point of client
 * startup (main.tsx, before React mounts / before AuthContext tries to
 * restore a session). Moves `?impersonation_token=<jwt>` (plus the
 * `tenant_name`/`username` companions the super admin's tab appended) out of
 * the URL and into sessionStorage, then strips it from history via
 * `replaceState` so the token never sits in the address bar or history.
 *
 * No-op (returns false) if there is no `impersonation_token` param — the
 * normal boot path is untouched.
 */
export function bootstrapImpersonationSession(win: Window = window): boolean {
  const { token, tenantName, username, strippedUrl } =
    parseImpersonationHandoff(win.location.href);
  if (!token) return false;

  setImpersonationToken(token);
  if (tenantName) setImpersonationTenantName(tenantName);
  if (username) setImpersonationUsername(username);

  win.history.replaceState({}, "", strippedUrl);
  return true;
}

export interface ImpersonationInfo {
  active: boolean;
  tenantId: number | null;
  impersonatorId: number | null;
  tenantName: string | null;
  username: string | null;
}

const INACTIVE_INFO: ImpersonationInfo = {
  active: false,
  tenantId: null,
  impersonatorId: null,
  tenantName: null,
  username: null,
};

/**
 * Single source of truth for "is this tab impersonating, and who/what" —
 * reads fresh from sessionStorage + the JWT on every call (no cached React
 * state) so it stays correct across reloads without extra plumbing.
 *
 * `tenantName`/`username` come from the handoff stash (URL -> sessionStorage
 * at bootstrap) because the JWT payload itself only carries
 * {userId, role, tenantId, impersonatorId, sessionToken} — no tenant name,
 * no username (plan §3). A `username` JWT claim is decoded as a defensive
 * fallback in case the backend adds one to the impersonation token; if
 * neither is available the caller should fall back to a generic label.
 */
export function getImpersonationInfo(): ImpersonationInfo {
  const token = getImpersonationToken();
  if (!token) return INACTIVE_INFO;

  const decoded = decodeJwtPayload(token);
  const tenantId =
    decoded &&
    (typeof decoded.tenantId === "number" || decoded.tenantId === null)
      ? decoded.tenantId
      : null;
  const impersonatorId =
    decoded && typeof decoded.impersonatorId === "number"
      ? decoded.impersonatorId
      : null;
  const decodedUsername =
    decoded && typeof decoded.username === "string" ? decoded.username : null;

  return {
    active: true,
    tenantId,
    impersonatorId,
    tenantName: getImpersonationTenantName(),
    username: getImpersonationUsername() ?? decodedUsername,
  };
}
