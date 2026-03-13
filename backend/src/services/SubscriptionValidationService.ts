import { logger } from "@liratek/core";
import { getGoogleSheetsService } from "./GoogleSheetsService.js";

interface SubscriptionStatus {
  isValid: boolean;
  shopName?: string;
  plan?: string;
  status?: string;
  error?: string;
  gracePeriodEnds?: string;
  expiresAt?: string;
  isCached?: boolean;
  isOffline?: boolean;
  validatedAt?: number;
}

/**
 * Validate subscription for a shop
 * Checks Google Sheets for API key validity and subscription status
 */
export async function validateSubscription(
  shopName: string,
): Promise<SubscriptionStatus> {
  try {
    const sheets = getGoogleSheetsService();
    const client = await sheets.getClientByShopName(shopName);

    if (!client) {
      logger.warn(
        { shopName },
        "Subscription validation failed - shop not found",
      );
      return {
        isValid: false,
        error: "Shop not found in subscription system",
      };
    }

    // Check API key exists
    if (!client.api_key) {
      logger.warn({ shopName }, "Subscription validation failed - no API key");
      return {
        isValid: false,
        error: "No API key configured for this shop",
      };
    }

    // Check subscription status
    if (client.status === "expired") {
      logger.warn({ shopName, status: client.status }, "Subscription expired");
      return {
        isValid: false,
        shopName: client.shop_name,
        plan: client.plan,
        status: client.status,
        error: "Subscription has expired. Please contact support.",
      };
    }

    if (client.status === "paused") {
      logger.warn({ shopName, status: client.status }, "Subscription paused");
      return {
        isValid: false,
        shopName: client.shop_name,
        plan: client.plan,
        status: client.status,
        error: "Subscription is paused. Please contact support.",
      };
    }

    // Check grace period
    if (client.status === "grace_period") {
      if (client.grace_period_ends) {
        const endsAt = new Date(client.grace_period_ends).getTime();
        const now = Date.now();

        if (now > endsAt) {
          logger.warn(
            { shopName, gracePeriodEnds: client.grace_period_ends },
            "Grace period expired",
          );
          return {
            isValid: false,
            shopName: client.shop_name,
            plan: client.plan,
            status: "expired",
            error: "Grace period has ended. Please renew your subscription.",
          };
        }
      }
      logger.info(
        { shopName, gracePeriodEnds: client.grace_period_ends },
        "Shop in grace period - allowing access",
      );
      return { isValid: true };
    }

    // Active subscription - but check expires_at
    if (client.status === "active") {
      // Check if subscription has expired based on expires_at date
      if (client.expires_at) {
        const expiresDate = new Date(client.expires_at);
        // Set to end of day to include the entire expiration day
        expiresDate.setHours(23, 59, 59, 999);
        const expiresAt = expiresDate.getTime();
        const now = Date.now();

        if (now > expiresAt) {
          logger.warn(
            { shopName, expiresAt: client.expires_at },
            "Subscription expired by date",
          );
          return {
            isValid: false,
            shopName: client.shop_name,
            plan: client.plan,
            status: "expired",
            error: "Subscription has expired. Please renew your subscription.",
          };
        }
      }
      logger.info(
        { shopName, plan: client.plan, expiresAt: client.expires_at },
        "Subscription validated successfully",
      );
      return { isValid: true };
    }

    // Unknown status
    logger.warn(
      { shopName, status: client.status },
      "Unknown subscription status",
    );
    return {
      isValid: false,
      shopName: client.shop_name,
      status: client.status,
      error: "Unknown subscription status",
    };
  } catch (error: any) {
    logger.error(
      { shopName, error: error.message },
      "Subscription validation failed",
    );

    // Fail open - allow login but log the error
    // This prevents Google Sheets downtime from blocking all logins
    return {
      isValid: true,
      shopName,
      error: `Subscription validation error: ${error.message}`,
    };
  }
}

export default validateSubscription;
