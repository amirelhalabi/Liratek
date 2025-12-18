import { useEffect, useState } from "react";

export default function RatesManager() {
  const [list, setList] = useState<
    Array<{
      id: number;
      from_code: string;
      to_code: string;
      rate: number;
      updated_at: string;
    }>
  >([]);
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("LBP");
  const [rate, setRate] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await window.api.rates.list();
      setList(rows);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!from || !to || !rate) return;
    const r = parseFloat(rate);
    if (!r || r <= 0) return alert("Invalid rate");
    const res = await window.api.rates.set(from, to, r);
    if (!res.success) return alert(res.error);
    setRate("");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          value={from}
          onChange={(e) => setFrom(e.target.value.toUpperCase())}
          placeholder="From (e.g., USD)"
          className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
        />
        <span className="text-slate-400">→</span>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value.toUpperCase())}
          placeholder="To (e.g., LBP)"
          className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
        />
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="Rate"
          className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white w-32"
        />
        <button
          onClick={save}
          className="px-3 py-2 bg-violet-600 rounded text-white"
        >
          Save
        </button>
      </div>

      <div className="border border-slate-700 rounded overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="p-2">Pair</th>
              <th className="p-2">Rate</th>
              <th className="p-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="p-3 text-slate-500">
                  Loading...
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-3 text-slate-500">
                  No rates
                </td>
              </tr>
            ) : (
              list.map((row) => (
                <tr key={row.id} className="border-t border-slate-800">
                  <td className="p-2 font-mono">
                    {row.from_code} → {row.to_code}
                  </td>
                  <td className="p-2">{row.rate}</td>
                  <td className="p-2 text-slate-500 text-xs">
                    {row.updated_at}
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
