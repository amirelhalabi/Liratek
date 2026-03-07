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
import {
  getAuthService,
  hashPassword,
  isAppError,
  authLogger,
  getTransactionRepository,
  TRANSACTION_TYPES,
} from "@liratek/core";
import {
  setSession,
  clearSession,
  getSession,
  requireRole,
  storeEncryptedSession,
  getEncryptedSession,
  clearEncryptedSession,
  storeSessionTokenToFile,
} from "../session.js";

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
    authLogger.warn(
      { error: e instanceof Error ? e.message : String(e) },
      "Admin seed warning",
    );
  }

  // ---------------------------------------------------------------------------
  // Login Handler
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    "auth:login",
    async (
      event,
      username: string,
      password: string,
      rememberMe: boolean = false,
    ) => {
      try {
        authLogger.debug({ username, rememberMe }, "Login attempt");

        // Login with database session
        const result = await authService.login(username, password, {
          rememberMe,
          deviceType: "electron",
          deviceInfo: `Electron ${process.versions.electron}`,
        });

        if (!result.success || !result.user || !result.token) {
          return { success: false, error: "Invalid username or password" };
        }

        // Log activity
        logActivity(db, result.user.id, "LOGIN");

        // Bind session to this renderer (webContents) for backwards compatibility
        try {
          setSession(
            event.sender.id,
            result.user.id,
            result.user.role as "admin" | "staff",
          );
        } catch (e) {
          authLogger.warn(
            { error: e instanceof Error ? e.message : String(e) },
            "Failed to set in-memory session",
          );
        }

        // Store session token in encrypted file for persistence across refreshes
        // (localStorage gets cleared on Cmd+R in Electron)
        try {
          storeSessionTokenToFile(result.token, result.user.id);
          authLogger.info(
            { userId: result.user.id },
            "Session token stored to encrypted file",
          );
        } catch (e) {
          authLogger.warn(
            { error: e instanceof Error ? e.message : String(e) },
            "Failed to store session token to file",
          );
        }

        authLogger.info(
          { username, userId: result.user.id, rememberMe },
          "Login successful with database session",
        );
        return {
          success: true,
          user: result.user,
          sessionToken: result.token,
        };
      } catch (error) {
        authLogger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            username,
          },
          "Login error",
        );
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
  ipcMain.handle("auth:logout", async (_event, sessionToken: string) => {
    try {
      authLogger.debug({ token: sessionToken?.substring(0, 10) }, "Logout");

      // Delete session from database
      const success = await authService.logout(sessionToken);

      if (success) {
        // Clear in-memory session for backwards compatibility
        try {
          clearSession(_event.sender.id);
        } catch (e) {
          authLogger.warn(
            { error: e instanceof Error ? e.message : String(e) },
            "Failed to clear in-memory session",
          );
        }

        // Clear encrypted session file
        try {
          clearEncryptedSession();
          authLogger.info("Encrypted session file cleared");
        } catch (e) {
          authLogger.warn(
            { error: e instanceof Error ? e.message : String(e) },
            "Failed to clear encrypted session file",
          );
        }

        authLogger.info("Logout successful");
      }

      return { success };
    } catch (error) {
      authLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Logout error",
      );
      return { success: false, error: "Failed to logout" };
    }
  });

  // ---------------------------------------------------------------------------
  // Restore Session Handler
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    "auth:restore-session",
    async (event, sessionToken?: string) => {
      try {
        authLogger.debug(
          { hasToken: !!sessionToken },
          "🔍 [SESSION-RESTORE] Starting session restoration",
        );

        // Try to restore from provided token first
        if (sessionToken) {
          authLogger.debug(
            { tokenPrefix: sessionToken.substring(0, 10) },
            "🔍 [SESSION-RESTORE] Validating provided session token from localStorage",
          );

          const user = await authService.validateSession(sessionToken);

          if (user) {
            // Restore in-memory session for backwards compatibility
            setSession(
              event.sender.id,
              user.id,
              user.role as "admin" | "staff",
            );
            authLogger.info(
              { username: user.username, userId: user.id },
              "✅ [SESSION-RESTORE] Session restored from localStorage token",
            );

            return {
              success: true,
              user: {
                id: user.id,
                username: user.username,
                role: user.role,
              },
              sessionToken,
            };
          } else {
            authLogger.warn(
              { tokenPrefix: sessionToken.substring(0, 10) },
              "❌ [SESSION-RESTORE] localStorage token validation failed (expired or invalid)",
            );
          }
        } else {
          authLogger.debug(
            "🔍 [SESSION-RESTORE] No session token in localStorage",
          );
        }

        // Fallback: try encrypted session file (persists across refreshes)
        authLogger.debug(
          "🔍 [SESSION-RESTORE] Checking for session token in encrypted file",
        );
        const stored = getEncryptedSession();

        if (stored && stored.token) {
          authLogger.debug(
            { tokenPrefix: stored.token.substring(0, 10) },
            "🔍 [SESSION-RESTORE] Found token in encrypted file, validating against database",
          );

          const user = await authService.validateSession(stored.token);

          if (user) {
            // Restore in-memory session for backwards compatibility
            setSession(
              event.sender.id,
              user.id,
              user.role as "admin" | "staff",
            );
            authLogger.info(
              { username: user.username, userId: user.id },
              "✅ [SESSION-RESTORE] Session restored from encrypted file token",
            );

            return {
              success: true,
              user: {
                id: user.id,
                username: user.username,
                role: user.role,
              },
              sessionToken: stored.token,
            };
          } else {
            authLogger.warn(
              { tokenPrefix: stored.token.substring(0, 10) },
              "❌ [SESSION-RESTORE] Encrypted file token validation failed (expired or invalid)",
            );
            clearEncryptedSession();
          }
        }

        // Legacy fallback: try old encrypted session for migration (userId-based)
        authLogger.debug(
          "🔍 [SESSION-RESTORE] Checking for old encrypted session (legacy migration)",
        );
        const storedLegacy = getEncryptedSession();

        if (storedLegacy && !storedLegacy.token) {
          // Old format without token field - needs migration
          authLogger.info(
            { userId: storedLegacy.userId },
            "🔍 [SESSION-RESTORE] Found old encrypted session (no token), attempting migration",
          );

          const user = authService.getUserById(storedLegacy.userId);

          if (user) {
            authLogger.info(
              { username: user.username, userId: user.id },
              "🔍 [SESSION-RESTORE] User found, creating new database session",
            );

            // Migrate to new session system
            const result = await authService.login(user.username, "", {
              rememberMe: true,
              deviceType: "electron",
              deviceInfo: `Electron ${process.versions.electron}`,
            });

            if (result.success && result.user && result.token) {
              // Store new token to file
              storeSessionTokenToFile(result.token, result.user.id);
              setSession(
                event.sender.id,
                user.id,
                user.role as "admin" | "staff",
              );
              authLogger.info(
                { username: user.username, userId: user.id },
                "✅ [SESSION-RESTORE] Migrated old encrypted session to database",
              );

              return {
                success: true,
                user: result.user,
                sessionToken: result.token,
              };
            } else {
              authLogger.warn(
                "❌ [SESSION-RESTORE] Failed to create new session during migration",
              );
            }
          } else {
            authLogger.warn(
              { userId: storedLegacy.userId },
              "❌ [SESSION-RESTORE] User from encrypted session not found in database",
            );
          }

          clearEncryptedSession();
          authLogger.info(
            "🗑️ [SESSION-RESTORE] Cleared invalid encrypted session",
          );
        } else {
          authLogger.debug(
            "ℹ️ [SESSION-RESTORE] No legacy encrypted session found",
          );
        }

        authLogger.warn(
          "❌ [SESSION-RESTORE] No valid session found, user needs to login",
        );
        return { success: false, error: "No session" };
      } catch (error) {
        authLogger.error(
          { error: error instanceof Error ? error.message : String(error) },
          "💥 [SESSION-RESTORE] Restore session error",
        );
        return { success: false, error: "Failed to restore session" };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Get Current User Handler
  // ---------------------------------------------------------------------------
  ipcMain.handle("auth:get-current-user", (_event, userId: number) => {
    try {
      const user = authService.getUserById(userId);
      authLogger.debug({ userId, found: !!user }, "Get current user");
      return user || null;
    } catch (error) {
      authLogger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
        },
        "Get current user error",
      );
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
        authLogger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            userId: data.id,
          },
          "Set password error",
        );
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
      authLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "List non-admin users error",
      );
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
  _db: ReturnType<typeof getDatabase>,
  userId: number,
  action: string,
): void {
  try {
    getTransactionRepository().createTransaction({
      type: action as (typeof TRANSACTION_TYPES)[keyof typeof TRANSACTION_TYPES],
      source_table: "users",
      source_id: userId,
      user_id: userId,
      summary: `User ${action}`,
      metadata_json: { timestamp: new Date().toISOString() },
    });
  } catch (e) {
    authLogger.warn(
      { error: e instanceof Error ? e.message : String(e), action, userId },
      "Failed to log activity",
    );
  }
}

/**
 * Check if current session has admin role
 */
function requireAdminRole(senderId: number): { ok: boolean; error?: string } {
  try {
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
    return getSession(senderId) || null;
  } catch {
    return null;
  }
}
