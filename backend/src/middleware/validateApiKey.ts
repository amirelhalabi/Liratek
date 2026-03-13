import { Request, Response, NextFunction } from "express";
import { logger } from "@liratek/core";
import { getGoogleSheetsService } from "../services/GoogleSheetsService.js";
import { getSubscriptionCache } from "../services/SubscriptionCacheService.js";
import type { ClientData } from "../services/GoogleSheetsService.js";

// Extend Express Request type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      client?: ClientData;
    }
  }
}

/**
 * Extract API key from request headers
 */
function extractApiKey(req: Request): string | null {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return null;
  }

  // Support "Bearer <key>" format
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  // Support raw API key
  return authHeader;
}

/**
 * Validate API Key Middleware
 *
 * Validates the API key from request headers against Google Sheets data.
 * Uses local cache (12h TTL) for performance.
 *
 * On success: Adds client data to req.client
 * On failure: Returns 401 Unauthorized or 403 Forbidden
 */
export async function validateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = extractApiKey(req);

  if (!apiKey) {
    logger.warn({ path: req.path }, "Request missing API key");
    res.status(401).json({
      error: "Unauthorized",
      message: "API key required. Set LIRATEK_API_KEY in .env file.",
    });
    return;
  }

  try {
    const cache = getSubscriptionCache();
    const sheets = getGoogleSheetsService();

    // Try cache first
    let client = cache.getByApiKey(apiKey);

    if (!client) {
      // Cache miss - fetch from Google Sheets
      logger.debug(
        { apiKey: apiKey.substring(0, 8) + "..." },
        "Cache miss, fetching from sheets",
      );
      client = await sheets.getClientByApiKey(apiKey);

      if (client) {
        // Cache the client data
        cache.set(client.shop_name, client);
        logger.info(
          { shopName: client.shop_name },
          "Client data cached from sheets",
        );
      }
    }

    if (!client) {
      logger.warn(
        { apiKey: apiKey.substring(0, 8) + "..." },
        "Invalid API key",
      );
      res.status(401).json({
        error: "Unauthorized",
        message: "Invalid API key. Check your LIRATEK_API_KEY configuration.",
      });
      return;
    }

    // Check client status
    if (client.status === "expired") {
      logger.warn(
        { shopName: client.shop_name },
        "Client subscription expired",
      );
      res.status(403).json({
        error: "Forbidden",
        message: "Subscription expired. Please contact support.",
      });
      return;
    }

    if (client.status === "paused") {
      logger.warn({ shopName: client.shop_name }, "Client subscription paused");
      res.status(403).json({
        error: "Forbidden",
        message: "Subscription paused. Please contact support.",
      });
      return;
    }

    // Check if active subscription has expired by date
    if (client.status === "active" && client.expires_at) {
      const expiresAt = new Date(client.expires_at).getTime();
      const now = Date.now();

      if (now > expiresAt) {
        logger.warn(
          { shopName: client.shop_name, expiresAt: client.expires_at },
          "Client subscription expired by date",
        );
        res.status(403).json({
          error: "Forbidden",
          message: "Subscription has expired. Please renew your subscription.",
        });
        return;
      }
    }

    // Check grace period
    if (client.status === "grace_period") {
      if (client.grace_period_ends) {
        const endsAt = new Date(client.grace_period_ends).getTime();
        const now = Date.now();

        if (now > endsAt) {
          logger.warn(
            {
              shopName: client.shop_name,
              gracePeriodEnds: client.grace_period_ends,
            },
            "Grace period expired",
          );
          res.status(403).json({
            error: "Forbidden",
            message: "Grace period expired. Please renew your subscription.",
          });
          return;
        }
      }

      logger.info(
        {
          shopName: client.shop_name,
          gracePeriodEnds: client.grace_period_ends,
        },
        "Client in grace period",
      );
    }

    // Update last login timestamp (async, don't wait)
    sheets.updateLastLogin(client.shop_name).catch((err) => {
      logger.error(
        { error: err.message, shopName: client.shop_name },
        "Failed to update last login",
      );
    });

    // Attach client data to request
    req.client = client;

    logger.debug(
      { shopName: client.shop_name, plan: client.plan, path: req.path },
      "API key validated",
    );

    next();
  } catch (error: any) {
    logger.error(
      { error: error.message, apiKey: apiKey.substring(0, 8) + "..." },
      "API key validation failed",
    );

    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to validate API key. Please try again later.",
    });
  }
}

/**
 * Optional API key validation
 * Doesn't block if key is missing/invalid, just sets req.client to undefined
 */
export async function optionalApiKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = extractApiKey(req);

  if (!apiKey) {
    return next();
  }

  try {
    const cache = getSubscriptionCache();
    const sheets = getGoogleSheetsService();

    let client = cache.getByApiKey(apiKey);

    if (!client) {
      client = await sheets.getClientByApiKey(apiKey);
      if (client) {
        cache.set(client.shop_name, client);
      }
    }

    if (client && client.status === "active") {
      req.client = client;
    }
  } catch (error: any) {
    logger.error(
      { error: error.message },
      "Optional API key validation failed",
    );
  }

  next();
}

export default validateApiKey;
