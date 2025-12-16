import { ipcMain } from 'electron';
import { getDatabase } from '../db';

interface User {
    id: number;
    username: string;
    role: string;
    is_active: number;
}

// Password hashing using Node's scrypt (avoids native bcrypt build issues)
function hashPassword(password: string): string {
    const crypto = require('node:crypto');
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(password, salt, 64);
    return 'SCRYPT:' + salt.toString('hex') + ':' + derived.toString('hex');
}

function verifyPassword(password: string, stored?: string): boolean {
    const crypto = require('node:crypto');
    if (!stored) return false;
    if (stored.startsWith('SCRYPT:')) {
        const [, saltHex, hashHex] = stored.split(':');
        const salt = Buffer.from(saltHex, 'hex');
        const expected = Buffer.from(hashHex, 'hex');
        const derived = crypto.scryptSync(password, salt, expected.length);
        return crypto.timingSafeEqual(expected, derived);
    }
    // Legacy support for initial admin seed
    if (stored === '' && password === 'admin123') return true;
    if (stored.startsWith('HASHED:')) {
        return password === stored.substring('HASHED:'.length);
    }
    return false;
}

export function registerAuthHandlers(): void {
    const db = getDatabase();
    // Ensure admin user exists (id=1) and has a default password hash
    try {
        db.prepare("INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active) VALUES (1, 'admin', '', 'admin', 1)").run();
        const row = db.prepare("SELECT password_hash FROM users WHERE id = 1").get() as { password_hash?: string } | undefined;
        if (!row || !row.password_hash || row.password_hash === '') {
            const hash = hashPassword('admin123');
            db.prepare("UPDATE users SET password_hash = ? WHERE id = 1").run(hash);
            console.log('[AUTH] Admin default password set (admin123). Please change it.');
        }
    } catch (e) { console.warn('[AUTH] Admin seed warning:', e); }

   // Create user (admin only assumed); simple hash stub
   ipcMain.handle('users:create', (_e, data: { username: string; password: string; role: 'admin' | 'staff' }) => {
       try {
           const db = getDatabase();
           const password_hash = hashPassword(data.password);
           const res = db.prepare(`INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)`).run(data.username, password_hash, data.role);
           return { success: true, id: res.lastInsertRowid };
       } catch (error: any) {
           return { success: false, error: error.message };
       }
   });

   // Set user password
   ipcMain.handle('users:set-password', (_e, data: { id: number; password: string }) => {
       try {
           const db = getDatabase();
           const password_hash = hashPassword(data.password);
           db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(password_hash, data.id);
           return { success: true };
       } catch (error: any) {
           return { success: false, error: error.message };
       }
   });

    // Login handler
    ipcMain.handle('auth:login', (_event, username: string, password: string) => {
        try {
            const db = getDatabase();
            console.log(`[AUTH] Login attempt for username: "${username}"`);

            // For now, simple password check (in production, use bcrypt)
            // The seed password is 'admin123'
            const userRow = db.prepare(`SELECT id, username, role, is_active, password_hash FROM users WHERE username = ? AND is_active = 1`).get(username) as (User & { password_hash?: string }) | undefined;

            if (!userRow) {
                console.log(`[AUTH] User not found: "${username}"`);
                return { success: false, error: 'Invalid username or password' };
            }

            console.log(`[AUTH] User found: ${userRow.username} (ID: ${userRow.id})`);

            // Simple password check for now
            // TODO: Implement proper bcrypt hashing
            if (!verifyPassword(password, (userRow as any).password_hash)) {
                console.log(`[AUTH] Invalid password for user: ${username}`);
                return { success: false, error: 'Invalid username or password' };
            }

            console.log(`[AUTH] Password verified for user: ${username}`);
            // Migration: if legacy blank/hash, set scrypt now
            if (!(userRow as any).password_hash || String((userRow as any).password_hash).startsWith('HASHED:')) {
                const newHash = hashPassword(password);
                db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(newHash, userRow.id);
            }

            // Log activity
            db.prepare(`
      INSERT INTO activity_logs (user_id, action, details_json)
      VALUES (?, ?, ?)
    `).run(userRow.id, 'LOGIN', JSON.stringify({ timestamp: new Date().toISOString() }));

            console.log(`[AUTH] Login successful for user: ${username}`);
            return {
                success: true,
                user: {
                    id: userRow.id,
                    username: userRow.username,
                    role: userRow.role,
                },
            };
        } catch (error) {
            console.error('[AUTH] Login error:', error);
            return { success: false, error: 'An unexpected error occurred during login' };
        }
    });

    // Get current user (for session restoration)
    ipcMain.handle('auth:get-current-user', (_event, userId: number) => {
        try {
            const db = getDatabase();
            const user = db.prepare(`
      SELECT id, username, role 
      FROM users 
      WHERE id = ? AND is_active = 1
    `).get(userId) as User | undefined;

            console.log(`[AUTH] Get current user for ID: ${userId} - ${user ? 'found' : 'not found'}`);
            return user || null;
        } catch (error) {
            console.error('[AUTH] Get current user error:', error);
            return null;
        }
    });

    // List non-admin users
    ipcMain.handle('users:get-non-admins', () => {
        try {
            const db = getDatabase();
            const users = db.prepare(`SELECT id, username, role, is_active FROM users WHERE role != 'admin' ORDER BY username ASC`).all();
            return users;
        } catch (error) {
            console.error('[AUTH] List non-admin users error:', error);
            return [];
        }
    });

    // Update user active state (admin only scenario assumed)
    ipcMain.handle('users:set-active', (_e, data: { id: number; is_active: number }) => {
        try {
            const db = getDatabase();
            db.prepare(`UPDATE users SET is_active = ? WHERE id = ?`).run(data.is_active, data.id);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Update user role (admin/staff)
    ipcMain.handle('users:set-role', (_e, data: { id: number; role: 'admin' | 'staff' }) => {
        try {
            const db = getDatabase();
            db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(data.role, data.id);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Logout handler
    ipcMain.handle('auth:logout', (_event, userId: number) => {
        try {
            const db = getDatabase();
            console.log(`[AUTH] Logout for user ID: ${userId}`);

            // Log activity
            db.prepare(`
      INSERT INTO activity_logs (user_id, action, details_json)
      VALUES (?, ?, ?)
    `).run(userId, 'LOGOUT', JSON.stringify({ timestamp: new Date().toISOString() }));

            return { success: true };
        } catch (error) {
            console.error('[AUTH] Logout error:', error);
            return { success: false, error: 'Failed to logout' };
        }
    });
}
