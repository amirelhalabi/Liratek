import { useEffect, useState } from "react";

export default function UpdatesPanel() {
  const [status, setStatus] = useState<{
    packaged: boolean;
    platform: string;
    version: string;
  } | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      const res = await window.api.updater.getStatus();
      setStatus(res);
    } catch (_e: unknown) {
      setStatus(null);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const check = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.api.updater.check();
      if (!res.success) throw new Error(res.error || "Check failed");
      setInfo(res.updateInfo ? JSON.stringify(res.updateInfo, null, 2) : null);
    } catch (_e) {
      setError(_e instanceof Error ? _e.message : "Check failed");
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.api.updater.download();
      if (!res.success) throw new Error(res.error || "Download failed");
    } catch (_e) {
      setError(_e instanceof Error ? _e.message : "Download failed");
    } finally {
      setLoading(false);
    }
  };

  const install = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.api.updater.quitAndInstall();
      if (!res.success) throw new Error(res.error || "Install failed");
    } catch (_e) {
      setError(_e instanceof Error ? _e.message : "Install failed");
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold">Updates</h3>
        <button
          onClick={loadStatus}
          className="px-3 py-1 bg-slate-700 rounded text-white text-sm"
        >
          Refresh
        </button>
      </div>

      {status && (
        <div className="text-xs text-slate-500 space-y-1">
          <div>Version: {status.version}</div>
          <div>Platform: {status.platform}</div>
          <div>
            Updater: {status.packaged ? "Enabled (packaged build)" : "Disabled (dev mode)"}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={check}
          disabled={loading}
          className="px-3 py-2 bg-slate-700 rounded text-white text-sm"
        >
          {loading ? "Working..." : "Check for Updates"}
        </button>
        <button
          onClick={download}
          disabled={loading}
          className="px-3 py-2 bg-violet-600 rounded text-white text-sm"
        >
          Download
        </button>
        <button
          onClick={install}
          disabled={loading}
          className="px-3 py-2 bg-red-600 rounded text-white text-sm"
        >
          Install & Restart
        </button>
      </div>

      {info && (
        <pre className="text-xs bg-slate-900 border border-slate-700 rounded p-3 overflow-auto max-h-48 text-slate-300">
          {info}
        </pre>
      )}
    </div>
  );
}
