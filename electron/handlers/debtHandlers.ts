import { ipcMain } from 'electron';
import { getDatabase } from '../db';

export function registerDebtHandlers(): void {
    const db = getDatabase();

    // Get all clients with outstanding debt > 0
    ipcMain.handle('debt:get-debtors', () => {
        try {
            // Group by client and sum up the debt (assuming amount_usd tracks the USD value)
            // positive amount = debt added, negative = repayment
            // We want clients where SUM(amount_usd) > threshold (e.g. 0.01)
            const debtors = db.prepare(`
                SELECT 
                    c.id, 
                    c.full_name, 
                    c.phone_number,
                    SUM(dl.amount_usd) as total_debt_usd
                FROM debt_ledger dl
                JOIN clients c ON dl.client_id = c.id
                GROUP BY c.id
                HAVING total_debt_usd > 0.01
                ORDER BY total_debt_usd DESC
            `).all();
            return debtors;
        } catch (error) {
            console.error('Failed to get debtors:', error);
            return [];
        }
    });

    // Get specific client history
    ipcMain.handle('debt:get-client-history', (_event, clientId: number) => {
        try {
            const history = db.prepare(`
                SELECT 
                    dl.*,
                    s.created_at as sale_date
                FROM debt_ledger dl
                LEFT JOIN sales s ON dl.sale_id = s.id
                WHERE dl.client_id = ?
                ORDER BY dl.created_at DESC
            `).all(clientId);
            return history;
        } catch (error) {
            console.error('Failed to get debt history:', error);
            return [];
        }
    });

    // Add Repayment
    ipcMain.handle('debt:add-repayment', (_event, data: { clientId: number; amountUSD: number; amountLBP: number; note?: string; exchangeRate: number }) => {
        try {
            const { clientId, amountUSD, amountLBP, note, exchangeRate } = data;

            // Calculate total USD value of the repayment
            // Repayments reduce debt, so we store as NEGATIVE in the ledger if we follow the "Sum = Balance" logic.
            // Logic: Debt = +100. Repayment = 50. Balance = 100 + (-50) = 50.

            const valueInUSD = amountUSD + (amountLBP / exchangeRate);
            const ledgerAmount = -Math.abs(valueInUSD); // Ensure it's negative

            const stmt = db.prepare(`
                INSERT INTO debt_ledger (
                    client_id, 
                    transaction_type, 
                    amount_usd, 
                    amount_lbp, 
                    note,
                    created_at
                ) VALUES (?, 'Repayment', ?, ?, ?, CURRENT_TIMESTAMP)
            `);

            const result = stmt.run(clientId, ledgerAmount, amountLBP, note || 'Manual Repayment');
            return { success: true, id: result.lastInsertRowid };
        } catch (error: any) {
            console.error('Failed to add repayment:', error);
            return { success: false, error: error.message };
        }
    });
}
