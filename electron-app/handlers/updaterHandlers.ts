import { app, BrowserWindow, ipcMain, net } from "electron";
import { requireRole } from "../session.js";
import { UPDATE_TOKEN } from "../updater-config.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ESM does not provide require(); create one so we can load CJS-only packages
const esmRequire = createRequire(import.meta.url);

const GH_OWNER = "amirelhalabi";
const GH_REPO = "Liratek";

/** Whether we've already wired autoUpdater event listeners (only do once) */
let updaterEventsWired = false;

/**
 * Ensure process.env.GH_TOKEN is set for electron-updater's
 * PrivateGitHubProvider.  Priority:
 *   1. Already set in env (e.g. from .env file in dev)
 *   2. Build-time UPDATE_TOKEN baked in by CI
 */
function ensureUpdateToken(): void {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return;
  if (UPDATE_TOKEN && UPDATE_TOKEN !== "__UPDATE_TOKEN__") {
    process.env.GH_TOKEN = UPDATE_TOKEN;
  }
}

/** Read the canonical app version from the root package.json (electron-app/package.json is 1.0.0 placeholder). */
function getAppVersion(): string {
  if (app.isPackaged) return app.getVersion();
  try {
    // At runtime __dirname = electron-app/dist/handlers/
    // So: dist/handlers/ → dist/ → electron-app/ → repo root
    const rootPkg = path.resolve(__dirname, "../../../package.json");
    const pkg = JSON.parse(fs.readFileSync(rootPkg, "utf8"));
    return pkg.version || app.getVersion();
  } catch {
    return app.getVersion();
  }
}

/** Fetch the latest GitHub release metadata. Requires GH_TOKEN env var for private repos. */
async function fetchLatestRelease(): Promise<{
  tag: string;
  name: string;
  published_at: string;
  assets: { name: string; size: number; download_url: string }[];
}> {
  const token =
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    (UPDATE_TOKEN !== "__UPDATE_TOKEN__" ? UPDATE_TOKEN : null);
  if (!token) {
    throw new Error(
      "GH_TOKEN not set. Export GH_TOKEN with a GitHub personal access token to preview releases in dev mode.",
    );
  }

  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`;
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: "GET" });
    request.setHeader("Accept", "application/vnd.github+json");
    request.setHeader("User-Agent", "LiraTek-Updater");
    request.setHeader("Authorization", `Bearer ${token}`);

    let body = "";
    request.on("response", (response) => {
      response.on("data", (chunk) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          return reject(
            new Error(
              `GitHub API ${response.statusCode}: ${body.slice(0, 200)}`,
            ),
          );
        }
        try {
          const data = JSON.parse(body);
          resolve({
            tag: data.tag_name,
            name: data.name || data.tag_name,
            published_at: data.published_at,
            assets: (data.assets || []).map((a: any) => ({
              name: a.name,
              size: a.size,
              download_url: a.browser_download_url,
            })),
          });
        } catch (err) {
          reject(new Error("Failed to parse GitHub response"));
        }
      });
    });
    request.on("error", reject);
    request.end();
  });
}

/** Send an event to all renderer windows (safe if none exist yet). */
function sendToRenderers(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}

/**
 * Wire autoUpdater event listeners so that update-available, download-progress,
 * and update-downloaded events are pushed to the renderer. Only wires once.
 */
function wireAutoUpdaterEvents(): void {
  if (updaterEventsWired) return;
  updaterEventsWired = true;

  try {
    const { autoUpdater } = esmRequire("electron-updater");

    autoUpdater.on("update-available", (info: any) => {
      sendToRenderers("updater:update-available", {
        version: info?.version,
        releaseDate: info?.releaseDate,
        releaseName: info?.releaseName,
      });
    });

    autoUpdater.on("download-progress", (progress: any) => {
      sendToRenderers("updater:download-progress", {
        percent: progress?.percent ?? 0,
        bytesPerSecond: progress?.bytesPerSecond ?? 0,
        transferred: progress?.transferred ?? 0,
        total: progress?.total ?? 0,
      });
    });

    autoUpdater.on("update-downloaded", (info: any) => {
      sendToRenderers("updater:update-downloaded", {
        version: info?.version,
        releaseDate: info?.releaseDate,
        releaseName: info?.releaseName,
      });
    });

    autoUpdater.on("update-not-available", () => {
      sendToRenderers("updater:update-not-available");
    });

    autoUpdater.on("error", (err: Error) => {
      sendToRenderers("updater:error", err?.message || "Unknown updater error");
    });
  } catch {
    // electron-updater not available (e.g. dev mode) — silently skip
  }
}

/**
 * Auto-check for updates on app launch (called from main.ts).
 * Only runs in packaged mode and when the `auto_check_updates` setting is enabled.
 * @param getSetting - function that reads a setting from the DB
 */
export async function autoCheckForUpdates(
  getSetting?: (key: string) => string | undefined,
): Promise<void> {
  if (!app.isPackaged) return;

  // Check if auto-check is enabled (default: enabled)
  const autoCheckVal = getSetting?.("auto_check_updates");
  if (autoCheckVal === "0" || autoCheckVal === "disabled") return;

  try {
    const { autoUpdater } = esmRequire("electron-updater");
    ensureUpdateToken();
    wireAutoUpdaterEvents();
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    await autoUpdater.checkForUpdates();
  } catch {
    // Silently fail on auto-check — user can always check manually
  }
}

export function registerUpdaterHandlers(): void {
  ipcMain.handle("updater:get-status", () => {
    return {
      packaged: app.isPackaged,
      platform: process.platform,
      version: getAppVersion(),
    };
  });

  ipcMain.handle("updater:check", async (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    // Dev mode: fetch release metadata from GitHub API directly
    if (!app.isPackaged) {
      try {
        const release = await fetchLatestRelease();
        return { success: true, updateInfo: release, devMode: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    try {
      const { autoUpdater } = esmRequire("electron-updater");
      ensureUpdateToken();
      wireAutoUpdaterEvents();
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      const res = await autoUpdater.checkForUpdates();
      return { success: true, updateInfo: res?.updateInfo };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("updater:download", async (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    if (!app.isPackaged) {
      return { success: false, error: "Updater is disabled in dev mode" };
    }

    try {
      const { autoUpdater } = esmRequire("electron-updater");
      ensureUpdateToken();
      wireAutoUpdaterEvents();
      const res = await autoUpdater.downloadUpdate();
      return { success: true, result: res };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("updater:quit-and-install", async (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    if (!app.isPackaged) {
      return { success: false, error: "Updater is disabled in dev mode" };
    }

    try {
      const { autoUpdater } = esmRequire("electron-updater");
      ensureUpdateToken();
      autoUpdater.quitAndInstall();
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
