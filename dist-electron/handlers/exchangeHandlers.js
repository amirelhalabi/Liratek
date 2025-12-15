"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerExchangeHandlers = registerExchangeHandlers;
const electron_1 = require("electron");
const db_1 = require("../db");
function registerExchangeHandlers() {
    const db = (0, db_1.getDatabase)();
    // Add Transaction
    electron_1.ipcMain.handle('exchange:add-transaction', (_event, data) => {
        try {
            const stmt = db.prepare(`
                INSERT INTO exchange_transactions (
                    type, from_currency, to_currency, amount_in, amount_out, rate, client_name, note
                ) VALUES ('EXCHANGE', ?, ?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(data.fromCurrency, data.toCurrency, data.amountIn, data.amountOut, data.rate, data.clientName || null, data.note || null);
            return { success: true, id: result.lastInsertRowid };
        }
        catch (error) {
            console.error('Failed to add exchange transaction:', error);
            return { success: false, error: error.message };
        }
    });
    // Get History (Today or All?) - Let's do Today by default, or limit 50
    electron_1.ipcMain.handle('exchange:get-history', () => {
        try {
            // Get today's transactions first
            const transactions = db.prepare(`
                SELECT * FROM exchange_transactions 
                ORDER BY created_at DESC 
                LIMIT 50
            `).all();
            return transactions;
        }
        catch (error) {
            console.error('Failed to get exchange history:', error);
            return [];
        }
    });
}
