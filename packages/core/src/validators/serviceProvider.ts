import { z } from "zod";

/**
 * Service Provider validation schemas —
 * FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 5 (the write path that
 * makes "add a Syria provider" possible — see ServiceProviderService for the
 * money-safety enforcement this schema is the first line of defense for).
 *
 * `code` charset mirrors `providerCodeSchema` (validators/financial.ts) —
 * letters/digits/underscore only, so it is guaranteed to be a legal
 * `financial_services.provider` value once stored (v154 composite FK).
 * Unlike `providerCodeSchema`, this schema does NOT accept a value already
 * containing a case mix on purpose to preserve — there is no existing data
 * to protect here, this is a BRAND NEW code. `ServiceProviderRepository.
 * createProvider` normalizes to uppercase at the DB boundary (unchanged,
 * pre-existing behavior); this schema only enforces shape (non-empty, no
 * whitespace, safe charset) so a bad payload is rejected before it reaches
 * the repository at all.
 *
 * `drawer_name` and `is_system_provider` are deliberately ABSENT from both
 * schemas below — plan §5b owner decision (2026-08-09): "all of them if paid
 * cash will affect general drawer. only the whish system association is
 * linked to whish system drawer." A provider created through this write path
 * always resolves its cash to `General` and is never Primary-Cash-Drawer
 * eligible; `ServiceProviderService.createProvider` hardcodes both rather
 * than trusting a caller-supplied value, and this schema doesn't even offer
 * the fields, so a hand-built REST/IPC payload can't smuggle a different
 * drawer in. See that method's own doc comment for the full rationale.
 *
 * `code` is intentionally absent from the UPDATE schema — `financial_services
 * .provider` FKs to `service_providers(tenant_id, code)` (v154); renaming a
 * code already referenced by real money rows would orphan them. This mirrors
 * `UpdateServiceProviderData` (ServiceProviderRepository.ts), whose TypeScript
 * shape has no `code` field at all — the immutability is structural, not just
 * a schema choice, and holds for every row (system or not).
 */
export const createServiceProviderSchema = z.object({
  code: z
    .string()
    .min(1, "Code is required")
    .max(50, "Code must be 50 characters or fewer")
    .regex(
      /^[A-Za-z0-9_]+$/,
      "Code may only contain letters, numbers, and underscores (no whitespace)",
    ),
  label: z
    .string()
    .trim()
    .min(1, "Label is required")
    .max(100, "Label must be 100 characters or fewer"),
});

export const updateServiceProviderSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Label is required")
    .max(100, "Label must be 100 characters or fewer")
    .optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

export type CreateServiceProviderInput = z.infer<
  typeof createServiceProviderSchema
>;
export type UpdateServiceProviderInput = z.infer<
  typeof updateServiceProviderSchema
>;
