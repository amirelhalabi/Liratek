import { z } from "zod";
import { validateTenantSlug } from "../utils/tenantSlug.js";
import { signupEmailSchema } from "./signupInvitation.js";

/**
 * Control-plane tenant schemas (plan §5 — backend/src/api/admin.ts).
 *
 * `slug` reuses `validateTenantSlug` (CLAUDE.md rule 14: one definition of the
 * business-rule predicate, shared with `TenantProvisioningService`'s own
 * defense-in-depth check) rather than re-encoding the regex/reserved-list here.
 */

const tenantSlugSchema = z.string().superRefine((slug, ctx) => {
  const result = validateTenantSlug(slug);
  if (!result.valid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
  }
});

export const createTenantSchema = z.object({
  name: z.string().min(1, "Tenant name is required").max(255),
  slug: tenantSlugSchema,
  contactName: z.string().max(255).optional(),
  contactPhone: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  // LIRA-267 FR-013b: optional on the admin path; one shop per email is
  // enforced by the idx_tenants_contact_email unique index.
  contactEmail: signupEmailSchema.optional(),
  adminUsername: z
    .string()
    .min(3, "Admin username must be at least 3 characters")
    .max(100),
  adminPassword: z
    .string()
    .min(6, "Admin password must be at least 6 characters"),
});

export const updateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: z.enum(["active", "suspended", "archived"]).optional(),
  contactName: z.string().max(255).optional(),
  contactPhone: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
});

export const SIGNUP_INVITE_REQUIRED_MESSAGE =
  "Use an invite link or an invite code";

/**
 * Public self-service signup body.
 *
 * The same fields a super admin supplies when provisioning a tenant by hand,
 * plus proof of invitation, because this endpoint is reachable without a
 * token. Reusing createTenantSchema is deliberate: the slug charset and
 * reserved-name rules that protect the tenant registry must be identical
 * whether a tenant is created by staff or by a stranger.
 *
 * LIRA-267 Stage A: EXACTLY ONE of `inviteCode` (the shared code, being
 * retired in Stage B) or `inviteToken` (the emailed single-use link).
 * `contactEmail` is OMITTED, so zod strips any client-sent value: on this
 * public route the email always comes from the invite row, never the body.
 */
export const signupSchema = createTenantSchema
  .omit({ contactEmail: true })
  .extend({
    inviteCode: z.string().min(1).optional(),
    inviteToken: z.string().min(1).max(200).optional(),
  })
  .superRefine((data, ctx) => {
    const hasCode = data.inviteCode !== undefined;
    const hasToken = data.inviteToken !== undefined;
    if (hasCode === hasToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: SIGNUP_INVITE_REQUIRED_MESSAGE,
        path: ["inviteCode"],
      });
    }
  });

export type SignupInput = z.infer<typeof signupSchema>;

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
