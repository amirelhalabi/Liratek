import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@liratek/ui";
import { Clock, TrendingUp, TrendingDown, Eye } from "lucide-react";
import { DataTable } from "@liratek/ui";
import OpeningModal from "../Opening";

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
  checkpoint_type: "OPENING" | "CLOSING";
  created_at: string;
  created_by: number;
  user_name: string;
  notes?: string;
  currencies: CheckpointCurrency[];
}

interface CheckpointFilters {
  date: string;
  type: "OPENING" | "CLOSING" | "ALL";
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
    } catch (error) {
      console.error("Failed to load checkpoints:", error);
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
    if (code === "USD") return `$${amount.toFixed(2)}`;
    if (code === "EUR") return `€${amount.toFixed(2)}`;
    if (code === "LBP") return `${amount.toLocaleString()} LBP`;
    return `${amount.toFixed(2)} ${code}`;
  };

  const getTypeBadgeClass = (type: string) => {
    return type === "OPENING"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
      : "bg-amber-500/10 text-amber-400 border-amber-500/30";
  };

  // Determine which currencies to show based on all checkpoints
  const allCurrencies = useMemo(() => {
    const currencySet = new Set<string>();
    checkpoints.forEach((cp) => {
      cp.currencies.forEach((c) => currencySet.add(c.currency_code));
    });
    return Array.from(currencySet).sort();
  }, [checkpoints]);

  // Get aggregated totals by currency (for timeline display)
  const getAggregatedTotals = (checkpoint: CheckpointRecord) => {
    const totals: Record<string, number> = {};
    checkpoint.currencies.forEach((c) => {
      if (!totals[c.currency_code]) {
        totals[c.currency_code] = 0;
      }
      totals[c.currency_code] += c.opening_amount || 0;
    });
    return totals;
  };

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      <PageHeader
        icon={Clock}
        title="Checkpoint Timeline"
        subtitle="Opening & Closing balance checkpoints"
      />

      {/* Filters */}
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
          value={filters.type}
          onChange={(e) =>
            setFilters({
              ...filters,
              type: e.target.value as "OPENING" | "CLOSING" | "ALL",
            })
          }
          className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
        >
          <option value="ALL">All Types</option>
          <option value="OPENING">Opening Only</option>
          <option value="CLOSING">Closing Only</option>
        </select>

        <select
          value={filters.drawer_name}
          onChange={(e) =>
            setFilters({ ...filters, drawer_name: e.target.value })
          }
          className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
        >
          <option value="">All Drawers</option>
          <option value="General">General</option>
          <option value="OMT_App">OMT App</option>
          <option value="OMT_System">OMT System</option>
          <option value="Whish_App">Whish App</option>
          <option value="Whish_System">Whish System</option>
          <option value="MTC">MTC</option>
          <option value="Alfa">Alfa</option>
          <option value="Binance">Binance</option>
          <option value="iPick">iPick</option>
          <option value="Katsh">Katsh</option>
        </select>
      </div>

      {/* Timeline */}
      <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700 overflow-auto">
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
                header: "Type",
                className: "p-4 border-b border-slate-700 w-32",
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
              return (
                <tr
                  key={checkpoint.id}
                  className="hover:bg-slate-700/50 transition-colors"
                >
                  <td className="p-4 text-slate-300 font-mono">
                    {formatTime(checkpoint.created_at)}
                  </td>
                  <td className="p-4">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium border inline-flex items-center gap-1 ${getTypeBadgeClass(checkpoint.checkpoint_type)}`}
                    >
                      {checkpoint.checkpoint_type === "OPENING" ? (
                        <TrendingUp size={12} />
                      ) : (
                        <TrendingDown size={12} />
                      )}
                      {checkpoint.checkpoint_type}
                    </span>
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
                  <td className="p-4 text-slate-300">{checkpoint.user_name}</td>
                  <td className="p-4 text-slate-400 italic max-w-xs truncate">
                    {checkpoint.notes || "-"}
                  </td>
                  <td className="p-4 text-right">
                    <button
                      onClick={() => setViewCheckpoint(checkpoint)}
                      className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
                      title="View details"
                    >
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              );
            }}
          />
        )}
      </div>

      {/* View Checkpoint Details Modal */}
      {viewCheckpoint && (
        <OpeningModal
          isOpen={true}
          onClose={() => setViewCheckpoint(null)}
          viewOnly={true}
          checkpointData={viewCheckpoint}
        />
      )}
    </div>
  );
}
