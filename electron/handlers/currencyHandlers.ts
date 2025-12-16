import { ipcMain } from 'electron';
import { getDatabase } from '../db';

export function registerCurrencyHandlers(): void {
  const db = getDatabase();

  ipcMain.handle('currencies:list', () => {
    try {
      const rows = db.prepare(`SELECT id, code, name, is_active FROM currencies ORDER BY code ASC`).all();
      return rows;
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('currencies:create', (_e, data: { code: string; name: string }) => {
    try {
      const stmt = db.prepare(`INSERT INTO currencies (code, name, is_active) VALUES (?, ?, 1)`);
      const res = stmt.run(data.code.toUpperCase(), data.name);
      return { success: true, id: res.lastInsertRowid };
    } catch (e: any) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return { success: false, error: 'Currency code already exists' };
      }
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('currencies:update', (_e, data: { id: number; code?: string; name?: string; is_active?: number }) => {
    try {
      const current = db.prepare(`SELECT * FROM currencies WHERE id = ?`).get(data.id) as any;
      if (!current) return { success: false, error: 'Not found' };
      const code = (data.code ?? current.code).toUpperCase();
      const name = data.name ?? current.name;
      const isActive = data.is_active ?? current.is_active;
      db.prepare(`UPDATE currencies SET code = ?, name = ?, is_active = ? WHERE id = ?`).run(code, name, isActive, data.id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('currencies:delete', (_e, id: number) => {
    try {
      db.prepare(`DELETE FROM currencies WHERE id = ?`).run(id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
