/**
 * Tenant context — AsyncLocalStorage-based, fail-closed.
 *
 * This is the backbone of the multi-tenant retrofit (see
 * docs/plans/MULTI_TENANT_IMPLEMENTATION_PLAN.md §3/§6): every repository
 * read/write that touches a tenant-owned table resolves "which tenant am I
 * running for" through `getCurrentTenantId()`. There is NO default tenant —
 * a call with neither an active `runWithTenant()` scope nor a fixed fallback
 * (Electron/desktop) throws `TenantContextError` instead of silently
 * resolving to some tenant. A missed context wire-up must be a loud 500, not
 * a cross-tenant data leak.
 *
 * Why AsyncLocalStorage and not a simple module-level variable: better-sqlite3
 * calls are synchronous, but Express request handlers are async. Between two
 * sync DB calls inside one handler, Node can interleave another request's
 * handler on the same event loop turn. A plain module-level "current tenant"
 * variable would leak across concurrent requests. AsyncLocalStorage keeps the
 * tenant bound to the async execution context that entered `runWithTenant()`,
 * so it stays correct across `await` points and interleaved requests.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Thrown whenever `getCurrentTenantId()` cannot resolve a tenant: no active
 * `runWithTenant()` scope, no fixed fallback (`initFixedTenantContext()`),
 * and — if we ARE inside a scope — that scope is a `runWithoutTenant()`
 * bypass, which by design carries no tenant id.
 */
export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
    Error.captureStackTrace?.(this, this.constructor);
  }
}

interface TenantStore {
  /** Null only while `bypass` is true — a bypass scope never carries a tenant id. */
  tenantId: number | null;
  /** True only inside `runWithoutTenant()`. */
  bypass: boolean;
}

const tenantAls = new AsyncLocalStorage<TenantStore>();

/**
 * Module-level fallback tenant id for single-tenant/desktop mode. Set once at
 * boot via `initFixedTenantContext()`. Web/backend code should never call
 * this — it always runs inside a per-request `runWithTenant()` scope.
 */
let fixedTenantId: number | null = null;

/**
 * Run `fn` with `tenantId` bound as the current tenant for the entire async
 * extent of `fn` (including anything it awaits). A nested `runWithTenant()`
 * call — e.g. a control-plane operation that needs to act "as" a specific
 * tenant for a moment — overrides the outer scope for its own extent only;
 * the outer scope is restored automatically once the nested call returns.
 */
export function runWithTenant<T>(tenantId: number, fn: () => T): T {
  return tenantAls.run({ tenantId, bypass: false }, fn);
}

/**
 * Escape hatch for control-plane code ONLY (e.g. `TenantRepository`, cross-
 * tenant admin lookups). Marks the current async scope as "no tenant" —
 * `getCurrentTenantId()` throws inside it rather than resolving to whatever
 * tenant happened to be active outside. `BaseRepository` checks
 * `isTenantBypass()` before it ever calls `getCurrentTenantId()`, so its
 * generic CRUD methods simply skip the `tenant_id` predicate here instead of
 * throwing. Every call site is reported by `scripts/check-tenant-scoping.mjs`
 * for review.
 */
export function runWithoutTenant<T>(fn: () => T): T {
  return tenantAls.run({ tenantId: null, bypass: true }, fn);
}

/**
 * Resolve the tenant id for the current async context.
 *
 * Resolution order:
 *   1. Active `runWithTenant()` ALS scope (throws if the active scope is a
 *      `runWithoutTenant()` bypass instead).
 *   2. The fixed fallback set by `initFixedTenantContext()` (Electron/desktop).
 *   3. Throw `TenantContextError` — there is no default tenant.
 */
export function getCurrentTenantId(): number {
  const store = tenantAls.getStore();
  if (store) {
    if (store.bypass || store.tenantId === null) {
      throw new TenantContextError(
        "getCurrentTenantId() was called inside runWithoutTenant() (bypass scope), " +
          "which carries no tenant id by design. Check isTenantBypass() before calling " +
          "getCurrentTenantId(), or move this call outside the bypass scope.",
      );
    }
    return store.tenantId;
  }

  if (fixedTenantId !== null) {
    return fixedTenantId;
  }

  throw new TenantContextError(
    "getCurrentTenantId() was called with no tenant context set. Wrap the call in " +
      "runWithTenant(tenantId, fn) (web/per-request), or call initFixedTenantContext(tenantId) " +
      "once at boot for single-tenant/desktop mode. There is no default tenant.",
  );
}

/**
 * True only while inside an active `runWithoutTenant()` scope (including
 * nested calls that haven't overridden it with a fresh `runWithTenant()`).
 */
export function isTenantBypass(): boolean {
  return tenantAls.getStore()?.bypass ?? false;
}

/**
 * Set the module-level fallback tenant id. Electron/desktop calls this once
 * at boot (see `electron-app/main.ts`) — desktop is permanently single-tenant,
 * so every `getCurrentTenantId()` call resolves to this id with no per-request
 * wiring needed. Calling this again overwrites the previous fallback (used by
 * tests to reset between cases via `resetTenantContext()`).
 */
export function initFixedTenantContext(tenantId: number): void {
  fixedTenantId = tenantId;
}

/**
 * Clear the fixed fallback set by `initFixedTenantContext()`. Test-only —
 * lets each test start from a clean "no context" state.
 */
export function resetTenantContext(): void {
  fixedTenantId = null;
}
