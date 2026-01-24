import { useEffect, useState } from "react";

export default function CurrencyManager() {
  const [list, setList] = useState<
    Array<{ id: number; code: string; name: string; is_active: number }>
  >([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await window.api.currencies.list();
      setList(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async () => {
    if (!code || !name) return;
    const res = await window.api.currencies.create(code, name);
    if (res.success) {
      setCode("");
      setName("");
      load();
    } else {
      alert(res.error);
    }
  };

  const handleToggle = async (id: number, active: number) => {
    await window.api.currencies.update({ id, is_active: active ? 0 : 1 });
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete currency?")) return;
    const res = await window.api.currencies.delete(id);
    if (!res.success) alert(res.error);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Code (e.g., USD)"
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g., US Dollar)"
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white flex-1"
        />
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg"
        >
          Add
        </button>
      </div>

      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="p-2">Code</th>
              <th className="p-2">Name</th>
              <th className="p-2">Active</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="p-3 text-slate-500">
                  Loading...
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-3 text-slate-500">
                  No currencies
                </td>
              </tr>
            ) : (
              list.map((c) => (
                <tr key={c.id} className="border-t border-slate-800">
                  <td className="p-2">{c.code}</td>
                  <td className="p-2">{c.name}</td>
                  <td className="p-2">{c.is_active ? "Yes" : "No"}</td>
                  <td className="p-2 text-right space-x-2">
                    <button
                      onClick={() => handleToggle(c.id, c.is_active)}
                      className="text-xs px-2 py-1 bg-slate-700 rounded"
                    >
                      {c.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="text-xs px-2 py-1 bg-red-600 rounded text-white"
                    >
                      Delete
                    </button>
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
