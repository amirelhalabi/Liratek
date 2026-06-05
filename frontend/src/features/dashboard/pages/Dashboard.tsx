import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { appEvents, PageHeader, useApi } from "@liratek/ui";
import {
  Clock,
  BarChart2,
  Package,
  Wallet,
  AlertTriangle,
  LayoutDashboard,
  Plus,
  ClipboardCheck,
} from "lucide-react";
import { DrawerTopUpModal } from "../components/DrawerTopUpModal";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useModules } from "@/contexts/ModuleContext";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";

const DashboardChart = lazy(() => import("../components/DashboardChart"));

type ChartType = "Sales" | "Profit";

/** Format drawer_name from DB into a display label */
function formatDrawerLabel(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/Drawer B$/i, "Drawer")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Sort key so USD renders before LBP before any other currency */
function CURRENCY_ORDER(code: string): number {
  if (code === "USD") return 0;
  if (code === "LBP") return 1;
  return 2;
}

/**
 * Parse a timestamp into a Date. SQLite `CURRENT_TIMESTAMP` values arrive as
 * UTC formatted "YYYY-MM-DD HH:MM:SS" with no timezone marker, which JS would
 * otherwise interpret as *local* time — making fresh records look hours old.
 * If no timezone info is present, treat the value as UTC.
 */
function parseDbDate(iso: string): Date {
  // Already carries a timezone designator (trailing Z or ±hh:mm offset).
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso)) return new Date(iso);
  // SQLite space-separated form (or bare ISO) → pin to UTC.
  return new Date(`${iso.replace(" ", "T")}Z`);
}

/** Human-readable "time since last checkpoint" */
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - parseDbDate(iso).getTime();
  const diffM = diffMs / (1000 * 60);
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffM < 1) return "Just now";
  if (diffM < 60) return `${Math.floor(diffM)}m ago`;
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

/** Staleness color buckets: <8h green, <24h yellow, else/never red */
function stalenessDotColor(iso: string | null): string {
  if (!iso) return "bg-red-400";
  const diffH = (Date.now() - parseDbDate(iso).getTime()) / (1000 * 60 * 60);
  if (diffH < 8) return "bg-green-400";
  if (diffH < 24) return "bg-yellow-400";
  return "bg-red-400";
}

function stalenessTextColor(iso: string | null): string {
  if (!iso) return "text-red-400";
  const diffH = (Date.now() - parseDbDate(iso).getTime()) / (1000 * 60 * 60);
  if (diffH < 8) return "text-green-400";
  if (diffH < 24) return "text-yellow-400";
  return "text-red-400";
}

export default function Dashboard() {
  const api = useApi();
  const { formatAmount, getSymbol } = useCurrencyContext();
  const { isModuleEnabled } = useModules();
  const { user } = useAuth();
  const { flags } = useFeatureFlags();
  const checkpointsEnabled = user?.role === "admin" && flags.sessionManagement;

  const debtEnabled = isModuleEnabled("debts");

  const [stats, setStats] = useState({
    totalSalesUSD: 0,
    totalSalesLBP: 0,
    cashCollectedUSD: 0,
    cashCollectedLBP: 0,
    ordersCount: 0,
    activeClients: 0,
    stockBudgetUSD: 0,
    stockCount: 0,
    monthlyNetProfitUSD: 0,
    monthlyNetProfitLBP: 0,
  });
  /** Dynamic drawer balances: drawer_name → currency_code → amount */
  const [drawerBalances, setDrawerBalances] = useState<
    Record<string, Record<string, number>>
  >({});
  /** Configured currencies per drawer: drawer_name → currency_code[] */
  const [_drawerCurrencyConfig, setDrawerCurrencyConfig] = useState<
    Record<string, string[]>
  >({});
  /** Last checkpoint timestamp per drawer: drawer_name → checked_at ISO */
  const [drawerStatuses, setDrawerStatuses] = useState<
    Record<string, { checked_at: string }>
  >({});
  type ChartPoint = {
    date: string;
    usd?: number;
    lbp?: number;
    profit?: number;
  };
  type TodaySale = {
    id: number;
    client_name: string | null;
    paid_usd: number;
    paid_lbp: number;
    created_at: string;
  };
  type DebtSummary = {
    totalDebt: number;
    totalDebtUsd: number;
    totalDebtLbp: number;
    topDebtors: {
      full_name: string;
      total_debt: number;
      total_debt_usd: number;
      total_debt_lbp: number;
    }[];
  };
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [todaysSales, setTodaysSales] = useState<TodaySale[]>([]);
  const [debtSummary, setDebtSummary] = useState<DebtSummary>({
    totalDebt: 0,
    totalDebtUsd: 0,
    totalDebtLbp: 0,
    topDebtors: [],
  });
  const [chartType, setChartType] = useState<ChartType>("Sales");

  type UnsettledSummary = {
    provider: string;
    count: number;
    pending_commission_usd: number;
    pending_commission_lbp: number;
    total_owed_usd: number;
    total_owed_lbp: number;
  };
  const [unsettledSummary, setUnsettledSummary] = useState<UnsettledSummary[]>(
    [],
  );
  const [showTopUpModal, setShowTopUpModal] = useState(false);

  // State for dynamic Y-axis domains
  const [maxUsdSales, setMaxUsdSales] = useState(0);
  const [maxLbpSales, setMaxLbpSales] = useState(0);

  const loadData = useCallback(async () => {
    try {
      const [
        statsData,
        profitChartData,
        salesTodayData,
        drawerData,
        debtData,
        stockStats,
        monthlyPL,
        drawerCurrConfig,
      ] = window.api
        ? await Promise.all([
            window.api.dashboard.getStats(),
            window.api.dashboard.getProfitSalesChart(chartType),
            window.api.sales.getTodaysSales(),
            window.api.closing.getSystemExpectedBalancesDynamic(),
            window.api.debt.getSummary(),
            window.api.inventory.getStockStats(),
            window.api.financial.getMonthlyPL(
              new Date().toISOString().slice(0, 7),
            ),
            window.api.currencies.allDrawerCurrencies(),
          ])
        : await Promise.all([
            api.getDashboardStats(),
            api.getProfitSalesChart(chartType),
            api.getTodaysSales(),
            api.getSystemExpectedBalancesDynamic(),
            api.getDebtSummary(),
            api.getInventoryStockStats(),
            api.getMonthlyPL(new Date().toISOString().slice(0, 7)),
            api.getAllDrawerCurrencies(),
          ]);

      setStats({
        ...statsData,
        stockBudgetUSD: stockStats?.stock_budget_usd || 0,
        stockCount: stockStats?.stock_count || 0,
        monthlyNetProfitUSD: monthlyPL?.netProfitUSD || 0,
        monthlyNetProfitLBP: monthlyPL?.netProfitLBP || 0,
      });
      const formattedChartData = profitChartData.map((d: any) => ({
        ...d,
        date: new Date(d.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      }));
      setChartData(formattedChartData);
      setTodaysSales(salesTodayData);
      if (drawerData) {
        setDrawerBalances(drawerData);
      }
      if (drawerCurrConfig) {
        setDrawerCurrencyConfig(drawerCurrConfig);
      }
      if (debtData) {
        setDebtSummary(debtData);
      }

      // Load last-checkpoint-per-drawer for staleness badges (admin + session mgmt only)
      if (checkpointsEnabled && window.api) {
        try {
          const statusRes =
            await window.api.closing.getLastCheckpointPerDrawer();
          if (statusRes.success && statusRes.data) {
            setDrawerStatuses(statusRes.data);
          }
        } catch {
          // non-critical
        }
      }

      // Load unsettled summary (non-critical — don't let failures block dashboard)
      try {
        const unsettled = window.api
          ? await window.api.suppliers.getUnsettledSummary()
          : await (api as any).getUnsettledSummary?.();
        if (Array.isArray(unsettled)) setUnsettledSummary(unsettled);
      } catch {
        // non-critical
      }

      // Calculate max values for Y-axis domain
      if (chartType === "Sales" && formattedChartData.length > 0) {
        const currentMaxUsd = Math.max(
          ...formattedChartData.map((d: any) => d.usd || 0),
        );
        const currentMaxLbp = Math.max(
          ...formattedChartData.map((d: any) => d.lbp || 0),
        );

        // Round up USD to the next thousand
        setMaxUsdSales(Math.ceil(currentMaxUsd / 1000) * 1000);

        // Round up LBP to the next million
        setMaxLbpSales(Math.ceil(currentMaxLbp / 1_000_000) * 1_000_000);
      }
    } catch (_error) {
      // logger.error('Failed to load dashboard data:', error);
    }
  }, [api, chartType, checkpointsEnabled]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadData();
    }, 0);
    const interval = setInterval(loadData, 30000); // 30s refresh

    // Subscribe to refresh events
    const unsubscribe = appEvents.on("sale:completed", () => {
      // Sale completed, refresh dashboard stats
      loadData();
    });
    // Refresh balances + checkpoint staleness after a checkpoint completes
    const offClosing = appEvents.on("closing:completed", () => {
      loadData();
    });

    return () => {
      clearTimeout(t);
      clearInterval(interval);
      unsubscribe();
      offClosing();
    };
  }, [loadData]);

  // Financial Metrics (Row 1)
  const financialCards = [
    {
      label: "Sales Revenue (Today)",
      usdValue: stats.totalSalesUSD,
      lbpValue: stats.totalSalesLBP,
    },
    {
      label: "Cash Collected (Today)",
      usdValue: stats.cashCollectedUSD,
      lbpValue: stats.cashCollectedLBP,
    },
    {
      label: "Orders Processed",
      singleValue: stats.ordersCount.toString(),
    },
    // Only show Total Debt card when debt module is enabled
    ...(debtEnabled
      ? [
          {
            label: "Total Debt",
            usdValue: debtSummary.totalDebtUsd,
            lbpValue: debtSummary.totalDebtLbp,
          },
        ]
      : []),
  ];

  // Map drawer names to required module keys so we can hide drawers
  // for disabled payment methods / modules
  const drawerModuleMap: Record<string, () => boolean> = {
    OMT_App: () => isModuleEnabled("ipec_katch"),
    OMT_System: () => isModuleEnabled("ipec_katch"),
    Whish_App: () => isModuleEnabled("ipec_katch"),
    Whish_System: () => isModuleEnabled("ipec_katch"),
    Binance: () => isModuleEnabled("binance"),
    MTC: () => isModuleEnabled("recharge"),
    Alfa: () => isModuleEnabled("recharge"),
    iPick: () => isModuleEnabled("ipec_katch"),
    Katsh: () => false, // Katsh drawer is internal cost-tracking only — never show on dashboard
  };

  // Drawer Balances (Row 2) — dynamic from drawer_balances table
  // Filter out drawers whose associated module/PM is disabled
  const drawerEntries = Object.entries(drawerBalances).filter(([name]) => {
    const check = drawerModuleMap[name];
    return !check || check(); // show if no restriction, or if module is enabled
  });
  const drawerCards = drawerEntries.map(([name, currencies]) => {
    // Show all currencies with a non-zero balance, or all if all are zero
    const nonZero = Object.fromEntries(
      Object.entries(currencies).filter(([, amount]) => amount !== 0),
    );
    const displayCurrencies =
      Object.keys(nonZero).length > 0 ? nonZero : currencies;
    return {
      name,
      label: formatDrawerLabel(name),
      currencies: displayCurrencies,
      checkedAt: drawerStatuses[name]?.checked_at ?? null,
    };
  });

  // Credits & Stock (Row 3)
  const creditsAndStockCards = [
    {
      label: "Stock Budget",
      singleValue: formatAmount(stats.stockBudgetUSD, "USD"),
    },
    {
      label: "Stock Count",
      singleValue: `${stats.stockCount.toLocaleString()} items`,
    },
    {
      label: "Monthly Net Profit",
      usdValue: stats.monthlyNetProfitUSD,
      lbpValue: stats.monthlyNetProfitLBP,
    },
  ];

  return (
    <>
      <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
        <PageHeader icon={LayoutDashboard} title="Dashboard" />

        {/* Scrollable content area */}
        <div className="flex-1 min-h-0 overflow-auto space-y-6">
          {/* Financial Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {financialCards.map((stat) => (
              <div
                key={stat.label}
                className="bg-slate-800 p-4 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors"
              >
                <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-2">
                  {stat.label}
                </h3>

                {stat.singleValue && (
                  <p className="text-xl font-bold text-white">
                    {stat.singleValue}
                  </p>
                )}

                {stat.usdValue !== undefined && stat.lbpValue !== undefined && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <p className="text-base font-bold text-emerald-400">
                        {formatAmount(stat.usdValue, "USD")}
                      </p>
                    </div>
                    <div className="flex-1">
                      <p className="text-base font-bold text-violet-400 text-right">
                        {formatAmount(stat.lbpValue, "LBP")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Drawer Balances — separate section */}
          {drawerCards.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Wallet className="text-sky-400" />
                  Drawer Balances
                </h2>
                <button
                  onClick={() => setShowTopUpModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  <Plus size={14} />
                  Top Up
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {drawerCards.map((stat) => (
                  <div
                    key={stat.label}
                    className="bg-slate-800 p-4 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
                          {stat.label}
                        </h3>
                        {checkpointsEnabled && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${stalenessDotColor(stat.checkedAt)}`}
                            />
                            <span
                              className={`text-[10px] font-medium ${stalenessTextColor(stat.checkedAt)}`}
                            >
                              {stat.checkedAt
                                ? formatRelativeTime(stat.checkedAt)
                                : "Never checkpointed"}
                            </span>
                          </div>
                        )}
                      </div>
                      {checkpointsEnabled && (
                        <button
                          onClick={() =>
                            appEvents.emit("checkpoint:open", {
                              drawerName: stat.name,
                            })
                          }
                          className="flex items-center gap-1 px-2 py-1 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg transition-colors shrink-0"
                          title="Checkpoint this drawer"
                        >
                          <ClipboardCheck size={12} />
                          Checkpoint
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      {Object.entries(stat.currencies)
                        .sort(
                          ([a], [b]) =>
                            CURRENCY_ORDER(a) - CURRENCY_ORDER(b),
                        )
                        .map(([code, amount], idx) => (
                          <p
                            key={code}
                            className={`text-base font-bold text-emerald-400 ${
                              idx > 0 ? "text-right" : ""
                            }`}
                          >
                            {formatAmount(amount, code)}
                          </p>
                        ))}
                      {Object.keys(stat.currencies).length === 0 && (
                        <p className="text-sm text-slate-500">No balance</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Credits, Stock & Profit */}
          <div>
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Package className="text-amber-400" />
              Credits & Stock
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {creditsAndStockCards.map((stat) => (
                <div
                  key={stat.label}
                  className="bg-slate-800 p-4 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors"
                >
                  <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-2">
                    {stat.label}
                  </h3>
                  <p className="text-xl font-bold text-white">
                    {stat.singleValue}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Pending Settlement Banner — only shown when there are unsettled commissions */}
          {unsettledSummary.length > 0 &&
            (() => {
              const totalPendingUsd = unsettledSummary.reduce(
                (s, r) => s + r.pending_commission_usd,
                0,
              );
              const totalTxns = unsettledSummary.reduce(
                (s, r) => s + r.count,
                0,
              );
              return (
                <div className="bg-amber-950/40 border border-amber-700/60 rounded-xl p-4 flex items-start gap-3">
                  <AlertTriangle
                    className="text-amber-400 shrink-0 mt-0.5"
                    size={18}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-amber-300 font-semibold text-sm">
                      Pending Settlement — {totalTxns} transaction
                      {totalTxns !== 1 ? "s" : ""}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {unsettledSummary.map((r) => (
                        <span
                          key={r.provider}
                          className="text-xs text-amber-400/80 font-mono"
                        >
                          {r.provider}:{" "}
                          <span className="text-amber-300 font-semibold">
                            ${r.pending_commission_usd.toFixed(4)}
                          </span>{" "}
                          commission on ${r.total_owed_usd.toFixed(2)} owed (
                          {r.count} txns)
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-amber-500 mt-1">
                      Total pending:{" "}
                      <span className="text-amber-300 font-mono font-bold">
                        ${totalPendingUsd.toFixed(4)}
                      </span>{" "}
                      — settle via Settings → Supplier Ledger
                    </p>
                  </div>
                </div>
              );
            })()}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:h-[520px]">
            <div className="lg:col-span-2 bg-slate-800 p-4 rounded-xl border border-slate-700/50 shadow-lg flex flex-col min-h-0">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-bold text-white">
                  {chartType} Trend (Last 30 Days)
                </h3>
                <select
                  value={chartType}
                  onChange={(e) => setChartType(e.target.value as ChartType)}
                  className="bg-slate-700 text-xs text-white rounded p-1 border border-slate-600 focus:ring-violet-500 focus:border-violet-500"
                >
                  <option value="Sales">Sales</option>
                  <option value="Profit">Profit</option>
                </select>
              </div>
              <div className="flex-1 w-full min-h-0">
                <Suspense
                  fallback={
                    <div className="h-full animate-pulse bg-slate-700/30 rounded-xl" />
                  }
                >
                  <DashboardChart
                    chartData={chartData}
                    chartType={chartType}
                    maxUsdSales={maxUsdSales}
                    maxLbpSales={maxLbpSales}
                    getSymbol={getSymbol}
                    formatAmount={formatAmount}
                  />
                </Suspense>
              </div>
            </div>

            <div className="flex flex-col h-full gap-4 min-h-0">
              {debtEnabled && (
                <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg flex-1 flex flex-col min-h-0">
                  <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2">
                    <BarChart2 size={16} className="text-red-400" />
                    Top Debtors
                  </h3>
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                    {debtSummary.topDebtors.length > 0 ? (
                      debtSummary.topDebtors.map((debtor) => (
                        <div
                          key={debtor.full_name}
                          className="flex items-center justify-between p-2.5 bg-slate-700/20 rounded-lg"
                        >
                          <span className="text-sm text-slate-300 truncate mr-3">
                            {debtor.full_name}
                          </span>
                          <div className="text-right shrink-0">
                            <span className="text-sm font-bold text-red-400">
                              {formatAmount(debtor.total_debt_usd, "USD")}
                            </span>
                            {debtor.total_debt_lbp !== 0 && (
                              <span className="text-xs text-red-400/70 ml-2">
                                {formatAmount(debtor.total_debt_lbp, "LBP")}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                        No debtors
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg flex-1 flex flex-col min-h-0">
                <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2">
                  <Clock size={16} className="text-blue-400" />
                  Today's Sales
                </h3>
                <div className="space-y-3 overflow-y-auto flex-1 min-h-0">
                  {todaysSales.length > 0 ? (
                    todaysSales.map((sale) => (
                      <div
                        key={sale.id}
                        className="flex items-center justify-between p-3 bg-slate-700/20 rounded-lg hover:bg-slate-700/40 transition-colors"
                      >
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-slate-200">
                            {sale.client_name || "Walk-in Client"}
                          </span>
                          <span className="text-xs text-slate-500">
                            {new Date(sale.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <div className="text-right">
                          {sale.paid_usd > 0 && (
                            <p className="text-emerald-400 font-bold text-sm">
                              +{formatAmount(sale.paid_usd, "USD")}
                            </p>
                          )}
                          {sale.paid_lbp > 0 && (
                            <p className="text-sky-400 font-semibold text-xs">
                              +{formatAmount(sale.paid_lbp, "LBP")}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500 text-center py-4">
                      No sales yet today.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <DrawerTopUpModal
        isOpen={showTopUpModal}
        onClose={() => setShowTopUpModal(false)}
        onSuccess={() => {
          setShowTopUpModal(false);
          loadData();
        }}
      />
    </>
  );
}
