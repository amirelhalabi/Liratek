/**
 * LIRA-333 T017 (contracts/open-external.md) — `app:open-external` opens an
 * allowed WhatsApp link with Electron's `shell.openExternal` (outside
 * LiraTek, FR-016) and refuses every other URL without touching the shell.
 */
jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
  shell: { openExternal: jest.fn() },
}));

import { ipcMain as originalIpcMain, shell } from "electron";
import { registerAppShellHandlers } from "../appShellHandlers";

const ipcMain = originalIpcMain as unknown as { handle: jest.Mock };
const openExternal = shell.openExternal as unknown as jest.Mock;

type Handler = (event: unknown, data: unknown) => Promise<unknown>;

function handler(): Handler {
  const call = ipcMain.handle.mock.calls.find(
    ([name]) => name === "app:open-external",
  );
  if (!call) throw new Error("app:open-external was not registered");
  return call[1] as Handler;
}

const event = { sender: { id: 1 } };

describe("app:open-external", () => {
  beforeAll(() => {
    registerAppShellHandlers();
  });

  beforeEach(() => {
    openExternal.mockReset();
  });

  it("opens an allowed WhatsApp link once and reports success", async () => {
    openExternal.mockResolvedValue(undefined);
    const url = "https://wa.me/9613123456?text=Receipt%20RCP-1";
    await expect(handler()(event, { url })).resolves.toEqual({
      success: true,
    });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(url);
  });

  it.each([
    "https://evil.com/x",
    "http://wa.me/1",
    "file:///C:/Windows/System32/calc.exe",
    "javascript:alert(1)",
  ])("refuses %s without calling the shell", async (url) => {
    await expect(handler()(event, { url })).resolves.toEqual({
      success: false,
      error: "URL not allowed",
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("refuses a malformed payload without calling the shell", async () => {
    await expect(handler()(event, "https://wa.me/1")).resolves.toEqual({
      success: false,
      error: "URL not allowed",
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("reports a shell failure", async () => {
    openExternal.mockRejectedValue(new Error("no handler for https"));
    await expect(
      handler()(event, { url: "https://wa.me/9613123456" }),
    ).resolves.toEqual({ success: false, error: "no handler for https" });
  });
});
