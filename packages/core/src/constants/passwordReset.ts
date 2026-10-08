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
  /** `POST /forgot` on a host that names no shop with no `shop` field, where
   * host tenancy is OFF (dev, previews, e2e): the page must ask for the shop
   * address. On www (the platform host) the server instead mails a link for
   * every shop the email signs in to (LIRA-287). */
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
  /** `POST /set-initial` (LIRA-291): the user already has a password; this
   * route only ADDS a first one (changing one needs the current password). */
  PASSWORD_ALREADY_SET: "PASSWORD_ALREADY_SET",
} as const;

export type PasswordResetCode =
  (typeof PASSWORD_RESET_CODES)[keyof typeof PASSWORD_RESET_CODES];

/** The ONE reply to `POST /forgot`, whether or not anything was sent — so
 * the form cannot be used to learn which emails have accounts. */
export const PASSWORD_RESET_REQUEST_MESSAGE =
  "If this email belongs to an account in this shop, we've sent a link.";

/** The ONE reply to `POST /forgot` on www without a shop (LIRA-287): one
 * reset link is mailed per shop the email signs in to, so the message
 * cannot say "this shop". Same rule: identical whether or not anything was
 * sent. */
export const PASSWORD_RESET_EVERY_SHOP_MESSAGE =
  "If this email belongs to a LiraTek account, we've sent a reset link for each shop it signs in to.";

/** At most this many shops get a reset link from one www request. */
export const PASSWORD_RESET_EVERY_SHOP_MAX = 10;

/** The ONE refusal for every unusable reset link: unknown, expired, used,
 * superseded, for another shop, or for a user who is no longer active. */
export const PASSWORD_RESET_INVALID_MESSAGE =
  "This reset link is not valid. Ask for a new one.";

/** At most this many reset links per user... */
export const PASSWORD_RESET_PER_USER_LIMIT = 3;
/** ...within this rolling window. */
export const PASSWORD_RESET_PER_USER_WINDOW_MS = 60 * 60 * 1000;

/**
 * LIRA-291: the outbox template for a link sent to a user with NO password
 * (joined with Google): "Set a password for <username>". Same token, page
 * and expiry as `password-reset`; only the wording differs.
 */
export const PASSWORD_SET_TEMPLATE = "password-set";

/**
 * LIRA-291: the notice sent after a signed-in user added a password from
 * Settings. No link and no secret.
 */
export const PASSWORD_ADDED_TEMPLATE = "password-added";
