import { ipcMain } from 'electron';
import { getDatabase } from '../db';
// import { Client } from '../../src/types'; // Removed to avoid rootDir issues 
// For Electron main process, usually better to define interface locally or share properly.
// Redefining partially to avoid ts-node import issues if src/types isn't excluded from build properly.

interface ClientData {
    id?: number;
    full_name: string;
    phone_number: string;
    notes?: string;
    whatsapp_opt_in: boolean | number;
}

export function registerClientHandlers(): void {
    const db = getDatabase();

    // Get all clients (with search)
    ipcMain.handle('clients:get-all', (_event, search?: string) => {
        let query = `SELECT * FROM clients WHERE 1=1`;
        const params: string[] = [];

        if (search) {
            query += ` AND (full_name LIKE ? OR phone_number LIKE ?)`;
            const term = `%${search}%`;
            params.push(term, term);
        }

        query += ` ORDER BY full_name ASC`;
        return db.prepare(query).all(...params);
    });

    // Get single client
    ipcMain.handle('clients:get-one', (_event, id: number) => {
        return db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id);
    });

    // Create client
    ipcMain.handle('clients:create', (_event, client: ClientData) => {
        try {
            const stmt = db.prepare(`
                INSERT INTO clients (full_name, phone_number, notes, whatsapp_opt_in)
                VALUES (?, ?, ?, ?)
            `);
            const result = stmt.run(
                client.full_name,
                client.phone_number,
                client.notes || null,
                client.whatsapp_opt_in ? 1 : 0
            );
            return { success: true, id: result.lastInsertRowid };
        } catch (error: any) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return { success: false, error: 'Phone number already registered' };
            }
            return { success: false, error: error.message };
        }
    });

    // Update client
    ipcMain.handle('clients:update', (_event, client: ClientData) => {
        try {
            if (!client.id) return { success: false, error: 'Client ID required' };

            const stmt = db.prepare(`
                UPDATE clients 
                SET full_name = ?, phone_number = ?, notes = ?, whatsapp_opt_in = ?
                WHERE id = ?
            `);
            stmt.run(
                client.full_name,
                client.phone_number,
                client.notes || null,
                client.whatsapp_opt_in ? 1 : 0,
                client.id
            );
            return { success: true };
        } catch (error: any) {
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
    ipcMain.handle('clients:delete', (_event, id: number) => {
        try {
            // Check for existing sales first to prevent foreign key issues or data loss
            const salesCount = db.prepare(`SELECT count(*) as count FROM sales WHERE client_id = ?`).get(id) as { count: number };
            if (salesCount.count > 0) {
                return { success: false, error: 'Cannot delete client with existing sales history.' };
            }

            db.prepare(`DELETE FROM clients WHERE id = ?`).run(id);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
}
