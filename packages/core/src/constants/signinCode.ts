/**
 * "Email me a code" sign-in on www (LIRA-287) — the fixed messages, limits
 * and the shape of the "your shops" answer, defined once (rule 14) and shared
 * by the server and the web page.
 *
 * A LEAF module with no imports: `browser.ts` re-exports it, so nothing here
 * may reach a Node built-in (rule 29).
 *
 * What a code does: it proves the person reads that inbox, and nothing more.
 * A valid code returns the shops where the email is a CONFIRMED user; the
 * person still types their password on the shop's own page (owner decision
 * 2026-10-07). It never signs anyone in.
 */

/** The ONE reply to "send me a code", whether or not anything was sent, so
 * the form cannot be used to learn which emails have accounts. */
export const SIGNIN_CODE_REQUEST_MESSAGE =
  "If this email has a LiraTek account, we've sent a code.";

/** The ONE refusal for every unusable code: wrong, expired, used, replaced
 * by a newer one, locked after too many tries, or never sent. */
export const SIGNIN_CODE_INVALID_MESSAGE =
  "That code is not right or has expired. Check it, or ask for a new one.";

/** The refusal code that goes with SIGNIN_CODE_INVALID_MESSAGE. */
export const SIGNIN_CODE_INVALID = "SIGNIN_CODE_INVALID";

/** Digits in a code. */
export const SIGNIN_CODE_LENGTH = 6;
/** A code works for this long. */
export const SIGNIN_CODE_TTL_MINUTES = 10;
/** Wrong tries before a code stops working, even with the right digits. */
export const SIGNIN_CODE_MAX_ATTEMPTS = 5;
/** At most this many codes per email... */
export const SIGNIN_CODE_PER_EMAIL_LIMIT = 5;
/** ...within this rolling window. */
export const SIGNIN_CODE_PER_EMAIL_WINDOW_MS = 60 * 60 * 1000;

/** The outbox `data` key holding the code: a secret, scrubbed from the
 * outbox once the email is final (the template's `secretKeys`). */
export const SIGNIN_CODE_SECRET_KEY = "code";

/** One shop a verified code opens: where to go and which account. */
export interface SigninShop {
  /** The shop address label (`<slug>.<base>`). */
  slug: string;
  /** The shop's display name. */
  name: string;
  /** The account in that shop this email belongs to (prefilled there). */
  username: string;
}
