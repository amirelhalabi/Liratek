import { ipcMain } from 'electron';
import { getDatabase } from '../db';

interface User {
    id: number;
    username: string;
    role: string;
    is_active: number;
}

export function registerAuthHandlers(): void {
    // Login handler
    ipcMain.handle('auth:login', (_event, username: string, password: string) => {
        const db = getDatabase();

        // For now, simple password check (in production, use bcrypt)
        // The seed password is 'admin123'
        const user = db.prepare(`
      SELECT id, username, role, is_active 
      FROM users 
      WHERE username = ? AND is_active = 1
    `).get(username) as User | undefined;

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
    ipcMain.handle('auth:get-current-user', (_event, userId: number) => {
        const db = getDatabase();
        const user = db.prepare(`
      SELECT id, username, role 
      FROM users 
      WHERE id = ? AND is_active = 1
    `).get(userId) as User | undefined;

        return user || null;
    });

    // Logout handler
    ipcMain.handle('auth:logout', (_event, userId: number) => {
        const db = getDatabase();

        // Log activity
        db.prepare(`
      INSERT INTO activity_logs (user_id, action, details_json)
      VALUES (?, ?, ?)
    `).run(userId, 'LOGOUT', JSON.stringify({ timestamp: new Date().toISOString() }));

        return { success: true };
    });
}
