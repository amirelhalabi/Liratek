/**
 * App shell IPC handlers (LIRA-333, contracts/open-external.md).
 *
 * `app:open-external` opens a link OUTSIDE LiraTek with Electron's
 * `shell.openExternal` — the WhatsApp desktop app when installed, otherwise
 * the default browser (FR-016). A renderer `window.open` would instead
 * create a LiraTek window, because the app has no `setWindowOpenHandler`.
 *
 * No `requireRole`, deliberately: opening a link reads and writes no data,
 * so any signed-in cashier may do it. The security boundary is the host
 * allow-list in `openExternalUrlSchema` (core): only `https://wa.me/…` and
 * `https://api.whatsapp.com/…` reach the shell; `file:`, `javascript:` and
 * look-alike hosts are refused before `shell.openExternal` is called.
 *
 * Offline desktop mode classes this channel `local` (channelPolicy.ts): it
 * runs, and is never recorded.
 */
import { ipcMain, shell } from "electron";
import { ipcLogger, OPEN_EXTERNAL_URL_NOT_ALLOWED } from "@liratek/core";
import { validatePayload, OpenExternalUrlSchema } from "../schemas/index.js";

export function registerAppShellHandlers(): void {
  ipcMain.handle("app:open-external", async (_event, data: unknown) => {
    const validation = validatePayload(OpenExternalUrlSchema, data);
    if (!validation.ok) {
      ipcLogger.warn(
        { channel: "app:open-external" },
        "Refused to open a URL that is not on the allow-list",
      );
      return { success: false, error: OPEN_EXTERNAL_URL_NOT_ALLOWED };
    }
    try {
      await shell.openExternal(validation.data.url);
      return { success: true };
    } catch (error) {
      ipcLogger.error({ error }, "app:open-external failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Could not open link",
      };
    }
  });
}
