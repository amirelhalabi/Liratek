import express from "express";
import { authenticateJWT } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import {
  getCustomServiceService,
  createCustomServiceSchema,
} from "@liratek/core";
import { logger } from "../server.js";

const router = express.Router();

// All custom-services routes require auth
router.use(authenticateJWT);

// GET /api/custom-services - List services (optional ?date=YYYY-MM-DD)
router.get("/", (req, res): void => {
  try {
    const service = getCustomServiceService();
    const filter = req.query.date
      ? { date: String(req.query.date) }
      : undefined;
    const services = service.getServices(filter);
    res.json({ success: true, services });
  } catch (error) {
    logger.error({ error }, "Get custom services error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch custom services" });
  }
});

// GET /api/custom-services/summary - Today's summary stats
router.get("/summary", (_req, res): void => {
  try {
    const service = getCustomServiceService();
    const summary = service.getTodaySummary();
    res.json({ success: true, summary });
  } catch (error) {
    logger.error({ error }, "Get custom services summary error");
    res.status(500).json({ success: false, error: "Failed to fetch summary" });
  }
});

// GET /api/custom-services/:id - Get single service
router.get("/:id", (req, res): void => {
  try {
    const service = getCustomServiceService();
    const record = service.getServiceById(Number(req.params.id));
    if (!record) {
      res.status(404).json({ success: false, error: "Service not found" });
      return;
    }
    res.json({ success: true, service: record });
  } catch (error) {
    logger.error({ error }, "Get custom service error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch custom service" });
  }
});

// POST /api/custom-services - Create service
router.post(
  "/",
  validateRequest(createCustomServiceSchema),
  (req, res): void => {
    try {
      const service = getCustomServiceService();
      const result = service.addService(req.body);

      if (!result.success) {
        res.status(400).json(result);
        return;
      }

      res.json(result);
    } catch (error) {
      logger.error({ error }, "Create custom service error");
      res
        .status(500)
        .json({ success: false, error: "Failed to create custom service" });
    }
  },
);

// DELETE /api/custom-services/:id - Delete service
router.delete("/:id", (req, res): void => {
  try {
    const service = getCustomServiceService();
    const result = service.deleteService(Number(req.params.id));

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    res.json(result);
  } catch (error) {
    logger.error({ error }, "Delete custom service error");
    res
      .status(500)
      .json({ success: false, error: "Failed to delete custom service" });
  }
});

export default router;
