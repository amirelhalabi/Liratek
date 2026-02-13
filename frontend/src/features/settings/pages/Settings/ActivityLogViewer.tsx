import { useEffect, useState, useCallback } from "react";
import * as api from "../../../../api/backendApi";

export default function ActivityLogViewer() {
  type ActivityLogRow = {
    id: number;
    created_at: string;
    user_id: number | null;
    action: string;
    table_name: string;
    record_id: number | null;
    details_json?: string;
  };
  const [logs, setLogs] = useState<ActivityLogRow[]>([]);
  const [limit, setLimit] = useState("200");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getRecentActivity(Number(limit) || 200);
      setLogs((res as ActivityLogRow[]) || []);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white w-24"
        />
        <button
          onClick={load}
          className="px-3 py-1 bg-slate-700 rounded text-white"
        >
          Refresh
        </button>
      </div>
      <div className="border border-slate-700 rounded overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="p-2">Time</th>
              <th className="p-2">User</th>
              <th className="p-2">Action</th>
              <th className="p-2">Table</th>
              <th className="p-2">Record</th>
              <th className="p-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-3 text-slate-500">
                  Loading...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-3 text-slate-500">
                  No activity logs
                </td>
              </tr>
            ) : (
              logs.map((r) => (
                <tr key={r.id} className="border-t border-slate-800">
                  <td className="p-2 text-xs text-slate-400">{r.created_at}</td>
                  <td className="p-2 text-xs">{r.user_id}</td>
                  <td className="p-2 text-xs">{r.action}</td>
                  <td className="p-2 text-xs">{r.table_name}</td>
                  <td className="p-2 text-xs">{r.record_id}</td>
                  <td className="p-2 text-xs truncate max-w-[240px]">
                    {r.details_json}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
