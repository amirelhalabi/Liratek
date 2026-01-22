import { ipcMain } from "electron";
import { registerUpdaterHandlers } from "../updaterHandlers";

jest.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "1.0.0" },
  ipcMain: { handle: jest.fn() },
}));

describe("updaterHandlers registration", () => {
  it("registers updater channels", () => {
    registerUpdaterHandlers();

    const calls = (ipcMain.handle as unknown as jest.Mock).mock.calls.map(
      (c) => c[0],
    );

    expect(calls).toEqual(
      expect.arrayContaining([
        "updater:get-status",
        "updater:check",
        "updater:download",
        "updater:quit-and-install",
      ]),
    );
  });
});
