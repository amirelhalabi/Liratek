import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { getCurrencyService } from "@liratek/core";
import { auditRest } from "../middleware/audit.js";
import { logger } from "../server.js";

const router = express.Router();

// All currency routes require auth
router.use(authenticateJWT);

// GET /api/currencies - List all currencies
router.get("/", (_req, res): void => {
  try {
    const currencyService = getCurrencyService();
    const currencies = currencyService.listCurrencies();
    res.json({ success: true, currencies });
  } catch (error) {
    logger.error({ error }, "List currencies error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch currencies" });
  }
});

// POST /api/currencies - Create a currency (admin only)
router.post("/", requireRole(["admin"]), async (req, res): Promise<void> => {
  try {
    const currencyService = getCurrencyService();
    const result = currencyService.createCurrency(req.body);

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    // Mirrors currencyHandlers.ts's currencies:create audit.
    auditRest(req, {
      action: "create",
      entity_type: "currency",
      entity_id: req.body.code,
      summary: `Created currency "${req.body.code}" (${req.body.name})`,
    });

    res.json(result);
  } catch (error) {
    logger.error({ error }, "Create currency error");
    res
      .status(500)
      .json({ success: false, error: "Failed to create currency" });
  }
});

// PUT /api/currencies/:id - Update a currency (admin only)
router.put("/:id", requireRole(["admin"]), async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: "Invalid currency ID" });
      return;
    }

    const currencyService = getCurrencyService();
    const result = currencyService.updateCurrency(id, req.body);

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    // Mirrors currencyHandlers.ts's currencies:update audit.
    auditRest(req, {
      action: "update",
      entity_type: "currency",
      entity_id: String(id),
      summary: `Updated currency #${id}`,
    });

    res.json(result);
  } catch (error) {
    logger.error({ error }, "Update currency error");
    res
      .status(500)
      .json({ success: false, error: "Failed to update currency" });
  }
});

// DELETE /api/currencies/:id - Delete a currency (admin only)
router.delete(
  "/:id",
  requireRole(["admin"]),
  async (req, res): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ success: false, error: "Invalid currency ID" });
        return;
      }

      const currencyService = getCurrencyService();
      const result = currencyService.deleteCurrency(id);

      if (!result.success) {
        res.status(400).json(result);
        return;
      }

      // Mirrors currencyHandlers.ts's currencies:delete audit.
      auditRest(req, {
        action: "delete",
        entity_type: "currency",
        entity_id: String(id),
        summary: `Deleted currency #${id}`,
      });

      res.json(result);
    } catch (error) {
      logger.error({ error }, "Delete currency error");
      res
        .status(500)
        .json({ success: false, error: "Failed to delete currency" });
    }
  },
);

// GET /api/currencies/by-module/:moduleKey - Get currencies for a module
router.get("/by-module/:moduleKey", (_req, res): void => {
  try {
    const currencyService = getCurrencyService();
    const currencies = currencyService.getCurrenciesForModule(
      _req.params.moduleKey,
    );
    res.json({ success: true, currencies });
  } catch (error) {
    logger.error({ error }, "Get currencies by module error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch currencies by module" });
  }
});

// GET /api/currencies/drawer-currencies - Get all drawer→currency[] mappings
router.get("/drawer-currencies", (_req, res): void => {
  try {
    const currencyService = getCurrencyService();
    const drawerCurrencies = currencyService.getAllDrawerCurrencies();
    res.json({ success: true, drawerCurrencies });
  } catch (error) {
    logger.error({ error }, "Get all drawer currencies error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch drawer currencies" });
  }
});

// GET /api/currencies/countable-drawer-currencies - Get the countable currency
// set (allowlist ∪ non-zero balances) per drawer
router.get("/countable-drawer-currencies", (_req, res): void => {
  try {
    const currencyService = getCurrencyService();
    const drawerCurrencies = currencyService.getCountableCurrenciesByDrawer();
    res.json({ success: true, drawerCurrencies });
  } catch (error) {
    logger.error({ error }, "Get countable drawer currencies error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch countable drawer currencies" });
  }
});

// GET /api/currencies/by-drawer/:drawerName - Get full currencies for a drawer
router.get("/by-drawer/:drawerName", (_req, res): void => {
  try {
    const currencyService = getCurrencyService();
    const currencies = currencyService.getFullCurrenciesForDrawer(
      _req.params.drawerName,
    );
    res.json({ success: true, currencies });
  } catch (error) {
    logger.error({ error }, "Get currencies by drawer error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch currencies by drawer" });
  }
});

// GET /api/currencies/:code/modules - Get modules for a currency
router.get("/:code/modules", (_req, res): void => {
  try {
    const currencyService = getCurrencyService();
    const modules = currencyService.getModulesForCurrency(_req.params.code);
    res.json({ success: true, modules });
  } catch (error) {
    logger.error({ error }, "Get modules for currency error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch modules for currency" });
  }
});

// PUT /api/currencies/:code/modules - Set modules for a currency (admin only)
router.put(
  "/:code/modules",
  requireRole(["admin"]),
  async (req, res): Promise<void> => {
    try {
      const currencyService = getCurrencyService();
      const result = currencyService.setModulesForCurrency(
        req.params.code,
        req.body.modules,
      );

      if (!result.success) {
        res.status(400).json(result);
        return;
      }

      // Mirrors currencyHandlers.ts's currencies:setModules audit.
      auditRest(req, {
        action: "update",
        entity_type: "currency_modules",
        entity_id: req.params.code,
        summary: `Set modules for currency ${req.params.code}`,
        new_values: { modules: req.body.modules },
      });

      res.json(result);
    } catch (error) {
      logger.error({ error }, "Set modules for currency error");
      res
        .status(500)
        .json({ success: false, error: "Failed to set modules for currency" });
    }
  },
);

export default router;
