/**
 * Audit trail for the WEB transport.
 *
 * The desktop side has had one for a long time: 35 IPC handler files call
 * `audit(...)` (electron-app/handlers/auditHelper.ts) at 146 sites. The REST
 * routes called it at ZERO. So every sale, refund, void, debt repayment and
 * drawer movement made through the browser was unrecorded — and because the
 * audit *viewer* reads over REST and works fine, the page looked healthy while
 * having nothing to show for web activity. On a POS system that is the kind of
 * gap you only discover on the day you need the trail.
 *
 * This middleware closes the coverage hole for every mutating route at once.
 * It writes deliberately COARSE rows, tagged `metadata.audit_source =
 * "http-middleware"`, so they are honest about their precision and easy to
 * distinguish from a hand-written semantic entry. Routes that deserve richer
 * rows (entity ids, before/after values) should call `auditFromRequest()`
 * directly — that is the same shape the desktop handlers use, and a semantic
 * row is strictly better than what this produces. The middleware is the floor,
 * not the ceiling.
 *
 * ── Two implementation constraints, both load-bearing ──
 *
 * 1. WHERE the row is written. `AuditRepository extends BaseRepository`, so it
 *    is tenant-scoped and reads the tenant from AsyncLocalStorage — and
 *    `tenantContext.ts` is fail-closed, so a write with no context throws. A
 *    `res.on("finish")` hook fires outside that async scope, which would break
 *    every row. Wrapping `res.json` instead keeps the write inside the
 *    request's own context, where the tenant is still set.
 *
 * 2. NEVER throwing. An audit failure must not fail a money write. Everything
 *    here is wrapped, mirroring `AuditService.log`'s own fire-and-forget
 *    contract.
 */

import type { Request, Response, NextFunction } from "express";
import { getAuditService, createChildLogger } from "@liratek/core";
import type { CreateAuditLogData } from "@liratek/core";
import {
  ACTION_BY_METHOD,
  entityTypeFromPath,
  onMutationSuccess,
} from "./mutationOutcome.js";

const auditLogger = createChildLogger({ module: "audit" });

/**
 * Routes this middleware cannot meaningfully audit.
 *
 * `/api/auth/*` is the important one: those routes do not run
 * `authenticateJWT`, so there is no `req.user` to attribute a row to at
 * response time. Login/logout auditing needs to happen inside the auth route
 * itself, where the authenticated identity is known — tracked as a follow-up.
 */
const EXEMPT_PREFIXES = ["/api/auth/", "/health"];

/**
 * Field names whose values must never reach `audit_log`.
 *
 * This table is human-readable by admins and is exported; a plaintext password
 * or bearer token in it would be a worse leak than the missing trail this file
 * fixes. Matched case-insensitively against the key, as a substring, so
 * `adminPassword` and `new_password` are both caught.
 */
const REDACT_KEY_PATTERNS = [
  "password",
  "token",
  "secret",
  "hash",
  "pin",
  "database_key",
  "jwt",
];

const MAX_SERIALIZED_BODY = 2000;

function shouldRedact(key: string): boolean {
  const k = key.toLowerCase();
  return REDACT_KEY_PATTERNS.some((p) => k.includes(p));
}

/** Recursively copy a request body with sensitive values replaced. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = shouldRedact(k) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}

/**
 * Write a semantic audit row from inside a REST route.
 *
 * Prefer this over relying on the middleware whenever the route knows what it
 * actually did — the entity id and a real summary are what make a trail useful.
 * Actor, role and impersonator are taken from the JWT, never from the client.
 *
 * Safe to call anywhere in a route handler; never throws.
 */
export function auditFromRequest(
  req: Request,
  data: Omit<CreateAuditLogData, "user_id" | "username" | "role">,
): void {
  try {
    const user = req.user;
    if (!user) return;
    getAuditService().log({
      ...data,
      user_id: user.userId,
      username: user.username,
      role: user.role,
      // Preserve who really acted when a super admin is impersonating a tenant.
      impersonator_id: user.impersonatorId ?? null,
    });
  } catch (error) {
    auditLogger.error({ error }, "auditFromRequest failed");
  }
}

/**
 * Express middleware: records one coarse audit row per successful mutating
 * request. Mount BEFORE the API routers so the `res.json` wrapper is installed;
 * `req.user` is read at response time, by which point the router's
 * `authenticateJWT` has populated it.
 */
export function auditRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  onMutationSuccess(req, res, EXEMPT_PREFIXES, (body) => {
    try {
      writeRow(req, res, body);
    } catch (error) {
      auditLogger.error({ error }, "audit middleware failed");
    }
  });

  next();
}

function writeRow(req: Request, res: Response, _body: unknown): void {
  const user = req.user;
  if (!user) return; // unauthenticated mutations are rejected; nothing to attribute

  let serialized: unknown = undefined;
  if (req.body && typeof req.body === "object") {
    const safe = redact(req.body);
    const asText = JSON.stringify(safe);
    serialized =
      asText && asText.length > MAX_SERIALIZED_BODY
        ? `${asText.slice(0, MAX_SERIALIZED_BODY)}…[truncated]`
        : safe;
  }

  getAuditService().log({
    user_id: user.userId,
    username: user.username,
    role: user.role,
    action: ACTION_BY_METHOD[req.method] ?? req.method.toLowerCase(),
    entity_type: entityTypeFromPath(req.path),
    entity_id: null,
    summary: `${req.method} ${req.path}`,
    new_values: null,
    metadata: {
      // Marks the row as auto-generated and coarse, so it is never mistaken
      // for a hand-written semantic entry.
      audit_source: "http-middleware",
      transport: "web",
      method: req.method,
      path: req.path,
      status: res.statusCode,
      request_body: serialized,
    },
    impersonator_id: user.impersonatorId ?? null,
  });
}
