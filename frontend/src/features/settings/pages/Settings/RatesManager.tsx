import { useEffect, useState } from "react";
import { useApi } from "@liratek/ui";
import { DataTable } from "@/shared/components/DataTable";

export default function RatesManager() {
  const api = useApi();
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
      const rows = await api.getRates();
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
    const res = await api.setRate(from, to, r);
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
        <DataTable
          columns={["Pair", "Rate", "Updated"]}
          data={list}
          loading={loading}
          emptyMessage="No rates"
          exportExcel
          exportPdf
          exportFilename="exchange-rates"
          renderRow={(row) => (
            <tr key={row.id} className="border-t border-slate-800">
              <td className="p-2 font-mono">
                {row.from_code} → {row.to_code}
              </td>
              <td className="p-2">{row.rate}</td>
              <td className="p-2 text-slate-500 text-xs">{row.updated_at}</td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}
