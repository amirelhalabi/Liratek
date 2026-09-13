/**
 * Users API Endpoints (admin-only user management)
 *
 * REST twin of `electron-app/handlers/authHandlers.ts`'s `users:*` IPC
 * channels — both transports converge on the SAME `AuthService` methods
 * (`createUser`, `resetPassword`, `deactivateUser`, `reactivateUser`,
 * `setUserRole`, `getAllUsers`), so a user created/edited on web is
 * identical to one created/edited on desktop.
 *
 * HISTORY (LIRA-104 aftermath): every write route here used to be a
 * non-functional placeholder — `POST /`, `PUT /:id/active`, `PUT /:id/role`
 * and `PUT /:id/password` logged a "requested" message and returned a
 * canned `{ success: true }` (`POST /` even fabricated `id: 1`) without
 * calling AuthService or touching a single row. `GET /non-admins` always
 * returned `[]`. That is why user creation silently "succeeded" with no
 * error and no new user on the web app (owner report, 2026-09-13) — these
 * routes were lying about success on purpose, per the LIRA-104 scope note
 * that used to live here, and audit wiring was deliberately skipped because
 * auditing a mutation that never happened would corrupt the audit log. Both
 * reasons expire the moment the routes are real, which is what this file
 * now is: every route below performs the actual mutation and audits it
 * exactly like its IPC twin. Do not reintroduce a stub here — if a route
 * can't yet call a real service method, leave it unregistered (404) rather
 * than faking a 200.
 *
 * Envelope parity (CLAUDE.md rule 19c): every HANDLED failure — validation,
 * duplicate username, business-rule rejection — answers HTTP 200 with
 * `{ success: false, error }`, never a 4xx. Only a genuinely unexpected
 * throw (not an AppError) is a 500. The frontend adapter branches on
 * `result.success`, never on status code.
 *
 * `GET /non-admins` is gated `requireRole(["admin"])` here even though the
 * REST route previously only required auth — its IPC twin
 * (`users:get-non-admins`) has always required admin, and this brings the
 * two transports back in line.
 */

import { Router, type Response, type NextFunction } from "express";
import {
  requireAuth,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";
import { logger } from "../server.js";
import {
  getAuthService,
  isAppError,
  createUserSchema,
  setUserPasswordBodySchema,
  setUserActiveBodySchema,
  setUserRoleBodySchema,
} from "@liratek/core";

const router = Router();

/**
 * Positive integer only, and strictly so: match the canonical digit string
 * BEFORE parsing rather than trusting `Number()` + `isInteger()` on the raw
 * param — `Number()` happily accepts "1e3" (exponential notation) and
 * "  5" (leading whitespace) as valid integers, neither of which is a
 * positive-integer id a URL segment should ever legitimately contain. Also
 * rejects "0", negatives, fractions, and non-numeric input. Mirrors the
 * identical guard in `auth.ts`'s `DELETE /sessions/:id`.
 */
function validateUserIdParam(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const idParam = req.params.id;
  if (!/^[1-9]\d*$/.test(idParam ?? "")) {
    // Handled failure, not a framework/thrown error — envelope parity
    // (rule 19c): HTTP 200 + { success: false, error } so the adapter's
    // write functions branch on result.success the same way IPC does.
    res.json({ success: false, error: "Invalid user ID" });
    return;
  }
  next();
}

// GET /api/users/non-admins — mirrors users:get-non-admins
// (getAllUsers().filter(u => u.role !== "admin")), admin-only.
router.get(
  "/non-admins",
  requireAuth,
  requireRole(["admin"]),
  async (_req, res) => {
    try {
      const users = getAuthService()
        .getAllUsers()
        .filter((u) => u.role !== "admin");
      res.json({ success: true, users });
    } catch (error) {
      logger.error({ error }, "Get non-admin users error");
      res.status(500).json({ success: false, error: "Failed to get users" });
    }
  },
);

// POST /api/users — mirrors users:create.
router.post(
  "/",
  requireAuth,
  requireRole(["admin"]),
  validateRequest(createUserSchema),
  async (req: AuthRequest, res) => {
    const { username, password, role } = req.body as {
      username: string;
      password: string;
      role: "admin" | "staff";
    };

    try {
      const result = await getAuthService().createUser(
        { username, password, role },
        req.user!.role,
      );

      if (result.success && result.user) {
        auditRest(req, {
          action: "create",
          entity_type: "user",
          entity_id: String(result.user.id),
          summary: `Created user "${username}" with role "${role}"`,
        });
        res.json({ success: true, id: result.user.id });
        return;
      }

      res.json({
        success: false,
        error: result.error || "Failed to create user",
      });
    } catch (error) {
      logger.error({ error, username }, "Create user error");
      res.status(isAppError(error) ? 200 : 500).json({
        success: false,
        error: isAppError(error) ? error.message : "Failed to create user",
      });
    }
  },
);

// PUT /api/users/:id/active — mirrors users:set-active.
router.put(
  "/:id/active",
  requireAuth,
  requireRole(["admin"]),
  validateUserIdParam,
  validateRequest(setUserActiveBodySchema),
  async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const { is_active } = req.body as { is_active: 0 | 1 };

    try {
      // deactivateUser/reactivateUser are tenant-scoped repository writes:
      // `false` means no row matched — a nonexistent id, or an id belonging
      // to another tenant — NOT an exception. Discarding this return value
      // was the exact bug this ticket is about: it made the route answer
      // `{ success: true }` and write an audit_log row for a mutation that
      // never happened.
      const changed =
        is_active === 0
          ? getAuthService().deactivateUser(
              id,
              req.user!.userId,
              req.user!.role,
            )
          : getAuthService().reactivateUser(id, req.user!.role);

      if (!changed) {
        res.json({ success: false, error: "User not found" });
        return;
      }

      auditRest(req, {
        action: "update",
        entity_type: "user",
        entity_id: String(id),
        summary: `${is_active ? "Activated" : "Deactivated"} user`,
      });
      res.json({ success: true });
    } catch (error) {
      logger.error({ error, userId: id, is_active }, "Set user active error");
      res.status(isAppError(error) ? 200 : 500).json({
        success: false,
        error: isAppError(error)
          ? error.message
          : "Failed to update user status",
      });
    }
  },
);

// PUT /api/users/:id/role — mirrors users:set-role.
router.put(
  "/:id/role",
  requireAuth,
  requireRole(["admin"]),
  validateUserIdParam,
  validateRequest(setUserRoleBodySchema),
  async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const { role } = req.body as { role: "admin" | "staff" };

    try {
      // setUserRole is a tenant-scoped repository write: `false` means no
      // row matched (nonexistent id, or another tenant's id) — not an
      // exception. See the identical note on PUT /:id/active above.
      const changed = getAuthService().setUserRole(id, role, req.user!.role);

      if (!changed) {
        res.json({ success: false, error: "User not found" });
        return;
      }

      auditRest(req, {
        action: "update",
        entity_type: "user",
        entity_id: String(id),
        summary: `Changed user role to "${role}"`,
      });
      res.json({ success: true });
    } catch (error) {
      logger.error({ error, userId: id, role }, "Set user role error");
      res.status(isAppError(error) ? 200 : 500).json({
        success: false,
        error: isAppError(error) ? error.message : "Failed to update role",
      });
    }
  },
);

// PUT /api/users/:id/password — mirrors users:set-password.
router.put(
  "/:id/password",
  requireAuth,
  requireRole(["admin"]),
  validateUserIdParam,
  validateRequest(setUserPasswordBodySchema),
  async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const { password } = req.body as { password: string };

    try {
      const result = await getAuthService().resetPassword(
        id,
        password,
        req.user!.role,
      );

      if (result.success) {
        auditRest(req, {
          action: "update",
          entity_type: "user",
          entity_id: String(id),
          summary: "Changed user password",
        });
        res.json({ success: true });
        return;
      }

      res.json({ success: false, error: result.error });
    } catch (error) {
      logger.error({ error, userId: id }, "Set user password error");
      res.status(isAppError(error) ? 200 : 500).json({
        success: false,
        error: isAppError(error)
          ? error.message
          : "Failed to set user password",
      });
    }
  },
);

export default router;
