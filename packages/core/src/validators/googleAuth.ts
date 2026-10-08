import { z } from "zod";
import { createTenantSchema } from "./tenant.js";
import { googleStartQuerySchema } from "./account.js";

/**
 * Continue with Google (LIRA-280, feature D) — the schemas and codes the web
 * page and the backend share. Browser-safe (zod only): exported from
 * `browser.ts` and, through `services/index.ts`, from `index.ts` (both under
 * the `[auth-D]` anchors).
 */

/** Every Google route answers this `code` while GOOGLE_CLIENT_ID (or the
 * secret, or the www base URL) is unset — the feature is dormant. */
export const GOOGLE_NOT_CONFIGURED = "GOOGLE_NOT_CONFIGURED";

/**
 * Google sign-up is refused because the platform reached its ONE daily limit
 * for public sign-ups (email requests + Google sign-ups, owner decision
 * 2026-10-07). The person IS signed in with Google, so — unlike the email
 * form, which answers identically to hide the cap — they are told.
 */
export const SIGNUP_DAILY_CAP = "SIGNUP_DAILY_CAP";
export const SIGNUP_DAILY_CAP_MESSAGE =
  "Today's limit for new shops has been reached. Please try again tomorrow.";

/**
 * The `error=` values the Google callback can redirect a browser with, to
 * `/#/auth/google?error=…` (or `/#/settings?…&google=…` for a link). The page
 * compares these, never message text.
 */
export const GOOGLE_AUTH_ERRORS = [
  "not_configured",
  "signup_limit",
  "no_account",
  // Deprecated (LIRA-288): no longer sent — an account linked in other
  // shops may create a new shop. Kept for one release so a page left open
  // from before still has its message.
  "already_connected",
  "cancelled",
  "expired",
  "failed",
  // LIRA-290: sign-up with a Gmail that already owns a shop (its contact
  // email). The page says so, with a "Sign in instead" link.
  "email_has_shop",
] as const;
export type GoogleAuthErrorCode = (typeof GOOGLE_AUTH_ERRORS)[number];

/**
 * LIRA-288 "Join with Google": the `google=` values the callback sends a
 * browser back to the invite page with (`/#/join?invite=…&google=…`) when
 * joining did not happen. The join page compares these, never message text.
 * Every one of them leaves the invite usable (unless it was already used,
 * expired or revoked — `invite_invalid`).
 */
export const JOIN_WITH_GOOGLE_RESULTS = [
  /** The Google account's email is not the invited address. */
  "email_mismatch",
  /** Another user of this shop already has that Google account. */
  "already_linked",
  /** The invite is unknown, expired, used or revoked. */
  "invite_invalid",
  /** The shop's subscription has lapsed to read-only. */
  "shop_not_active",
  /** The chosen username was taken meanwhile. */
  "username_taken",
  /** Another user of this shop already has the invited email. */
  "email_taken",
  "cancelled",
  "error",
] as const;
export type JoinWithGoogleResult = (typeof JOIN_WITH_GOOGLE_RESULTS)[number];

/** Signed tickets are short JWTs; bounded generously. */
const ticketSchema = z.string().min(1).max(4000);

/**
 * POST /api/auth/google/start (a form the Settings page or, LIRA-288, the
 * invite page submits) — the foundation's start schema plus the ticket from
 * `POST /link/start` or `POST /api/user-invitations/google/start`.
 * The ticket travels in a POST body, never a URL, so it never lands in access
 * logs or browser history. Without the extension zod would strip `ticket`
 * silently (rule 23).
 */
export const googleStartFormSchema = googleStartQuerySchema.extend({
  ticket: ticketSchema.optional(),
});

/**
 * POST /api/auth/signup with Google as the proof instead of an emailed invite
 * link. The same shop fields as every other sign-up (createTenantSchema), so
 * the slug rules and the REQUIRED admin password are identical (owner
 * decision 2026-10-07: a Google sign-up still sets a password). `contactEmail`
 * is omitted: the email comes from the signed ticket, never the body.
 */
export const googleSignupSchema = createTenantSchema
  .omit({ contactEmail: true })
  .extend({ googleTicket: ticketSchema });

/** POST /api/auth/google/choose — pick one of several shops. */
export const googleChooseSchema = z.object({
  ticket: ticketSchema,
  tenantId: z.number().int().positive(),
});

export type GoogleSignupBodyInput = z.input<typeof googleSignupSchema>;
export type GoogleChooseInput = z.input<typeof googleChooseSchema>;
