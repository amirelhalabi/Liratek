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
