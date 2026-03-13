import { Router, Request, Response } from "express";
import { validateSubscription } from "../services/SubscriptionValidationService.js";
import { logger } from "@liratek/core";
import { getGoogleSheetsService } from "../services/GoogleSheetsService.js";
import { getSubscriptionCache } from "../services/SubscriptionCacheService.js";
import { getSubscriptionSyncService } from "../services/SubscriptionSyncService.js";
import { getPlanComparison } from "../middleware/checkPlanPermissions.js";
import { validateApiKey } from "../middleware/validateApiKey.js";
import { authenticateJWT } from "../middleware/auth.js";

const router = Router();

/**
 * GET /api/subscription/current
 * Get current client's subscription info
 */
router.get("/current", validateApiKey, async (req: Request, res: Response) => {
  try {
    const client = req.client!;

    res.json({
      shop_name: client.shop_name,
      plan: client.plan,
      status: client.status,
      features: getPlanComparison()[client.plan],
      created_at: client.created_at,
      expires_at: client.expires_at,
      grace_period_ends: client.grace_period_ends,
      billing_cycle: client.billing_cycle,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to get subscription info");
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to retrieve subscription information",
    });
  }
});

/**
 * GET /api/subscription/plans
 * Get available plans and their features
 */
router.get("/plans", (_req: Request, res: Response) => {
  try {
    const comparison = getPlanComparison();

    res.json({
      plans: [
        {
          name: "essentials",
          displayName: "Essentials",
          description: "Essential features for small shops",
          features: comparison.essentials,
        },
        {
          name: "professional",
          displayName: "Professional",
          description: "Full-featured for established shops",
          features: comparison.professional,
        },
      ],
      matrix: comparison.matrix,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to get plans");
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to retrieve plan information",
    });
  }
});

/**
 * POST /api/subscription/change-plan
 * Request plan change (requires admin approval)
 */
router.post(
  "/change-plan",
  validateApiKey,
  async (req: Request, res: Response) => {
    try {
      const client = req.client!;
      const { new_plan } = req.body;

      if (!new_plan || !["essentials", "professional"].includes(new_plan)) {
        res.status(400).json({
          error: "Bad Request",
          message: "Invalid plan. Must be 'essentials' or 'professional'",
        });
        return;
      }

      if (new_plan === client.plan) {
        res.status(400).json({
          error: "Bad Request",
          message: "Already on this plan",
        });
        return;
      }

      // Log the request (admin will need to approve in Google Sheets)
      logger.info(
        {
          shopName: client.shop_name,
          currentPlan: client.plan,
          requestedPlan: new_plan,
        },
        "Plan change requested",
      );

      res.json({
        success: true,
        message:
          "Plan change request submitted. Please contact admin for approval.",
        current_plan: client.plan,
        requested_plan: new_plan,
        requires_approval: true,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, "Failed to process plan change");
      res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to process plan change request",
      });
    }
  },
);

export default router;

// Admin-only endpoints
export const adminRouter = Router();

/**
 * GET /api/admin/clients
 * Get all clients (admin only)
 */
adminRouter.get("/clients", async (_req: Request, res: Response) => {
  try {
    const sheets = getGoogleSheetsService();
    const clients = await sheets.getAllClients();

    // Remove sensitive data
    const sanitized = clients.map((c) => ({
      shop_name: c.shop_name,
      plan: c.plan,
      status: c.status,
      contact_email: c.contact_email,
      contact_phone: c.contact_phone,
      created_at: c.created_at,
      last_login_at: c.last_login_at,
      billing_cycle: c.billing_cycle,
      notes: c.notes,
    }));

    res.json({ clients: sanitized, total: sanitized.length });
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to get clients");
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to retrieve client list",
    });
  }
});

/**
 * GET /api/admin/clients/:shopName
 * Get specific client details (admin only)
 */
adminRouter.get("/clients/:shopName", async (req: Request, res: Response) => {
  try {
    const { shopName } = req.params;
    const sheets = getGoogleSheetsService();
    const client = await sheets.getClientByShopName(shopName);

    if (!client) {
      res.status(404).json({
        error: "Not Found",
        message: `Client not found: ${shopName}`,
      });
      return;
    }

    res.json({ client });
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to get client");
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to retrieve client information",
    });
  }
});

/**
 * POST /api/admin/clients/:shopName/sync
 * Force sync client data from Google Sheets (admin only)
 */
adminRouter.post(
  "/clients/:shopName/sync",
  async (req: Request, res: Response) => {
    try {
      const { shopName } = req.params;
      const sheets = getGoogleSheetsService();
      const cache = getSubscriptionCache();

      const client = await sheets.getClientByShopName(shopName);
      if (!client) {
        res.status(404).json({
          error: "Not Found",
          message: `Client not found: ${shopName}`,
        });
        return;
      }

      cache.set(shopName, client);
      await sheets.updateLastSyncedAt(shopName);

      logger.info({ shopName }, "Client data synced");
      res.json({
        success: true,
        message: "Client data synced successfully",
        last_synced_at: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error({ error: error.message }, "Failed to sync client");
      res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to sync client data",
      });
    }
  },
);

/**
 * GET /api/admin/sync/status
 * Get sync service status (admin only)
 */
adminRouter.get("/sync/status", (_req: Request, res: Response) => {
  try {
    const syncService = getSubscriptionSyncService();
    const status = syncService.getStatus();

    res.json(status);
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to get sync status");
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to retrieve sync status",
    });
  }
});

/**
 * POST /api/admin/sync/trigger
 * Manually trigger sync (admin only)
 */
adminRouter.post("/sync/trigger", async (_req: Request, res: Response) => {
  try {
    const syncService = getSubscriptionSyncService();
    const result = await syncService.syncFromSheets();

    res.json({
      success: true,
      message: "Sync completed",
      ...result,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to trigger sync");
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to trigger sync",
    });
  }
});

/**
 * GET /api/subscription/validate/:shopName
 * Validate subscription for a specific shop (for Electron session restore)
 */
router.get("/validate/:shopName", async (req: Request, res: Response) => {
  try {
    const { shopName } = req.params;
    const subscription = await validateSubscription(shopName);

    if (!subscription.isValid) {
      res.status(403).json({
        success: false,
        error: {
          code: "SUBSCRIPTION_INVALID",
          message: subscription.error,
          details: {
            shopName: subscription.shopName,
            plan: subscription.plan,
            status: subscription.status,
          },
        },
      });
    } else {
      res.json({
        success: true,
        data: {
          shopName: subscription.shopName,
          plan: subscription.plan,
          status: subscription.status,
        },
      });
    }
  } catch (error: any) {
    logger.error({ error: error.message }, "Subscription validation error");
    res.status(500).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Failed to validate subscription",
      },
    });
  }
});

/**
 * POST /api/subscription/validate-self
 * Get current authenticated user's subscription status (for frontend)
 */
router.post(
  "/validate-self",
  authenticateJWT,
  async (req: Request, res: Response): Promise<Response> => {
    const user = (req as any).user;

    if (!user?.username) {
      return res.status(400).json({
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: "User not authenticated",
        },
      });
    }

    try {
      const status = await validateSubscription(user.username);

      if (!status.isValid && !status.isOffline) {
        return res.status(403).json({
          success: false,
          error: {
            code: "SUBSCRIPTION_INVALID",
            message: status.error || "Subscription validation failed",
            details: {
              shopName: status.shopName,
              plan: status.plan,
              status: status.status,
              gracePeriodEnds: status.gracePeriodEnds,
              expiresAt: status.expiresAt,
              isCached: status.isCached,
              isOffline: status.isOffline,
              validatedAt: status.validatedAt,
            },
          },
        });
      }

      res.json({
        success: true,
        data: {
          isValid: status.isValid,
          shopName: status.shopName,
          plan: status.plan,
          status: status.status,
          error: status.error,
          expiresAt: status.expiresAt,
          isCached: status.isCached,
          isOffline: status.isOffline,
          validatedAt: status.validatedAt,
        },
      });
    } catch (error: any) {
      logger.error(
        { username: user.username, error: error.message },
        "Error validating current user subscription",
      );

      // Return offline/cached status if available
      return res.status(503).json({
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Subscription validation unavailable",
          details: {
            isOffline: true,
            error: error.message,
          },
        },
      });
    }

    // This line should never be reached, but TypeScript requires it
    return res;
  },
);
