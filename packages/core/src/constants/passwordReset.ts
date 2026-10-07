/**
 * Forgot / reset password (LIRA-275/276) — the refusal codes and the fixed
 * messages the routes answer with, defined once (rule 14) and shared by the
 * server and the web pages.
 *
 * A LEAF module with no imports: `browser.ts` re-exports it, so nothing here
 * may reach a Node built-in (rule 29). Pages compare `code`s, never message
 * text.
 */

/**
 * Refusal codes, as one object rather than loose constants: feature B
 * answers some of the same strings (`USER_HAS_NO_EMAIL`, `RATE_LIMITED`), and
 * two `export const RATE_LIMITED` reaching `index.ts` through `export *` would
 * collide at merge time.
 */
export const PASSWORD_RESET_CODES = {
  /** `POST /forgot` on a host that names no shop (www, or host tenancy off)
   * with no `shop` field: the page must ask for the shop address. */
  SHOP_REQUIRED: "SHOP_REQUIRED",
  /** `POST /send/:userId`: no such active user in the admin's shop. */
  NOT_FOUND: "NOT_FOUND",
  /** `POST /send/:userId`: the user has no email address at all. */
  USER_HAS_NO_EMAIL: "USER_HAS_NO_EMAIL",
  /** `POST /send/:userId`: the email was never verified, so no reset link is
   * sent to it (an unverified address may be a typo). */
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  /** `POST /send/:userId`: no mail transport, or nowhere for a link to point. */
  EMAIL_NOT_CONFIGURED: "EMAIL_NOT_CONFIGURED",
  /** `POST /send/:userId`: this user already got the hourly maximum. */
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export type PasswordResetCode =
  (typeof PASSWORD_RESET_CODES)[keyof typeof PASSWORD_RESET_CODES];

/** The ONE reply to `POST /forgot`, whether or not anything was sent — so
 * the form cannot be used to learn which emails have accounts. */
export const PASSWORD_RESET_REQUEST_MESSAGE =
  "If this email belongs to an account in this shop, we've sent a link.";

/** The ONE refusal for every unusable reset link: unknown, expired, used,
 * superseded, for another shop, or for a user who is no longer active. */
export const PASSWORD_RESET_INVALID_MESSAGE =
  "This reset link is not valid. Ask for a new one.";

/** At most this many reset links per user... */
export const PASSWORD_RESET_PER_USER_LIMIT = 3;
/** ...within this rolling window. */
export const PASSWORD_RESET_PER_USER_WINDOW_MS = 60 * 60 * 1000;
