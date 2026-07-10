import { z } from "zod";
import { validateTenantSlug } from "../utils/tenantSlug.js";

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

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
