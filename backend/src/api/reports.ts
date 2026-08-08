/**
 * Reports & Diagnostics API Endpoints
 *
 * Handles PDF generation, backups, and diagnostics
 * Note: ReportService uses Electron APIs - these are placeholders for backend mode
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { logger } from "../server.js";
// NOTE (LIRA-104 scope note): /backup and /restore below are BOTH
// non-functional placeholders on this transport today — they unconditionally
// return `{ success: false, error: "... only available in Electron mode" }`
// (ReportService/BackupService need Electron APIs not wired into the backend
// process). There is therefore no real state change to audit yet on either
// route: `backup:create` DOES audit on IPC (create/backup) and `/backup`
// mirrors it in name only — wiring an `auditRest(...)` call here would sit
// behind an unreachable success branch (dead code) since `result.success` is
// always false. Flagging as a parity gap for whoever implements a real
// backend-mode backup path, rather than adding audit logic with nothing to
// gate on. `report:restore-db` has no IPC audit precedent at all (per the
// LIRA-104 scout) and `/restore` is equally a placeholder — same reasoning,
// doubly out of scope.

const router = Router();
// Note: ReportService requires Electron APIs, not available in backend mode

// POST /api/reports/pdf
router.post("/pdf", requireAuth, async (req, res) => {
  try {
    const { html, filename } = req.body;

    if (!html) {
      res.status(400).json({ success: false, error: "Missing HTML content" });
      return;
    }

    // Placeholder - PDF generation requires Electron APIs
    logger.info(
      { filename },
      "PDF generation requested (not available in backend mode)",
    );
    res.json({
      success: false,
      error: "PDF generation only available in Electron mode",
    });
  } catch (error) {
    logger.error({ error }, "Generate PDF error");
    res.status(500).json({ success: false, error: "Failed to generate PDF" });
  }
});

// POST /api/reports/backup
router.post("/backup", requireAuth, async (_req, res) => {
  try {
    // Placeholder - backup functionality
    logger.info("Database backup requested (not available in backend mode)");
    res.json({
      success: false,
      error: "Database backup only available in Electron mode",
    });
  } catch (error) {
    logger.error({ error }, "Backup database error");
    res
      .status(500)
      .json({ success: false, error: "Failed to backup database" });
  }
});

// GET /api/reports/backups
router.get("/backups", requireAuth, async (_req, res) => {
  try {
    // Placeholder - list backups
    res.json({ success: true, backups: [] });
  } catch (error) {
    logger.error({ error }, "List backups error");
    res.status(500).json({ success: false, error: "Failed to list backups" });
  }
});

// POST /api/reports/backup/verify
router.post("/backup/verify", requireAuth, async (req, res) => {
  try {
    const { path } = req.body;

    if (!path) {
      res.status(400).json({ success: false, error: "Missing backup path" });
      return;
    }

    // Placeholder - backup verification not available in backend mode
    res.json({
      success: true,
      valid: false,
      error: "Backup verification only available in Electron mode",
    });
  } catch (error) {
    logger.error({ error }, "Verify backup error");
    res.status(500).json({ success: false, error: "Failed to verify backup" });
  }
});

// POST /api/reports/restore
router.post("/restore", requireAuth, async (req, res) => {
  try {
    const { path } = req.body;

    if (!path) {
      res.status(400).json({ success: false, error: "Missing backup path" });
      return;
    }

    // Placeholder - ReportService doesn't have restoreDatabase method yet
    logger.info({ path }, "Database restore requested");
    res.json({
      success: false,
      error: "Restore not yet implemented in backend",
    });
  } catch (error) {
    logger.error({ error }, "Restore database error");
    res
      .status(500)
      .json({ success: false, error: "Failed to restore database" });
  }
});

// GET /api/reports/diagnostics/foreign-keys
router.get("/diagnostics/foreign-keys", requireAuth, async (_req, res) => {
  try {
    // This would need a diagnostics service - placeholder for now
    res.json({ success: true, rows: [] });
  } catch (error) {
    logger.error({ error }, "Foreign key check error");
    res
      .status(500)
      .json({ success: false, error: "Failed to check foreign keys" });
  }
});

// GET /api/reports/diagnostics/sync-errors
router.get("/diagnostics/sync-errors", requireAuth, async (_req, res) => {
  try {
    // Placeholder - would need a diagnostics service
    res.json({ success: true, errors: [] });
  } catch (error) {
    logger.error({ error }, "Get sync errors error");
    res
      .status(500)
      .json({ success: false, error: "Failed to get sync errors" });
  }
});

export default router;
