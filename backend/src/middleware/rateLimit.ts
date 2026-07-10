/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse and brute force attacks
 */

import rateLimit from "express-rate-limit";
import { logger } from "../server.js";

// Limits are env-tunable (a single authenticated POS session fires far more
// than 100 requests per 15 min in dev); defaults preserve prior behavior.
function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * General API rate limiter
 * - API_RATE_LIMIT_MAX requests per 15 minutes per IP (default 100)
 * - Protects all /api/* routes
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: envLimit("API_RATE_LIMIT_MAX", 100),
  message: {
    success: false,
    error: "Too many requests from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        method: req.method,
      },
      "Rate limit exceeded - general API",
    );
    res.status(429).json({
      success: false,
      error: "Too many requests from this IP, please try again later.",
      retryAfter: "15 minutes",
    });
  },
});

/**
 * Strict rate limiter for authentication endpoints
 * - 5 attempts per 15 minutes per IP
 * - Prevents brute force attacks on login
 * - Only counts failed attempts (skipSuccessfulRequests: true)
 */
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
