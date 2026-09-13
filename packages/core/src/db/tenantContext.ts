/**
 * Tenant context — AsyncLocalStorage-based, fail-closed.
 *
 * This is the backbone of the multi-tenant retrofit (see
 * docs/plans/todo_plans/MULTI_TENANT_IMPLEMENTATION_PLAN.md §3/§6): every repository
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
  /**
   * The CLIENT's own local calendar day (`YYYY-MM-DD`), carried alongside
   * the tenant id for the same reason the tenant id is carried here at all:
   * a synchronous better-sqlite3 call deep in a repository has no other way
   * to learn something about the request that isn't one of its own
   * arguments (rule 27 — dual-transport hazard). Null when the caller
   * supplied nothing, or supplied a value that failed `CLIENT_DAY_PATTERN`.
   * `clientDay()` (utils/localDate.ts) is the public accessor everything
   * else should call — it folds this into the `localDay()` fallback so an
   * absent/invalid value is always harmless.
   */
  clientDay: string | null;
}

const tenantAls = new AsyncLocalStorage<TenantStore>();

/**
 * Format a client-supplied calendar day must match to be trusted into the
 * context — `YYYY-MM-DD`, the same shape `localDay()` produces. Exported so
 * `backend/src/middleware/auth.ts` validates the `X-Client-Day` header
 * against this SAME pattern rather than a re-typed copy (rule 14: a
 * business-rule predicate is defined once).
 */
export const CLIENT_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeClientDay(value: string | null | undefined): string | null {
  return typeof value === "string" && CLIENT_DAY_PATTERN.test(value)
    ? value
    : null;
}

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
 *
 * `options.clientDay`, when given, is the CLIENT's own local calendar day
 * (`YYYY-MM-DD`) for this same async extent — set by
 * `backend/src/middleware/auth.ts` from the `X-Client-Day` request header,
 * alongside the tenant id, since both answer "whose request is this" rather
 * than anything the server's own clock can know. A value that fails
 * `CLIENT_DAY_PATTERN` is silently dropped (stored as `null`, same as
 * omitting it) — never throws, so a malformed or spoofed header can never
 * fail a request over this alone (rule 27).
 */
export function runWithTenant<T>(
  tenantId: number,
  fn: () => T,
  options?: { clientDay?: string | null },
): T {
  return tenantAls.run(
    { tenantId, bypass: false, clientDay: normalizeClientDay(options?.clientDay) },
    fn,
  );
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
  return tenantAls.run({ tenantId: null, bypass: true, clientDay: null }, fn);
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
 * The CLIENT's own local calendar day (`YYYY-MM-DD`) for the current async
 * scope, if `runWithTenant()` was given one and it passed
 * `CLIENT_DAY_PATTERN`. `undefined` outside any scope, inside a
 * `runWithoutTenant()` bypass, or when none/an invalid one was supplied.
 *
 * This is the low-level accessor — request-path code should call
 * `clientDay()` (`utils/localDate.ts`) instead, which folds this into the
 * same `?? localDay()` fallback every other caller here already uses, so
 * desktop (no ALS scope, ever) and any test that doesn't set one keep
 * behaving exactly as before.
 */
export function getContextClientDay(): string | undefined {
  return tenantAls.getStore()?.clientDay ?? undefined;
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
