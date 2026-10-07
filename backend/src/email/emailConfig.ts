/**
 * Email-related configuration derived from the env (LIRA-267). Each function
 * takes the raw values as parameters, defaulting to the parsed env, so the
 * rules are unit-testable without re-importing the env module.
 */

import {
  APP_BASE_DOMAIN,
  EMAIL_FROM,
  EMAIL_REPLY_TO,
  SIGNUP_INVITE_BASE_URL,
} from "@liratek/core";
import { isEmailConfigured } from "./createTransport.js";

/** `LiraTek <mail@liratek.shop>` -> `mail@liratek.shop`; a bare address is
 * returned trimmed. */
function bareAddress(value: string): string {
  const match = /<([^<>]+)>/.exec(value);
  return (match ? match[1]! : value).trim();
}

/** The address the email tells people to write to for help. */
export function resolveSupportEmail(
  replyTo: string | undefined = EMAIL_REPLY_TO,
  from: string = EMAIL_FROM,
): string {
  return bareAddress(replyTo ?? from);
}

/**
 * Where invite links point: `SIGNUP_INVITE_BASE_URL`, else
 * `https://www.<APP_BASE_DOMAIN>`. Null when neither is set — a link built
 * from nothing would be `https://www.undefined/…`.
 */
export function resolveInviteBaseUrl(
  explicit: string | undefined = SIGNUP_INVITE_BASE_URL,
  baseDomain: string | undefined = APP_BASE_DOMAIN,
): string | null {
  if (explicit) return explicit.replace(/\/+$/, "");
  if (baseDomain) return `https://www.${baseDomain}`;
  return null;
}

/**
 * A shop's own origin, `https://<slug>.<APP_BASE_DOMAIN>` — where every
 * SHOP-scoped emailed link points (v196: `/#/join?invite=`,
 * `/#/reset-password?token=`, `/#/verify-email?token=`, and the Google
 * hand-off `/#/login?sso=`), and the sign-up response's `loginUrl` and the
 * impersonation `targetOrigin`. Defined once (rule 14).
 *
 * Null when APP_BASE_DOMAIN is unset (desktop, local dev, e2e): host-based
 * tenancy is off there, so there is no per-shop origin, and a feature that
 * needs one must refuse to send rather than invent a dead link. Production
 * sets APP_BASE_DOMAIN=liratek.shop (docs/DEPLOYMENT.md).
 */
export function resolveTenantBaseUrl(
  slug: string,
  baseDomain: string | undefined = APP_BASE_DOMAIN,
): string | null {
  return baseDomain ? `https://${slug}.${baseDomain}` : null;
}

/**
 * Where a SHOP-scoped emailed link points (v196): the shop's own subdomain
 * when host tenancy is on; otherwise the one platform origin
 * (`resolveInviteBaseUrl`), because with APP_BASE_DOMAIN unset every shop is
 * served from that single origin (local dev, preview, web e2e). Null when
 * neither is configured — the feature must refuse to send. Both bases are
 * parameters for testability; production resolves to
 * `https://<slug>.liratek.shop`.
 */
export function resolveShopLinkBaseUrl(
  slug: string,
  platformBaseUrl: string | undefined = SIGNUP_INVITE_BASE_URL,
  baseDomain: string | undefined = APP_BASE_DOMAIN,
): string | null {
  return (
    resolveTenantBaseUrl(slug, baseDomain) ??
    resolveInviteBaseUrl(platformBaseUrl, baseDomain)
  );
}

/**
 * Can this deployment email an invite link at all? Needs BOTH a mail
 * transport and somewhere for the link to point. The one definition used by
 * the admin list's `emailConfigured` banner and by self-serve availability,
 * so neither can claim "configured" while every send would be refused.
 */
export function canSendInvites(): boolean {
  return isEmailConfigured() && resolveInviteBaseUrl() !== null;
}
