"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClientHandlers = registerClientHandlers;
const electron_1 = require("electron");
const db_1 = require("../db");
function registerClientHandlers() {
    const db = (0, db_1.getDatabase)();
    // Get all clients (with search)
    electron_1.ipcMain.handle('clients:get-all', (_event, search) => {
        let query = `SELECT * FROM clients WHERE 1=1`;
        const params = [];
        if (search) {
            query += ` AND (full_name LIKE ? OR phone_number LIKE ?)`;
            const term = `%${search}%`;
            params.push(term, term);
        }
        query += ` ORDER BY full_name ASC`;
        return db.prepare(query).all(...params);
    });
    // Get single client
    electron_1.ipcMain.handle('clients:get-one', (_event, id) => {
        return db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id);
    });
    // Create client
    electron_1.ipcMain.handle('clients:create', (_event, client) => {
        try {
            const stmt = db.prepare(`
                INSERT INTO clients (full_name, phone_number, notes, whatsapp_opt_in)
                VALUES (?, ?, ?, ?)
            `);
            const result = stmt.run(client.full_name, client.phone_number, client.notes || null, client.whatsapp_opt_in ? 1 : 0);
            return { success: true, id: result.lastInsertRowid };
        }
        catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return { success: false, error: 'Phone number already registered' };
            }
            return { success: false, error: error.message };
        }
    });
    // Update client
    electron_1.ipcMain.handle('clients:update', (_event, client) => {
        try {
            if (!client.id)
                return { success: false, error: 'Client ID required' };
            const stmt = db.prepare(`
                UPDATE clients 
                SET full_name = ?, phone_number = ?, notes = ?, whatsapp_opt_in = ?
                WHERE id = ?
            `);
            stmt.run(client.full_name, client.phone_number, client.notes || null, client.whatsapp_opt_in ? 1 : 0, client.id);
            return { success: true };
        }
        catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return { success: false, error: 'Phone number already in use by another client' };
            }
            return { success: false, error: error.message };
        }
    });
    // Delete client (Caution: Soft delete preferred if linked to sales, strictly checking schema...
    // Schema doesn't have is_active for clients yet based on 001_initial_schema.sql, 
    // let's check schema first. 001_initial_schema.sql lines 28-35:
    // CREATE TABLE clients (... whatsapp_opt_in BOOLEAN DEFAULT 1, created_at ...);
    // No is_active column. Adding hard delete for now, or just Delete.)
    electron_1.ipcMain.handle('clients:delete', (_event, id) => {
        try {
            // Check for existing sales first to prevent foreign key issues or data loss
            const salesCount = db.prepare(`SELECT count(*) as count FROM sales WHERE client_id = ?`).get(id);
            if (salesCount.count > 0) {
                return { success: false, error: 'Cannot delete client with existing sales history.' };
            }
            db.prepare(`DELETE FROM clients WHERE id = ?`).run(id);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
}
