import { registerDatabaseHandlers } from '../../handlers/dbHandlers';
import { ipcMain } from 'electron';

jest.mock('electron');
jest.mock('../../db');

describe('Closing Handlers', () => {
  beforeEach(() => {
    (ipcMain.handle as any).mockClear?.();
    jest.resetModules();
  });

  it('registers IPC handlers and validates payloads', () => {
    registerDatabaseHandlers();
    const calls = (ipcMain.handle as any).mock.calls.map((c: any[]) => c[0]);
    expect(calls).toEqual(expect.arrayContaining([
      'closing:set-opening-balances',
      'closing:create-daily-closing',
    ]));
  });
});
