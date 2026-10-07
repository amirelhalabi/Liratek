/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse and brute force attacks
 */

import type { Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import { logger } from "../server.js";
import { verifyJwt } from "./auth.js";

// Limits are env-tunable (a single authenticated POS session fires far more
// than 100 requests per 15 min in dev); defaults preserve prior behavior.
function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * The ONE message every general-API 429 carries (LIRA-282). The frontend shows
 * it as-is (`requestJson` throws it as `ApiError.message`), so it is written
 * for a cashier, not a developer.
 */
export const RATE_LIMIT_MESSAGE =
  "Too many requests — please wait a minute and try again.";

/**
 * General API rate limiting — `apiLimiter`, mounted on `/api/` in server.ts.
 *
 * ## Why it is not a single per-IP limiter any more (LIRA-282)
 *
 * It used to be: one bucket per IP for ALL `/api` traffic. A shop's tills sit
 * behind ONE internet connection, a page load is ~25–30 requests, so a few
 * tills loading pages together exhausted the shared bucket and EVERY till saw
 * "Failed to load data". Owner decision 2026-10-07: limit per user, with a
 * clear message.
 *
 * ## The three buckets
 *
 *  1. Anonymous / unverifiable — per IP, `API_RATE_LIMIT_MAX` per 15 min
 *     (default 100, production sets 1000). Unchanged from before.
 *  2. Authenticated — per USER (tenant + user id), `API_USER_RATE_LIMIT_MAX`
 *     per minute (default 200).
 *  3. Authenticated — per IP flood cap, `API_IP_FLOOD_RATE_LIMIT_MAX` per
 *     minute (default 1000), so one address holding many valid accounts still
 *     has a ceiling.
 *
 * Numbers: one page load ≈ 30 requests. 200/min is ~6–7 full page loads a
 * minute for one person, sustained — more than a cashier can click through,
 * with headroom for the refetch bursts socket invalidations trigger when
 * another till writes. 1000/min per IP is five tills each at that full rate.
 * The 1-minute window is also what makes "wait a minute" in the message
 * true: a till that trips its limit is back within 60 s, not 15 minutes.
 *
 * ## Where the identity comes from — and why that is safe before auth
 *
 * Routers run their own `authenticateJWT`, AFTER this app-level limiter, so
 * there is no single post-auth point to hang a per-user limiter on. Instead
 * the identity is read here with `verifyJwt` — the same pre-auth pattern
 * `requireWritableSubscription` uses — which checks the HS256 SIGNATURE and
 * the v2 payload shape. A forged, unsigned, malformed or expired token
 * returns null and falls into the anonymous per-IP bucket, so nobody can pick
 * their own bucket. A signature-valid token whose session has since been
 * revoked still only reaches that real user's own bucket (nobody can mint
 * signatures), and is then refused by `authenticateJWT` as usual.
 *
 * Keyed by user id, NOT by `sessionToken`: `authLimiter` skips successful
 * logins, so a per-session key would let anyone with credentials mint fresh
 * buckets by logging in again. Consequence to know: tills that share ONE
 * login share one bucket — size the per-user number for that.
 *
 * The identity is stored on `res.locals`, NEVER on `req.user`: `requireRole`
 * trusts `req.user`, and setting it from a merely signature-valid token
 * (no DB session check) would be an authentication bypass.
 *
 * Login / signup / invite / password endpoints keep their own strict per-IP
 * limiters below — they are deliberately untouched.
 */
const RATE_LIMIT_IDENTITY = "rateLimitIdentity";

/** The verified per-user bucket key for this request, or null (anonymous). */
function verifiedIdentityKey(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const payload = verifyJwt(header.substring(7));
  if (!payload) return null;
  return payload.tenantId === null
    ? `platform:user:${payload.userId}`
    : `tenant:${payload.tenantId}:user:${payload.userId}`;
}

function identityOf(res: Response): string | null {
  const value: unknown = res.locals[RATE_LIMIT_IDENTITY];
  return typeof value === "string" ? value : null;
}

function rejectRateLimited(
  label: string,
  retryAfter: string,
  error: string = RATE_LIMIT_MESSAGE,
): (req: Request, res: Response) => void {
  return (req, res) => {
    logger.warn(
      {
        ip: req.ip,
        identity: identityOf(res),
        path: req.path,
        method: req.method,
      },
      `Rate limit exceeded - ${label}`,
    );
    res.status(429).json({
      success: false,
      error,
      retryAfter,
    });
  };
}

/** Bucket 1: anonymous / unverifiable traffic, per IP (unchanged numbers). */
const anonymousIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: envLimit("API_RATE_LIMIT_MAX", 100),
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: (_req, res) => identityOf(res) !== null,
  // Keeps its old wording: this window is 15 minutes, so "wait a minute"
  // would be untrue here.
  handler: rejectRateLimited(
    "general API (anonymous, per IP)",
    "15 minutes",
    "Too many requests from this IP, please try again later.",
  ),
});

/** Bucket 2: authenticated traffic, per user. */
const perUserLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: envLimit("API_USER_RATE_LIMIT_MAX", 200),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (_req, res) => identityOf(res) === null,
  keyGenerator: (_req, res) => identityOf(res) ?? "",
  handler: rejectRateLimited("general API (per user)", "1 minute"),
});

/**
 * Bucket 3: authenticated traffic, per-IP flood cap.
 *
 * Set high on purpose (owner decision 2026-10-07): in production `req.ip` is
 * currently a hosting proxy address shared by EVERY shop (measured: all
 * sessions record 66.241.124.103), so this bucket is effectively global
 * until LIRA-283 reads the real client address. It must only stop a flood,
 * never normal multi-shop traffic.
 */
const authenticatedIpFloodLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: envLimit("API_IP_FLOOD_RATE_LIMIT_MAX", 10000),
  // No headers: it runs AFTER the per-user limiter and would overwrite the
  // per-user `RateLimit-*` values with the shop-wide ones.
  standardHeaders: false,
  legacyHeaders: false,
  skip: (_req, res) => identityOf(res) === null,
  handler: rejectRateLimited("general API (authenticated, per IP)", "1 minute"),
});

// Per-user BEFORE the flood cap: a request refused by its own user's limit
// never reaches the IP counter, so one runaway till cannot eat the rest of
// the shop's shared flood budget.
const generalLimiters: RequestHandler[] = [
  anonymousIpLimiter,
  perUserLimiter,
  authenticatedIpFloodLimiter,
];

export const apiLimiter: RequestHandler = (req, res, next) => {
  res.locals[RATE_LIMIT_IDENTITY] = verifiedIdentityKey(req);
  let index = 0;
  const step = (err?: unknown): void => {
    if (err) {
      next(err);
      return;
    }
    const limiter = generalLimiters[index++];
    if (!limiter) {
      next();
      return;
    }
    void limiter(req, res, step);
  };
  step();
};

/**
 * Strict rate limiter for authentication endpoints
 * - 5 attempts per 15 minutes per IP
 * - Prevents brute force attacks on login
 * - Only counts failed attempts (skipSuccessfulRequests: true)
 */
/**
 * Signup limiter.
 *
 * Separate from authLimiter, and the difference is the point: authLimiter sets
 * skipSuccessfulRequests, because for LOGIN only failures are suspicious. For
 * signup a SUCCESS is exactly what needs limiting — each one permanently
 * consumes a globally-unique slug and creates a tenant. So this counts every
 * request.
 *
 * Which is also why the cap is 5 rather than the 3 this started at: counting
 * failures means a mistyped form (e.g. a taken slug) burns a slot, and locking someone out
 * for an hour over two typos is a worse failure than letting one IP create
 * five shops. `SIGNUP_RATE_LIMIT_MAX` raises it (dev deployments want more).
 */
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: envLimit("SIGNUP_RATE_LIMIT_MAX", 5),
  message: {
    success: false,
    error: "Too many signup attempts from this IP, please try again later.",
    retryAfter: "1 hour",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Invite-link check limiter (LIRA-267).
 *
 * `POST /signup/invite/check` runs every time the sign-up page loads with an
 * `?invite=` link. It used to share `signupLimiter` (5/hour), so a visitor
 * who reloaded the page a few times was locked out of SIGNING UP before
 * they had submitted anything. A check is read-only and reveals only
 * "usable or not" for a 256-bit token, so it gets its own, roomier budget.
 */
export const signupCheckLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: envLimit("SIGNUP_CHECK_RATE_LIMIT_MAX", 30),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(
      { ip: req.ip, path: req.path },
      "Rate limit exceeded - invite check",
    );
    res.status(429).json({
      success: false,
      error: "Too many requests, please try again later",
    });
  },
});

/**
 * Self-serve "email me a sign-up link" limiter (LIRA-267 FR-029): 5 per hour
 * per IP. Counts every request. The answer never depends on the email, so
 * it may differ from the generic success body (FR-028's one exception).
 */
export const signupRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: envLimit("SIGNUP_REQUEST_RATE_LIMIT_MAX", 5),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(
      { ip: req.ip, path: req.path },
      "Rate limit exceeded - sign-up request",
    );
    res.status(429).json({
      success: false,
      error: "Too many requests, please try again later",
    });
  },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: envLimit("AUTH_RATE_LIMIT_MAX", 5), // failed attempts per window
  message: {
    success: false,
    error:
      "Too many login attempts from this IP, please try again after 15 minutes.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
  handler: (req, res) => {
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        username: req.body?.username,
      },
      "Rate limit exceeded - authentication",
    );
    res.status(429).json({
      success: false,
      error:
        "Too many login attempts from this IP, please try again after 15 minutes.",
      retryAfter: "15 minutes",
    });
  },
});

/**
 * Strict rate limiter for sensitive operations
 * - 10 requests per 15 minutes per IP
 * - For operations like password reset, user creation, etc.
 */
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: {
    success: false,
    error: "Too many requests for this operation, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        method: req.method,
      },
      "Rate limit exceeded - sensitive operation",
    );
    res.status(429).json({
      success: false,
      error: "Too many requests for this operation, please try again later.",
      retryAfter: "15 minutes",
    });
  },
});

/**
 * Rate limiter for the profits-unlock endpoint (password gate, frozen
 * contract PROFITS_GATE_CONTRACT.md).
 * - ~5 FAILED attempts per 15 minutes per IP (skipSuccessfulRequests: true)
 * - Cloned from `authLimiter`, deliberately NOT `strictLimiter`:
 *   `strictLimiter` counts successful requests too, and the owner chose
 *   "re-prompt on every visit to /profits" — a legitimate user visiting the
 *   page 10 times in 15 minutes would get 429'd on correct passwords if
 *   successes counted toward the limit.
 */
export const profitsUnlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: envLimit("PROFITS_UNLOCK_RATE_LIMIT_MAX", 5), // failed attempts per window
  message: {
    success: false,
    error:
      "Too many unlock attempts from this IP, please try again after 15 minutes.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful unlocks
  handler: (req, res) => {
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
      },
      "Rate limit exceeded - profits unlock",
    );
    res.status(429).json({
      success: false,
      error:
        "Too many unlock attempts from this IP, please try again after 15 minutes.",
      retryAfter: "15 minutes",
    });
  },
});

/**
 * Lenient rate limiter for read-only operations
 * - 300 requests per 15 minutes per IP
 * - For GET endpoints that are safe to call frequently
 */
export const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requests per window
  message: {
    success: false,
    error: "Too many requests, please slow down.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.info(
      {
        ip: req.ip,
        path: req.path,
      },
      "Rate limit exceeded - read operations",
    );
    res.status(429).json({
      success: false,
      error: "Too many requests, please slow down.",
      retryAfter: "15 minutes",
    });
  },
});
