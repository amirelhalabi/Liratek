// jest.setup.ts
import "@testing-library/jest-dom";
import { resetAllMocks as resetBetterSqlite3Mocks } from "./__mocks__/better-sqlite3";
import { ipcMain } from "./__mocks__/electron";

beforeEach(() => {
  // Clear all mocks before each test
  ipcMain.handle.mockClear();
  ipcMain.on.mockClear();
  ipcMain.removeHandler.mockClear();

  resetBetterSqlite3Mocks();
});
