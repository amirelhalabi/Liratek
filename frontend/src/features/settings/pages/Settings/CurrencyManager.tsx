import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Save, Trash2, X } from "lucide-react";
import { useApi } from "@liratek/ui";

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

// ─── Exchange Rates Section ────────────────────────────────────────────────
function ExchangeRatesSection() {
  const api = useApi();
  const [rates, setRates] = useState<
    Array<{
      id: number;
      from_code: string;
      to_code: string;
      rate: number;
      updated_at: string;
    }>
  >([]);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("LBP");
  const [rate, setRate] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, currencyRows] = await Promise.all([
        api.getRates(),
        api.getCurrencies(),
      ]);
      setRates(Array.isArray(rows) ? rows : []);
      setCurrencies(
        (currencyRows as Array<{ code: string; is_active: number }>)
          .filter((c) => c.is_active)
          .map((c) => c.code),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
        Exchange Rates
      </h3>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            if (e.target.value === to) {
              const alt = currencies.find((c) => c !== e.target.value);
              if (alt) setTo(alt);
            }
          }}
          className="bg-slate-800/50 border border-slate-600 rounded-lg px-3 py-2 text-white w-24 text-sm"
        >
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="text-slate-500">→</span>
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="bg-slate-800/50 border border-slate-600 rounded-lg px-3 py-2 text-white w-24 text-sm"
        >
          {currencies
            .filter((c) => c !== from)
            .map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
        </select>
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="Rate"
          type="number"
          className="bg-slate-800/50 border border-slate-600 rounded-lg px-3 py-2 text-white w-32 text-sm"
        />
        <button
          onClick={save}
          className="px-3 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-white text-sm transition-colors"
        >
          Set Rate
        </button>
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">Loading rates...</p>
      ) : rates.length === 0 ? (
        <p className="text-slate-500 text-sm">
          No exchange rates set. Add one above.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {rates.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/30 px-3 py-2"
            >
              <span className="text-sm font-mono text-white">
                {r.from_code} → {r.to_code}
              </span>
              <span className="text-sm font-semibold text-emerald-400 tabular-nums">
                {Number(r.rate).toLocaleString()}
              </span>
            </div>
          ))}
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
    IPEC: "IPEC",
    Katch: "Katch",
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
