import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@liratek/ui";
import { Clock, Eye, X, Check, TrendingUp, TrendingDown } from "lucide-react";
import { DataTable, appEvents } from "@liratek/ui";
import { DRAWER_CONFIGS, DRAWER_ORDER } from "../../config/drawers";
import { formatCurrencyAmount } from "../../utils/variance";
import type { DrawerType } from "../../types";

interface CheckpointCurrency {
  currency_code: string;
  opening_amount: number;
  physical_amount?: number;
  variance?: number;
  drawer_name?: string;
}

interface CheckpointRecord {
  id: number;
  closing_date: string;
  drawer_name: string;
  checkpoint_type: "OPENING" | "CLOSING" | "CHECKPOINT";
  created_at: string;
  created_by: number;
  user_name: string;
  notes?: string;
  currencies: CheckpointCurrency[];
}

interface CheckpointFilters {
  date: string;
  type: "OPENING" | "CLOSING" | "CHECKPOINT" | "ALL";
  drawer_name: string;
  user_id?: number;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export default function CheckpointTimeline() {
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<CheckpointFilters>({
    date: todayISO(),
    type: "ALL",
    drawer_name: "",
  });
  const [viewCheckpoint, setViewCheckpoint] = useState<CheckpointRecord | null>(
    null,
  );

  // Refresh the timeline after a checkpoint completes
  useEffect(() => {
    const off = appEvents.on("closing:completed", () => {
      loadCheckpoints();
    });
    return () => off();
  }, []);

  useEffect(() => {
    loadCheckpoints();
  }, [filters]);

  const loadCheckpoints = async () => {
    setLoading(true);
    try {
      const result = await window.api.closing.getCheckpointTimeline(filters);
      if (result.success && result.checkpoints) {
        setCheckpoints(result.checkpoints);
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatCurrency = (amount: number, code: string) => {
    if (code === "LBP") return amount.toLocaleString();
    return amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const allCurrencies = useMemo(() => {
    const currencySet = new Set<string>();
    checkpoints.forEach((cp) => {
      cp.currencies.forEach((c) => currencySet.add(c.currency_code));
    });
    return Array.from(currencySet).sort();
  }, [checkpoints]);

  const getAggregatedTotals = (checkpoint: CheckpointRecord) => {
    const totals: Record<string, number> = {};
    checkpoint.currencies.forEach((c) => {
      if (!totals[c.currency_code]) {
        totals[c.currency_code] = 0;
      }
      totals[c.currency_code] += c.physical_amount ?? c.opening_amount ?? 0;
    });
    return totals;
  };

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-auto animate-in fade-in duration-500">
      <PageHeader icon={Clock} title="Checkpoints" />

      {/* Timeline Filters */}
      <div>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
          History
        </h2>
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-400">Date:</label>
            <input
              type="date"
              value={filters.date}
              onChange={(e) => setFilters({ ...filters, date: e.target.value })}
              className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
            />
          </div>

          <select
            value={filters.drawer_name}
            onChange={(e) =>
              setFilters({ ...filters, drawer_name: e.target.value })
            }
            className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
          >
            <option value="">All Drawers</option>
            {DRAWER_ORDER.map((d) => (
              <option key={d} value={d}>
                {DRAWER_CONFIGS[d]?.label ?? d}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Timeline Table */}
      <div className="min-h-0 bg-slate-800 rounded-xl border border-slate-700 overflow-auto">
        {loading ? (
          <div className="p-8 text-center text-slate-400 animate-pulse">
            Loading checkpoints...
          </div>
        ) : checkpoints.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <Clock size={48} className="mx-auto mb-4 opacity-50" />
            <p>No checkpoints found for {filters.date}</p>
          </div>
        ) : (
          <DataTable
            columns={[
              {
                header: "Time",
                className: "p-4 border-b border-slate-700 w-24",
              },
              {
                header: "Drawer",
                className: "p-4 border-b border-slate-700 w-36",
              },
              ...allCurrencies.map((code) => ({
                header: code,
                className: "p-4 border-b border-slate-700 text-right w-40",
              })),
              { header: "User", className: "p-4 border-b border-slate-700" },
              { header: "Notes", className: "p-4 border-b border-slate-700" },
              { header: "", className: "p-4 border-b border-slate-700 w-20" },
            ]}
            data={checkpoints}
            loading={loading}
            emptyMessage="No checkpoints found"
            renderRow={(checkpoint) => {
              const drawerLabel =
                DRAWER_CONFIGS[checkpoint.drawer_name as DrawerType]?.label ??
                checkpoint.drawer_name;
              return (
                <tr
                  key={checkpoint.id}
                  className="hover:bg-slate-700/50 transition-colors"
                >
                    <td className="p-4 text-slate-300 font-mono">
                      {formatTime(checkpoint.created_at)}
                    </td>
                    <td className="p-4 text-slate-300 text-sm">
                      {drawerLabel}
                    </td>
                    {allCurrencies.map((code) => {
                      const totals = getAggregatedTotals(checkpoint);
                      const total = totals[code] || 0;
                      if (total === 0) {
                        return (
                          <td
                            key={code}
                            className="p-4 text-right text-slate-600"
                          >
                            -
                          </td>
                        );
                      }
                      return (
                        <td key={code} className="p-4 text-right">
                          <div className="text-emerald-400 font-mono font-medium">
                            {formatCurrency(total, code)}
                          </div>
                        </td>
                      );
                    })}
                    <td className="p-4 text-slate-300">
                      {checkpoint.user_name}
                    </td>
                    <td className="p-4 text-slate-400 italic max-w-xs truncate">
                      {checkpoint.notes || "-"}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setViewCheckpoint(checkpoint)}
                          className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
                          title="View details"
                        >
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                </tr>
              );
            }}
          />
        )}
      </div>

      {/* View Checkpoint Details Modal */}
      {viewCheckpoint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                Checkpoint Details —{" "}
                {DRAWER_CONFIGS[viewCheckpoint.drawer_name as DrawerType]
                  ?.label ?? viewCheckpoint.drawer_name}
              </h2>
              <button
                onClick={() => setViewCheckpoint(null)}
                className="p-1 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Time</span>
                <span className="text-white">
                  {formatTime(viewCheckpoint.created_at)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">User</span>
                <span className="text-white">{viewCheckpoint.user_name}</span>
              </div>
              {viewCheckpoint.notes && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Notes</span>
                  <span className="text-white italic">
                    {viewCheckpoint.notes}
                  </span>
                </div>
              )}
            </div>
            <div className="border-t border-slate-700 pt-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-slate-400 uppercase tracking-wide">
                  Amounts
                </p>
                <p className="text-[11px] text-slate-500">Expected → Counted</p>
              </div>
              {(() => {
                const entries = viewCheckpoint.currencies
                  .filter(
                    (c) => (c.physical_amount ?? c.opening_amount ?? 0) !== 0,
                  )
                  .map((c) => ({
                    code: c.currency_code,
                    amount: c.physical_amount ?? c.opening_amount ?? 0,
                    expected: c.opening_amount ?? 0,
                  }));

                if (entries.length === 0) {
                  return (
                    <p className="text-sm text-slate-500 italic">
                      No amounts recorded
                    </p>
                  );
                }
                return (
                  <div className="space-y-2">
                    {entries.map(({ code, amount, expected }) => {
                      const variance = amount - expected;
                      const matched = Math.abs(variance) <= 0.01;
                      const positive = variance > 0;
                      return (
                        <div
                          key={code}
                          className="flex items-center gap-3 rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2.5"
                        >
                          {/* Currency pill */}
                          <span className="flex-shrink-0 w-12 text-center text-xs font-bold text-slate-300 bg-slate-800 border border-slate-700 rounded-md py-1">
                            {code}
                          </span>

                          {/* Expected → Counted */}
                          <div className="flex-1 min-w-0 flex items-baseline gap-2 font-mono">
                            <span className="text-sm text-slate-500 truncate">
                              {formatCurrencyAmount(expected, code)}
                            </span>
                            <span className="text-slate-600">→</span>
                            <span className="text-base text-white font-semibold truncate">
                              {formatCurrencyAmount(amount, code)}
                            </span>
                          </div>

                          {/* Variance badge */}
                          {matched ? (
                            <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                              <Check className="w-3.5 h-3.5" /> Matched
                            </span>
                          ) : (
                            <span
                              className={`flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold font-mono ${
                                positive ? "text-green-400" : "text-red-400"
                              }`}
                            >
                              {positive ? (
                                <TrendingUp className="w-3.5 h-3.5" />
                              ) : (
                                <TrendingDown className="w-3.5 h-3.5" />
                              )}
                              {positive ? "+" : ""}
                              {formatCurrencyAmount(variance, code)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setViewCheckpoint(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
