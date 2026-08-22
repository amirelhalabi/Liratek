import { useMemo, useState } from "react";
import {
  History,
  RefreshCw,
  X,
  ArrowRight,
  Pencil,
  Check,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { DataTable, useApi } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { useDateRangeFilter } from "@/shared/hooks/useDateRangeFilter";
import { DateRangeFilter } from "@/shared/components/DateRangeFilter";
import { EditHistoryPopover } from "@/shared/components/EditHistoryPopover";
import { parseDbDate } from "@/shared/utils/parseDbDate";

// EXCHANGE_LOT_SETTLEMENT.md Phase 4b PINNED CONTRACT — mirrors
// `SourceSummary`/`SettlerSummary` (packages/core/src/repositories/
// ExchangeLotRepository.ts) verbatim. `lot_summary` is populated when this
// row created a lot (an exotic-currency BUY leg, keyed to `from_currency`);
// `settler_summary` is populated when this row consumed lot(s) (an
// exotic-currency SELL leg, keyed to `to_currency`). Both are `null` for a
// row that never touched a lot (USD<->LBP, or a lot lookup failure).
type LotSourceSummary = {
  original_qty: number;
  remaining_qty: number;
  settled_qty: number;
  realized_profit_usd: number;
  is_voided: number;
};

type LotSettlerSummary = {
  settled_qty: number;
  realized_profit_usd: number;
};

type ExchangeTx = {
  id: number;
  created_at: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  leg1_rate: number | null;
  leg1_market_rate: number | null;
  leg1_profit_usd: number | null;
  leg2_rate: number | null;
  leg2_market_rate: number | null;
  leg2_profit_usd: number | null;
  via_currency: string | null;
  profit_usd: number | null;
  amount_in: string | number;
  amount_out: string | number;
  is_refunded?: number;
  refunded_at?: string | null;
  edited_by?: string | null;
  edited_at?: string | null;
  client_name?: string | null;
  note?: string | null;
  lot_summary?: LotSourceSummary | null;
  settler_summary?: LotSettlerSummary | null;
};

// Settlement row shape shared by both sides of `getLotBreakdown`'s response
// (`LotSettlementEntityDto`/`LotSettlementWithLotDto` in backendApi.ts) —
// only the fields this table actually renders are declared here.
type LotSettlementRow = {
  id: number | null;
  qty: number;
  unit_cost_usd: number;
  unit_proceeds_usd: number;
  profit_usd: number;
  basis_source: "LOT" | "MARKET";
  is_refunded: number;
  created_at: string;
};

type LotBreakdown = {
  asSettler: LotSettlementRow[];
  againstSource: LotSettlementRow[];
};

// Matches LOT_QTY_EPSILON in packages/core/src/constants/exchangeLotPolicy.ts
// — replicated as a literal here (not imported) because @liratek/core's
// package-root import chains into DB-touching modules that jsdom/jest can't
// resolve without mocking the whole package (see Exchange/index.tsx's test
// mocks). Not worth pulling that into a component that otherwise never
// touches core, for one float constant.
const LOT_QTY_EPSILON = 0.005;

interface HistoryModalProps {
  transactions: ExchangeTx[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  /** Preset by PositionsPanel's per-row "view" action (Q16). */
  initialCurrencyFilter?: string;
}

/** Status badge derivation for a lot-tracked BUY row (Q16). */
function lotStatus(summary: LotSourceSummary): {
  label: "Settled" | "Partial" | "Open";
  pct: number | null;
} {
  if (summary.remaining_qty <= LOT_QTY_EPSILON) {
    return { label: "Settled", pct: null };
  }
  if (summary.settled_qty > 0) {
    const pct =
      summary.original_qty > 0
        ? (summary.settled_qty / summary.original_qty) * 100
        : 0;
    return { label: "Partial", pct };
  }
  return { label: "Open", pct: null };
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  Settled: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Partial: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Open: "bg-sky-500/10 text-sky-400 border-sky-500/20",
};

/** Small settlement-list table shared by both sides of the expandable
 *  breakdown row (this exchange's own consumption, and later settlements
 *  drawn against a lot this exchange created). */
function BreakdownTable({
  rows,
  currency,
}: {
  rows: LotSettlementRow[];
  currency: string;
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-slate-500">
          <th className="text-left font-medium py-1 pr-3">Date</th>
          <th className="text-right font-medium py-1 pr-3">Qty</th>
          <th className="text-right font-medium py-1 pr-3">Unit Cost</th>
          <th className="text-right font-medium py-1 pr-3">Unit Proceeds</th>
          <th className="text-right font-medium py-1 pr-3">Profit</th>
          <th className="text-center font-medium py-1">Basis</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-700/40">
        {rows.map((s, i) => (
          <tr
            key={s.id ?? i}
            className={s.is_refunded ? "opacity-50 line-through" : ""}
          >
            <td className="py-1 pr-3 text-slate-300 whitespace-nowrap">
              {parseDbDate(s.created_at).toLocaleString([], {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </td>
            <td className="py-1 pr-3 text-right font-mono text-slate-300 whitespace-nowrap">
              {s.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
              {currency}
            </td>
            <td className="py-1 pr-3 text-right font-mono text-slate-400">
              ${s.unit_cost_usd.toFixed(4)}
            </td>
            <td className="py-1 pr-3 text-right font-mono text-slate-400">
              ${s.unit_proceeds_usd.toFixed(4)}
            </td>
            <td
              className={`py-1 pr-3 text-right font-mono font-semibold ${
                s.profit_usd >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {s.profit_usd >= 0 ? "+" : ""}${s.profit_usd.toFixed(4)}
            </td>
            <td className="py-1 text-center">
              {s.basis_source === "MARKET" ? (
                <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full border border-amber-500/20">
                  MARKET
                </span>
              ) : (
                <span className="text-[10px] text-slate-500">LOT</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HistoryModal({
  transactions,
  loading,
  onClose,
  onRefresh,
  initialCurrencyFilter,
}: HistoryModalProps) {
  useModalFocusFix(true);
  const api = useApi();
  const { filteredData, from, to, setFrom, setTo } = useDateRangeFilter(
    transactions,
    "created_at",
  );

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ client_name: "", note: "" });
  const [editSaving, setEditSaving] = useState(false);

  // Currency filter (Q17 — client-side over the already-loaded, 50-row-capped
  // rows; no server change). Options are derived from ALL loaded rows so the
  // list doesn't shrink/reflow as the date filter narrows the visible set.
  const [currencyFilter, setCurrencyFilter] = useState<string>(
    initialCurrencyFilter ?? "ALL",
  );
  const currencyOptions = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((tx) => {
      set.add(tx.from_currency);
      set.add(tx.to_currency);
    });
    return Array.from(set).sort();
  }, [transactions]);
  const currencyFilteredData = useMemo(() => {
    if (currencyFilter === "ALL") return filteredData;
    return filteredData.filter(
      (tx) =>
        tx.from_currency === currencyFilter || tx.to_currency === currencyFilter,
    );
  }, [filteredData, currencyFilter]);

  // Expandable settlement breakdown (Q16) — lazily fetched per row on first
  // expand, keyed by exchange id so a re-expand doesn't refetch.
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [breakdownById, setBreakdownById] = useState<
    Record<number, LotBreakdown | "loading" | "error">
  >({});

  async function toggleExpand(tx: ExchangeTx) {
    const isLotTouched = !!tx.lot_summary || !!tx.settler_summary;
    if (!isLotTouched) return;
    if (expandedId === tx.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(tx.id);
    if (breakdownById[tx.id]) return;
    setBreakdownById((prev) => ({ ...prev, [tx.id]: "loading" }));
    try {
      const data = await api.exchangeLots.getBreakdown(tx.id);
      setBreakdownById((prev) => ({ ...prev, [tx.id]: data }));
    } catch {
      setBreakdownById((prev) => ({ ...prev, [tx.id]: "error" }));
    }
  }

  function startEdit(tx: ExchangeTx) {
    setEditingId(tx.id);
    setEditForm({ client_name: tx.client_name ?? "", note: tx.note ?? "" });
  }

  async function handleSaveEdit() {
    if (editingId === null) return;
    setEditSaving(true);
    try {
      const result = await api.updateExchangeMetadata({
        id: editingId,
        ...(editForm.client_name !== undefined && {
          client_name: editForm.client_name,
        }),
        ...(editForm.note !== undefined && { note: editForm.note }),
      });
      if (result.success) {
        setEditingId(null);
        onRefresh();
      } else {
        alert(result.error ?? "Failed to save");
      }
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl max-h-[85vh] bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <History className="text-slate-400" size={18} />
            Exchange History
            <span className="text-xs text-slate-500 font-normal ml-1">
              ({currencyFilteredData.length} records)
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <select
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value)}
              title="Filter by currency"
              className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500"
            >
              <option value="ALL">All Currencies</option>
              {currencyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <DateRangeFilter
              from={from}
              to={to}
              onFromChange={setFrom}
              onToChange={setTo}
            />
            <button
              onClick={onRefresh}
              className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <RefreshCw size={20} className="animate-spin mr-2" />
              Loading...
            </div>
          ) : (
            <DataTable<ExchangeTx>
              columns={[
                {
                  header: "Time",
                  className: "px-4 py-3",
                  sortKey: "created_at",
                },
                {
                  header: "Pair",
                  className: "px-4 py-3",
                  sortKey: "from_currency",
                },
                {
                  header: "Amount In",
                  className: "px-4 py-3 text-right",
                  sortKey: "amount_in",
                },
                {
                  header: "Amount Out",
                  className: "px-4 py-3 text-right",
                  sortKey: "amount_out",
                },
                { header: "Via", className: "px-4 py-3 text-center" },
                { header: "Status", className: "px-4 py-3 text-center" },
                { header: "Remaining", className: "px-4 py-3 text-right" },
                { header: "Realized", className: "px-4 py-3 text-right" },
                {
                  header: "Profit",
                  className: "px-4 py-3 text-right",
                  sortKey: "profit_usd",
                },
                { header: "", className: "px-4 py-3 w-10 text-center" },
              ]}
              data={currencyFilteredData}
              exportExcel
              exportPdf
              exportFilename="exchange-history"
              className="w-full"
              theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
              tbodyClassName="divide-y divide-slate-700/50"
              emptyMessage="No exchanges yet."
              renderRow={(tx) => {
                const totalProfit =
                  tx.leg1_profit_usd !== null || tx.leg2_profit_usd !== null
                    ? (tx.leg1_profit_usd ?? 0) + (tx.leg2_profit_usd ?? 0)
                    : tx.profit_usd;
                const isRefunded = Boolean(tx.is_refunded);
                const isEditing = editingId === tx.id;
                const isLotTouched = !!tx.lot_summary || !!tx.settler_summary;
                const isExpanded = expandedId === tx.id;
                const status = tx.lot_summary
                  ? lotStatus(tx.lot_summary)
                  : null;
                const breakdown = breakdownById[tx.id];

                return (
                  <>
                    <tr
                      key={tx.id}
                      onClick={() => toggleExpand(tx)}
                      className={`transition-colors${
                        isLotTouched
                          ? " cursor-pointer hover:bg-slate-700/30"
                          : " hover:bg-slate-700/20"
                      }${isRefunded ? " opacity-50" : ""}`}
                    >
                      <td className="px-4 py-3 text-sm text-slate-400">
                        <div className="flex items-center gap-1.5">
                          {isLotTouched &&
                            (isExpanded ? (
                              <ChevronDown
                                size={12}
                                className="text-slate-500 shrink-0"
                              />
                            ) : (
                              <ChevronRight
                                size={12}
                                className="text-slate-500 shrink-0"
                              />
                            ))}
                          {parseDbDate(tx.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400">
                            {tx.from_currency}
                          </span>
                          <ArrowRight size={10} className="text-slate-600" />
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400">
                            {tx.to_currency}
                          </span>
                          {isRefunded && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              Refunded
                            </span>
                          )}
                          {tx.edited_by && (
                            <EditHistoryPopover
                              entityType="exchange_transaction"
                              entityId={tx.id}
                              trigger={
                                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400 cursor-pointer hover:bg-yellow-500/20 transition-colors">
                                  <Pencil size={8} />
                                  Edited
                                </span>
                              }
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-emerald-400 text-right font-mono">
                        {Number(tx.amount_in).toLocaleString()}{" "}
                        {tx.from_currency}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-red-400 text-right font-mono">
                        {Number(tx.amount_out).toLocaleString()}{" "}
                        {tx.to_currency}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tx.via_currency ? (
                          <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                            via {tx.via_currency}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                      {/* Status (Q16) — derived from lot_summary only (the
                          BUY leg's own open position); a sell-only or
                          non-lot row has nothing to show here. */}
                      <td className="px-4 py-3 text-center">
                        {status ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_BADGE_CLASSES[status.label]}`}
                          >
                            {status.label}
                            {status.pct !== null &&
                              ` (${status.pct.toFixed(0)}%)`}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                      {/* Remaining (Q16) — the BUY lot's own remaining
                          quantity, denominated in from_currency (the
                          acquired currency). */}
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-300">
                        {tx.lot_summary
                          ? `${tx.lot_summary.remaining_qty.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${tx.from_currency}`
                          : "—"}
                      </td>
                      {/* Realized-so-far (Q16) — lot_summary's running total
                          for a BUY row (reference only — settlement profit
                          already lives on the settling SELL's own Profit
                          cell, unchanged). A sell-only row's realized profit
                          is already the Profit column — "—" here avoids
                          showing the same number twice. */}
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {tx.lot_summary ? (
                          <span
                            className={
                              tx.lot_summary.realized_profit_usd >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }
                          >
                            {tx.lot_summary.realized_profit_usd >= 0
                              ? "+"
                              : ""}
                            ${tx.lot_summary.realized_profit_usd.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-right">
                        {totalProfit !== null && totalProfit !== undefined ? (
                          <span
                            // LIRA-131: neutralise (muted + struck through +
                            // tooltip) on a refunded row instead of
                            // presenting reversed income as live, mirroring
                            // e47dfa2 (Custom Services).
                            className={
                              isRefunded
                                ? "text-slate-500 line-through"
                                : totalProfit >= 0
                                  ? "text-emerald-400"
                                  : "text-red-400"
                            }
                            title={
                              isRefunded
                                ? "Refunded — profit not realized"
                                : undefined
                            }
                          >
                            ${Number(totalProfit).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <div
                            className="flex items-center justify-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={handleSaveEdit}
                              disabled={editSaving}
                              className="p-1.5 text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-colors disabled:opacity-50"
                              title="Save"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1.5 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(tx);
                            }}
                            className="p-1.5 text-slate-500 hover:text-orange-400 hover:bg-orange-400/10 rounded-lg transition-colors"
                            title="Edit metadata"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="bg-slate-800/60 border-b border-slate-700/50">
                        <td colSpan={10} className="px-4 py-3">
                          <div className="flex items-end gap-3 flex-wrap">
                            <div>
                              <label className="text-xs text-slate-400 block mb-1">
                                Client Name
                              </label>
                              <input
                                value={editForm.client_name}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    client_name: e.target.value,
                                  }))
                                }
                                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 w-48"
                                placeholder="Client name"
                              />
                            </div>
                            <div className="flex-1 min-w-[180px]">
                              <label className="text-xs text-slate-400 block mb-1">
                                Note
                              </label>
                              <input
                                value={editForm.note}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    note: e.target.value,
                                  }))
                                }
                                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 w-full"
                                placeholder="Note"
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    {isExpanded && isLotTouched && (
                      <tr className="bg-slate-800/40 border-b border-slate-700/50">
                        <td colSpan={10} className="px-4 py-3">
                          {breakdown === "loading" || breakdown === undefined ? (
                            <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                              <RefreshCw size={12} className="animate-spin" />
                              Loading settlement breakdown...
                            </div>
                          ) : breakdown === "error" ? (
                            <div className="text-xs text-red-400 py-2">
                              Failed to load settlement breakdown.
                            </div>
                          ) : breakdown.asSettler.length === 0 &&
                            breakdown.againstSource.length === 0 ? (
                            <div className="text-xs text-slate-500 py-2">
                              No settlements recorded.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {breakdown.asSettler.length > 0 && (
                                <div>
                                  <div className="text-[11px] font-semibold text-slate-400 uppercase mb-1">
                                    Settled from lots ({tx.to_currency})
                                  </div>
                                  <BreakdownTable
                                    rows={breakdown.asSettler}
                                    currency={tx.to_currency}
                                  />
                                </div>
                              )}
                              {breakdown.againstSource.length > 0 && (
                                <div>
                                  <div className="text-[11px] font-semibold text-slate-400 uppercase mb-1">
                                    Later settlements against this lot (
                                    {tx.from_currency})
                                  </div>
                                  <BreakdownTable
                                    rows={breakdown.againstSource}
                                    currency={tx.from_currency}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
