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
import { getDatabase } from "../db";
import { getAuthService } from "../services/AuthService";
import { hashPassword } from "../utils/crypto";
import { isAppError } from "../utils/errors";

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
      console.log("[AUTH] Admin default password set (admin123). Please change it.");
    }
  } catch (e) {
    console.warn("[AUTH] Admin seed warning:", e);
  }

  // ---------------------------------------------------------------------------
  // Login Handler
  // ---------------------------------------------------------------------------
  ipcMain.handle("auth:login", async (event, username: string, password: string) => {
    try {
      console.log(`[AUTH] Login attempt for username: "${username}"`);
      
      const result = await authService.login(username, password);
      
      if (!result.success || !result.user) {
        return { success: false, error: "Invalid username or password" };
      }

      // Log activity
      logActivity(db, result.user.id, "LOGIN");

      // Bind session to this renderer (webContents)
      let sessionToken: string | null = null;
      try {
        const { setSession, storeEncryptedSession } = require("../session");
        setSession(event.sender.id, result.user.id, result.user.role);
        sessionToken = storeEncryptedSession(result.user.id);
      } catch (e) {
        console.warn("[AUTH] Failed to set session:", e);
      }

      console.log(`[AUTH] Login successful for user: ${username}`);
      return {
        success: true,
        user: result.user,
        sessionToken,
      };
    } catch (error) {
      console.error("[AUTH] Login error:", error);
      return {
        success: false,
        error: isAppError(error) ? error.message : "An unexpected error occurred during login",
      };
    }
  });

  // ---------------------------------------------------------------------------
  // Logout Handler
  // ---------------------------------------------------------------------------
  ipcMain.handle("auth:logout", (_event, userId: number) => {
    try {
      console.log(`[AUTH] Logout for user ID: ${userId}`);

      // Clear encrypted session
      try {
        const { clearEncryptedSession, clearSession } = require("../session");
        clearEncryptedSession();
        clearSession(_event.sender.id);
      } catch (e) {
        console.warn("[AUTH] Failed to clear session:", e);
      }

      // Log activity
      logActivity(db, userId, "LOGOUT");

      return { success: true };
    } catch (error) {
      console.error("[AUTH] Logout error:", error);
      return { success: false, error: "Failed to logout" };
    }
  });

  // ---------------------------------------------------------------------------
  // Restore Session Handler
  // ---------------------------------------------------------------------------
  ipcMain.handle("auth:restore-session", (event) => {
    try {
      const { getEncryptedSession, setSession } = require("../session");
      const stored = getEncryptedSession();
      
      if (!stored) {
        console.log("[AUTH] No stored session found");
        return { success: false, error: "No session" };
      }

      const user = authService.getUserById(stored.userId);

      if (!user) {
        console.log("[AUTH] Stored session user not found or inactive");
        const { clearEncryptedSession } = require("../session");
        clearEncryptedSession();
        return { success: false, error: "User not found" };
      }

      // Restore in-memory session
      setSession(event.sender.id, user.id, user.role);
      console.log(`[AUTH] Session restored for user: ${user.username}`);

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      };
    } catch (error) {
      console.error("[AUTH] Restore session error:", error);
      return { success: false, error: "Failed to restore session" };
    }
  });

  // ---------------------------------------------------------------------------
  // Get Current User Handler
  // ---------------------------------------------------------------------------
  ipcMain.handle("auth:get-current-user", (_event, userId: number) => {
    try {
      const user = authService.getUserById(userId);
      console.log(`[AUTH] Get current user for ID: ${userId} - ${user ? "found" : "not found"}`);
      return user || null;
    } catch (error) {
      console.error("[AUTH] Get current user error:", error);
      return null;
    }
  });

  // ---------------------------------------------------------------------------
  // Create User Handler (Admin only)
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    "users:create",
    async (e, data: { username: string; password: string; role: "admin" | "staff" }) => {
      // Check authorization
      const authCheck = requireAdminRole(e.sender.id);
      if (!authCheck.ok) return { success: false, error: authCheck.error };

      try {
        const result = await authService.createUser(
          { username: data.username, password: data.password, role: data.role === "staff" ? "cashier" : data.role },
          "admin"
        );
        
        if (result.success && result.user) {
          return { success: true, id: result.user.id };
        }
        return { success: false, error: result.error || "Failed to create user" };
      } catch (error) {
        console.error("[AUTH] Create user error:", error);
        return { success: false, error: isAppError(error) ? error.message : "Failed to create user" };
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
        const result = await authService.resetPassword(data.id, data.password, "admin");
        return { success: result.success, error: result.error };
      } catch (error) {
        console.error("[AUTH] Set password error:", error);
        return { success: false, error: isAppError(error) ? error.message : "Failed to set password" };
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
      return users.filter(u => u.role !== "admin");
    } catch (error) {
      console.error("[AUTH] List non-admin users error:", error);
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
        console.error("[AUTH] Set active error:", error);
        return { success: false, error: isAppError(error) ? error.message : "Failed to update user status" };
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
        console.error("[AUTH] Set role error:", error);
        return { success: false, error: isAppError(error) ? error.message : "Failed to update role" };
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
function logActivity(db: ReturnType<typeof getDatabase>, userId: number, action: string): void {
  try {
    db.prepare(
      `INSERT INTO activity_logs (user_id, action, details_json) VALUES (?, ?, ?)`
    ).run(userId, action, JSON.stringify({ timestamp: new Date().toISOString() }));
  } catch (e) {
    console.warn(`[AUTH] Failed to log ${action} activity:`, e);
  }
}

/**
 * Check if current session has admin role
 */
function requireAdminRole(senderId: number): { ok: boolean; error?: string } {
  try {
    const { requireRole } = require("../session");
    return requireRole(senderId, ["admin"]);
  } catch {
    return { ok: false, error: "Session not available" };
  }
}

/**
 * Get session info for current sender
 */
function getSessionInfo(senderId: number): { userId: number; role: string } | null {
  try {
    const { getSession } = require("../session");
    return getSession(senderId);
  } catch {
    return null;
  }
}
