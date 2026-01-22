import { app, ipcMain } from "electron";
/* eslint-disable @typescript-eslint/no-require-imports */

export function registerUpdaterHandlers(): void {
  ipcMain.handle("updater:get-status", () => {
    return {
      packaged: app.isPackaged,
      platform: process.platform,
      version: app.getVersion(),
    };
  });

  ipcMain.handle("updater:check", async (e) => {
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    if (!app.isPackaged) {
      return { success: false, error: "Updater is disabled in dev mode" };
    }

    try {
      const { autoUpdater } = require("electron-updater");
      const res = await autoUpdater.checkForUpdates();
      return { success: true, updateInfo: res?.updateInfo };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("updater:download", async (e) => {
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    if (!app.isPackaged) {
      return { success: false, error: "Updater is disabled in dev mode" };
    }

    try {
      const { autoUpdater } = require("electron-updater");
      const res = await autoUpdater.downloadUpdate();
      return { success: true, result: res };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("updater:quit-and-install", async (e) => {
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    if (!app.isPackaged) {
      return { success: false, error: "Updater is disabled in dev mode" };
    }

    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.quitAndInstall();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
