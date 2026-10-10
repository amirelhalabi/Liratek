/**
 * Warranty REST routes (LIRA-296 — warranty for any item) — the web twin of
 * electron-app/handlers/warrantyHandlers.ts. Both call the SAME core
 * `WarrantyService` with the SAME shared schemas (rules 14 and 19).
 *
 * Every route: `authenticateJWT` (tenant context) → `requireRole` (the same
 * roles as the IPC handler) → validation → the IPC-identical envelope
 * (`{ success, data?, error? }`, HTTP 200 even on a refusal, rule 19c).
 */
import express from "express";
import {
  getWarrantyService,
  warrantySearchSchema,
  warrantyLogger,
  type WarrantySearchQuery,
} from "@liratek/core";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validation.js";

const router = express.Router();
router.use(authenticateJWT);

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

// GET /api/warranty/search?q&from&to&state&client_day&limit — admin, staff.
router.get(
  "/search",
  requireRole(["admin", "staff"]),
  validateQuery(warrantySearchSchema),
  (req, res) => {
    try {
      const data = getWarrantyService().search(
        req.query as unknown as WarrantySearchQuery,
      );
      res.json({ success: true, data });
    } catch (error) {
      warrantyLogger.error({ error }, "GET /api/warranty/search failed");
      res.json({
        success: false,
        error: errorMessage(error, "Failed to search warranties"),
      });
    }
  },
);

export default router;
