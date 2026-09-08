/**
 * Push cache invalidation to a tenant's connected clients after any successful
 * write, so the UI does not have to discover changes by polling.
 *
 * ── Why this is a middleware and not per-route emits ──
 *
 * Before this, the entire backend had exactly ONE emit site
 * (`sales:processed`, api/sales.ts). If events are load-bearing for freshness,
 * then every mutating route must emit or the UI silently goes stale — and
 * "every route must remember to call X" is a bug generator, not a design. The
 * audit trail proved it in this very codebase: 146 call sites on the desktop
 * IPC side, zero on REST, and the viewer page looked perfectly healthy while
 * recording nothing. Deriving the event from the request means a new route is
 * covered the day it is added, by nobody.
 *
 * ── Why INVALIDATION and not state ──
 *
 * The payload says "something of this kind changed", never "here is the new
 * balance". Clients refetch through their normal, tenant-scoped, authorised
 * read path. That means:
 *
 *  - No money figure is ever trusted from an event, so out-of-order or
 *    duplicated delivery cannot corrupt what a user sees. A duplicate
 *    invalidation costs one redundant GET; a duplicate state push could show a
 *    stale drawer total, which someone might act on.
 *  - No authorisation logic is duplicated into the socket layer.
 *  - The payload carries no business data, so a socket delivered to the wrong
 *    room would leak nothing beyond an entity name (and `emitEvent` is already
 *    tenant-room scoped).
 *
 * ── This does NOT remove polling ──
 *
 * Sockets drop, tabs sleep, events get missed. Push narrows the window; a slow
 * safety poll plus refetch-on-focus closes it. Treating push as a complete
 * replacement is how clients silently diverge.
 */

import type { Request, Response, NextFunction } from "express";
import { getCurrentTenantId, createChildLogger } from "@liratek/core";
import { emitEvent } from "../websocket/io.js";
import {
  ACTION_BY_METHOD,
  entityTypeFromPath,
  onMutationSuccess,
} from "./mutationOutcome.js";

const invalidateLogger = createChildLogger({ module: "invalidate" });

/** The single event name clients subscribe to. */
export const INVALIDATE_EVENT = "data:invalidate";

export interface InvalidatePayload {
  /** Coarse entity name, e.g. "sessions", "sales", "drawer_topup". */
  entity: string;
  /** "create" | "update" | "delete", matching the desktop audit vocabulary. */
  action: string;
  /** Server clock, so a client can ignore an event older than its last fetch. */
  at: string;
}

/**
 * Routes that must not emit.
 *
 * `/api/auth/*` covers login/logout: they mutate session rows, but they carry
 * no tenant context worth broadcasting and firing an invalidation storm at
 * every connected client on each login is pure noise.
 */
const EXEMPT_PREFIXES = ["/api/auth/", "/health"];

export function invalidateOnMutation(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  onMutationSuccess(req, res, EXEMPT_PREFIXES, () => {
    try {
      // Resolved from the request's tenant context, never from user input —
      // emitEvent's own contract. Safe here only because onMutationSuccess
      // runs inside the request's async context; see its doc comment.
      const tenantId = getCurrentTenantId();

      const payload: InvalidatePayload = {
        entity: entityTypeFromPath(req.path),
        action: ACTION_BY_METHOD[req.method] ?? req.method.toLowerCase(),
        at: new Date().toISOString(),
      };

      emitEvent(tenantId, INVALIDATE_EVENT, payload);
    } catch (error) {
      // A super_admin route runs with NO tenant context (tenantId null), so
      // getCurrentTenantId() throws by design — there is no tenant room to
      // notify. Debug, not error: this is an expected path, not a fault.
      invalidateLogger.debug(
        { error, path: req.path },
        "no tenant context — invalidation not emitted",
      );
    }
  });

  next();
}
