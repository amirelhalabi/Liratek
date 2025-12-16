import { ipcMain } from 'electron';
import { getDatabase } from '../db';

export function registerDebtHandlers(): void {
    const db = getDatabase();

    // This handler was moved from salesHandlers to consolidate debt logic
    ipcMain.handle('debt:get-debtors', () => {
        // This query gets the total debt for each client
        const stmt = db.prepare(`
            SELECT 
                c.id, 
                c.full_name, 
                c.phone_number,
                SUM(dl.amount_usd) as total_debt
            FROM debt_ledger dl
            JOIN clients c ON dl.client_id = c.id
            GROUP BY c.id
            ORDER BY total_debt DESC
        `);
        return stmt.all();
    });

    ipcMain.handle('debt:get-client-history', (_event, clientId: number) => {
        const stmt = db.prepare(`
            SELECT * FROM debt_ledger 
            WHERE client_id = ? 
            ORDER BY created_at ASC
        `);
        return stmt.all(clientId);
    });

    ipcMain.handle('debt:get-client-total', (_event, clientId: number) => {
        const stmt = db.prepare('SELECT SUM(amount_usd) as total FROM debt_ledger WHERE client_id = ?');
        const result = stmt.get(clientId) as { total: number };
        return result.total || 0;
    });
    
    ipcMain.handle('debt:add-repayment', (_event, data) => {
        const { clientId, amountUSD, amountLBP, note } = data;
        try {
            const stmt = db.prepare(`
                INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note)
                VALUES (?, 'Repayment', ?, ?, ?)
            `);
            // Store as negative values to signify a reduction in debt
            const result = stmt.run(clientId, -amountUSD, -amountLBP, note);

            console.log(`[DEBT] Repayment of $${amountUSD} and ${amountLBP} LBP for client ${clientId}`);
            return { success: true, id: result.lastInsertRowid };
        } catch (error) {
            console.error('Failed to add repayment:', error);
            return { success: false, error: (error as Error).message };
        }
    });

    // New handler for dashboard debt summary
    ipcMain.handle('dashboard:get-debt-summary', () => {
        const db = getDatabase();
        
        // 1. Get Total Debt Receivable
        const totalDebtResult = db.prepare(`
            SELECT SUM(amount_usd) as totalDebt 
            FROM debt_ledger
        `).get() as { totalDebt: number };

        // 2. Get Top 5 Debtors
        const topDebtors = db.prepare(`
            SELECT 
                c.full_name,
                SUM(dl.amount_usd) as total_debt
            FROM debt_ledger dl
            JOIN clients c ON dl.client_id = c.id
            GROUP BY dl.client_id
            HAVING total_debt > 0.01
            ORDER BY total_debt DESC
            LIMIT 5
        `).all();
        
        return {
            totalDebt: totalDebtResult?.totalDebt || 0,
            topDebtors: topDebtors
        };
    });
}