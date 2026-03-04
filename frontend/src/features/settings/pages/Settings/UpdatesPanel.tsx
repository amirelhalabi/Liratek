import { useEffect, useState } from "react";
import { appEvents } from "@liratek/ui";
import {
  Download,
  RefreshCw,
  Package,
  Tag,
  Calendar,
  FileBox,
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
  const [loading, setLoading] = useState(false);

  const check = async () => {
    setLoading(true);
    setDevRelease(null);
    try {
      const res = await window.api.updater.check();
      if (!res.success) {
        appEvents.emit(
          "notification:show",
          res.error || "Update check failed",
          "error",
        );
        return;
      }

      if (res.devMode && res.updateInfo) {
        setDevRelease(res.updateInfo as DevReleaseInfo);
        setInfo(null);
      } else {
        setInfo(
          res.updateInfo ? JSON.stringify(res.updateInfo, null, 2) : null,
        );
        setDevRelease(null);
      }
    } catch (_e) {
      appEvents.emit(
        "notification:show",
        _e instanceof Error ? _e.message : "Update check failed",
        "error",
      );
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    setLoading(true);
    try {
      const res = await window.api.updater.download();
      if (!res.success) {
        appEvents.emit(
          "notification:show",
          res.error || "Download failed",
          "error",
        );
        return;
      }
      appEvents.emit(
        "notification:show",
        "Update downloaded successfully",
        "success",
      );
    } catch (_e) {
      appEvents.emit(
        "notification:show",
        _e instanceof Error ? _e.message : "Download failed",
        "error",
      );
    } finally {
      setLoading(false);
    }
  };

  const install = async () => {
    setLoading(true);
    try {
      const res = await window.api.updater.quitAndInstall();
      if (!res.success) {
        appEvents.emit(
          "notification:show",
          res.error || "Install failed",
          "error",
        );
        setLoading(false);
        return;
      }
    } catch (_e) {
      appEvents.emit(
        "notification:show",
        _e instanceof Error ? _e.message : "Install failed",
        "error",
      );
      setLoading(false);
    }
  };

  // Load status and auto-check on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await window.api.updater.getStatus();
        setStatus(res);
      } catch {
        setStatus(null);
      }
      check();
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isDevMode = status && !status.packaged;

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

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <RefreshCw size={14} className="animate-spin" />
          Checking for updates...
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={check}
          disabled={loading}
          className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw size={14} />
          Check for Updates
        </button>
        {!isDevMode && (
          <>
            <button
              onClick={download}
              disabled={loading}
              className="px-3 py-2 bg-violet-600 hover:bg-violet-500 rounded text-white text-sm flex items-center gap-1.5 transition-colors"
            >
              <Download size={14} />
              Download
            </button>
            <button
              onClick={install}
              disabled={loading}
              className="px-3 py-2 bg-red-600 hover:bg-red-500 rounded text-white text-sm flex items-center gap-1.5 transition-colors"
            >
              <Package size={14} />
              Install & Restart
            </button>
          </>
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

      {/* Packaged mode: raw JSON */}
      {info && !devRelease && (
        <pre className="text-xs bg-slate-900 border border-slate-700 rounded p-3 overflow-auto max-h-48 text-slate-300">
          {info}
        </pre>
      )}
    </div>
  );
}
