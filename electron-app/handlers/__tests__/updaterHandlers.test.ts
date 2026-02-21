import { ipcMain, app } from "electron";
import { registerUpdaterHandlers } from "../updaterHandlers";

jest.mock("electron", () => ({
  app: {
    isPackaged: false,
    getVersion: () => "1.0.0",
  },
  ipcMain: { handle: jest.fn() },
}));

jest.mock("electron-updater", () => ({
  autoUpdater: {
    checkForUpdates: jest.fn(async () => ({
      updateInfo: { version: "1.0.1" },
    })),
    downloadUpdate: jest.fn(async () => "downloaded"),
    quitAndInstall: jest.fn(),
  },
}));

jest.mock("../../session", () => ({
  requireRole: () => ({ ok: true }),
}));

describe("updaterHandlers", () => {
  beforeEach(() => {
    (ipcMain.handle as unknown as jest.Mock).mockClear();
  });

  function getHandler(channel: string) {
    const calls = (ipcMain.handle as unknown as jest.Mock).mock.calls;
    const match = calls.find((c) => c[0] === channel);
    if (!match) throw new Error(`Missing handler: ${channel}`);
    return match[1] as (...args: any[]) => any;
  }

  it("get-status returns version/platform/packaged", async () => {
    registerUpdaterHandlers();
    const handler = getHandler("updater:get-status");

    const res = await handler();
    expect(res.version).toBe("1.0.0");
    expect(res.packaged).toBe(false);
    expect(res.platform).toBe(process.platform);
  });

  it("check returns error in dev mode", async () => {
    (app as any).isPackaged = false;
    registerUpdaterHandlers();

    const handler = getHandler("updater:check");
    const res = await handler({ sender: { id: 1 } });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/disabled in dev/i);
  });

  it("check calls electron-updater in packaged mode", async () => {
    const { autoUpdater } = require("electron-updater");
    (app as any).isPackaged = true;

    registerUpdaterHandlers();

    const handler = getHandler("updater:check");
    const res = await handler({ sender: { id: 1 } });
    expect(res.success).toBe(true);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled();
    expect(res.updateInfo).toEqual({ version: "1.0.1" });
  });

  it("download calls electron-updater in packaged mode", async () => {
    const { autoUpdater } = require("electron-updater");
    (app as any).isPackaged = true;

    registerUpdaterHandlers();

    const handler = getHandler("updater:download");
    const res = await handler({ sender: { id: 1 } });
    expect(res.success).toBe(true);
    expect(autoUpdater.downloadUpdate).toHaveBeenCalled();
  });

  it("quitAndInstall calls electron-updater in packaged mode", async () => {
    const { autoUpdater } = require("electron-updater");
    (app as any).isPackaged = true;

    registerUpdaterHandlers();

    const handler = getHandler("updater:quit-and-install");
    const res = await handler({ sender: { id: 1 } });
    expect(res.success).toBe(true);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalled();
  });
});
