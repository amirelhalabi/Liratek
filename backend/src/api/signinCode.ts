/**
 * "Email me a code" sign-in on www (LIRA-287), mounted at
 * `/api/auth/signin-code` (before `/api/auth`).
 *
 *   POST /request   public   { email }        -> always the same message
 *   POST /verify    public   { email, code }  -> { shops: SigninShop[] }
 *
 * The owner-approved www sign-in (2026-10-07): a valid code shows the shops
 * where the email is a CONFIRMED user; the person then signs in on that
 * shop's own page with their password. A code never opens a session.
 *
 * All logic lives in core's SigninCodeService; this file applies the
 * per-IP limiters, refuses an unknown shop subdomain, and maps outcomes to
 * envelopes. Every request outcome — mailed, unknown email, unverified,
 * limit reached, mail not set up, an error — gets the SAME reply, so the
 * form cannot be used to learn which emails have accounts. Every unusable
 * code gets the ONE refusal `SIGNIN_CODE_INVALID` (HTTP 200, the contract's
 * business-refusal shape). Zod failures come from validateRequest.
 *
 * Web-only: the desktop app signs in with a username on its own machine and
 * has no www (the same recorded exception as LIRA-267's sign-up links), so
 * there is no IPC mirror. "Which shops does this email sign in to?" comes
 * from the platform sign-in directory (LIRA-288), so it works whether shops
 * share one file or each has its own.
 */

import express, { type Request } from "express";
import rateLimit from "express-rate-limit";
import {
  createErrorResponse,
  createSuccessResponse,
  getSigninCodeService,
  requestSigninCodeSchema,
  verifySigninCodeSchema,
  SIGNIN_CODE_INVALID,
  SIGNIN_CODE_INVALID_MESSAGE,
  SIGNIN_CODE_REQUEST_MESSAGE,
} from "@liratek/core";
import { validateRequest } from "../middleware/validation.js";
import {
  clientIpRateLimitKey,
  resolveClientIp,
} from "../middleware/clientIp.js";
import { resolveTenantHost } from "../middleware/tenantHost.js";
import { isEmailConfigured } from "../email/createTransport.js";
import { resolveSupportEmail } from "../email/emailConfig.js";
import { logger } from "../server.js";

const router = express.Router();

function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function hourlyLimiter(label: string, envName: string, max: number) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max: envLimit(envName, max),
    standardHeaders: true,
    legacyHeaders: false,
    // The real client IP (proxy-secret-verified header, else req.ip) — the
    // one helper every public limiter shares.
    keyGenerator: (req) => clientIpRateLimitKey(req),
    handler: (req, res) => {
      logger.warn(
        { ip: resolveClientIp(req), path: req.path },
        `Rate limit exceeded - ${label}`,
      );
      res.status(429).json({
        success: false,
        error: "Too many requests, please try again later",
      });
    },
  });
}

/** 10 code requests per hour per client IP (the per-email limit, 5 per
 * hour, is the service's). */
const requestLimiter = hourlyLimiter(
  "sign-in code request",
  "SIGNIN_CODE_REQUEST_RATE_LIMIT_MAX",
  10,
);

/** 30 code checks per hour per client IP. Each code also locks itself after
 * 5 wrong tries, and a new code burns the old ones. */
const verifyLimiter = hourlyLimiter(
  "sign-in code check",
  "SIGNIN_CODE_VERIFY_RATE_LIMIT_MAX",
  30,
);

/** An unknown shop subdomain refuses everything (like every public route). */
function onUnknownShop(req: Request): boolean {
  return resolveTenantHost(req).kind === "unknown";
}

function invalidCode() {
  return {
    ...createErrorResponse(SIGNIN_CODE_INVALID, SIGNIN_CODE_INVALID_MESSAGE),
    code: SIGNIN_CODE_INVALID,
  };
}

router.post(
  "/request",
  requestLimiter,
  validateRequest(requestSigninCodeSchema),
  (req, res): void => {
    const sent = (): void => {
      res.json(createSuccessResponse({ message: SIGNIN_CODE_REQUEST_MESSAGE }));
    };
    try {
      if (onUnknownShop(req)) {
        sent();
        return;
      }
      const { email } = req.body as { email: string };
      getSigninCodeService().requestCode({
        email,
        now: new Date().toISOString(),
        emailConfigured: isEmailConfigured(),
        supportEmail: resolveSupportEmail(),
        requesterIp: resolveClientIp(req) || null,
      });
      sent();
    } catch (error) {
      // Still the generic answer: an error must not reveal that the email
      // matched an account (only that path does real work).
      logger.error({ error }, "Sign-in code request failed");
      sent();
    }
  },
);

router.post(
  "/verify",
  verifyLimiter,
  validateRequest(verifySigninCodeSchema),
  (req, res): void => {
    try {
      if (onUnknownShop(req)) {
        res.json(invalidCode());
        return;
      }
      const { email, code } = req.body as { email: string; code: string };
      const result = getSigninCodeService().verifyCode({
        email,
        code,
        now: new Date().toISOString(),
      });
      if (!result) {
        res.json(invalidCode());
        return;
      }
      res.json(createSuccessResponse(result));
    } catch (error) {
      logger.error({ error }, "Sign-in code check failed");
      res.json(invalidCode());
    }
  },
);

export default router;
