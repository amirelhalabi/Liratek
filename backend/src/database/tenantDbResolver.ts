/**
 * The per-tenant connection ROUTING DECISION (Phase A, `docs/plans/
 * ongoing_plans/PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 11.1/§ 11.3 test
 * 7), split out of `connection.ts` into its own leaf module for one reason:
 * testability. `connection.ts` uses `import.meta.url` (to locate
 * `electron-app/create_db.sql` relative to itself at runtime), which is
 * genuinely unparsable under this backend's CommonJS-mode ts-jest — not a
 * naming collision, a hard `SyntaxError: Cannot use 'import.meta' outside a
 * module`. That means `connection.ts` can never be `require()`-d for real
 * under backend jest (every existing test that touches it uses
 * `jest.mock("../database/connection.js", ...)` instead). Keeping the
 * resolver's routing logic here — with zero imports that trip that
 * limitation — lets it be unit-tested directly instead of only ever mocked
 * away, same motivation as `utils/requestDay.ts` / `utils/formatMoney.ts` in
 * `packages/core` splitting a server-only function out of a Node-coupled
 * module (rule 29's pattern, applied one level up the stack).
 */
import type Database from "better-sqlite3";
import {
  getCurrentTenantId,
  isTenantBypass,
  TenantContextError,
} from "@liratek/core";

/** The subset of `TenantDatabasePool` the resolver needs — narrowed so it
 * can be unit-tested with a fake pool instead of real files. */
export interface TenantPoolLike {
  get(tenantId: number): Database.Database;
}

/**
 * Builds the per-tenant connection resolver: an active `runWithTenant(id)`
 * scope resolves to `pool.get(id)`; an explicit `runWithoutTenant()` bypass
 * OR no active tenant scope at all (`getCurrentTenantId()` throwing
 * `TenantContextError`) resolves to `platformDb()` instead.
 *
 * `platformDb` must NEVER be `@liratek/core`'s own `getDatabase()` — that is
 * what calls the resolver this function returns in the first place, so
 * routing "no tenant" back to it would recurse forever. Callers
 * (`connection.ts`) pass their OWN platform `getDatabase()`, which manages
 * `dbInstance` directly. Exported as a pure function (dependencies injected,
 * no module-level state) so it is unit-testable without a real pool, a real
 * file, or reloading any module with a different `TENANT_DB_MODE`.
 */
export function buildTenantDbResolver(
  pool: TenantPoolLike,
  platformDb: () => Database.Database,
): () => Database.Database {
  return () => {
    if (isTenantBypass()) return platformDb();
    try {
      const tenantId = getCurrentTenantId();
      return pool.get(tenantId);
    } catch (error) {
      if (error instanceof TenantContextError) return platformDb();
      throw error;
    }
  };
}
