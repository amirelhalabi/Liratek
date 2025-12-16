"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCurrencyHandlers = registerCurrencyHandlers;
const electron_1 = require("electron");
const db_1 = require("../db");
function registerCurrencyHandlers() {
    const db = (0, db_1.getDatabase)();
    electron_1.ipcMain.handle('currencies:list', () => {
        try {
            const rows = db.prepare(`SELECT id, code, name, is_active FROM currencies ORDER BY code ASC`).all();
            return rows;
        }
        catch (e) {
            return { error: e.message };
        }
    });
    electron_1.ipcMain.handle('currencies:create', (_e, data) => {
        try {
            const stmt = db.prepare(`INSERT INTO currencies (code, name, is_active) VALUES (?, ?, 1)`);
            const res = stmt.run(data.code.toUpperCase(), data.name);
            return { success: true, id: res.lastInsertRowid };
        }
        catch (e) {
            if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return { success: false, error: 'Currency code already exists' };
            }
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('currencies:update', (_e, data) => {
        try {
            const current = db.prepare(`SELECT * FROM currencies WHERE id = ?`).get(data.id);
            if (!current)
                return { success: false, error: 'Not found' };
            const code = (data.code ?? current.code).toUpperCase();
            const name = data.name ?? current.name;
            const isActive = data.is_active ?? current.is_active;
            db.prepare(`UPDATE currencies SET code = ?, name = ?, is_active = ? WHERE id = ?`).run(code, name, isActive, data.id);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
    electron_1.ipcMain.handle('currencies:delete', (_e, id) => {
        try {
            db.prepare(`DELETE FROM currencies WHERE id = ?`).run(id);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
}
