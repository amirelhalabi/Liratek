import express from "express";
import { authenticateJWT, type AuthRequest } from "../middleware/auth.js";
import { getVoucherImageService } from "@liratek/core";
import { logger } from "../server.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// All voucher-images routes require auth
router.use(authenticateJWT);

// GET /api/voucher-images - Get all voucher images
router.get("/", (_req, res): void => {
  try {
    const voucherImageService = getVoucherImageService();
    const images = voucherImageService.getAllImages();
    res.json({ success: true, images });
  } catch (error) {
    logger.error({ error }, "Get voucher images error");
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch voucher images" });
  }
});

// POST /api/voucher-images - Save/update a voucher image
router.post("/", (req, res): void => {
  try {
    const { provider, category, itemKey, imageData } = req.body;

    if (!provider || !category || !itemKey || !imageData) {
      res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
      return;
    }

    const voucherImageService = getVoucherImageService();
    voucherImageService.setImage(provider, category, itemKey, imageData);
    // Mirrors voucherImageHandlers.ts's voucher-images:set audit
    // (update/voucher_image).
    auditRest(req as AuthRequest, {
      action: "update",
      entity_type: "voucher_image",
      summary: `Set voucher image for ${provider}/${category}/${itemKey}`,
      metadata: { provider, category, itemKey },
    });
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Set voucher image error");
    res
      .status(500)
      .json({ success: false, error: "Failed to save voucher image" });
  }
});

// DELETE /api/voucher-images/:id - Delete a voucher image by ID
router.delete("/:id", (req, res): void => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: "Invalid ID" });
      return;
    }

    const voucherImageService = getVoucherImageService();
    voucherImageService.deleteImage(id);
    // Mirrors voucherImageHandlers.ts's voucher-images:delete audit
    // (delete/voucher_image).
    auditRest(req as AuthRequest, {
      action: "delete",
      entity_type: "voucher_image",
      entity_id: String(id),
      summary: `Deleted voucher image #${id}`,
    });
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Delete voucher image error");
    res
      .status(500)
      .json({ success: false, error: "Failed to delete voucher image" });
  }
});

export default router;
