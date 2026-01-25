/**
 * Authentication IPC Handlers
 *
 * Thin wrapper layer that delegates business logic to AuthService.
 * Handles:
 * - IPC registration
 * - Session management (Electron-specific)
 * - Activity logging
 * - Error formatting for IPC responses
 */

import { ipcMain } from "electron";
import { getDatabase } from "../db.js";
import { getAuthService } from "../services/AuthService.js";
import { hashPassword } from "../utils/crypto.js";
import { isAppError } from "../utils/errors.js";
import { authLogger } from "../utils/logger.js";

// =============================================================================
// Handler Registration
// =============================================================================

export function registerAuthHandlers(): void {
  const authService = getAuthService();
  const db = getDatabase();

  // ---------------------------------------------------------------------------
  // Seed admin user on startup
  // ---------------------------------------------------------------------------
  try {
    db.prepare(
      "INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active) VALUES (1, 'admin', '', 'admin', 1)",
    ).run();
    const row = db
      .prepare("SELECT password_hash FROM users WHERE id = 1")
      .get() as { password_hash?: string } | undefined;
    if (!row || !row.password_hash || row.password_hash === "") {
      const hash = hashPassword("admin123");
      db.prepare("UPDATE users SET password_hash = ? WHERE id = 1").run(hash);
      authLogger.info(
        "Admin default password set (admin123). Please change it.",
      );
    }
  } catch (e) {
    authLogger.warn({ error: e instanceof Error ? e.message : String(e) }, "Admin seed warning");
  }

  // ---------------------------------------------------------------------------
  // Login Handler
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    "auth:login",
    async (event, username: string, password: string) => {
      try {
        authLogger.debug({ username }, "Login attempt");

        const result = await authService.login(username, password);

        if (!result.success || !result.user) {
          return { success: false, error: "Invalid username or password" };
        }

        // Log activity
        logActivity(db, result.user.id, "LOGIN");

        // Bind session to this renderer (webContents)
        let sessionToken: string | null = null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { setSession, storeEncryptedSession } = require("../session");
          setSession(event.sender.id, result.user.id, result.user.role);
          sessionToken = storeEncryptedSession(result.user.id);
        } catch (e) {
          authLogger.warn({ error: e instanceof Error ? e.message : String(e) }, "Failed to set session");
        }

        authLogger.info(
          { username, userId: result.user.id },
          "Login successful",
        );
        return {
          success: true,
          user: result.user,
          sessionToken,
        };
      } catch (error) {
        authLogger.error({ error: error instanceof Error ? error.message : String(error), username }, "Login error");
        return {
          success: false,
          error: isAppError(error)
            ? error.message
            : "An unexpected error occurred during login",
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Logout Handler
  // ---------------------------------------------------------------------------
  ipcMain.handle("auth:logout", (_event, userId: number) => {
    try {
      authLogger.debug({ userId }, "Logout");

      // Clear encrypted session
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { clearEncryptedSession, clearSession } = require("../session");
        clearEncryptedSession();
        clearSession(_event.sender.id);
      } catch (e) {
        authLogger.warn({ error: e instanceof Error ? e.message : String(e) }, "Failed to clear session");
      }

      // Log activity
      logActivity(db, userId, "LOGOUT");

      return { success: true };
    } catch (error) {
      authLogger.error({ error: error instanceof Error ? error.message : String(error), userId }, "Logout error");
      return { success: false, error: "Failed to logout" };
    }
  });

  // ---------------------------------------------------------------------------
  // Restore Session Handler
  // ---------------------------------------------------------------------------
  ipcMain.handle("auth:restore-session", (event) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getEncryptedSession, setSession } = require("../session");
      const stored = getEncryptedSession();

      if (!stored) {
        // This is normal on first run - don't log as error
        return { success: false, error: "No session" };
      }

      const user = authService.getUserById(stored.userId);

      if (!user) {
        authLogger.debug(
          { userId: stored.userId },
          "Stored session user not found or inactive",
        );
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { clearEncryptedSession } = require("../session");
        clearEncryptedSession();
        return { success: false, error: "User not found" };
      }

      // Restore in-memory session
      setSession(event.sender.id, user.id, user.role);
      authLogger.info(
        { username: user.username, userId: user.id },
        "Session restored",
      );

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      };
    } catch (error) {
      authLogger.error({ error: error instanceof Error ? error.message : String(error) }, "Restore session error");
      return { success: false, error: "Failed to restore session" };
    }
  });

  // ---------------------------------------------------------------------------
  // Get Current User Handler
  // ---------------------------------------------------------------------------
  ipcMain.handle("auth:get-current-user", (_event, userId: number) => {
    try {
      const user = authService.getUserById(userId);
      authLogger.debug({ userId, found: !!user }, "Get current user");
      return user || null;
    } catch (error) {
      authLogger.error({ error: error instanceof Error ? error.message : String(error), userId }, "Get current user error");
      return null;
    }
  });

  // ---------------------------------------------------------------------------
  // Create User Handler (Admin only)
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    "users:create",
    async (
      e,
      data: { username: string; password: string; role: "admin" | "staff" },
    ) => {
      // Check authorization
      const authCheck = requireAdminRole(e.sender.id);
      if (!authCheck.ok) return { success: false, error: authCheck.error };

      try {
        const result = await authService.createUser(
          {
            username: data.username,
            password: data.password,
            role: data.role === "staff" ? "cashier" : data.role,
          },
          "admin",
        );

        if (result.success && result.user) {
          return { success: true, id: result.user.id };
        }
        return {
          success: false,
          error: result.error || "Failed to create user",
        };
      } catch (error) {
        authLogger.error(
          { error, username: data.username },
          "Create user error",
        );
        return {
          success: false,
          error: isAppError(error) ? error.message : "Failed to create user",
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Set Password Handler (Admin only)
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    "users:set-password",
    async (e, data: { id: number; password: string }) => {
      const authCheck = requireAdminRole(e.sender.id);
      if (!authCheck.ok) return { success: false, error: authCheck.error };

      try {
        const result = await authService.resetPassword(
          data.id,
          data.password,
          "admin",
        );
        return { success: result.success, error: result.error };
      } catch (error) {
        authLogger.error({ error: error instanceof Error ? error.message : String(error), userId: data.id }, "Set password error");
        return {
          success: false,
          error: isAppError(error) ? error.message : "Failed to set password",
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Get Non-Admin Users Handler
  // ---------------------------------------------------------------------------
  ipcMain.handle("users:get-non-admins", (e) => {
    const authCheck = requireAdminRole(e.sender.id);
    if (!authCheck.ok) return [];

    try {
      // Get all users and filter out admins
      const users = authService.getAllUsers();
      return users.filter((u) => u.role !== "admin");
    } catch (error) {
      authLogger.error({ error: error instanceof Error ? error.message : String(error) }, "List non-admin users error");
      return [];
    }
  });

  // ---------------------------------------------------------------------------
  // Set User Active Status Handler (Admin only)
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    "users:set-active",
    (e, data: { id: number; is_active: number }) => {
      const authCheck = requireAdminRole(e.sender.id);
      if (!authCheck.ok) return { success: false, error: authCheck.error };

      try {
        if (data.is_active === 0) {
          // Deactivate
          const session = getSessionInfo(e.sender.id);
          authService.deactivateUser(data.id, session?.userId || 0, "admin");
        } else {
          // Reactivate
          authService.reactivateUser(data.id, "admin");
        }
        return { success: true };
      } catch (error) {
        authLogger.error(
          { error, userId: data.id, is_active: data.is_active },
          "Set active error",
        );
        return {
          success: false,
          error: isAppError(error)
            ? error.message
            : "Failed to update user status",
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Set User Role Handler (Admin only)
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    "users:set-role",
    (e, data: { id: number; role: "admin" | "staff" }) => {
      const authCheck = requireAdminRole(e.sender.id);
      if (!authCheck.ok) return { success: false, error: authCheck.error };

      try {
        // Direct database update for role change (not in AuthService yet)
        const db = getDatabase();
        const role = data.role === "staff" ? "cashier" : data.role;
        db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, data.id);
        return { success: true };
      } catch (error) {
        authLogger.error(
          { error, userId: data.id, role: data.role },
          "Set role error",
        );
        return {
          success: false,
          error: isAppError(error) ? error.message : "Failed to update role",
        };
      }
    },
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Log user activity
 */
function logActivity(
  db: ReturnType<typeof getDatabase>,
  userId: number,
  action: string,
): void {
  try {
    db.prepare(
      `INSERT INTO activity_logs (user_id, action, details_json) VALUES (?, ?, ?)`,
    ).run(
      userId,
      action,
      JSON.stringify({ timestamp: new Date().toISOString() }),
    );
  } catch (e) {
    authLogger.warn({ error: e instanceof Error ? e.message : String(e), action, userId }, "Failed to log activity");
  }
}

/**
 * Check if current session has admin role
 */
function requireAdminRole(senderId: number): { ok: boolean; error?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireRole } = require("../session");
    return requireRole(senderId, ["admin"]);
  } catch {
    return { ok: false, error: "Session not available" };
  }
}

/**
 * Get session info for current sender
 */
function getSessionInfo(
  senderId: number,
): { userId: number; role: string } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSession } = require("../session");
    return getSession(senderId);
  } catch {
    return null;
  }
}
