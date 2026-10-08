import { z } from "zod";
import { validatePasswordComplexity } from "../utils/passwordPolicy.js";
import { validateTenantSlug } from "../utils/tenantSlug.js";
import { signupEmailSchema } from "./signupInvitation.js";

/**
 * Account schemas (v196 foundation — SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md):
 * invite a user into a shop (LIRA-281), forgot/reset password (LIRA-275/276),
 * a user's own email (LIRA-279), Google sign-in (LIRA-280).
 *
 * Browser-safe: zod plus two pure utils. Re-exported from
 * `validators/index.ts`, which `browser.ts` re-exports (rule 29). The
 * `*Input` types at the bottom are computed HERE against core's zod major,
 * for the web adapter's payload types (rule 21) — the frontend never applies
 * its own zod's `z.input` to these schemas.
 */

/** Every link token in this family: the 43-char base64url from
 * `generateToken()`, bounded generously. */
const linkTokenSchema = z.string().min(1).max(200);

/**
 * A NEW password, held to the same complexity rule user creation enforces
 * (`validatePasswordComplexity`, utils/passwordPolicy.ts — rule 14). Each
 * failed requirement becomes its own issue with the policy's own message.
 * Services still re-check; this gives the form an early, identical answer.
 */
export const newPasswordSchema = z
  .string()
  .max(200)
  .superRefine((password, ctx) => {
    for (const message of validatePasswordComplexity(password).errors) {
      ctx.addIssue({ code: "custom", message });
    }
  });

/** A shop address (`<slug>.liratek.shop`), same rules as tenant creation. */
const shopSlugSchema = z.string().superRefine((slug, ctx) => {
  const result = validateTenantSlug(slug);
  if (!result.valid) ctx.addIssue({ code: "custom", message: result.error });
});

const userRoleSchema = z.enum(["admin", "staff"]);

// ── Invite a user into a shop (LIRA-281) ─────────────────────────────────

/** POST /api/users/invitations — a shop admin invites by email. */
export const createUserInvitationSchema = z.object({
  email: signupEmailSchema,
  role: userRoleSchema,
});

/** POST /api/auth/user-invite/check — is this /#/join link usable? */
export const checkUserInvitationSchema = z.object({
  token: linkTokenSchema,
});

/** POST /api/auth/user-invite/accept — the invitee picks a username and
 * password. Username rules match `AuthService.createUser` (trimmed, at least
 * 3 characters) and tenant provisioning's 100-character cap. */
export const acceptUserInvitationSchema = z.object({
  token: linkTokenSchema,
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(100),
  password: newPasswordSchema,
});

/** The invitee's username — the same rules as `acceptUserInvitationSchema`
 * (one definition, rule 14). */
const inviteUsernameSchema = acceptUserInvitationSchema.shape.username;

/**
 * POST /api/user-invitations/google/start (LIRA-288) — "Join with Google":
 * the invite token and the chosen username, checked BEFORE leaving for
 * Google. No password: a Google-only member can set one later through
 * "Forgot password" (owner decision 2026-10-08).
 */
export const joinWithGoogleStartSchema = z.object({
  token: linkTokenSchema,
  username: inviteUsernameSchema,
});

// ── Forgot / reset password (LIRA-275/276) ───────────────────────────────

/**
 * POST /api/auth/password/forgot. On a shop subdomain the shop comes from the
 * host; on www the person types their shop address, sent as `shop` (slug).
 */
export const forgotPasswordSchema = z.object({
  email: signupEmailSchema,
  shop: shopSlugSchema.optional(),
});

/** POST /api/auth/password/reset/check — is this reset link usable? */
export const checkResetTokenSchema = z.object({
  token: linkTokenSchema,
});

/** POST /api/auth/password/reset — choose the new password. */
export const resetPasswordSchema = z.object({
  token: linkTokenSchema,
  password: newPasswordSchema,
});

// ── A user's own email (LIRA-279) ────────────────────────────────────────

/** PUT /api/users/:id/email — set (sends a verification link) or clear. */
export const setUserEmailSchema = z.object({
  email: signupEmailSchema.nullable(),
});

/** POST /api/auth/verify-email — open the emailed verification link. */
export const verifyUserEmailSchema = z.object({
  token: linkTokenSchema,
});

// ── Google sign-in (LIRA-280) ────────────────────────────────────────────

/** GET /api/auth/google/start?intent=…&shop=… (query string). `link` and
 * `join` (LIRA-288) are POST-only: their ticket never sits in a URL. */
export const googleStartQuerySchema = z.object({
  intent: z.enum(["login", "signup", "link", "join"]),
  shop: shopSlugSchema.optional(),
});

/** POST /api/auth/sso/exchange — the shop page trades the hand-off token
 * for a normal session. */
export const ssoExchangeSchema = z.object({
  token: linkTokenSchema,
});

// ── Wire (pre-parse) types for the web adapter (rule 21) ─────────────────

export type CreateUserInvitationInput = z.input<
  typeof createUserInvitationSchema
>;
export type CheckUserInvitationInput = z.input<
  typeof checkUserInvitationSchema
>;
export type AcceptUserInvitationInput = z.input<
  typeof acceptUserInvitationSchema
>;
export type JoinWithGoogleStartInput = z.input<
  typeof joinWithGoogleStartSchema
>;
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;
export type CheckResetTokenInput = z.input<typeof checkResetTokenSchema>;
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;
export type SetUserEmailInput = z.input<typeof setUserEmailSchema>;
export type VerifyUserEmailInput = z.input<typeof verifyUserEmailSchema>;
export type GoogleStartQueryInput = z.input<typeof googleStartQuerySchema>;
export type SsoExchangeInput = z.input<typeof ssoExchangeSchema>;
