import { useEffect, useState } from "react";
import { useApi } from "@liratek/ui";
import { DataTable } from "@/shared/components/DataTable";
import { Edit, Trash2, TrendingUp, Info } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RateRow {
  id: number;
  to_code: string;
  market_rate: number;
  delta: number;
  is_stronger: 1 | -1;
  updated_at: string;
}

interface FormData {
  to_code: string;
  market_rate: string;
  delta: string;
  is_stronger: 1 | -1;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute the effective buy/sell rates from the 4-column schema.
 * rate = market_rate + is_stronger × (action × delta)
 * GIVE_USD = +1, TAKE_USD = -1
 */
function computeEffectiveRates(row: RateRow) {
  const buyRate = row.market_rate + row.is_stronger * (+1 * row.delta); // GIVE_USD: customer gives non-USD
  const sellRate = row.market_rate + row.is_stronger * (-1 * row.delta); // TAKE_USD: customer gives USD

  // For LBP (is_stronger=+1): buyRate > market > sellRate (rate in LBP/USD)
  // For EUR (is_stronger=-1): sellRate > market > buyRate (rate in USD/EUR)
  return { buyRate, sellRate };
}

function formatRate(rate: number, isStronger: 1 | -1): string {
  return isStronger === 1
    ? rate.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " LBP"
    : rate.toFixed(4) + " USD";
}

function getCurrencyLabel(toCode: string, isStronger: 1 | -1): string {
  if (isStronger === 1) return `1 USD = X ${toCode}`;
  return `1 ${toCode} = X USD`;
}

// ─── Component ────────────────────────────────────────────────────────────────

const defaultForm: FormData = {
  to_code: "",
  market_rate: "",
  delta: "",
  is_stronger: 1,
};

export default function RatesManager() {
  const api = useApi();
  const [list, setList] = useState<RateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormData>(defaultForm);
  const [editingRow, setEditingRow] = useState<RateRow | null>(null);
  const [editForm, setEditForm] = useState<FormData>(defaultForm);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.getRates();
      setList(rows as RateRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // ── Add New Rate ──────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!form.to_code || !form.market_rate || !form.delta) {
      return alert("Please fill in all fields.");
    }
    const market = parseFloat(form.market_rate);
    const delta = parseFloat(form.delta);
    if (isNaN(market) || market <= 0) return alert("Invalid market rate.");
    if (isNaN(delta) || delta < 0) return alert("Invalid delta (must be ≥ 0).");

    const res = await api.setRate({
      to_code: form.to_code.toUpperCase(),
      market_rate: market,
      delta,
      is_stronger: form.is_stronger,
    });
    if (!res?.success) return alert(res?.error ?? "Failed to save rate.");
    setForm(defaultForm);
    load();
  };

  // ── Edit ──────────────────────────────────────────────────────────────────

  const handleEditOpen = (row: RateRow) => {
    setEditingRow(row);
    setEditForm({
      to_code: row.to_code,
      market_rate: String(row.market_rate),
      delta: String(row.delta),
      is_stronger: row.is_stronger,
    });
  };

  const handleEditSave = async () => {
    if (!editingRow) return;
    const market = parseFloat(editForm.market_rate);
    const delta = parseFloat(editForm.delta);
    if (isNaN(market) || market <= 0) return alert("Invalid market rate.");
    if (isNaN(delta) || delta < 0) return alert("Invalid delta.");

    const res = await api.setRate({
      to_code: editingRow.to_code,
      market_rate: market,
      delta,
      is_stronger: editForm.is_stronger,
    });
    if (!res?.success) return alert(res?.error ?? "Failed to save rate.");
    setEditingRow(null);
    load();
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (row: RateRow) => {
    if (
      !confirm(
        `Delete rate for ${row.to_code}? This will break exchanges involving this currency.`,
      )
    )
      return;
    try {
      await api.deleteRate(row.to_code);
      load();
    } catch {
      alert("Failed to delete rate.");
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Info Banner ── */}
      <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-sm text-blue-300">
        <Info size={16} className="mt-0.5 shrink-0 text-blue-400" />
        <div>
          <strong>New rate model:</strong> One row per non-USD currency. Enter
          the <strong>market (mid) rate</strong> and <strong>delta</strong>{" "}
          (half-spread). The formula{" "}
          <code className="bg-slate-800 px-1 rounded text-xs">
            rate = market ± delta
          </code>{" "}
          derives buy/sell rates automatically. Use{" "}
          <strong>is_stronger = stronger</strong> for currencies worth more than
          1 USD (EUR, GBP), and <strong>weaker</strong> for currencies worth
          less (LBP, TRY).
        </div>
      </div>

      {/* ── Spread Cards ── */}
      {list.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((row) => {
            const { buyRate, sellRate } = computeEffectiveRates(row);
            return (
              <div
                key={row.id}
                className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl"
              >
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-emerald-400">
                      USD/{row.to_code} Spread
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {getCurrencyLabel(row.to_code, row.is_stronger)}
                    </p>
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">We pay customer:</span>
                        <span className="font-mono text-white">
                          {formatRate(buyRate, row.is_stronger)}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">
                          Customer pays us:
                        </span>
                        <span className="font-mono text-white">
                          {formatRate(sellRate, row.is_stronger)}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs border-t border-slate-700 pt-1 mt-1">
                        <span className="text-emerald-400">
                          Spread (2×delta):
                        </span>
                        <span className="font-mono text-emerald-400 font-bold">
                          {formatRate(row.delta * 2, row.is_stronger)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add New Rate ── */}
      <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
        <h3 className="text-sm font-semibold text-white mb-3">
          Add / Update Currency Rate
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Currency Code
            </label>
            <input
              value={form.to_code}
              onChange={(e) =>
                setForm({ ...form, to_code: e.target.value.toUpperCase() })
              }
              placeholder="e.g. LBP, EUR, GBP"
              maxLength={5}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white text-sm font-mono uppercase"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Market Rate
            </label>
            <input
              value={form.market_rate}
              onChange={(e) =>
                setForm({ ...form, market_rate: e.target.value })
              }
              placeholder="e.g. 89500 or 1.18"
              type="number"
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Delta (half-spread)
            </label>
            <input
              value={form.delta}
              onChange={(e) => setForm({ ...form, delta: e.target.value })}
              placeholder="e.g. 500 or 0.02"
              type="number"
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Strength vs USD
            </label>
            <select
              value={form.is_stronger}
              onChange={(e) =>
                setForm({
                  ...form,
                  is_stronger: Number(e.target.value) as 1 | -1,
                })
              }
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white text-sm"
            >
              <option value={1}>Weaker than USD (e.g. LBP)</option>
              <option value={-1}>Stronger than USD (e.g. EUR)</option>
            </select>
          </div>
        </div>
        <button
          onClick={handleAdd}
          className="mt-3 px-5 py-2 bg-violet-600 hover:bg-violet-700 rounded text-white text-sm font-medium transition-colors"
        >
          Save Rate
        </button>
      </div>

      {/* ── Rates Table ── */}
      <div className="border border-slate-700 rounded-xl overflow-hidden">
        <DataTable
          columns={[
            { header: "Currency" },
            { header: "Market Rate" },
            { header: "Buy Rate (we give)" },
            { header: "Sell Rate (customer gives)" },
            { header: "Delta" },
            { header: "Updated" },
            { header: "Actions" },
          ]}
          data={list}
          loading={loading}
          emptyMessage="No rates configured"
          exportExcel
          exportPdf
          exportFilename="exchange-rates"
          renderRow={(row) => {
            const { buyRate, sellRate } = computeEffectiveRates(row);
            return (
              <tr
                key={row.id}
                className="border-t border-slate-800 hover:bg-slate-800/50 transition-colors"
              >
                <td className="p-3">
                  <div className="font-bold text-white font-mono">
                    {row.to_code}
                  </div>
                  <div className="text-xs text-slate-500">
                    {getCurrencyLabel(row.to_code, row.is_stronger)}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    {row.is_stronger === 1
                      ? "Weaker than USD"
                      : "Stronger than USD"}
                  </div>
                </td>
                <td className="p-3">
                  <span className="font-mono text-white">
                    {formatRate(row.market_rate, row.is_stronger)}
                  </span>
                </td>
                <td className="p-3">
                  <span className="font-mono text-emerald-400">
                    {formatRate(buyRate, row.is_stronger)}
                  </span>
                  <div className="text-xs text-slate-600">
                    We give this to customer
                  </div>
                </td>
                <td className="p-3">
                  <span className="font-mono text-red-400">
                    {formatRate(sellRate, row.is_stronger)}
                  </span>
                  <div className="text-xs text-slate-600">
                    Customer gives us this
                  </div>
                </td>
                <td className="p-3">
                  <span className="font-mono text-amber-400">
                    ±{formatRate(row.delta, row.is_stronger)}
                  </span>
                </td>
                <td className="p-3 text-slate-400 text-xs">
                  {new Date(row.updated_at).toLocaleString()}
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditOpen(row)}
                      className="p-2 hover:bg-slate-700 rounded text-blue-400 hover:text-blue-300 transition-colors"
                      title="Edit rate"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(row)}
                      className="p-2 hover:bg-slate-700 rounded text-red-400 hover:text-red-300 transition-colors"
                      title="Delete rate"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          }}
        />
      </div>

      {/* ── Edit Modal ── */}
      {editingRow && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-[420px] shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">
              Edit Rate —{" "}
              <span className="text-violet-400">{editingRow.to_code}</span>
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Market Rate (mid-market)
                </label>
                <input
                  type="number"
                  value={editForm.market_rate}
                  onChange={(e) =>
                    setEditForm({ ...editForm, market_rate: e.target.value })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-2 text-white font-mono"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Delta (half-spread)
                </label>
                <input
                  type="number"
                  value={editForm.delta}
                  onChange={(e) =>
                    setEditForm({ ...editForm, delta: e.target.value })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-2 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Strength vs USD
                </label>
                <select
                  value={editForm.is_stronger}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      is_stronger: Number(e.target.value) as 1 | -1,
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-2 text-white"
                >
                  <option value={1}>Weaker than USD (e.g. LBP)</option>
                  <option value={-1}>Stronger than USD (e.g. EUR)</option>
                </select>
              </div>

              {/* Preview */}
              {editForm.market_rate && editForm.delta && (
                <div className="bg-slate-900/60 rounded-lg p-3 text-xs space-y-1">
                  <div className="text-slate-400 font-semibold mb-2">
                    Preview:
                  </div>
                  {(() => {
                    const m = parseFloat(editForm.market_rate);
                    const d = parseFloat(editForm.delta);
                    const s = editForm.is_stronger;
                    if (isNaN(m) || isNaN(d)) return null;
                    const buy = m + s * (+1 * d);
                    const sell = m + s * (-1 * d);
                    return (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Buy (we give):</span>
                          <span className="text-emerald-400 font-mono">
                            {formatRate(buy, s)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Market:</span>
                          <span className="text-white font-mono">
                            {formatRate(m, s)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">
                            Sell (customer gives):
                          </span>
                          <span className="text-red-400 font-mono">
                            {formatRate(sell, s)}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setEditingRow(null)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditSave}
                  className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded text-white font-medium transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
