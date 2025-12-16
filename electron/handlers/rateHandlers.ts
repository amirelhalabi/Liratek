import { ipcMain } from 'electron';
import { getDatabase } from '../db';

export function registerRateHandlers(): void {
  const db = getDatabase();

  ipcMain.handle('rates:list', () => {
    try {
      const rows = db.prepare(`SELECT id, from_code, to_code, rate, updated_at FROM exchange_rates ORDER BY from_code, to_code`).all();
      return rows;
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('rates:set', (_e, data: { from_code: string; to_code: string; rate: number }) => {
    try {
      const stmt = db.prepare(`INSERT INTO exchange_rates (from_code, to_code, rate) VALUES (?, ?, ?)
        ON CONFLICT(from_code, to_code) DO UPDATE SET rate=excluded.rate, updated_at=CURRENT_TIMESTAMP`);
      stmt.run(data.from_code.toUpperCase(), data.to_code.toUpperCase(), data.rate);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
