import { z } from "zod";

/**
 * Sign-up invitation schemas (LIRA-267 — email invites + self-serve sign-up).
 *
 * Browser-safe: zod only. Re-exported from `validators/index.ts`, which
 * `browser.ts` re-exports, so nothing here may import a Node built-in
 * (CLAUDE.md rule 29).
 */

/**
 * The one definition of "an email we store": trimmed, lowercased, valid, at
 * most 254 characters (the SMTP path limit). Lowercasing here is what makes
 * the `idx_tenants_contact_email` unique index effectively case-insensitive.
 */
export const signupEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

/** POST /api/admin/signup-invitations — a super admin invites a shop. */
export const createSignupInvitationSchema = z.object({
  email: signupEmailSchema,
  shopNameHint: z.string().trim().max(100).optional(),
});

/** GET/POST check of an invite link's token before the form is shown. */
export const checkSignupInviteSchema = z.object({
  token: z.string().min(1).max(200),
});

/**
 * POST /api/auth/signup/request — "email me a sign-up link" (public).
 *
 * LIRA-278 (self-serve without Turnstile):
 *   - `turnstileToken` is OPTIONAL: Turnstile is an extra layer, checked only
 *     when its keys are configured. When configured, the route must still
 *     refuse a request that omits it. Never an empty string.
 *   - `shopNameHint` prefills the full form behind the link. It is stored on
 *     the invite but NEVER echoed in a self-serve email (spam vector).
 *   - `website` is a HONEYPOT: a hidden field people never fill. It parses
 *     whatever its content so the route can answer a filled one with the
 *     normal "check your inbox" reply and send nothing — a 400 would tell the
 *     bot what tripped it.
 *   - `formElapsedMs` — how long the form was open, measured by the browser
 *     on ITS OWN clock (render -> submit) — feeds the "too fast to be human"
 *     check, answered the same silent way. Deliberately NOT a start
 *     timestamp: comparing a browser timestamp with the server's clock makes
 *     clock skew silently drop real people (rule 27). Absent = no check.
 */
export const requestSignupLinkSchema = z.object({
  email: signupEmailSchema,
  turnstileToken: z.string().min(1).max(2048).optional(),
  shopNameHint: z.string().trim().max(100).optional(),
  website: z.string().max(200).optional(),
  formElapsedMs: z.number().int().nonnegative().max(86_400_000).optional(),
});

export type CreateSignupInvitationInput = z.input<
  typeof createSignupInvitationSchema
>;
export type CheckSignupInviteInput = z.input<typeof checkSignupInviteSchema>;
export type RequestSignupLinkInput = z.input<typeof requestSignupLinkSchema>;
