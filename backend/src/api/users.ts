/**
 * Users API Endpoints
 *
 * Handles user management (admin only)
 * Note: This is a simplified version - full user management methods need to be added to AuthService
 *
 * LIRA-104 SCOPE NOTE (audit-wiring ticket): every write route below (POST /,
 * PUT /:id/active, PUT /:id/role, PUT /:id/password) is a NON-FUNCTIONAL
 * PLACEHOLDER today — none of them call AuthService/UserRepository at all;
 * they log a "requested" message and return a canned `{ success: true }`
 * without creating/updating any real row. This predates this ticket (see the
 * "Placeholder - needs full implementation" comments below).
 *
 * Their IPC twins (authHandlers.ts's users:create/set-active/set-role/
 * set-password) DO perform real mutations and DO audit them
 * (create|update/user) — but wiring `auditRest(...)` calls onto these REST
 * stubs would write audit_log rows for user changes that never actually
 * happened on the web transport, which violates this ticket's own
 * non-negotiable ("audit only real state changes"). Making these routes
 * functional is a full user-management REST implementation (password
 * hashing via AuthService.createUser/resetPassword, a real role-update
 * repository method, etc.) — out of scope for an audit-wiring ticket and
 * flagged here for the ticket owner as a separate, larger web-parity gap
 * (worse than "missing route": these 404-never, they silently lie about
 * success). Deliberately left unaudited and untouched.
 */

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
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
router.post("/", requireAuth, requireRole(["admin"]), async (req, res) => {
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
router.put(
  "/:id/active",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
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
  },
);

// PUT /api/users/:id/role
router.put(
  "/:id/role",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
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
  },
);

// PUT /api/users/:id/password
router.put(
  "/:id/password",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ success: false, error: "Invalid user ID" });
      }

      const { password } = req.body;
      if (!password) {
        res
          .status(400)
          .json({ success: false, error: "Missing password field" });
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
  },
);

export default router;
