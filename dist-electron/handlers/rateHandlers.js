"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRateHandlers = registerRateHandlers;
const electron_1 = require("electron");
const db_1 = require("../db");
function registerRateHandlers() {
    const db = (0, db_1.getDatabase)();
    electron_1.ipcMain.handle('rates:list', () => {
        try {
            const rows = db.prepare(`SELECT id, from_code, to_code, rate, updated_at FROM exchange_rates ORDER BY from_code, to_code`).all();
            return rows;
        }
        catch (e) {
            return { error: e.message };
        }
    });
    electron_1.ipcMain.handle('rates:set', (_e, data) => {
        try {
            const stmt = db.prepare(`INSERT INTO exchange_rates (from_code, to_code, rate) VALUES (?, ?, ?)
        ON CONFLICT(from_code, to_code) DO UPDATE SET rate=excluded.rate, updated_at=CURRENT_TIMESTAMP`);
            stmt.run(data.from_code.toUpperCase(), data.to_code.toUpperCase(), data.rate);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e.message };
        }
    });
}
