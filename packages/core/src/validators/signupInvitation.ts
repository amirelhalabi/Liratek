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

/** POST /api/auth/signup-request — "email me a sign-up link" (public). */
export const requestSignupLinkSchema = z.object({
  email: signupEmailSchema,
  turnstileToken: z.string().min(1).max(2048),
});

export type CreateSignupInvitationInput = z.input<
  typeof createSignupInvitationSchema
>;
export type CheckSignupInviteInput = z.input<typeof checkSignupInviteSchema>;
export type RequestSignupLinkInput = z.input<typeof requestSignupLinkSchema>;
