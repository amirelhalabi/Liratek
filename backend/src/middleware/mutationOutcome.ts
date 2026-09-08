/**
 * "Did this HTTP request successfully mutate something?" — defined ONCE.
 *
 * Two middlewares need this exact judgement: the audit trail
 * (`auditRequest.ts`) and cache invalidation (`invalidateOnMutation.ts`).
 * It encodes two real domain rules, which is why it is not copy-pasted into
 * both (rule 14):
 *
 *  - Which verbs mutate.
 *  - What "succeeded" means on this API. The REST envelope deliberately
 *    returns HTTP 200 even on failure (`{success:false}`) so it matches the
 *    IPC transport, so the status code ALONE is not the answer. Getting this
 *    wrong in one place and not the other would mean auditing writes that
 *    never happened, or invalidating caches for them.
 */

import type { Request, Response } from "express";

/** Only state-changing verbs are candidates. */
export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Desktop's audit vocabulary (electron-app/handlers/*) is lowercase verbs;
 * matching it keeps `action` queryable across both transports.
 */
export const ACTION_BY_METHOD: Record<string, string> = {
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

/**
 * Coarse entity name from a route path: `/api/drawer-topup/from-drawer`
 * becomes `drawer_topup`. Hyphens become underscores to match the
 * snake_case `entity_type` convention used by the desktop audit rows.
 */
export function entityTypeFromPath(path: string): string {
  const seg = path.replace(/^\/api\//, "").split("/")[0] || "unknown";
  return seg.replace(/-/g, "_");
}

/** A request that could produce a side effect if it succeeds. */
export function isMutatingRequest(
  req: Request,
  exemptPrefixes: string[],
): boolean {
  if (!MUTATING_METHODS.has(req.method)) return false;
  return !exemptPrefixes.some((p) => req.path.startsWith(p));
}

/**
 * Whether the response represents a mutation that actually committed.
 * Checks the status code AND the envelope's success flag — see the file header
 * for why both are required.
 */
export function isSuccessfulMutation(res: Response, body: unknown): boolean {
  if (res.statusCode >= 400) return false;
  if (
    body !== null &&
    typeof body === "object" &&
    (body as { success?: unknown }).success === false
  ) {
    return false;
  }
  return true;
}

/**
 * Run `onSuccess` when a mutating request completes successfully.
 *
 * Hooks `res.json` rather than `res.on("finish")`, and that choice is
 * load-bearing: repositories extend BaseRepository and read the tenant from
 * AsyncLocalStorage, and `tenantContext.ts` is fail-closed. A finish handler
 * fires OUTSIDE the request's async context, so every tenant-scoped write or
 * `getCurrentTenantId()` call from there would throw. Wrapping `res.json`
 * keeps the callback inside the context that the route ran in.
 *
 * `onSuccess` must never throw; callers wrap their own work. A throw here is
 * swallowed rather than allowed to break the response, because a side effect
 * failing must not fail the mutation that already committed.
 */
export function onMutationSuccess(
  req: Request,
  res: Response,
  exemptPrefixes: string[],
  onSuccess: (body: unknown) => void,
): boolean {
  if (!isMutatingRequest(req, exemptPrefixes)) return false;

  const originalJson = res.json.bind(res);
  res.json = (body: unknown): Response => {
    if (isSuccessfulMutation(res, body)) {
      try {
        onSuccess(body);
      } catch {
        // Deliberately swallowed — the caller logs. The response must proceed.
      }
    }
    return originalJson(body);
  };
  return true;
}
