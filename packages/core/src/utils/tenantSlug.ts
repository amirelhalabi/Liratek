/**
 * Tenant slug validation — single source of truth for the predicate (CLAUDE.md
 * rule 14: a business-rule check must be defined once and reused everywhere).
 *
 * Used by BOTH:
 *   - `createTenantSchema` (Zod, backend/src/api/admin.ts's POST /tenants) —
 *     first-line rejection with a 400 before any DB work.
 *   - `TenantProvisioningService.provisionTenant()` — defense in depth, in
 *     case a future caller bypasses the Zod layer (e.g. a script, a test).
 *
 * docs/plans/MULTI_TENANT_IMPLEMENTATION_PLAN.md §5.
 */

import { ValidationError } from "./errors.js";

/**
 * Reserved subdomain-shaped names. Subdomain routing is out of scope for v1
 * (plan §1), but the slug is the FUTURE subdomain, so these are blocked now
 * to avoid ever having to migrate an already-provisioned tenant off one.
 */
export const RESERVED_TENANT_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "api",
  "admin",
  "app",
  "mail",
  "ftp",
  "localhost",
  "static",
  "cdn",
  "assets",
  "help",
  "support",
  "status",
  "blog",
]);

/**
 * Lowercase letters, digits, and hyphens only; no leading/trailing hyphen;
 * 3-32 characters total (1 leading char + 1-30 middle chars + 1 trailing char).
 */
export const TENANT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

export type TenantSlugValidation =
  | { valid: true }
  | { valid: false; error: string };

/**
 * Pure predicate — no throw. Callers that need a Zod-friendly boolean/message
 * (createTenantSchema) or an exception (assertValidTenantSlug) both build on
 * this single check.
 */
export function validateTenantSlug(slug: string): TenantSlugValidation {
  if (!TENANT_SLUG_REGEX.test(slug)) {
    return {
      valid: false,
      error:
        "Slug must be 3-32 characters, lowercase letters/digits/hyphens only, " +
        "and cannot start or end with a hyphen",
    };
  }
  if (RESERVED_TENANT_SLUGS.has(slug)) {
    return {
      valid: false,
      error: `Slug '${slug}' is reserved and cannot be used`,
    };
  }
  return { valid: true };
}

/** Throws `ValidationError` (400) when the slug fails `validateTenantSlug`. */
export function assertValidTenantSlug(slug: string): void {
  const result = validateTenantSlug(slug);
  if (!result.valid) {
    throw new ValidationError(result.error);
  }
}
