/**
 * Request logging middleware with correlation IDs
 */

import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { logger } from "../utils/logger.js";

// Extend Express Request to include correlationId
declare module "express-serve-static-core" {
  interface Request {
    correlationId?: string;
  }
}

/**
 * Middleware to add correlation ID to each request
 * and log request/response details
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // Generate or extract correlation ID
  const correlationId =
    (req.headers["x-correlation-id"] as string) ||
    (req.headers["x-request-id"] as string) ||
    randomUUID();

  // Attach to request
  req.correlationId = correlationId;

  // Add to response headers
  res.setHeader("X-Correlation-ID", correlationId);

  // Log request start
  const startTime = Date.now();

  logger.info(
    {
      correlationId,
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
    "Request started",
  );

  // Log response when finished
  const originalSend = res.send;
  res.send = function (body) {
    const duration = Date.now() - startTime;

    logger.info(
      {
        correlationId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
      },
      "Request completed",
    );

    return originalSend.call(this, body);
  };

  next();
}
