/**
 * Whether per-tenant database routing is switched on
 * (`docs/plans/ongoing_plans/PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 11.1).
 *
 * Split into its own leaf module, separate from `backend/src/database/
 * connection.ts` (which reads the SAME env var into a module-level constant
 * at import time to decide whether to install the per-tenant resolver), for
 * two reasons:
 *
 *   1. `connection.ts` cannot be imported under this backend's CommonJS-mode
 *      ts-jest (it uses `import.meta.url`) — every existing test mocks it
 *      away instead. A caller that only needs the mode flag, not the whole
 *      connection module, should not have to mock the whole thing just to
 *      read one env var.
 *   2. This reads `process.env.TENANT_DB_MODE` AT CALL TIME, not at module
 *      load — so a test can flip `process.env.TENANT_DB_MODE` between cases
 *      without needing to reset the module registry, and so a caller that
 *      imports this before `connection.ts` has run its own env parsing never
 *      observes a stale value.
 *
 * Auth code (`api/auth.ts`) uses this to decide whether a login with no
 * resolved realm (host-based tenancy inactive) may fall back to the
 * cross-tenant `resolveWithoutRealm` username search (shared-DB mode only —
 * that search cannot work once each tenant's users live in a separate file).
 */
export function isPerTenantDbMode(): boolean {
  return process.env.TENANT_DB_MODE === "per-tenant";
}
