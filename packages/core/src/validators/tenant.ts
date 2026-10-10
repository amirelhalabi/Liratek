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
  "Sign-up needs the invite link from your email";

/**
 * Public self-service signup body.
 *
 * The same fields a super admin supplies when provisioning a tenant by hand,
 * plus proof of invitation, because this endpoint is reachable without a
 * token. Reusing createTenantSchema is deliberate: the slug charset and
 * reserved-name rules that protect the tenant registry must be identical
 * whether a tenant is created by staff or by a stranger.
 *
 * LIRA-267 Stage B: the ONLY proof of invitation is `inviteToken`, the
 * emailed single-use link. The shared `inviteCode` is gone; zod strips one
 * if a stale client still sends it, so it can never open this route.
 * `contactEmail` is OMITTED, so zod strips any client-sent value: on this
 * public route the email always comes from the invite row, never the body.
 */
export const signupSchema = createTenantSchema
  .omit({ contactEmail: true })
  .extend({
    inviteToken: z
      .string({ error: SIGNUP_INVITE_REQUIRED_MESSAGE })
      .min(1, SIGNUP_INVITE_REQUIRED_MESSAGE)
      .max(200),
  });

export type SignupInput = z.infer<typeof signupSchema>;

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

/**
 * Wire (pre-parse) shapes of the two tenant-creating bodies, for the web
 * adapter's payload types (CLAUDE.md rule 21: derived from the schema, never
 * hand-copied). `z.input` is computed HERE, against core's own zod major, so
 * the frontend never applies its own zod's `z.input` to a core schema.
 */
export type SignupBodyInput = z.input<typeof signupSchema>;
export type CreateTenantBodyInput = z.input<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

// LIRA-297 (rule 21) — what a caller SENDS: `z.input`, so `.default()`
// fields stay optional. The adapters (backendApi.ts, ElectronApiAdapter.ts,
// packages/ui ApiAdapter) type their payloads with these, never with a
// hand-copied object literal.
export type UpdateTenantPayload = z.input<typeof updateTenantSchema>;
