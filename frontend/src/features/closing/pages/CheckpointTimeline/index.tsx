import { useState, useEffect, useMemo } from "react";
import { DateRangeFilter } from "@/shared/components/DateRangeFilter";
import { PageHeader, Select, useApi } from "@liratek/ui";
import { Clock, Eye, X, Check, AlertTriangle } from "lucide-react";
import { DataTable, appEvents } from "@liratek/ui";
import { DRAWER_CONFIGS, DRAWER_ORDER } from "../../config/drawers";
import {
  formatCurrencyAmount,
  formatDayVariance,
  getDateVarianceStatus,
  getVarianceStatus,
} from "../../utils/variance";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { localDay } from "@/shared/utils/localDay";
import type { DrawerType } from "../../types";

interface CheckpointCurrency {
  currency_code: string;
  opening_amount: number;
  physical_amount?: number;
  variance?: number;
  drawer_name?: string;
}

/** A shop SIM line counted during the checkpoint (MTC/Alfa, plan Phase 3). */
interface CheckpointCarrierLine {
  carrier_line_id: number;
  carrier: string;
  phone_number: string;
  label: string | null;
  expected_credits: number;
  counted_credits: number;
  expected_expires_at: string | null;
  /** Null when validity was not counted for this line. */
  counted_expires_at: string | null;
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
  /** Absent on rows written before v148 and on every non-carrier drawer. */
  carrier_lines?: CheckpointCarrierLine[];
}

interface CheckpointFilters {
  date_from: string;
  date_to: string;
  type: "OPENING" | "CLOSING" | "CHECKPOINT" | "ALL";
  drawer_name: string;
  user_id?: number;
}

function todayISO(): string {
  return localDay();
}

export default function CheckpointTimeline() {
  const api = useApi();
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(100);
  const [filters, setFilters] = useState<CheckpointFilters>({
    date_from: todayISO(),
    date_to: todayISO(),
    type: "ALL",
    drawer_name: "",
  });
  const [viewCheckpoint, setViewCheckpoint] = useState<CheckpointRecord | null>(
    null,
  );
  // closing_date of the initial (setup) checkpoint, for the "jump to setup" hint.
  const [initialCheckpointDate, setInitialCheckpointDate] = useState<
    string | null
  >(null);

  // Fetch the setup checkpoint date once so we can surface it when it falls
  // outside the current filter window.
  useEffect(() => {
    api
      .getInitialCheckpointDate()
      .then(setInitialCheckpointDate)
      .catch(() => setInitialCheckpointDate(null));
  }, [api]);

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
      const result = await api.getCheckpointTimeline(filters);
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
    const date = parseDbDate(iso);
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

  const CURRENCY_ORDER = ["USD", "USDT", "LBP"];

  const getAmountDisplay = (checkpoint: CheckpointRecord): string => {
    const totals = getAggregatedTotals(checkpoint);
    const parts: string[] = [];
    CURRENCY_ORDER.forEach((code) => {
      const amount = totals[code];
      if (!amount) return;
      if (code === "USD") parts.push(`$${formatCurrency(amount, code)}`);
      else if (code === "LBP")
        parts.push(`${formatCurrency(amount, code)} LBP`);
      else parts.push(`${formatCurrency(amount, code)} ${code}`);
    });
    Object.entries(totals).forEach(([code, amount]) => {
      if (!CURRENCY_ORDER.includes(code) && amount) {
        parts.push(`${formatCurrency(amount, code)} ${code}`);
      }
    });
    return parts.join(" + ") || "—";
  };

  // Currencies whose counted amount differs from expected (opening). No
  // tolerance — any difference beyond a rounding epsilon is a variance.
  const getCheckpointDiffs = (checkpoint: CheckpointRecord) =>
    checkpoint.currencies
      .map((c) => {
        const expected = c.opening_amount ?? 0;
        const counted = c.physical_amount ?? c.opening_amount ?? 0;
        const { status, variance } = getVarianceStatus(counted, expected);
        return { code: c.currency_code, status, variance };
      })
      .filter((d) => d.status === "diff");

  // SIM lines whose counted expiry differed from the stored one. Credits
  // variance already shows up through the provider drawer's USD row above —
  // the checkpoint writes the same counted figure to both — so only validity
  // needs its own line here, and only when it was actually counted.
  const getValidityDiffs = (checkpoint: CheckpointRecord) =>
    (checkpoint.carrier_lines ?? [])
      .map((l) => ({
        phone: l.phone_number,
        ...getDateVarianceStatus(l.counted_expires_at, l.expected_expires_at),
      }))
      .filter((d) => d.status === "diff");

  // Compact one-line variance summary for the timeline row.
  const getVarianceSummary = (
    diffs: ReturnType<typeof getCheckpointDiffs>,
    validityDiffs: ReturnType<typeof getValidityDiffs> = [],
  ): string => {
    const parts: string[] =
      diffs.length > 2
        ? [`Variance in ${diffs.length} currencies`]
        : diffs.map(
            (d) =>
              `${d.code} ${d.variance > 0 ? "+" : ""}${formatCurrencyAmount(d.variance, d.code)}`,
          );
    if (validityDiffs.length === 1) {
      parts.push(`Validity ${formatDayVariance(validityDiffs[0].days)}`);
    } else if (validityDiffs.length > 1) {
      parts.push(`Validity variance on ${validityDiffs.length} lines`);
    }
    return parts.join(", ");
  };

  const filteredCheckpoints = useMemo(() => {
    if (!search.trim()) return checkpoints;
    const q = search.toLowerCase();
    return checkpoints.filter(
      (cp) =>
        cp.drawer_name.toLowerCase().includes(q) ||
        cp.user_name.toLowerCase().includes(q) ||
        (cp.notes ?? "").toLowerCase().includes(q),
    );
  }, [checkpoints, search]);

  const displayedCheckpoints = useMemo(
    () => filteredCheckpoints.slice(0, limit),
    [filteredCheckpoints, limit],
  );

  // The setup checkpoint exists but sits before the current from-date, so it is
  // not in the table. Offer to move the from-date back to it (to-date untouched).
  const showInitialSetupHint =
    !!initialCheckpointDate && initialCheckpointDate < filters.date_from;

  const jumpToInitialSetup = () => {
    if (initialCheckpointDate) {
      setFilters((f) => ({ ...f, date_from: initialCheckpointDate }));
    }
  };

  const formatDateLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-auto animate-in fade-in duration-500">
      <PageHeader title="Checkpoints" />

      {/* Timeline Filters */}
      <div>
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex gap-4 flex-wrap items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search drawer, user, notes…"
            className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-violet-600 w-56"
          />

          <Select
            value={filters.drawer_name}
            onChange={(v) => setFilters({ ...filters, drawer_name: v })}
            options={[
              { value: "", label: "All Drawers" },
              ...DRAWER_ORDER.map((d) => ({
                value: d,
                label: DRAWER_CONFIGS[d]?.label ?? d,
              })),
            ]}
          />

          <DateRangeFilter
            from={filters.date_from}
            to={filters.date_to}
            onFromChange={(v) => setFilters({ ...filters, date_from: v })}
            onToChange={(v) => setFilters({ ...filters, date_to: v })}
          />

          <div className="flex items-center gap-2 ml-auto">
            <label className="text-sm text-slate-400">Rows:</label>
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 100)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-violet-600 w-20"
            />
          </div>
        </div>
      </div>

      {/* Initial-setup hint — the setup checkpoint is older than the from-date */}
      {showInitialSetupHint && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-violet-500/10 border border-violet-500/30 rounded-xl">
          <Clock className="w-4 h-4 text-violet-300 shrink-0" />
          <p className="text-xs text-violet-200 flex-1 min-w-0">
            Initial drawer setup was recorded on{" "}
            <span className="font-semibold">
              {formatDateLabel(initialCheckpointDate!)}
            </span>{" "}
            — before the selected date range, so it isn&apos;t shown below.
          </p>
          <button
            onClick={jumpToInitialSetup}
            className="text-xs font-medium text-violet-100 bg-violet-600/40 hover:bg-violet-600/60 px-3 py-1.5 rounded-lg transition-colors shrink-0"
          >
            Show from setup →
          </button>
        </div>
      )}

      {/* Timeline Table */}
      <div className="min-h-0 bg-slate-800 rounded-xl border border-slate-700 overflow-auto">
        {loading ? (
          <div className="p-8 text-center text-slate-400 animate-pulse">
            Loading checkpoints...
          </div>
        ) : checkpoints.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <Clock size={48} className="mx-auto mb-4 opacity-50" />
            <p>
              No checkpoints found for{" "}
              {filters.date_from === filters.date_to
                ? filters.date_from
                : `${filters.date_from} – ${filters.date_to}`}
            </p>
          </div>
        ) : (
          <DataTable
            columns={[
              {
                header: "Time",
                sortKey: "created_at",
                width: "100px",
                className: "p-2 text-xs font-semibold uppercase text-slate-400",
              },
              {
                header: "Drawer",
                sortKey: "drawer_name",
                width: "140px",
                className: "p-2 text-xs font-semibold uppercase text-slate-400",
              },
              {
                header: "Amount",
                sortKey: "amount",
                className: "p-2 text-xs font-semibold uppercase text-slate-400",
              },
              {
                header: "User",
                sortKey: "user_name",
                width: "120px",
                className: "p-2 text-xs font-semibold uppercase text-slate-400",
              },
              {
                header: "Notes",
                sortKey: "notes",
                className: "p-2 text-xs font-semibold uppercase text-slate-400",
              },
              {
                header: "",
                width: "80px",
                className: "p-2 text-xs font-semibold uppercase text-slate-400",
              },
            ]}
            data={displayedCheckpoints}
            loading={loading}
            emptyMessage="No checkpoints found"
            exportExcel
            exportPdf
            exportFilename="checkpoints"
            exportDefaultColumns={["Time", "Drawer", "Amount", "User", "Notes"]}
            showRowCount
            totalRowCount={filteredCheckpoints.length}
            defaultSortKey="created_at"
            defaultSortDirection="desc"
            className="w-full text-left"
            theadClassName="bg-slate-900 text-slate-400 text-xs uppercase"
            getSortValue={(row, key) => {
              if (key === "created_at")
                return parseDbDate(row.created_at).getTime();
              if (key === "drawer_name") return row.drawer_name;
              if (key === "user_name") return row.user_name;
              if (key === "notes") return row.notes ?? "";
              if (key === "amount") {
                const totals = getAggregatedTotals(row);
                return totals["USD"] ?? totals["USDT"] ?? 0;
              }
              return "";
            }}
            renderRow={(checkpoint) => {
              const drawerLabel =
                DRAWER_CONFIGS[checkpoint.drawer_name as DrawerType]?.label ??
                checkpoint.drawer_name;
              const diffs = getCheckpointDiffs(checkpoint);
              const validityDiffs = getValidityDiffs(checkpoint);
              return (
                <tr
                  key={checkpoint.id}
                  className="border-t border-slate-800 text-xs hover:bg-slate-700/50 transition-colors"
                >
                  <td className="p-2 text-slate-300 font-mono">
                    {formatTime(checkpoint.created_at)}
                  </td>
                  <td className="p-2 text-slate-300">{drawerLabel}</td>
                  <td className="p-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-emerald-400 font-mono font-medium">
                        {getAmountDisplay(checkpoint)}
                      </span>
                      {(diffs.length > 0 || validityDiffs.length > 0) && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 font-mono">
                          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                          {getVarianceSummary(diffs, validityDiffs)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-2 text-slate-300">{checkpoint.user_name}</td>
                  <td className="p-2 text-slate-400 italic max-w-xs truncate">
                    {checkpoint.notes || "—"}
                  </td>
                  <td className="p-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setViewCheckpoint(checkpoint)}
                        className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
                        title="View details"
                      >
                        <Eye size={14} />
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
          <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
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
                      const { status, variance } = getVarianceStatus(
                        amount,
                        expected,
                      );
                      const matched = status === "match";
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
                            <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold font-mono text-amber-400">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              {variance > 0 ? "+" : ""}
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

            {/* Counted SIM lines — credits + validity expiry (plan Phase 3) */}
            {(viewCheckpoint.carrier_lines?.length ?? 0) > 0 && (
              <div className="border-t border-slate-700 pt-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-slate-400 uppercase tracking-wide">
                    Carrier Lines
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Expected → Counted
                  </p>
                </div>
                <div className="space-y-2">
                  {viewCheckpoint.carrier_lines!.map((line) => {
                    const credits = getVarianceStatus(
                      line.counted_credits,
                      line.expected_credits,
                    );
                    const validity = getDateVarianceStatus(
                      line.counted_expires_at,
                      line.expected_expires_at,
                    );
                    return (
                      <div
                        key={line.carrier_line_id}
                        className="rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2.5 space-y-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-300 uppercase">
                            {line.carrier}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">
                            {line.phone_number}
                          </span>
                          {line.label && (
                            <span className="text-[11px] text-slate-500 truncate">
                              {line.label}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="flex-shrink-0 w-16 text-[11px] text-slate-500">
                            Credits
                          </span>
                          <div className="flex-1 min-w-0 flex items-baseline gap-2 font-mono">
                            <span className="text-sm text-slate-500 truncate">
                              {formatCurrencyAmount(
                                line.expected_credits,
                                "USD",
                              )}
                            </span>
                            <span className="text-slate-600">→</span>
                            <span className="text-sm text-white font-semibold truncate">
                              {formatCurrencyAmount(
                                line.counted_credits,
                                "USD",
                              )}
                            </span>
                          </div>
                          {credits.status === "match" ? (
                            <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                              <Check className="w-3.5 h-3.5" /> Matched
                            </span>
                          ) : (
                            <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold font-mono text-amber-400">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              {credits.variance > 0 ? "+" : ""}
                              {formatCurrencyAmount(credits.variance, "USD")}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="flex-shrink-0 w-16 text-[11px] text-slate-500">
                            Validity
                          </span>
                          <div className="flex-1 min-w-0 flex items-baseline gap-2 font-mono">
                            <span className="text-sm text-slate-500 truncate">
                              {line.expected_expires_at ?? "not set"}
                            </span>
                            <span className="text-slate-600">→</span>
                            <span className="text-sm text-white font-semibold truncate">
                              {line.counted_expires_at ?? "not counted"}
                            </span>
                          </div>
                          {validity.status === "match" ? (
                            <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                              <Check className="w-3.5 h-3.5" /> Matched
                            </span>
                          ) : (
                            <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold font-mono text-amber-400">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              {formatDayVariance(validity.days)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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
