/**
 * Users API Endpoints
 *
 * Handles user management (admin only)
 * Note: This is a simplified version - full user management methods need to be added to AuthService
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { logger } from "../server.js";

const router = Router();

// GET /api/users/non-admins
router.get("/non-admins", requireAuth, async (_req, res) => {
  try {
    // Placeholder - needs AuthService.getNonAdminUsers() implementation
    res.json({ success: true, users: [] });
  } catch (error) {
    logger.error({ error }, "Get non-admin users error");
    res.status(500).json({ success: false, error: "Failed to get users" });
  }
});

// POST /api/users
router.post("/", requireAuth, async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      res.status(400).json({
        success: false,
        error: "Missing required fields: username, password, role",
      });
    }

    if (!["admin", "staff"].includes(role)) {
      res.status(400).json({
        success: false,
        error: 'Invalid role. Must be "admin" or "staff"',
      });
    }

    // Placeholder - needs full implementation
    logger.info({ username, role }, "User create requested");
    res.json({ success: true, id: 1 });
  } catch (error) {
    logger.error({ error }, "Create user error");
    res.status(500).json({ success: false, error: "Failed to create user" });
  }
});

// PUT /api/users/:id/active
router.put("/:id/active", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: "Invalid user ID" });
    }

    const { is_active } = req.body;
    if (is_active === undefined) {
      res
        .status(400)
        .json({ success: false, error: "Missing is_active field" });
    }

    // Placeholder - needs full implementation
    logger.info({ id, is_active }, "User active status update requested");
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Set user active error");
    res
      .status(500)
      .json({ success: false, error: "Failed to update user status" });
  }
});

// PUT /api/users/:id/role
router.put("/:id/role", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: "Invalid user ID" });
    }

    const { role } = req.body;
    if (!role || !["admin", "staff"].includes(role)) {
      res.status(400).json({
        success: false,
        error: 'Invalid role. Must be "admin" or "staff"',
      });
    }

    // Placeholder - needs full implementation
    logger.info({ id, role }, "User role update requested");
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Set user role error");
    res
      .status(500)
      .json({ success: false, error: "Failed to update user role" });
  }
});

// PUT /api/users/:id/password
router.put("/:id/password", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: "Invalid user ID" });
    }

    const { password } = req.body;
    if (!password) {
      res.status(400).json({ success: false, error: "Missing password field" });
    }

    // Placeholder - needs full implementation
    logger.info({ id }, "User password update requested");
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Set user password error");
    res
      .status(500)
      .json({ success: false, error: "Failed to update user password" });
  }
});

export default router;
