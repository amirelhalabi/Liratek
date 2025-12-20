"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthHandlers = registerAuthHandlers;
const electron_1 = require("electron");
const db_1 = require("../db");
const AuthService_1 = require("../services/AuthService");
const crypto_1 = require("../utils/crypto");
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
// =============================================================================
// Handler Registration
// =============================================================================
function registerAuthHandlers() {
    const authService = (0, AuthService_1.getAuthService)();
    const db = (0, db_1.getDatabase)();
    // ---------------------------------------------------------------------------
    // Seed admin user on startup
    // ---------------------------------------------------------------------------
    try {
        db.prepare("INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active) VALUES (1, 'admin', '', 'admin', 1)").run();
        const row = db
            .prepare("SELECT password_hash FROM users WHERE id = 1")
            .get();
        if (!row || !row.password_hash || row.password_hash === "") {
            const hash = (0, crypto_1.hashPassword)("admin123");
            db.prepare("UPDATE users SET password_hash = ? WHERE id = 1").run(hash);
            logger_1.authLogger.info("Admin default password set (admin123). Please change it.");
        }
    }
    catch (e) {
        logger_1.authLogger.warn({ error: e }, "Admin seed warning");
    }
    // ---------------------------------------------------------------------------
    // Login Handler
    // ---------------------------------------------------------------------------
    electron_1.ipcMain.handle("auth:login", async (event, username, password) => {
        try {
            logger_1.authLogger.debug({ username }, "Login attempt");
            const result = await authService.login(username, password);
            if (!result.success || !result.user) {
                return { success: false, error: "Invalid username or password" };
            }
            // Log activity
            logActivity(db, result.user.id, "LOGIN");
            // Bind session to this renderer (webContents)
            let sessionToken = null;
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { setSession, storeEncryptedSession } = require("../session");
                setSession(event.sender.id, result.user.id, result.user.role);
                sessionToken = storeEncryptedSession(result.user.id);
            }
            catch (e) {
                logger_1.authLogger.warn({ error: e }, "Failed to set session");
            }
            logger_1.authLogger.info({ username, userId: result.user.id }, "Login successful");
            return {
                success: true,
                user: result.user,
                sessionToken,
            };
        }
        catch (error) {
            logger_1.authLogger.error({ error, username }, "Login error");
            return {
                success: false,
                error: (0, errors_1.isAppError)(error)
                    ? error.message
                    : "An unexpected error occurred during login",
            };
        }
    });
    // ---------------------------------------------------------------------------
    // Logout Handler
    // ---------------------------------------------------------------------------
    electron_1.ipcMain.handle("auth:logout", (_event, userId) => {
        try {
            logger_1.authLogger.debug({ userId }, "Logout");
            // Clear encrypted session
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { clearEncryptedSession, clearSession } = require("../session");
                clearEncryptedSession();
                clearSession(_event.sender.id);
            }
            catch (e) {
                logger_1.authLogger.warn({ error: e }, "Failed to clear session");
            }
            // Log activity
            logActivity(db, userId, "LOGOUT");
            return { success: true };
        }
        catch (error) {
            logger_1.authLogger.error({ error, userId }, "Logout error");
            return { success: false, error: "Failed to logout" };
        }
    });
    // ---------------------------------------------------------------------------
    // Restore Session Handler
    // ---------------------------------------------------------------------------
    electron_1.ipcMain.handle("auth:restore-session", (event) => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { getEncryptedSession, setSession } = require("../session");
            const stored = getEncryptedSession();
            if (!stored) {
                logger_1.authLogger.debug("No stored session found");
                return { success: false, error: "No session" };
            }
            const user = authService.getUserById(stored.userId);
            if (!user) {
                logger_1.authLogger.debug({ userId: stored.userId }, "Stored session user not found or inactive");
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { clearEncryptedSession } = require("../session");
                clearEncryptedSession();
                return { success: false, error: "User not found" };
            }
            // Restore in-memory session
            setSession(event.sender.id, user.id, user.role);
            logger_1.authLogger.info({ username: user.username, userId: user.id }, "Session restored");
            return {
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                },
            };
        }
        catch (error) {
            logger_1.authLogger.error({ error }, "Restore session error");
            return { success: false, error: "Failed to restore session" };
        }
    });
    // ---------------------------------------------------------------------------
    // Get Current User Handler
    // ---------------------------------------------------------------------------
    electron_1.ipcMain.handle("auth:get-current-user", (_event, userId) => {
        try {
            const user = authService.getUserById(userId);
            logger_1.authLogger.debug({ userId, found: !!user }, "Get current user");
            return user || null;
        }
        catch (error) {
            logger_1.authLogger.error({ error, userId }, "Get current user error");
            return null;
        }
    });
    // ---------------------------------------------------------------------------
    // Create User Handler (Admin only)
    // ---------------------------------------------------------------------------
    electron_1.ipcMain.handle("users:create", async (e, data) => {
        // Check authorization
        const authCheck = requireAdminRole(e.sender.id);
        if (!authCheck.ok)
            return { success: false, error: authCheck.error };
        try {
            const result = await authService.createUser({
                username: data.username,
                password: data.password,
                role: data.role === "staff" ? "cashier" : data.role,
            }, "admin");
            if (result.success && result.user) {
                return { success: true, id: result.user.id };
            }
            return {
                success: false,
                error: result.error || "Failed to create user",
            };
        }
        catch (error) {
            logger_1.authLogger.error({ error, username: data.username }, "Create user error");
            return {
                success: false,
                error: (0, errors_1.isAppError)(error) ? error.message : "Failed to create user",
            };
        }
    });
    // ---------------------------------------------------------------------------
    // Set Password Handler (Admin only)
    // ---------------------------------------------------------------------------
    electron_1.ipcMain.handle("users:set-password", async (e, data) => {
        const authCheck = requireAdminRole(e.sender.id);
        if (!authCheck.ok)
            return { success: false, error: authCheck.error };
        try {
            const result = await authService.resetPassword(data.id, data.password, "admin");
            return { success: result.success, error: result.error };
        }
        catch (error) {
            logger_1.authLogger.error({ error, userId: data.id }, "Set password error");
            return {
                success: false,
                error: (0, errors_1.isAppError)(error) ? error.message : "Failed to set password",
            };
        }
    });
    // ---------------------------------------------------------------------------
    // Get Non-Admin Users Handler
    // ---------------------------------------------------------------------------
    electron_1.ipcMain.handle("users:get-non-admins", (e) => {
        const authCheck = requireAdminRole(e.sender.id);
        if (!authCheck.ok)
            return [];
        try {
            // Get all users and filter out admins
            const users = authService.getAllUsers();
            return users.filter((u) => u.role !== "admin");
        }
        catch (error) {
            logger_1.authLogger.error({ error }, "List non-admin users error");
            return [];
        }
    });
    // ---------------------------------------------------------------------------
    // Set User Active Status Handler (Admin only)
    // ---------------------------------------------------------------------------
    electron_1.ipcMain.handle("users:set-active", (e, data) => {
        const authCheck = requireAdminRole(e.sender.id);
        if (!authCheck.ok)
            return { success: false, error: authCheck.error };
        try {
            if (data.is_active === 0) {
                // Deactivate
                const session = getSessionInfo(e.sender.id);
                authService.deactivateUser(data.id, session?.userId || 0, "admin");
            }
            else {
                // Reactivate
                authService.reactivateUser(data.id, "admin");
            }
            return { success: true };
        }
        catch (error) {
            logger_1.authLogger.error({ error, userId: data.id, is_active: data.is_active }, "Set active error");
            return {
                success: false,
                error: (0, errors_1.isAppError)(error)
                    ? error.message
                    : "Failed to update user status",
            };
        }
    });
    // ---------------------------------------------------------------------------
    // Set User Role Handler (Admin only)
    // ---------------------------------------------------------------------------
    electron_1.ipcMain.handle("users:set-role", (e, data) => {
        const authCheck = requireAdminRole(e.sender.id);
        if (!authCheck.ok)
            return { success: false, error: authCheck.error };
        try {
            // Direct database update for role change (not in AuthService yet)
            const db = (0, db_1.getDatabase)();
            const role = data.role === "staff" ? "cashier" : data.role;
            db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, data.id);
            return { success: true };
        }
        catch (error) {
            logger_1.authLogger.error({ error, userId: data.id, role: data.role }, "Set role error");
            return {
                success: false,
                error: (0, errors_1.isAppError)(error) ? error.message : "Failed to update role",
            };
        }
    });
}
// =============================================================================
// Helper Functions
// =============================================================================
/**
 * Log user activity
 */
function logActivity(db, userId, action) {
    try {
        db.prepare(`INSERT INTO activity_logs (user_id, action, details_json) VALUES (?, ?, ?)`).run(userId, action, JSON.stringify({ timestamp: new Date().toISOString() }));
    }
    catch (e) {
        logger_1.authLogger.warn({ error: e, action, userId }, "Failed to log activity");
    }
}
/**
 * Check if current session has admin role
 */
function requireAdminRole(senderId) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { requireRole } = require("../session");
        return requireRole(senderId, ["admin"]);
    }
    catch {
        return { ok: false, error: "Session not available" };
    }
}
/**
 * Get session info for current sender
 */
function getSessionInfo(senderId) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getSession } = require("../session");
        return getSession(senderId);
    }
    catch {
        return null;
    }
}
