/**
 * Shared audit logging helper for REST routes — the transport-specific twin
 * of `electron-app/handlers/auditHelper.ts`'s `audit()`/`auditFromAuth()`.
 *
 * Both transports converge on the SAME write path: `getAuditService().log()`
 * -> `AuditRepository.log()` (one parameterized INSERT into `audit_log`,
 * tenant-scoped automatically via `getCurrentTenantId()`). This helper only
 * supplies the REST-specific actor resolution.
 *
 * Unlike IPC's `audit()`, which resolves the actor from an in-process
 * `webContentsId -> session` map (no equivalent exists on an Express
 * request) and then looks up the username via a repository call, REST
 * already has the full actor identity on `req.user` — populated by
 * `authenticateJWT` from the verified JWT. No repository lookup needed.
 *
 * Fire-and-forget, same contract as the IPC helper: never throws, so a
 * logging failure can never fail the mutation it's attached to.
 *
 * Actor trust: ALWAYS reads `req.user` (set by `authenticateJWT` from the
 * verified JWT) — never `req.body`. Callers must call this AFTER confirming
 * `result.success === true` and BEFORE `res.json(...)` — do not audit
 * business failures (rule 19c: HTTP 200 covers both outcomes, so status code
 * can't gate this; the caller's own `if (result.success)` branch must).
 */
import { getAuditService } from "@liratek/core";
import type { CreateAuditLogData } from "@liratek/core";
import type { AuthRequest } from "./auth.js";

export type AuditRestInput = Omit<
  CreateAuditLogData,
  "user_id" | "username" | "role"
>;

/**
 * Log an audit entry for a REST mutation. `req.user` must already be set
 * (i.e. this route sits behind `authenticateJWT`) — if it isn't, the call
 * is a no-op (never throws, matches the IPC helper's fire-and-forget contract).
 */
export function auditRest(req: AuthRequest, data: AuditRestInput): void {
  try {
    if (!req.user) return;
    getAuditService().log({
      ...data,
      user_id: req.user.userId,
      username: req.user.username,
      role: req.user.role,
    });
  } catch {
    // Never throw from audit — it must not break the mutation it's attached to.
  }
}
