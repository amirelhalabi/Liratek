"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthHandlers = registerAuthHandlers;
const electron_1 = require("electron");
const db_1 = require("../db");
function registerAuthHandlers() {
    // Login handler
    electron_1.ipcMain.handle('auth:login', (_event, username, password) => {
        const db = (0, db_1.getDatabase)();
        // For now, simple password check (in production, use bcrypt)
        // The seed password is 'admin123'
        const user = db.prepare(`
      SELECT id, username, role, is_active 
      FROM users 
      WHERE username = ? AND is_active = 1
    `).get(username);
        if (!user) {
            return { success: false, error: 'Invalid username or password' };
        }
        // Simple password check for now
        // TODO: Implement proper bcrypt hashing
        if (password !== 'admin123') {
            return { success: false, error: 'Invalid username or password' };
        }
        // Log activity
        db.prepare(`
      INSERT INTO activity_logs (user_id, action, details_json)
      VALUES (?, ?, ?)
    `).run(user.id, 'LOGIN', JSON.stringify({ timestamp: new Date().toISOString() }));
        return {
            success: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
            },
        };
    });
    // Get current user (for session restoration)
    electron_1.ipcMain.handle('auth:get-current-user', (_event, userId) => {
        const db = (0, db_1.getDatabase)();
        const user = db.prepare(`
      SELECT id, username, role 
      FROM users 
      WHERE id = ? AND is_active = 1
    `).get(userId);
        return user || null;
    });
    // Logout handler
    electron_1.ipcMain.handle('auth:logout', (_event, userId) => {
        const db = (0, db_1.getDatabase)();
        // Log activity
        db.prepare(`
      INSERT INTO activity_logs (user_id, action, details_json)
      VALUES (?, ?, ?)
    `).run(userId, 'LOGOUT', JSON.stringify({ timestamp: new Date().toISOString() }));
        return { success: true };
    });
}
