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
  Banknote,
} from "lucide-react";
import { DrawerTopUpModal } from "../components/DrawerTopUpModal";
import { InitialDrawerAmountsModal } from "../../closing/components/InitialDrawerAmountsModal";
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

/**
 * Absolute "last checkpoint" timestamp. Shows the time only when the
 * checkpoint is from today, otherwise prefixes the date. 12-hour AM/PM format.
 */
function formatCheckpointTime(iso: string): string {
  const date = parseDbDate(iso);
  const now = new Date();
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return time;
  const day = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day}, ${time}`;
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
  const [initialBalancesSet, setInitialBalancesSet] = useState(true);
  const [showInitialDrawerModal, setShowInitialDrawerModal] = useState(false);

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

  // Check once on mount whether initial drawer amounts have been set
  useEffect(() => {
    window.api.closing.hasInitialBalancesSet().then((isSet) => {
      setInitialBalancesSet(isSet);
    });
  }, []);

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
    Katsh: () => isModuleEnabled("ipec_katch"),
  };

  const DRAWER_COLORS: Record<string, { label: string; btn: string; borderL: string; glow: string; hoverShadow: string }> = {
    General:      { label: "text-blue-400",    btn: "text-blue-400    hover:text-white hover:bg-slate-700", borderL: "border-l-blue-500",    glow: "bg-blue-500",    hoverShadow: "hover:shadow-blue-500/20 hover:border-blue-500/50" },
    OMT_System:   { label: "text-green-400",   btn: "text-green-400   hover:text-white hover:bg-slate-700", borderL: "border-l-green-500",   glow: "bg-green-500",   hoverShadow: "hover:shadow-green-500/20 hover:border-green-500/50" },
    OMT_App:      { label: "text-lime-400",    btn: "text-lime-400    hover:text-white hover:bg-slate-700", borderL: "border-l-lime-500",    glow: "bg-lime-500",    hoverShadow: "hover:shadow-lime-500/20 hover:border-lime-500/50" },
    Whish_App:    { label: "text-emerald-400", btn: "text-emerald-400 hover:text-white hover:bg-slate-700", borderL: "border-l-emerald-500", glow: "bg-emerald-500", hoverShadow: "hover:shadow-emerald-500/20 hover:border-emerald-500/50" },
    Whish_System: { label: "text-fuchsia-400", btn: "text-fuchsia-400 hover:text-white hover:bg-slate-700", borderL: "border-l-fuchsia-500", glow: "bg-fuchsia-500", hoverShadow: "hover:shadow-fuchsia-500/20 hover:border-fuchsia-500/50" },
    Binance:      { label: "text-yellow-400",  btn: "text-yellow-400  hover:text-white hover:bg-slate-700", borderL: "border-l-yellow-500",  glow: "bg-yellow-500",  hoverShadow: "hover:shadow-yellow-500/20 hover:border-yellow-500/50" },
    MTC:          { label: "text-orange-400",  btn: "text-orange-400  hover:text-white hover:bg-slate-700", borderL: "border-l-orange-500",  glow: "bg-orange-500",  hoverShadow: "hover:shadow-orange-500/20 hover:border-orange-500/50" },
    Alfa:         { label: "text-red-400",     btn: "text-red-400     hover:text-white hover:bg-slate-700", borderL: "border-l-red-500",     glow: "bg-red-500",     hoverShadow: "hover:shadow-red-500/20 hover:border-red-500/50" },
    iPick:        { label: "text-sky-400",     btn: "text-sky-400     hover:text-white hover:bg-slate-700", borderL: "border-l-sky-500",     glow: "bg-sky-500",     hoverShadow: "hover:shadow-sky-500/20 hover:border-sky-500/50" },
    Katsh:        { label: "text-amber-400",   btn: "text-amber-400   hover:text-white hover:bg-slate-700", borderL: "border-l-amber-500",   glow: "bg-amber-500",   hoverShadow: "hover:shadow-amber-500/20 hover:border-amber-500/50" },
  };
  const DRAWER_COLOR_DEFAULT = { label: "text-slate-400", btn: "text-slate-400 hover:text-white hover:bg-slate-700", borderL: "border-l-violet-500", glow: "bg-violet-500", hoverShadow: "hover:shadow-violet-500/20 hover:border-violet-500/50" };

  type CardAccent = { labelColor: string; borderL: string; glow: string; hoverShadow: string };
  const FINANCIAL_ACCENTS: Record<string, CardAccent> = {
    "Sales Revenue (Today)":  { labelColor: "text-violet-400",  borderL: "border-l-violet-500",  glow: "bg-violet-500",  hoverShadow: "hover:shadow-violet-500/20 hover:border-violet-500/50" },
    "Cash Collected (Today)": { labelColor: "text-emerald-400", borderL: "border-l-emerald-500", glow: "bg-emerald-500", hoverShadow: "hover:shadow-emerald-500/20 hover:border-emerald-500/50" },
    "Orders Processed":       { labelColor: "text-sky-400",     borderL: "border-l-sky-500",     glow: "bg-sky-500",     hoverShadow: "hover:shadow-sky-500/20 hover:border-sky-500/50" },
    "Total Debt":             { labelColor: "text-rose-400",    borderL: "border-l-rose-500",    glow: "bg-rose-500",    hoverShadow: "hover:shadow-rose-500/20 hover:border-rose-500/50" },
  };
  const STOCK_ACCENTS: Record<string, CardAccent> = {
    "Stock Budget":       { labelColor: "text-amber-400", borderL: "border-l-amber-500", glow: "bg-amber-500", hoverShadow: "hover:shadow-amber-500/20 hover:border-amber-500/50" },
    "Stock Count":        { labelColor: "text-cyan-400",  borderL: "border-l-cyan-500",  glow: "bg-cyan-500",  hoverShadow: "hover:shadow-cyan-500/20 hover:border-cyan-500/50" },
    "Monthly Net Profit": { labelColor: "text-green-400", borderL: "border-l-green-500", glow: "bg-green-500", hoverShadow: "hover:shadow-green-500/20 hover:border-green-500/50" },
  };
  const ACCENT_DEFAULT: CardAccent = { labelColor: "text-slate-400", borderL: "border-l-slate-500", glow: "bg-slate-500", hoverShadow: "hover:shadow-slate-500/20 hover:border-slate-500/50" };

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

        {/* Initial drawer amounts banner — shown until operator sets starting balances */}
        {!initialBalancesSet && (
          <button
            onClick={() => setShowInitialDrawerModal(true)}
            className="flex items-center gap-3 w-full px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-left hover:bg-amber-500/15 transition-colors group"
          >
            <Wallet className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-300">
                Starting drawer amounts not set
              </p>
              <p className="text-xs text-amber-400/70">
                Set the opening cash for each active drawer so balances are accurate from day one.
              </p>
            </div>
            <span className="text-xs text-amber-400 group-hover:text-amber-300 font-medium shrink-0">
              Set now →
            </span>
          </button>
        )}

        {/* Scrollable content area */}
        <div className="flex-1 min-h-0 overflow-auto space-y-6">
          {/* Financial Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {financialCards.map((stat) => {
              const accent = FINANCIAL_ACCENTS[stat.label] ?? ACCENT_DEFAULT;
              return (
                <div
                  key={stat.label}
                  className={`relative bg-slate-800 p-4 rounded-xl border border-slate-700/40 border-l-2 ${accent.borderL} shadow-lg ${accent.hoverShadow} hover:shadow-xl transition-all duration-200 overflow-hidden`}
                >
                  <div className={`absolute -top-5 -right-5 w-20 h-20 rounded-full blur-2xl opacity-15 pointer-events-none ${accent.glow}`} />
                  <div className="relative">
                    <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 ${accent.labelColor}`}>
                      {stat.label}
                    </h3>
                    {stat.singleValue && (
                      <p className="text-xl font-bold text-white">{stat.singleValue}</p>
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
                </div>
              );
            })}
          </div>

          {/* Cash on Hand — compact strip */}
          {(drawerBalances["General"] || drawerBalances["OMT_System"]) && (
            <div className="flex items-stretch bg-slate-800 rounded-xl border border-slate-700/40 border-l-2 border-l-emerald-500 shadow-lg hover:shadow-emerald-500/20 hover:shadow-xl hover:border-emerald-500/50 transition-all duration-200 overflow-hidden self-start">
              <div className="flex items-center gap-2 px-4 bg-slate-900/50 border-r border-slate-700/60 shrink-0">
                <Banknote size={13} className="text-emerald-400" />
                <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                  Cash on Hand
                </span>
              </div>
              {(["General", "OMT_System"] as const).map((key, i) => {
                const raw = drawerBalances[key];
                const label = key === "General" ? "General" : "OMT System";
                const nonZero = raw
                  ? Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== 0))
                  : null;
                const display = nonZero && Object.keys(nonZero).length > 0 ? nonZero : raw;
                return (
                  <div
                    key={key}
                    className={`px-5 py-3 ${i < 1 ? "border-r border-slate-700/60" : ""}`}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
                      {label}
                    </p>
                    {display ? (
                      <div className="flex items-baseline gap-3 flex-wrap">
                        {Object.entries(display)
                          .sort(([a], [b]) => CURRENCY_ORDER(a) - CURRENCY_ORDER(b))
                          .map(([code, amount]) => (
                            <span key={code} className="text-sm font-bold text-emerald-400">
                              {formatAmount(amount, code)}
                            </span>
                          ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {drawerCards.map((stat) => {
                  const accent = DRAWER_COLORS[stat.name] ?? DRAWER_COLOR_DEFAULT;
                  return (
                  <div
                    key={stat.label}
                    className={`relative bg-slate-800 rounded-xl border border-slate-700/40 border-l-2 ${accent.borderL} shadow-lg ${accent.hoverShadow} hover:shadow-xl transition-all duration-200 overflow-hidden`}
                  >
                    {/* Corner glow orb */}
                    <div className={`absolute -top-5 -right-5 w-20 h-20 rounded-full blur-2xl opacity-15 pointer-events-none ${accent.glow}`} />

                    <div className="relative p-3">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <h3 className={`text-[11px] font-bold uppercase tracking-widest truncate ${accent.label}`}>
                          {stat.label}
                        </h3>
                        {checkpointsEnabled && (
                          <button
                            onClick={() =>
                              appEvents.emit("checkpoint:open", {
                                drawerName: stat.name,
                              })
                            }
                            className={`p-1 ${accent.btn} rounded transition-colors shrink-0`}
                            title="Checkpoint"
                          >
                            <ClipboardCheck size={12} />
                          </button>
                        )}
                      </div>
                      {checkpointsEnabled && (
                        <div className="flex items-center gap-1 mb-2.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${stalenessDotColor(stat.checkedAt)}`}
                          />
                          <span
                            className={`text-[10px] truncate ${stalenessTextColor(stat.checkedAt)}`}
                          >
                            {stat.checkedAt
                              ? formatCheckpointTime(stat.checkedAt)
                              : "Never"}
                          </span>
                        </div>
                      )}
                      <div className="space-y-0.5">
                        {Object.entries(stat.currencies)
                          .sort(([a], [b]) => CURRENCY_ORDER(a) - CURRENCY_ORDER(b))
                          .map(([code, amount]) => (
                            <p key={code} className="text-sm font-bold text-white">
                              {formatAmount(amount, code)}
                            </p>
                          ))}
                        {Object.keys(stat.currencies).length === 0 && (
                          <p className="text-xs text-slate-500">No balance</p>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })}
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
              {creditsAndStockCards.map((stat) => {
                const accent = STOCK_ACCENTS[stat.label] ?? ACCENT_DEFAULT;
                return (
                  <div
                    key={stat.label}
                    className={`relative bg-slate-800 p-4 rounded-xl border border-slate-700/40 border-l-2 ${accent.borderL} shadow-lg ${accent.hoverShadow} hover:shadow-xl transition-all duration-200 overflow-hidden`}
                  >
                    <div className={`absolute -top-5 -right-5 w-20 h-20 rounded-full blur-2xl opacity-15 pointer-events-none ${accent.glow}`} />
                    <div className="relative">
                      <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 ${accent.labelColor}`}>
                        {stat.label}
                      </h3>
                      {stat.singleValue && (
                        <p className="text-xl font-bold text-white">{stat.singleValue}</p>
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
                  </div>
                );
              })}
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
            <div className="lg:col-span-2 relative bg-slate-800 p-4 rounded-xl border border-slate-700/40 border-l-2 border-l-violet-500 shadow-lg hover:shadow-violet-500/20 hover:shadow-xl hover:border-violet-500/50 transition-all duration-200 flex flex-col min-h-0 overflow-hidden">
              <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full blur-3xl opacity-10 pointer-events-none bg-violet-500" />
              <div className="relative flex justify-between items-center mb-3">
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
                <div className="relative bg-slate-800 p-5 rounded-xl border border-slate-700/40 border-l-2 border-l-rose-500 shadow-lg hover:shadow-rose-500/20 hover:shadow-xl hover:border-rose-500/50 transition-all duration-200 flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div className="absolute -top-5 -right-5 w-20 h-20 rounded-full blur-2xl opacity-15 pointer-events-none bg-rose-500" />
                  <h3 className="relative text-md font-bold text-white mb-4 flex items-center gap-2">
                    <BarChart2 size={16} className="text-rose-400" />
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
                            <span className="text-sm font-bold text-rose-400">
                              {formatAmount(debtor.total_debt_usd, "USD")}
                            </span>
                            {debtor.total_debt_lbp !== 0 && (
                              <span className="text-xs text-rose-400/70 ml-2">
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

              <div className="relative bg-slate-800 p-5 rounded-xl border border-slate-700/40 border-l-2 border-l-blue-500 shadow-lg hover:shadow-blue-500/20 hover:shadow-xl hover:border-blue-500/50 transition-all duration-200 flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="absolute -top-5 -right-5 w-20 h-20 rounded-full blur-2xl opacity-15 pointer-events-none bg-blue-500" />
                <h3 className="relative text-md font-bold text-white mb-4 flex items-center gap-2">
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

      {showInitialDrawerModal && (
        <InitialDrawerAmountsModal
          onClose={() => setShowInitialDrawerModal(false)}
          onSaved={() => {
            setInitialBalancesSet(true);
            loadData();
          }}
        />
      )}
    </>
  );
}
