import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@liratek/ui";
import {
  Clock,
  Eye,
  X,
  AlertTriangle,
  CheckCircle,
  ClipboardCheck,
} from "lucide-react";
import { DataTable, appEvents } from "@liratek/ui";
import { DrawerVarianceBreakdown } from "../../components/VarianceCard";
import type { DrawerVariance } from "../../types";
import { DRAWER_CONFIGS, DRAWER_ORDER } from "../../config/drawers";
import type { DrawerType } from "../../types";
import { useModules } from "@/contexts/ModuleContext";

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

interface DrawerStatus {
  drawer_name: string;
  checked_at: string;
  amounts: Record<string, { physical: number; expected: number }>;
}

const DRAWER_MODULE_MAP: Partial<Record<string, string>> = {
  OMT_App: "ipec_katch",
  OMT_System: "ipec_katch",
  Whish_App: "ipec_katch",
  Whish_System: "ipec_katch",
  Binance: "binance",
  MTC: "recharge",
  Alfa: "recharge",
  iPick: "ipec_katch",
  Katsh: "ipec_katch",
};

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffH = diffMs / (1000 * 60 * 60);
  const diffM = diffMs / (1000 * 60);

  if (diffM < 1) return "Just now";
  if (diffM < 60) return `${Math.floor(diffM)}m ago`;
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  const days = Math.floor(diffH / 24);
  return `${days}d ago`;
}

function stalenessColor(iso: string | null): string {
  if (!iso) return "border-red-500/40 bg-red-500/5";
  const diffH = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
  if (diffH < 8) return "border-green-500/40 bg-green-500/5";
  if (diffH < 24) return "border-yellow-500/40 bg-yellow-500/5";
  return "border-red-500/40 bg-red-500/5";
}

function stalenessTextColor(iso: string | null): string {
  if (!iso) return "text-red-400";
  const diffH = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
  if (diffH < 8) return "text-green-400";
  if (diffH < 24) return "text-yellow-400";
  return "text-red-400";
}

function formatAmount(amount: number, code: string): string {
  if (code === "LBP") return amount.toLocaleString();
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function DrawerStatusCard({
  drawerName,
  status,
}: {
  drawerName: DrawerType;
  status: DrawerStatus | null;
}) {
  const config = DRAWER_CONFIGS[drawerName];
  const checkedAt = status?.checked_at ?? null;
  const colorClass = stalenessColor(checkedAt);
  const textColorClass = stalenessTextColor(checkedAt);

  const handleCheckpoint = () => {
    appEvents.emit("checkpoint:open", { drawerName });
  };

  const nonZeroAmounts = status
    ? Object.entries(status.amounts).filter(([, v]) => v.physical !== 0)
    : [];

  return (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-3 ${colorClass}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">
            {config?.label ?? drawerName}
          </p>
          <p className="text-xs text-slate-500">{config?.description}</p>
        </div>
        <button
          onClick={handleCheckpoint}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <ClipboardCheck size={13} />
          Checkpoint
        </button>
      </div>

      {/* Last checkpoint info */}
      <div className="flex items-center gap-1.5">
        {checkedAt ? (
          <CheckCircle size={13} className={textColorClass} />
        ) : (
          <AlertTriangle size={13} className="text-red-400" />
        )}
        <span className={`text-xs font-medium ${textColorClass}`}>
          {checkedAt
            ? formatRelativeTime(checkedAt)
            : "Never checkpointed"}
        </span>
        {checkedAt && (
          <span className="text-xs text-slate-600">
            —{" "}
            {new Date(checkedAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      {/* Last physical amounts */}
      {nonZeroAmounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {nonZeroAmounts.map(([code, { physical }]) => (
            <div
              key={code}
              className="bg-slate-900/60 rounded px-2 py-1 flex items-center gap-1"
            >
              <span className="text-xs text-slate-400">{code}</span>
              <span className="text-xs font-mono text-slate-200">
                {formatAmount(physical, code)}
              </span>
            </div>
          ))}
        </div>
      )}

      {!status && (
        <p className="text-xs text-slate-600 italic">No checkpoint on record</p>
      )}
    </div>
  );
}

export default function CheckpointTimeline() {
  const { isModuleEnabled } = useModules();

  const activeDrawerOrder = DRAWER_ORDER.filter((drawer) => {
    const requiredModule = DRAWER_MODULE_MAP[drawer];
    return !requiredModule || isModuleEnabled(requiredModule);
  });

  const [drawerStatuses, setDrawerStatuses] = useState<
    Record<string, DrawerStatus>
  >({});
  const [statusLoading, setStatusLoading] = useState(true);

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
  const [expandedVarianceId, setExpandedVarianceId] = useState<number | null>(
    null,
  );

  const loadDrawerStatuses = async () => {
    setStatusLoading(true);
    try {
      const result = await window.api.closing.getLastCheckpointPerDrawer();
      if (result.success && result.data) {
        setDrawerStatuses(result.data);
      }
    } catch {
      // non-fatal
    } finally {
      setStatusLoading(false);
    }
  };

  // Refresh drawer statuses after a checkpoint completes
  useEffect(() => {
    loadDrawerStatuses();
    const off = appEvents.on("closing:completed", () => {
      loadDrawerStatuses();
      loadCheckpoints();
    });
    return () => off();
  }, []);

  const getCheckpointVariances = (
    checkpoint: CheckpointRecord,
  ): DrawerVariance[] => {
    return checkpoint.currencies
      .filter(
        (c) => c.physical_amount !== undefined && c.physical_amount !== null,
      )
      .map((c) => ({
        drawerName: c.drawer_name || "Unknown",
        currency: c.currency_code,
        expected: c.opening_amount || 0,
        actual: c.physical_amount ?? 0,
        variance: (c.physical_amount ?? 0) - (c.opening_amount || 0),
      }))
      .filter((d) => Math.abs(d.variance) > 0.01);
  };

  const checkpointHasVariance = (checkpoint: CheckpointRecord): boolean => {
    return getCheckpointVariances(checkpoint).length > 0;
  };

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

      {/* Drawer Status Board */}
      <div>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
          Drawer Status
        </h2>
        {statusLoading ? (
          <div className="text-slate-500 text-sm animate-pulse">
            Loading drawer statuses...
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {activeDrawerOrder.map((drawer) => (
              <DrawerStatusCard
                key={drawer}
                drawerName={drawer}
                status={drawerStatuses[drawer] ?? null}
              />
            ))}
          </div>
        )}
      </div>

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
              const hasVariance = checkpointHasVariance(checkpoint);
              const isExpanded = expandedVarianceId === checkpoint.id;
              const drawerLabel =
                DRAWER_CONFIGS[checkpoint.drawer_name as DrawerType]?.label ??
                checkpoint.drawer_name;
              return (
                <>
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
                        {hasVariance && (
                          <button
                            onClick={() =>
                              setExpandedVarianceId(
                                isExpanded ? null : checkpoint.id,
                              )
                            }
                            className="p-2 hover:bg-amber-900/30 rounded-lg transition-colors text-amber-400 hover:text-amber-300"
                            title="Variance detected — click to see breakdown"
                          >
                            <AlertTriangle size={16} />
                          </button>
                        )}
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
                  {hasVariance && isExpanded && (
                    <tr key={`${checkpoint.id}-variance`}>
                      <td
                        colSpan={allCurrencies.length + 5}
                        className="px-4 pb-4 pt-0"
                      >
                        <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-4 mt-1">
                          <p className="text-xs text-amber-400 font-semibold uppercase tracking-wide mb-3">
                            Variance Breakdown
                          </p>
                          <DrawerVarianceBreakdown
                            drawers={getCheckpointVariances(checkpoint)}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </>
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
              <p className="text-xs text-slate-400 mb-3 uppercase tracking-wide">
                Amounts
              </p>
              {(() => {
                const entries = viewCheckpoint.currencies
                  .filter(
                    (c) =>
                      (c.physical_amount ?? c.opening_amount ?? 0) !== 0,
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
                  <div className="grid grid-cols-2 gap-2">
                    {entries.map(({ code, amount, expected }) => {
                      const variance = amount - expected;
                      return (
                        <div
                          key={code}
                          className="bg-slate-900/60 rounded-lg px-3 py-2 border border-slate-700/50"
                        >
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-white">
                              {code}
                            </span>
                            <span className="text-emerald-400 font-mono font-semibold text-sm">
                              {code === "LBP"
                                ? Number(amount).toLocaleString()
                                : Number(amount).toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                            </span>
                          </div>
                          {Math.abs(variance) > 0.01 && (
                            <div className="text-xs mt-0.5 text-right">
                              <span
                                className={
                                  variance >= 0
                                    ? "text-green-400"
                                    : "text-red-400"
                                }
                              >
                                {variance > 0 ? "+" : ""}
                                {code === "LBP"
                                  ? variance.toLocaleString()
                                  : variance.toLocaleString(undefined, {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                              </span>
                            </div>
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
