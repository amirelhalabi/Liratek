import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Edit,
  Info,
  Plus,
  Save,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { useApi } from "@liratek/ui";
import { DataTable } from "@liratek/ui";
import { calculateProfitSpread } from "@/utils/currencyUtils";

interface CurrencyRow {
  id: number;
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  is_active: number;
  enabledModules?: string[];
}

// ─── Multi-select dropdown (portal-positioned to avoid overflow clipping) ──
interface ModuleMultiSelectProps {
  allModules: Array<{ key: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}

function ModuleMultiSelect({
  allModules,
  selected,
  onChange,
}: ModuleMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Position the dropdown relative to viewport
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow < dropdownHeight
        ? rect.top - Math.min(dropdownHeight, rect.top - 8)
        : rect.bottom + 4;
    setPos({ top, left: rect.left });
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on scroll so it doesn't float in wrong position
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    window.addEventListener("scroll", handler, true);
    return () => window.removeEventListener("scroll", handler, true);
  }, [open]);

  const toggle = (key: string) => {
    onChange(
      selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key],
    );
  };

  const labels = allModules
    .filter((m) => selected.includes(m.key))
    .map((m) => m.label);

  return (
    <>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 w-full rounded-lg border border-slate-600 bg-slate-800/50 px-2.5 py-1.5 text-left text-sm hover:border-slate-500 transition-colors"
      >
        <span className="flex-1 flex flex-wrap gap-1 min-h-[22px]">
          {labels.length === 0 ? (
            <span className="text-slate-500 text-xs">No modules</span>
          ) : (
            labels.map((l) => (
              <span
                key={l}
                className="inline-flex items-center rounded-md bg-violet-600/20 text-violet-300 text-xs px-1.5 py-0.5 leading-tight border border-violet-500/20"
              >
                {l}
              </span>
            ))
          )}
        </span>
        <ChevronDown
          size={14}
          className={`text-slate-400 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Fixed-position dropdown (avoids overflow clipping) */}
      {open && (
        <div
          ref={dropdownRef}
          className="fixed z-[9999] w-56 rounded-lg border border-slate-600 bg-slate-800 shadow-2xl shadow-black/40 max-h-[280px] overflow-y-auto"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="p-1.5 border-b border-slate-700 flex items-center justify-between px-3">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">
              Select Modules
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-500 hover:text-white"
            >
              <X size={12} />
            </button>
          </div>
          {allModules.map((mod) => {
            const checked = selected.includes(mod.key);
            return (
              <button
                key={mod.key}
                type="button"
                onClick={() => toggle(mod.key)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-700/50 transition-colors"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    checked
                      ? "border-violet-500 bg-violet-600 text-white"
                      : "border-slate-500 bg-slate-700"
                  }`}
                >
                  {checked && <Check size={11} strokeWidth={3} />}
                </span>
                <span className={checked ? "text-white" : "text-slate-400"}>
                  {mod.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Exchange Rates Section (with full CRUD) ──────────────────────────────

interface RateRow {
  id: number;
  to_code: string;
  market_rate: number;
  delta: number;
  is_stronger: 1 | -1;
  updated_at: string;
}

interface RateFormData {
  to_code: string;
  market_rate: string;
  delta: string;
  is_stronger: 1 | -1;
}

const defaultRateForm: RateFormData = {
  to_code: "",
  market_rate: "",
  delta: "",
  is_stronger: 1,
};

function computeEffectiveRates(row: RateRow) {
  const rateA = row.market_rate + row.delta;
  const rateB = row.market_rate - row.delta;
  return { buyRate: Math.min(rateA, rateB), sellRate: Math.max(rateA, rateB) };
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

function ExchangeRatesSection() {
  const api = useApi();
  const [rates, setRates] = useState<RateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<RateFormData>(defaultRateForm);
  const [editingRow, setEditingRow] = useState<RateRow | null>(null);
  const [editForm, setEditForm] = useState<RateFormData>(defaultRateForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.getRates();
      setRates(Array.isArray(rows) ? (rows as RateRow[]) : []);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Add / Update ────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!form.to_code || !form.market_rate || !form.delta) {
      return alert("Please fill in all fields.");
    }
    const market = parseFloat(form.market_rate);
    const delta = parseFloat(form.delta);
    if (isNaN(market) || market <= 0) return alert("Invalid market rate.");
    if (isNaN(delta) || delta < 0)
      return alert("Invalid delta (must be >= 0).");

    const res = await api.setRate({
      to_code: form.to_code.toUpperCase(),
      market_rate: market,
      delta,
      is_stronger: form.is_stronger,
    });
    if (!res?.success) return alert(res?.error ?? "Failed to save rate.");
    setForm(defaultRateForm);
    load();
  };

  // ── Edit ────────────────────────────────────────────────────────────────
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

  // ── Delete ──────────────────────────────────────────────────────────────
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

  const lbpSpread = calculateProfitSpread(rates as any, "LBP");
  const eurSpread = calculateProfitSpread(rates as any, "EUR");

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
        Exchange Rates
      </h3>

      {/* ── Info Banner ── */}
      <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-blue-300">
        <Info size={16} className="mt-0.5 shrink-0 text-blue-400" />
        <div>
          Enter the <strong>market (mid) rate</strong> and{" "}
          <strong>delta</strong> (half-spread). The formula{" "}
          <code className="bg-slate-800 px-1 rounded text-xs">
            rate = market +/- delta
          </code>{" "}
          derives buy/sell rates automatically. Use <strong>stronger</strong>{" "}
          for currencies worth more than 1 USD (EUR, GBP), and{" "}
          <strong>weaker</strong> for currencies worth less (LBP, TRY).
        </div>
      </div>

      {/* ── Spread Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {lbpSpread !== null && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <div>
                <h4 className="text-xs font-semibold text-emerald-400">
                  USD/LBP Profit Spread
                </h4>
                <p className="text-lg font-bold text-white mt-0.5">
                  {lbpSpread.toLocaleString()} LBP
                </p>
                <p className="text-xs text-emerald-300/70">
                  Per 1 USD exchanged (2 x delta)
                </p>
              </div>
            </div>
          </div>
        )}
        {eurSpread !== null && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <div>
                <h4 className="text-xs font-semibold text-emerald-400">
                  USD/EUR Profit Spread
                </h4>
                <p className="text-lg font-bold text-white mt-0.5">
                  ${eurSpread.toFixed(2)} USD
                </p>
                <p className="text-xs text-emerald-300/70">
                  Per 1 EUR exchanged (2 x delta)
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Add / Update Rate Form ── */}
      <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
        <h4 className="text-sm font-semibold text-white mb-3">
          Add / Update Currency Rate
        </h4>
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
          data={rates}
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
                    const buy = Math.min(m + d, m - d);
                    const sell = Math.max(m + d, m - d);
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

// ─── Drawer–Currency configuration section ─────────────────────────────────
function DrawerCurrencySection() {
  const api = useApi();
  const [drawerConfig, setDrawerConfig] = useState<Record<string, string[]>>(
    {},
  );
  const [activeCurrencies, setActiveCurrencies] = useState<string[]>([]);
  const [pending, setPending] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const DRAWER_LABELS: Record<string, string> = {
    General: "General",
    OMT_System: "OMT System",
    OMT_App: "OMT App",
    Whish_App: "Whish App",
    Binance: "Binance",
    MTC: "MTC",
    Alfa: "Alfa",
    iPick: "iPick",
    Katsh: "Katsh",
    Whish_System: "Whish System",
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [config, currencies] = await Promise.all([
        api.getAllDrawerCurrencies(),
        api.getCurrencies(),
      ]);
      setDrawerConfig(config ?? {});
      setActiveCurrencies(
        (currencies as Array<{ code: string; is_active: number }>)
          .filter((c) => c.is_active)
          .map((c) => c.code),
      );
      setPending({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const drawerNames =
    Object.keys(drawerConfig).length > 0
      ? Object.keys(drawerConfig)
      : Object.keys(DRAWER_LABELS);

  const getEffective = (drawer: string): string[] =>
    pending[drawer] ?? drawerConfig[drawer] ?? [];

  const toggleCurrency = (drawer: string, code: string) => {
    const current = getEffective(drawer);
    const next = current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code];

    const original = drawerConfig[drawer] ?? [];
    const same =
      original.length === next.length &&
      original.every((c) => next.includes(c));

    setPending((prev) => {
      if (same) {
        const copy = { ...prev };
        delete copy[drawer];
        return copy;
      }
      return { ...prev, [drawer]: next };
    });
  };

  const hasPending = Object.keys(pending).length > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        Object.entries(pending).map(([drawer, currencies]) =>
          api.setDrawerCurrencies(drawer, currencies),
        ),
      );
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Drawer Currencies
        </h3>
        <p className="text-slate-500 text-sm py-2">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
        Drawer Currencies
      </h3>
      <p className="text-xs text-slate-500 mb-2">
        Configure which currencies are shown for each drawer on the Dashboard
        and in Closing/Opening.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {drawerNames.map((drawer) => {
          const effective = getEffective(drawer);
          const isPending = drawer in pending;
          return (
            <div
              key={drawer}
              className={`rounded-lg border p-3 transition-colors ${
                isPending
                  ? "border-amber-600/50 bg-amber-900/10"
                  : "border-slate-700 bg-slate-800/30"
              }`}
            >
              <h4 className="text-sm font-medium text-white mb-2">
                {DRAWER_LABELS[drawer] ?? drawer}
              </h4>
              <div className="flex flex-wrap gap-2">
                {activeCurrencies.map((code) => {
                  const checked = effective.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleCurrency(drawer, code)}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                        checked
                          ? "border-emerald-600/50 bg-emerald-900/20 text-emerald-300"
                          : "border-slate-600 bg-slate-800/50 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                          checked
                            ? "border-emerald-500 bg-emerald-600 text-white"
                            : "border-slate-500 bg-slate-700"
                        }`}
                      >
                        {checked && <Check size={9} strokeWidth={3} />}
                      </span>
                      {code}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {hasPending && (
        <div className="flex items-center justify-between rounded-lg border border-amber-600/40 bg-amber-950/80 backdrop-blur-sm px-4 py-3">
          <span className="text-sm text-amber-300">
            Unsaved drawer changes for{" "}
            <strong>{Object.keys(pending).join(", ")}</strong>
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPending({})}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 transition-colors"
            >
              <Save size={14} />
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Currency Manager ──────────────────────────────────────────────────────
export default function CurrencyManager() {
  const api = useApi();
  const [list, setList] = useState<CurrencyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  // Add form
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [decimalPlaces, setDecimalPlaces] = useState("2");

  // All available modules for the multi-select
  const [allModules, setAllModules] = useState<
    Array<{ key: string; label: string }>
  >([]);

  // Track pending module changes per currency: { [code]: string[] }
  const [pendingModules, setPendingModules] = useState<
    Record<string, string[]>
  >({});

  const hasPendingChanges = Object.keys(pendingModules).length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await api.getCurrencies()) as CurrencyRow[];
      const withModules = await Promise.all(
        rows.map(async (c) => ({
          ...c,
          enabledModules: (await api
            .getModulesForCurrency(c.code)
            .catch(() => [])) as string[],
        })),
      );
      setList(withModules);
      setPendingModules({});

      const mods = await api.getToggleableModules();
      setAllModules(
        (mods as Array<{ key: string; label: string }>).map((m) => ({
          key: m.key,
          label: m.label,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!code || !name) return;
    const res = await api.createCurrency(
      code,
      name,
      symbol || undefined,
      decimalPlaces ? Number(decimalPlaces) : undefined,
    );
    if (res.success) {
      setCode("");
      setName("");
      setSymbol("");
      setDecimalPlaces("2");
      setShowAdd(false);
      load();
    } else {
      alert(res.error);
    }
  };

  const handleToggle = async (id: number, active: number) => {
    await api.updateCurrency(id, { is_active: active ? 0 : 1 });
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this currency? This cannot be undone.")) return;
    const res = await api.deleteCurrency(id);
    if (!res.success) alert(res.error);
    load();
  };

  /** Stage a module change locally — nothing saved yet */
  const handleModuleChange = (currencyCode: string, next: string[]) => {
    const original = list.find((c) => c.code === currencyCode)?.enabledModules;
    const same =
      original &&
      original.length === next.length &&
      original.every((m) => next.includes(m));
    setPendingModules((prev) => {
      if (same) {
        const copy = { ...prev };
        delete copy[currencyCode];
        return copy;
      }
      return { ...prev, [currencyCode]: next };
    });
  };

  /** Persist all pending module changes */
  const handleSaveModules = async () => {
    setSaving(true);
    try {
      const results = await Promise.all(
        Object.entries(pendingModules).map(async ([currencyCode, modules]) => {
          const res = await api.setModulesForCurrency(currencyCode, modules);
          return { currencyCode, res };
        }),
      );
      const failed = results.filter(
        (r) =>
          r.res &&
          typeof r.res === "object" &&
          "success" in r.res &&
          !r.res.success,
      );
      if (failed.length > 0) {
        const msgs = failed
          .map(
            (f) =>
              `${f.currencyCode}: ${(f.res as any)?.error ?? "Unknown error"}`,
          )
          .join("\n");
        alert(`Failed to save modules:\n${msgs}`);
      }
      await load();
      window.dispatchEvent(new Event("currencies-changed"));
    } finally {
      setSaving(false);
    }
  };

  const getEffectiveModules = (c: CurrencyRow): string[] =>
    pendingModules[c.code] ?? c.enabledModules ?? [];

  return (
    <div className="space-y-6">
      {/* ── Exchange Rates ──────────────────────────────────────────── */}
      <ExchangeRatesSection />

      <hr className="border-slate-700" />

      {/* ── Drawer Currencies ──────────────────────────────────────── */}
      <DrawerCurrencySection />

      <hr className="border-slate-700" />

      {/* ── Currencies Header ───────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Currencies
        </h3>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          {showAdd ? <X size={14} /> : <Plus size={14} />}
          {showAdd ? "Cancel" : "Add Currency"}
        </button>
      </div>

      {/* ── Add Currency Form ───────────────────────────────────────── */}
      {showAdd && (
        <div className="rounded-lg border border-slate-600 bg-slate-800/40 p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label
                htmlFor="currency-code"
                className="block text-xs text-slate-400 mb-1"
              >
                Code
              </label>
              <input
                id="currency-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="USD"
                className="w-full bg-slate-800/50 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="currency-name"
                className="block text-xs text-slate-400 mb-1"
              >
                Name
              </label>
              <input
                id="currency-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="US Dollar"
                className="w-full bg-slate-800/50 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="currency-symbol"
                className="block text-xs text-slate-400 mb-1"
              >
                Symbol
              </label>
              <input
                id="currency-symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="$"
                className="w-full bg-slate-800/50 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="currency-decimals"
                className="block text-xs text-slate-400 mb-1"
              >
                Decimals
              </label>
              <input
                id="currency-decimals"
                value={decimalPlaces}
                onChange={(e) => setDecimalPlaces(e.target.value)}
                type="number"
                min="0"
                max="8"
                className="w-full bg-slate-800/50 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleAdd}
              disabled={!code || !name}
              className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm transition-colors"
            >
              <Plus size={14} />
              Add Currency
            </button>
          </div>
        </div>
      )}

      {/* ── Currency Cards ──────────────────────────────────────────── */}
      {loading ? (
        <p className="text-slate-500 text-sm py-4">Loading currencies...</p>
      ) : list.length === 0 ? (
        <p className="text-slate-500 text-sm py-4">
          No currencies configured. Click &quot;Add Currency&quot; to create
          one.
        </p>
      ) : (
        <div className="space-y-3">
          {list.map((c) => {
            const isPending = c.code in pendingModules;
            return (
              <div
                key={c.id}
                className={`rounded-lg border bg-slate-800/30 p-4 transition-colors ${
                  isPending
                    ? "border-amber-600/50 bg-amber-900/10"
                    : "border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: currency info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-700/50 text-lg font-bold text-white">
                      {c.symbol || c.code.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">
                          {c.code}
                        </span>
                        <span className="text-slate-400 text-sm truncate">
                          {c.name}
                        </span>
                        <span
                          className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                            c.is_active
                              ? "bg-emerald-600/20 text-emerald-400"
                              : "bg-red-600/20 text-red-400"
                          }`}
                        >
                          {c.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {c.decimal_places} decimal place
                        {c.decimal_places !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleToggle(c.id, c.is_active)}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                        c.is_active
                          ? "border-slate-600 text-slate-300 hover:bg-slate-700"
                          : "border-emerald-600/40 text-emerald-400 hover:bg-emerald-900/20"
                      }`}
                    >
                      {c.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="text-xs p-1.5 rounded-lg border border-red-600/30 text-red-400 hover:bg-red-900/20 transition-colors"
                      title="Delete currency"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Enabled modules */}
                <div className="mt-3 pt-3 border-t border-slate-700/50">
                  <span className="block text-[11px] text-slate-500 uppercase tracking-wider mb-1.5 font-medium">
                    Enabled Modules
                  </span>
                  <ModuleMultiSelect
                    allModules={allModules}
                    selected={getEffectiveModules(c)}
                    onChange={(next) => handleModuleChange(c.code, next)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Save Changes Bar ────────────────────────────────────────── */}
      {hasPendingChanges && (
        <div className="sticky bottom-0 flex items-center justify-between rounded-lg border border-amber-600/40 bg-amber-950/80 backdrop-blur-sm px-4 py-3">
          <span className="text-sm text-amber-300">
            Unsaved module changes for{" "}
            <strong>{Object.keys(pendingModules).join(", ")}</strong>
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPendingModules({})}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
            >
              Discard
            </button>
            <button
              onClick={handleSaveModules}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 transition-colors"
            >
              <Save size={14} />
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
