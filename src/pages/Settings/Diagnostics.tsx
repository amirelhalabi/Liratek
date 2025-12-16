import { useEffect, useState } from 'react';

export default function Diagnostics() {
  const [errors, setErrors] = useState<Array<{ id: number; endpoint: string; error: string; created_at: string }>>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await window.api.diagnostics.getSyncErrors();
      setErrors(rows);
    } finally { setLoading(false); }
  };

  useEffect(()=>{ load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold">Sync Errors</h3>
        <button onClick={load} className="px-3 py-1 bg-slate-700 rounded text-white text-sm">Refresh</button>
      </div>
      <div className="border border-slate-700 rounded overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="p-2">Time</th>
              <th className="p-2">Endpoint</th>
              <th className="p-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="p-3 text-slate-500">Loading...</td></tr>
            ) : errors.length === 0 ? (
              <tr><td colSpan={3} className="p-3 text-slate-500">No errors</td></tr>
            ) : errors.map(e => (
              <tr key={e.id} className="border-t border-slate-800">
                <td className="p-2 text-xs text-slate-400">{e.created_at}</td>
                <td className="p-2 font-mono text-xs">{e.endpoint}</td>
                <td className="p-2 text-sm">{e.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
