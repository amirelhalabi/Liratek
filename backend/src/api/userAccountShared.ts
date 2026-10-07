/**
 * Shared plumbing for feature B's two routers (`userInvitations.ts`,
 * `userEmail.ts`): the public-token scope, the error envelope, the id-param
 * guard and the per-IP limiter for the public link routes. Defined once
 * (rule 14) so the two routers cannot answer the same situation differently.
 */

import type { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import {
  AppError,
  ErrorCodes,
  createErrorResponse,
  runWithTenant,
  runWithoutTenant,
} from "@liratek/core";
import { resolveTenantHost, isHostTenancyActive } from "../middleware/tenantHost.js";
import { isPerTenantDbMode } from "../database/tenantDbMode.js";
import { logger } from "../server.js";

/**
 * Where a PUBLIC by-token route may look a token up.
 *
 *   - On a shop's own subdomain: inside that shop's scope (its file, in
 *     per-tenant mode), and the token must belong to that shop.
 *   - On the platform host or an unknown subdomain while host tenancy is on:
 *     refused. Every shop-scoped link points at the shop's subdomain.
 *   - Host tenancy off (local dev, preview, e2e): shared-DB mode reads
 *     across shops (the token names its shop). Per-tenant mode has no way to
 *     know which file to read, so it refuses.
 *
 * `ok: false` is answered with the route's ONE generic message.
 */
export type PublicTokenScope =
  | { ok: false }
  | {
      ok: true;
      requiredTenantId: number | null;
      run: <T>(fn: () => T) => T;
    };

export function resolvePublicTokenScope(req: Request): PublicTokenScope {
  const realm = resolveTenantHost(req);
  if (realm.kind === "tenant") {
    const tenantId = realm.tenant.id;
    return {
      ok: true,
      requiredTenantId: tenantId,
      run: (fn) => runWithTenant(tenantId, fn),
    };
  }
  if (isHostTenancyActive(realm)) return { ok: false };
  if (isPerTenantDbMode()) return { ok: false };
  return { ok: true, requiredTenantId: null, run: (fn) => runWithoutTenant(fn) };
}

/**
 * The contract envelope for a failure: an expected business refusal
 * (AppError) is HTTP 200 + `{ success:false, error:{ code, message } }`
 * (contract "Statuses"); anything else is logged and a 500.
 */
export function sendFailure(
  res: Response,
  error: unknown,
  logMessage: string,
  fallback: string,
): void {
  if (error instanceof AppError) {
    res.json(createErrorResponse(error.code, error.message));
    return;
  }
  logger.error({ error }, logMessage);
  res.status(500).json(createErrorResponse(ErrorCodes.INTERNAL_ERROR, fallback));
}

/**
 * A positive integer path id, strictly (no "1e3", no " 5"). A bad one is
 * refused exactly like `validateRequest` refuses a bad body: HTTP 200 +
 * `success:false` (rule 19c), with the VALIDATION_ERROR code.
 */
export function requirePositiveIdParam(name: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!/^[1-9]\d*$/.test(req.params[name] ?? "")) {
      res.json(createErrorResponse(ErrorCodes.VALIDATION_ERROR, `Invalid ${name}`));
      return;
    }
    next();
  };
}

function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * Per-IP limiter for the public link routes (join check/accept, email
 * verify). Local to feature B because `middleware/rateLimit.ts` belongs to
 * feature A; it keys on `req.ip` like the LIRA-267 limiters until A's
 * real-client-IP key generator lands.
 */
export function createPublicLinkLimiter(envName: string, label: string) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max: envLimit(envName, 30),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn({ ip: req.ip, path: req.path }, `Rate limit exceeded - ${label}`);
      res.status(429).json({
        success: false,
        error: "Too many requests, please try again later",
      });
    },
  });
}
