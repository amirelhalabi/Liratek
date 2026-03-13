import { Request, Response, NextFunction } from "express";
import { logger } from "@liratek/core";

// Module permission matrix
const MODULE_PERMISSIONS: Record<
  string,
  { essentials: boolean; professional: boolean }
> = {
  // Essentials plan modules
  pos: { essentials: true, professional: true },
  inventory: { essentials: true, professional: true },
  debts: { essentials: true, professional: true },
  clients: { essentials: true, professional: true },

  // Professional-only modules
  exchange: { essentials: false, professional: true },
  expenses: { essentials: false, professional: true },
  services: { essentials: false, professional: true },
  recharge: { essentials: false, professional: true },
  profits: { essentials: false, professional: true },
  "session-management": { essentials: false, professional: true },
  "voice-bot": { essentials: false, professional: true },
  maintenance: { essentials: false, professional: true },
  "custom-services": { essentials: false, professional: true },
  settings: { essentials: false, professional: true },
};

/**
 * Check if client's plan has permission to access a module
 *
 * Usage:
 *   app.get("/api/pos/*", validateApiKey, checkPlanPermissions("pos"), posHandler);
 *   app.get("/api/exchange/*", validateApiKey, checkPlanPermissions("exchange"), exchangeHandler);
 */
export function checkPlanPermissions(moduleName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const client = req.client;

    if (!client) {
      logger.warn({ path: req.path }, "No client data in request");
      res.status(500).json({
        error: "Internal Error",
        message: "Authentication not properly initialized",
      });
      return;
    }

    const plan = client.plan;
    const permissions = MODULE_PERMISSIONS[moduleName];

    if (!permissions) {
      logger.warn(
        { moduleName, path: req.path },
        "Unknown module in permission check",
      );
      // Allow access for unknown modules (backward compatibility)
      return next();
    }

    const hasAccess =
      plan === "professional"
        ? permissions.professional
        : permissions.essentials;

    if (!hasAccess) {
      logger.warn(
        { shopName: client.shop_name, plan, moduleName, path: req.path },
        "Module access denied - plan restriction",
      );

      res.status(403).json({
        error: "Forbidden",
        message: `This feature is not available in your ${plan} plan.`,
        requiredPlan: permissions.professional ? "professional" : "essentials",
        currentPlan: plan,
        upgradeAvailable: true,
      });
      return;
    }

    logger.debug(
      { shopName: client.shop_name, plan, moduleName, path: req.path },
      "Module access granted",
    );

    next();
  };
}

/**
 * Get available modules for a plan
 */
export function getAvailableModules(
  plan: "essentials" | "professional",
): string[] {
  return Object.entries(MODULE_PERMISSIONS)
    .filter(([_, perms]) =>
      plan === "professional" ? perms.professional : perms.essentials,
    )
    .map(([name]) => name);
}

/**
 * Get plan comparison data
 */
export function getPlanComparison(): {
  essentials: string[];
  professional: string[];
  matrix: Record<string, { essentials: boolean; professional: boolean }>;
} {
  return {
    essentials: getAvailableModules("essentials"),
    professional: getAvailableModules("professional"),
    matrix: MODULE_PERMISSIONS,
  };
}

export default checkPlanPermissions;
