import { ipcMain } from 'electron';
import { getDatabase } from '../db';

const EXCHANGE_RATE = 89000; // 1 USD = 89,000 LBP

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
            console.log(`[DEBT] Loaded ${debtors.length} debtors with outstanding debts`);
            return debtors;
        } catch (error) {
            console.error('Failed to get debtors:', error);
            return [];
        }
    });

    // Get specific client history (ALL debts, including paid ones)
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
            `).all(clientId) as any[];

            // Calculate running balance to determine which debts are "paid"
            let runningBalance = 0;
            const historyWithStatus = history.map((item: any) => {
                runningBalance += item.amount_usd;
                return {
                    ...item,
                    running_balance: runningBalance,
                    is_paid: runningBalance <= 0.01
                };
            });

            console.log(`[DEBT] Loaded history for client ${clientId}: ${history.length} entries`);
            return historyWithStatus;
        } catch (error) {
            console.error('Failed to get debt history:', error);
            return [];
        }
    });

    // Get total debts for a specific client (for dashboard/header)
    ipcMain.handle('debt:get-client-total', (_event, clientId: number) => {
        try {
            const result = db.prepare(`
                SELECT SUM(amount_usd) as total_debt_usd
                FROM debt_ledger
                WHERE client_id = ?
            `).get(clientId) as { total_debt_usd: number | null };

            const total = result.total_debt_usd || 0;
            console.log(`[DEBT] Total debt for client ${clientId}: $${total.toFixed(2)}`);
            return total;
        } catch (error) {
            console.error('Failed to get client total:', error);
            return 0;
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
            const actualLBP = amountLBP; // Store the actual LBP amount, not negative

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

            const result = stmt.run(clientId, ledgerAmount, actualLBP, note || 'Manual Repayment');
            console.log(`[DEBT] Repayment recorded - Client: ${clientId}, USD: $${amountUSD}, LBP: ${amountLBP}, Rate: ${exchangeRate}`);
            return { success: true, id: result.lastInsertRowid };
        } catch (error: any) {
            console.error('Failed to add repayment:', error);
            return { success: false, error: error.message };
        }
    });
}
