/**
 * Step 0: Detect existing LiraTek databases on the network.
 *
 * - Auto-scans mounted volumes on load
 * - If found → user can pick one to join
 * - If not found → browse manually or start fresh setup
 */

import { useEffect, useState } from "react";
import { useSetup } from "../context/SetupContext";
import { Loader2, Search, FolderOpen, Plus, Wifi } from "lucide-react";

interface DetectedDb {
  path: string;
  shopName: string;
}

export default function StepDetect() {
  const { setStep, updatePayload } = useSetup();
  const [scanning, setScanning] = useState(true);
  const [databases, setDatabases] = useState<DetectedDb[]>([]);
  const [error, setError] = useState("");

  // Auto-scan on mount
  useEffect(() => {
    let cancelled = false;

    async function scan() {
      try {
        if (!window.api) {
          setScanning(false);
          return;
        }
        const result = await window.api.setup.detectNetworkDb();
        if (cancelled) return;

        if (result.success && result.databases.length > 0) {
          setDatabases(result.databases);
        }
      } catch {
        // Scan failed silently — user can still browse or setup new
      } finally {
        if (!cancelled) setScanning(false);
      }
    }

    scan();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectDb = (db: DetectedDb) => {
    updatePayload({
      join_db_path: db.path,
      shop_name: db.shopName,
    });
    // Go to join-shop step (step -1 in our flow, rendered as StepJoinShop)
    setStep(-1);
  };

  const handleBrowse = async () => {
    if (!window.api) return;
    setError("");

    try {
      const result = await window.api.setup.browseForDatabase();
      if (result.canceled) return;

      if (!result.success) {
        setError(result.error || "Invalid database");
        return;
      }

      updatePayload({
        join_db_path: result.path!,
        shop_name: result.shopName || "Unknown Shop",
      });
      setStep(-1);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleNewSetup = () => {
    setStep(1);
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-white">Welcome to LiraTek</h2>
        <p className="text-slate-400 text-sm mt-1">
          {scanning
            ? "Scanning for existing shops on your network..."
            : databases.length > 0
              ? "We found an existing shop! Join it or set up a new one."
              : "No existing shops found. You can browse for one or start fresh."}
        </p>
      </div>

      {scanning && (
        <div className="flex flex-col items-center py-8 gap-3">
          <Loader2 size={32} className="animate-spin text-violet-400" />
          <span className="text-sm text-slate-400">
            Scanning network volumes...
          </span>
        </div>
      )}

      {!scanning && databases.length > 0 && (
        <div className="space-y-2">
          {databases.map((db) => (
            <button
              key={db.path}
              onClick={() => handleSelectDb(db)}
              className="w-full flex items-center gap-3 bg-slate-900/50 hover:bg-slate-700/50 border border-slate-700 hover:border-violet-500/50 rounded-xl p-4 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                <Wifi size={20} className="text-violet-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-white font-medium">{db.shopName}</div>
                <div className="text-xs text-slate-500 truncate">{db.path}</div>
              </div>
              <span className="text-xs text-violet-400 font-medium">
                Join &rarr;
              </span>
            </button>
          ))}
        </div>
      )}

      {!scanning && (
        <>
          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleBrowse}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border border-slate-600 text-slate-300 hover:bg-slate-800 rounded-xl transition-colors text-sm"
            >
              <FolderOpen size={16} />
              Browse for Database
            </button>
            <button
              onClick={handleNewSetup}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-xl transition-colors text-sm"
            >
              <Plus size={16} />
              Set Up New Shop
            </button>
          </div>

          {!scanning && databases.length === 0 && (
            <p className="text-xs text-slate-600 text-center">
              Make sure the primary laptop&apos;s shared folder is mounted in
              Finder before scanning.
            </p>
          )}

          <button
            onClick={() => {
              setScanning(true);
              setDatabases([]);
              // Re-trigger scan
              window.api?.setup.detectNetworkDb().then((r) => {
                if (r.success) setDatabases(r.databases);
                setScanning(false);
              });
            }}
            className="w-full flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <Search size={12} />
            Scan Again
          </button>
        </>
      )}
    </div>
  );
}
