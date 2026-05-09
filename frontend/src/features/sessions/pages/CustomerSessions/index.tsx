import { useState, useEffect, useCallback } from "react";
import {
  Users,
  Clock,
  CheckCircle,
  ShoppingCart,
  RefreshCw,
  TrendingUp,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { PageHeader } from "@liratek/ui";
import { DateRangeFilter } from "@/shared/components/DateRangeFilter";

interface SessionSummary {
  id: number;
  customer_name?: string;
  customer_phone?: string;
  customer_notes?: string;
  started_at: string;
  closed_at?: string;
  started_by: string;
  closed_by?: string;
  is_active: 0 | 1;
  checkout_total_usd: number;
  checkout_total_lbp: number;
  checkout_profit_usd: number;
  checkout_profit_lbp: number;
  item_count: number;
  total_usd: number;
  total_lbp: number;
  total_profit_usd: number;
  total_profit_lbp: number;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getDuration(startedAt: string, closedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const mins = Math.round((end - start) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function CurrencyAmount({
  usd,
  lbp,
  className = "",
}: {
  usd: number;
  lbp: number;
  className?: string;
}) {
  const parts: string[] = [];
  if (usd !== 0) parts.push(`$${usd.toFixed(2)}`);
  if (lbp !== 0) parts.push(`${Math.round(lbp).toLocaleString()} LBP`);
  if (parts.length === 0) return null;
  return <span className={className}>{parts.join(" + ")}</span>;
}

export default function CustomerSessions() {
  const today = new Date().toISOString().split("T")[0];
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);

  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await window.api.session.getByDateRange(dateFrom, dateTo);
      if (result.success && result.sessions) {
        setSessions(result.sessions);
      }
    } catch (err) {
      console.error("Failed to load sessions:", err);
    } finally {
      setIsLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const activeSessions = sessions.filter((s) => s.is_active === 1);
  const closedSessions = sessions.filter((s) => s.is_active === 0);

  const totalRevenueUsd = closedSessions.reduce(
    (sum, s) => sum + s.checkout_total_usd,
    0,
  );
  const totalRevenueLbp = closedSessions.reduce(
    (sum, s) => sum + s.checkout_total_lbp,
    0,
  );
  const totalProfitUsd = sessions.reduce(
    (sum, s) => sum + (s.checkout_profit_usd || s.total_profit_usd || 0),
    0,
  );
  const totalProfitLbp = sessions.reduce(
    (sum, s) => sum + (s.checkout_profit_lbp || s.total_profit_lbp || 0),
    0,
  );

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 min-h-0 flex flex-col gap-4 overflow-hidden animate-in fade-in duration-300">
      <PageHeader
        icon={Users}
        title="Customer Sessions"
        actions={
          <div className="flex items-center gap-3">
            <DateRangeFilter
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
            />
            <div className="flex items-center gap-2">
              <div className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="text-emerald-300/60 text-[10px] block">
                  Active
                </span>
                <span className="font-bold">{activeSessions.length}</span>
              </div>
              <div className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                <span className="text-slate-400 text-[10px] block">Closed</span>
                <span className="font-bold">{closedSessions.length}</span>
              </div>
              {(totalRevenueUsd > 0 || totalRevenueLbp > 0) && (
                <div className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <span className="text-amber-300/60 text-[10px] block">
                    Revenue
                  </span>
                  <CurrencyAmount
                    usd={totalRevenueUsd}
                    lbp={totalRevenueLbp}
                    className="font-bold"
                  />
                </div>
              )}
              {(totalProfitUsd > 0 || totalProfitLbp > 0) && (
                <div className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="text-emerald-300/60 text-[10px] block">
                    Profit
                  </span>
                  <CurrencyAmount
                    usd={totalProfitUsd}
                    lbp={totalProfitLbp}
                    className="font-bold"
                  />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={loadSessions}
              className="p-2 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all"
              title="Refresh"
            >
              <RefreshCw
                className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        }
      />

      {/* Sessions list */}
      <div className="flex-1 overflow-auto min-h-0">
        {isLoading && sessions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Loading sessions...
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
            <Users className="w-12 h-12 text-slate-600" />
            <p className="text-lg font-medium">No sessions today</p>
            <p className="text-sm text-slate-500">
              Customer sessions will appear here when started
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Active Sessions */}
            {activeSessions.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  Active ({activeSessions.length})
                </h3>
                <div className="grid gap-2">
                  {activeSessions.map((s) => (
                    <SessionCard key={s.id} session={s} />
                  ))}
                </div>
              </div>
            )}

            {/* Closed Sessions */}
            {closedSessions.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Completed ({closedSessions.length})
                </h3>
                <div className="grid gap-2">
                  {closedSessions.map((s) => (
                    <SessionCard key={s.id} session={s} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface SessionDetailItem {
  id: number;
  item_id: string;
  module: string;
  label: string;
  amount: number;
  currency: string;
  created_at: string;
}

interface SessionTransaction {
  id: number;
  transaction_type: string;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  created_at: string;
}

function SessionCard({ session: s }: { session: SessionSummary }) {
  const isActive = s.is_active === 1;
  // Use checkout totals if available, otherwise fall back to linked transaction totals
  const revenueUsd = s.checkout_total_usd || s.total_usd;
  const revenueLbp = s.checkout_total_lbp || s.total_lbp;
  const hasRevenue = revenueUsd > 0 || revenueLbp > 0;
  // Use checkout profit for closed sessions, transaction profit for active
  const profitUsd = s.checkout_profit_usd || s.total_profit_usd || 0;
  const profitLbp = s.checkout_profit_lbp || s.total_profit_lbp || 0;
  const hasProfit = profitUsd > 0 || profitLbp > 0;
  const [expanded, setExpanded] = useState(false);
  const [cartItems, setCartItems] = useState<SessionDetailItem[]>([]);
  const [transactions, setTransactions] = useState<SessionTransaction[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const handleClick = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    setLoadingDetails(true);
    try {
      const [cartResult, txResult] = await Promise.all([
        window.api.session.cartGet(s.id),
        window.api.session.getTransactions(s.id),
      ]);
      if (cartResult.success && cartResult.items) {
        setCartItems(cartResult.items as SessionDetailItem[]);
      }
      if (txResult.success && txResult.transactions) {
        setTransactions(txResult.transactions as SessionTransaction[]);
      }
    } catch (err) {
      console.error("Failed to load session details:", err);
    } finally {
      setLoadingDetails(false);
    }
  };

  return (
    <div
      className={`rounded-xl border transition-all ${
        isActive
          ? "bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40"
          : "bg-slate-800/50 border-slate-700/50 hover:border-slate-600"
      }`}
    >
      {/* Main row */}
      <div
        onClick={handleClick}
        className="flex items-center gap-4 px-4 py-3 cursor-pointer"
      >
        {/* Status indicator */}
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            isActive ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
          }`}
        />

        {/* Customer info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-white truncate">
              {s.customer_name || "Walk-in"}
            </span>
            {s.customer_phone && (
              <span className="text-xs text-slate-400">{s.customer_phone}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
            <span>
              {formatTime(s.started_at)}
              {s.closed_at ? ` — ${formatTime(s.closed_at)}` : ""}
            </span>
            <span className="text-slate-600">·</span>
            <span>{getDuration(s.started_at, s.closed_at)}</span>
            <span className="text-slate-600">·</span>
            <span>by {s.started_by}</span>
          </div>
        </div>

        {/* Items count */}
        {s.item_count > 0 && (
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>{s.item_count}</span>
          </div>
        )}

        {/* Revenue */}
        {hasRevenue && (
          <div className="text-right">
            <CurrencyAmount
              usd={revenueUsd}
              lbp={revenueLbp}
              className="text-sm font-bold text-amber-400"
            />
          </div>
        )}

        {/* Profit */}
        {hasProfit && (
          <div className="text-right flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            <CurrencyAmount
              usd={profitUsd}
              lbp={profitLbp}
              className="text-xs font-semibold text-emerald-400"
            />
          </div>
        )}

        {/* Status badge */}
        <div
          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
            isActive
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-slate-700/50 text-slate-400"
          }`}
        >
          {isActive ? "Active" : "Done"}
        </div>

        {/* Expand indicator */}
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-3 border-t border-slate-700/50 pt-3">
          {loadingDetails ? (
            <div className="text-xs text-slate-400 text-center py-2">
              Loading...
            </div>
          ) : cartItems.length === 0 && transactions.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-2">
              No items in this session
            </div>
          ) : (
            <div className="space-y-3">
              {/* Cart items (pending) */}
              {cartItems.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider mb-1.5">
                    Cart Items ({cartItems.length})
                  </div>
                  <div className="space-y-1">
                    {cartItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase text-slate-500 font-medium w-16">
                            {item.module}
                          </span>
                          <span className="text-sm text-slate-200">
                            {item.label}
                          </span>
                        </div>
                        <span
                          className={`text-sm font-mono font-semibold ${
                            item.amount >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {item.amount >= 0 ? "+" : ""}
                          {item.currency === "LBP"
                            ? `${item.amount.toLocaleString()} LBP`
                            : `$${item.amount.toFixed(2)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Committed transactions */}
              {transactions.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Transactions ({transactions.length})
                  </div>
                  <div className="space-y-1">
                    {transactions.map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50"
                      >
                        <span className="text-sm text-slate-300 capitalize">
                          {tx.transaction_type}
                        </span>
                        <div className="flex items-center gap-3">
                          {(tx.profit_usd > 0 || tx.profit_lbp > 0) && (
                            <span className="text-[10px] text-emerald-400/70">
                              +
                              <CurrencyAmount
                                usd={tx.profit_usd}
                                lbp={tx.profit_lbp}
                              />
                            </span>
                          )}
                          <div className="text-sm font-semibold">
                            {tx.amount_usd > 0 && (
                              <span className="text-green-400">
                                ${tx.amount_usd.toFixed(2)}
                              </span>
                            )}
                            {tx.amount_usd > 0 && tx.amount_lbp > 0 && (
                              <span className="mx-1 text-slate-500">+</span>
                            )}
                            {tx.amount_lbp > 0 && (
                              <span className="text-blue-400">
                                {tx.amount_lbp.toLocaleString()} LBP
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
