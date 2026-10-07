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
  "cancelled",
  "expired",
  "failed",
] as const;
export type GoogleAuthErrorCode = (typeof GOOGLE_AUTH_ERRORS)[number];

/** Signed tickets are short JWTs; bounded generously. */
const ticketSchema = z.string().min(1).max(4000);

/**
 * POST /api/auth/google/start (a form the Settings page submits) — the
 * foundation's start schema plus the link ticket from `POST /link/start`.
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
