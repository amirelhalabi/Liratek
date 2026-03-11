import { useEffect, useState, useCallback } from "react";
import { appEvents } from "@liratek/ui";
import {
  Download,
  RefreshCw,
  Package,
  Tag,
  Calendar,
  FileBox,
  CheckCircle,
} from "lucide-react";

interface ReleaseAsset {
  name: string;
  size: number;
  download_url: string;
}

interface DevReleaseInfo {
  tag: string;
  name: string;
  published_at: string;
  assets: ReleaseAsset[];
}

type UpdateState =
  | "idle"
  | "checking"
  | "update-available"
  | "up-to-date"
  | "downloading"
  | "downloaded";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UpdatesPanel() {
  const [status, setStatus] = useState<{
    packaged: boolean;
    platform: string;
    version: string;
  } | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [devRelease, setDevRelease] = useState<DevReleaseInfo | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);

  const currentVersion = status?.version ?? null;

  const check = useCallback(async () => {
    setUpdateState("checking");
    setDevRelease(null);
    setAvailableVersion(null);
    try {
      const res = await window.api.updater.check();
      if (!res.success) {
        appEvents.emit(
          "notification:show",
          res.error || "Update check failed",
          "error",
        );
        setUpdateState("idle");
        return;
      }

      if (res.devMode && res.updateInfo) {
        setDevRelease({
          tag: `v${res.updateInfo.version}`,
          name: res.updateInfo.version,
          published_at: res.updateInfo.releaseDate,
          assets: [],
        });
        setInfo(null);
        setUpdateState("idle"); // dev mode — no download/install flow
      } else if (res.updateInfo) {
        const updateInfo = res.updateInfo as { version?: string; tag?: string };
        const ver =
          updateInfo.version || updateInfo.tag?.replace(/^v/, "") || null;
        // Compare remote version to current — same version means up-to-date
        if (ver && currentVersion && ver === currentVersion) {
          setInfo(null);
          setDevRelease(null);
          setUpdateState("up-to-date");
        } else {
          setAvailableVersion(ver);
          setInfo(JSON.stringify(res.updateInfo, null, 2));
          setDevRelease(null);
          setUpdateState("update-available");
        }
      } else {
        setInfo(null);
        setDevRelease(null);
        setUpdateState("up-to-date");
      }
    } catch (_e) {
      appEvents.emit(
        "notification:show",
        _e instanceof Error ? _e.message : "Update check failed",
        "error",
      );
      setUpdateState("idle");
    }
  }, [currentVersion]);

  const download = useCallback(async () => {
    // Immediately show downloading state — progress events may be sparse
    setUpdateState("downloading");
    setDownloadPercent(0);
    try {
      const res = await window.api.updater.download();
      if (!res.success) {
        appEvents.emit(
          "notification:show",
          res.error || "Download failed",
          "error",
        );
        setUpdateState("update-available"); // revert — can retry
        return;
      }
      // If download completed instantly (no progress events fired),
      // jump straight to downloaded state
      setUpdateState((prev) => (prev === "downloading" ? "downloaded" : prev));
      if (updateState !== "downloaded") {
        appEvents.emit(
          "notification:show",
          "Update downloaded — ready to install",
          "success",
        );
      }
    } catch (_e) {
      appEvents.emit(
        "notification:show",
        _e instanceof Error ? _e.message : "Download failed",
        "error",
      );
      setUpdateState("update-available");
    }
  }, [updateState]);

  const install = useCallback(async () => {
    try {
      window.api.updater.quitAndInstall();
    } catch (_e) {
      appEvents.emit(
        "notification:show",
        _e instanceof Error ? _e.message : "Install failed",
        "error",
      );
    }
  }, []);

  // Load status on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await window.api.updater.getStatus();
        setStatus({
          packaged: !res.devMode,
          platform: res.status || "unknown",
          version: res.version || "0.0.0",
        });
      } catch {
        setStatus(null);
      }
    })();
  }, []);

  // Listen for push events from main process (auto-check on launch)
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    if (window.api.updater.onUpdateAvailable) {
      cleanups.push(
        window.api.updater.onUpdateAvailable((_event: any, data: any) => {
          // Skip if "update" version matches current version
          const ver = data?.version;
          if (ver && status?.version && ver === status.version) return;
          setAvailableVersion(ver || null);
          setUpdateState("update-available");
        }),
      );
    }
    if (window.api.updater.onDownloadProgress) {
      cleanups.push(
        window.api.updater.onDownloadProgress((_event: any, data: any) => {
          setUpdateState("downloading");
          setDownloadPercent(Math.round(data?.percent ?? 0));
        }),
      );
    }
    if (window.api.updater.onUpdateDownloaded) {
      cleanups.push(
        window.api.updater.onUpdateDownloaded((_event: any) => {
          setUpdateState("downloaded");
        }),
      );
    }
    if (window.api.updater.onUpdateNotAvailable) {
      cleanups.push(
        window.api.updater.onUpdateNotAvailable((_event: any) => {
          setUpdateState("up-to-date");
        }),
      );
    }

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [status?.version]);

  const isPackaged = status && status.packaged;
  const loading = updateState === "checking" || updateState === "downloading";

  return (
    <div className="space-y-3">
      <h3 className="text-white font-semibold">Updates</h3>

      {status && (
        <div className="text-xs text-slate-500 space-y-1">
          <div>Version: {status.version}</div>
          <div>Platform: {status.platform}</div>
          <div>
            Updater:{" "}
            {status.packaged
              ? "Enabled (packaged build)"
              : "Dev mode (GitHub API preview)"}
          </div>
        </div>
      )}

      {/* State message */}
      {updateState === "checking" && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <RefreshCw size={14} className="animate-spin" />
          Checking for updates...
        </div>
      )}
      {updateState === "up-to-date" && (
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle size={14} />
          You are running the latest version
        </div>
      )}
      {updateState === "update-available" && (
        <div className="flex items-center gap-2 text-sm text-amber-400">
          <Download size={14} />
          Update available{availableVersion ? `: v${availableVersion}` : ""}
        </div>
      )}
      {updateState === "downloading" && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-violet-400">
            <RefreshCw size={14} className="animate-spin" />
            Downloading update...{" "}
            {downloadPercent > 0 ? `${downloadPercent}%` : ""}
          </div>
          <div className="w-full bg-slate-700 rounded-full h-1.5 overflow-hidden">
            {downloadPercent > 0 ? (
              <div
                className="bg-violet-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${downloadPercent}%` }}
              />
            ) : (
              <div className="bg-violet-400/60 h-1.5 w-1/3 rounded-full animate-pulse" />
            )}
          </div>
        </div>
      )}
      {updateState === "downloaded" && (
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <Package size={14} />
          Update downloaded — ready to install
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={check}
          disabled={loading}
          className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm flex items-center gap-1.5 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} />
          Check for Updates
        </button>

        {/* Download: only when update is available (packaged only) */}
        {isPackaged && updateState === "update-available" && (
          <button
            onClick={download}
            className="px-3 py-2 bg-violet-600 hover:bg-violet-500 rounded text-white text-sm flex items-center gap-1.5 transition-colors"
          >
            <Download size={14} />
            Download
          </button>
        )}

        {/* Install: only when update is downloaded (packaged only) */}
        {isPackaged && updateState === "downloaded" && (
          <button
            onClick={install}
            className="px-3 py-2 bg-red-600 hover:bg-red-500 rounded text-white text-sm flex items-center gap-1.5 transition-colors"
          >
            <Package size={14} />
            Install & Restart
          </button>
        )}
      </div>

      {/* Dev mode: structured release display */}
      {devRelease && (
        <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Tag size={16} className="text-violet-400" />
            <span className="text-white font-semibold text-sm">
              {devRelease.tag}
            </span>
            {devRelease.tag !== `v${status?.version}` && (
              <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded-full">
                Newer than local
              </span>
            )}
            {devRelease.tag === `v${status?.version}` && (
              <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full">
                Up to date
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Calendar size={12} />
            {new Date(devRelease.published_at).toLocaleString()}
          </div>

          {devRelease.assets.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Release Assets ({devRelease.assets.length})
              </div>
              <div className="space-y-1">
                {devRelease.assets.map((asset) => (
                  <div
                    key={asset.name}
                    className="flex items-center justify-between bg-slate-900/60 rounded-lg px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileBox
                        size={14}
                        className={
                          asset.name.endsWith(".blockmap")
                            ? "text-amber-400"
                            : asset.name.endsWith(".yml")
                              ? "text-sky-400"
                              : "text-violet-400"
                        }
                      />
                      <span className="text-slate-200 truncate font-mono">
                        {asset.name}
                      </span>
                    </div>
                    <span className="text-slate-500 shrink-0 ml-3">
                      {formatBytes(asset.size)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Packaged mode: raw JSON for update info */}
      {info && !devRelease && updateState !== "idle" && (
        <pre className="text-xs bg-slate-900 border border-slate-700 rounded p-3 overflow-auto max-h-48 text-slate-300">
          {info}
        </pre>
      )}
    </div>
  );
}
