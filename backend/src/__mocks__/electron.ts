// Minimal Electron mock for backend unit tests (ESM)
import { jest } from "@jest/globals";

export const ipcMain = {
  handle: jest.fn(),
  on: jest.fn(),
  removeHandler: jest.fn(),
};

export class BrowserWindow {
  static getAllWindows() {
    return [] as BrowserWindow[];
  }
  webContents = {
    send: jest.fn(),
  };
}

export const app = {
  getPath: jest.fn(() => ""),
  getVersion: jest.fn(() => "0.0.0"),
};

export default {
  ipcMain,
  BrowserWindow,
  app,
};
