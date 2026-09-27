/**
 * `buildTenantDbResolver()` (Phase A, `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md`
 * § 11.3 test 7, backend half): an active `runWithTenant(id)` scope routes to
 * the tenant pool; an explicit `runWithoutTenant()` bypass, or no tenant
 * scope at all, routes to the platform database instead.
 *
 * A fake pool stands in for `TenantDatabasePool` here — that class's own
 * file-open/migrate/idle-close mechanics are already covered by
 * `packages/core/src/db/__tests__/tenantDatabasePool.test.ts`; this test is
 * only about the ROUTING DECISION `buildTenantDbResolver` makes, which is
 * why it takes a `TenantPoolLike` (just a `get(tenantId)` method) rather
 * than a concrete pool.
 */
import { buildTenantDbResolver } from "../tenantDbResolver";
import type { TenantPoolLike } from "../tenantDbResolver";
import {
  runWithTenant,
  runWithoutTenant,
  resetTenantContext,
} from "@liratek/core";

describe("buildTenantDbResolver", () => {
  afterEach(() => {
    resetTenantContext();
  });

  function fakeDb(label: string): any {
    return { __label: label };
  }

  function makeFakePool(): TenantPoolLike {
    return {
      get: (tenantId: number) => fakeDb(`tenant-${tenantId}`),
    };
  }

  it("routes an active runWithTenant(id) scope to pool.get(id)", () => {
    const pool = makeFakePool();
    const platform = fakeDb("platform");
    const resolver = buildTenantDbResolver(pool, () => platform);

    const result = runWithTenant(7, () => resolver());
    expect(result).toEqual(fakeDb("tenant-7"));
  });

  it("routes an explicit runWithoutTenant() bypass to the platform database", () => {
    const pool = makeFakePool();
    const platform = fakeDb("platform");
    const resolver = buildTenantDbResolver(pool, () => platform);

    const result = runWithoutTenant(() => resolver());
    expect(result).toBe(platform);
  });

  it("routes NO active tenant scope at all to the platform database", () => {
    const pool = makeFakePool();
    const platform = fakeDb("platform");
    const resolver = buildTenantDbResolver(pool, () => platform);

    // No runWithTenant()/runWithoutTenant() wrapper, and no fixed tenant
    // (resetTenantContext() in afterEach/here keeps it that way) — this is
    // the "no scope" half of getCurrentTenantId()'s TenantContextError.
    resetTenantContext();
    const result = resolver();
    expect(result).toBe(platform);
  });

  it("never calls platformDb() when a tenant scope IS active", () => {
    const pool = makeFakePool();
    const platformDb = jest.fn(() => fakeDb("platform"));
    const resolver = buildTenantDbResolver(pool, platformDb);

    runWithTenant(3, () => resolver());
    expect(platformDb).not.toHaveBeenCalled();
  });
});
