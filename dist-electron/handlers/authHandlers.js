"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthHandlers = registerAuthHandlers;
const electron_1 = require("electron");
const db_1 = require("../db");
function registerAuthHandlers() {
    // Login handler
    electron_1.ipcMain.handle('auth:login', (_event, username, password) => {
        try {
            const db = (0, db_1.getDatabase)();
            console.log(`[AUTH] Login attempt for username: "${username}"`);
            // For now, simple password check (in production, use bcrypt)
            // The seed password is 'admin123'
            const user = db.prepare(`
      SELECT id, username, role, is_active 
      FROM users 
      WHERE username = ? AND is_active = 1
    `).get(username);
            if (!user) {
                console.log(`[AUTH] User not found: "${username}"`);
                return { success: false, error: 'Invalid username or password' };
            }
            console.log(`[AUTH] User found: ${user.username} (ID: ${user.id})`);
            // Simple password check for now
            // TODO: Implement proper bcrypt hashing
            if (password !== 'admin123') {
                console.log(`[AUTH] Invalid password for user: ${username}`);
                return { success: false, error: 'Invalid username or password' };
            }
            console.log(`[AUTH] Password verified for user: ${username}`);
            // Log activity
            db.prepare(`
      INSERT INTO activity_logs (user_id, action, details_json)
      VALUES (?, ?, ?)
    `).run(user.id, 'LOGIN', JSON.stringify({ timestamp: new Date().toISOString() }));
            console.log(`[AUTH] Login successful for user: ${username}`);
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
            console.error('[AUTH] Login error:', error);
            return { success: false, error: 'An unexpected error occurred during login' };
        }
    });
    // Get current user (for session restoration)
    electron_1.ipcMain.handle('auth:get-current-user', (_event, userId) => {
        try {
            const db = (0, db_1.getDatabase)();
            const user = db.prepare(`
      SELECT id, username, role 
      FROM users 
      WHERE id = ? AND is_active = 1
    `).get(userId);
            console.log(`[AUTH] Get current user for ID: ${userId} - ${user ? 'found' : 'not found'}`);
            return user || null;
        }
        catch (error) {
            console.error('[AUTH] Get current user error:', error);
            return null;
        }
    });
    // Logout handler
    electron_1.ipcMain.handle('auth:logout', (_event, userId) => {
        try {
            const db = (0, db_1.getDatabase)();
            console.log(`[AUTH] Logout for user ID: ${userId}`);
            // Log activity
            db.prepare(`
      INSERT INTO activity_logs (user_id, action, details_json)
      VALUES (?, ?, ?)
    `).run(userId, 'LOGOUT', JSON.stringify({ timestamp: new Date().toISOString() }));
            return { success: true };
        }
        catch (error) {
            console.error('[AUTH] Logout error:', error);
            return { success: false, error: 'Failed to logout' };
        }
    });
}
