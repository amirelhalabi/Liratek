import { useState } from "react";
import { useSetup } from "../context/SetupContext";

export default function Step3DatabasePath() {
  const { updatePayload, setStep } = useSetup();
  const [dbType, setDbType] = useState<"local" | "network">("local");
  const [networkPath, setNetworkPath] = useState("");
  const [testResult, setTestResult] = useState<"pass" | "fail" | null>(null);
  const [testing, setTesting] = useState(false);

  const testConnection = async () => {
    if (!networkPath.trim()) return;

    setTesting(true);
    try {
      const result = await window.api.setup.testDatabasePath(
        networkPath.trim(),
      );
      setTestResult((result as { success: boolean }).success ? "pass" : "fail");
    } catch (_error) {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  };

  const handleNext = () => {
    updatePayload({
      database_path: dbType === "network" ? networkPath.trim() : null,
      database_type: dbType,
    });
    setStep(4);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Database Location</h2>
        <p className="text-slate-400 text-sm mt-1">
          Choose where to store your database. For multiple PCs on the same
          network, use a shared network folder.
        </p>
      </div>

      {/* Database Type Options */}
      <div className="space-y-3">
        {/* Local Option */}
        <label
          className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
            dbType === "local"
              ? "border-violet-500/40 bg-violet-500/5 ring-2 ring-violet-500/50"
              : "border-slate-700 bg-slate-900/50 hover:border-slate-600"
          }`}
        >
          <input
            type="radio"
            name="dbType"
            checked={dbType === "local"}
            onChange={() => setDbType("local")}
            className="mt-1 w-4 h-4 text-violet-600 focus:ring-violet-600"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">
                Local (This PC Only)
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                Default
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Database stored in this PC's app data folder. Other PCs cannot
              access this data.
            </p>
          </div>
        </label>

        {/* Network Option */}
        <label
          className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
            dbType === "network"
              ? "border-violet-500/40 bg-violet-500/5 ring-2 ring-violet-500/50"
              : "border-slate-700 bg-slate-900/50 hover:border-slate-600"
          }`}
        >
          <input
            type="radio"
            name="dbType"
            checked={dbType === "network"}
            onChange={() => setDbType("network")}
            className="mt-1 w-4 h-4 text-violet-600 focus:ring-violet-600"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">
                Network Shared (Multiple PCs)
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">
                Recommended for 2+ PCs
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              All PCs connect to the same database file on a shared network
              folder.
            </p>

            {dbType === "network" && (
              <div className="mt-3 space-y-2">
                <input
                  type="text"
                  placeholder="\\SERVER\LiratekDB\data.db"
                  value={networkPath}
                  onChange={(e) => {
                    setNetworkPath(e.target.value);
                    setTestResult(null);
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 font-mono"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={testConnection}
                    disabled={testing || !networkPath.trim()}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      testing || !networkPath.trim()
                        ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                        : "bg-violet-600 hover:bg-violet-500 text-white"
                    }`}
                  >
                    {testing ? "Testing..." : "Test Connection"}
                  </button>
                  {testResult === "pass" && (
                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                      ✓ Connection successful
                    </span>
                  )}
                  {testResult === "fail" && (
                    <span className="text-xs text-red-400 flex items-center gap-1">
                      ✗ Connection failed
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  💡 Tip: Create a shared folder on one PC (e.g., C:\LiratekDB)
                  and share it on the network.
                </p>
              </div>
            )}
          </div>
        </label>
      </div>

      {/* Warning for Network Mode */}
      {dbType === "network" && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <p className="text-xs text-amber-300">
            ⚠️ <strong>Important:</strong> Ensure the network folder is
            accessible from all PCs before continuing. The PC hosting the folder
            should remain powered on for other PCs to work.
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t border-slate-700">
        <button
          onClick={() => setStep(2)}
          className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          disabled={dbType === "network" && testResult !== "pass"}
          className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
            dbType === "network" && testResult !== "pass"
              ? "bg-slate-700 text-slate-400 cursor-not-allowed"
              : "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-500/20"
          }`}
        >
          Next
        </button>
      </div>
    </div>
  );
}
