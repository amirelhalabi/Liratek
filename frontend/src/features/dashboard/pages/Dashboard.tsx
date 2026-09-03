import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  lazy,
  Suspense,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  appEvents,
  PageHeader,
  useApi,
  Select,
  ServiceTypeTabs,
  DataTable,
  PageAlerts,
} from "@liratek/ui";
import type {
  ServiceTypeOption,
  CarrierLineEntity,
  PageAlertItem,
} from "@liratek/ui";
import {
  Clock,
  BarChart2,
  Package,
  Wallet,
  AlertTriangle,
  Plus,
  Minus,
  ClipboardCheck,
  Banknote,
  HandCoins,
  Phone,
} from "lucide-react";
import { DrawerTopUpModal } from "../components/DrawerTopUpModal";
import { DrawerCashoutModal } from "../components/DrawerCashoutModal";
import { InitialDrawerAmountsModal } from "../../closing/components/InitialDrawerAmountsModal";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useModules } from "@/contexts/ModuleContext";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useShopBase } from "@/hooks/useShopBase";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { localMonth } from "@/shared/utils/localDay";
import {
  computeCarrierLineAlerts,
  carrierLineAlertText,
} from "../utils/carrierLineAlerts";

const DashboardChart = lazy(() => import("../components/DashboardChart"));

type ChartType = "Sales" | "Profit";

/** The three tabbed dashboard insight panels */
type DashboardTab = "trend" | "sales" | "debtors";

/** Per-tab accent styling so the card + active tab share the section's color */
const TAB_ACCENT: Record<
  DashboardTab,
  { borderL: string; glow: string; hex: string }
> = {
  trend: {
    borderL: "border-l-violet-500",
    glow: "bg-violet-500",
    hex: "#8b5cf6",
  },
  sales: { borderL: "border-l-blue-500", glow: "bg-blue-500", hex: "#3b82f6" },
  debtors: {
    borderL: "border-l-rose-500",
    glow: "bg-rose-500",
    hex: "#f43f5e",
  },
};

/** Shared <th> className for the insight tables — mirrors the Transactions page */
const INSIGHT_TH_CLS = "p-2 text-xs font-semibold uppercase text-slate-400";

/** A Name / USD / LBP row for the Today's Sales and Top Debtors tables */
type NameAmountRow = {
  key: string | number;
  name: string;
  usd: number;
  lbp: number;
};

/**
 * A Name / USD / LBP table built on the same DataTable used by the
 * Transactions page (sortable headers, matching row styling). Both the
 * Today's Sales and Top Debtors tabs feed it a `NameAmountRow[]`.
 */
function NameAmountTable({
  rows,
  emptyMessage,
  formatAmount,
}: {
  rows: NameAmountRow[];
  emptyMessage: string;
  formatAmount: (
    amount: number | null | undefined,
    currencyCode: string,
  ) => string;
}) {
  return (
    <DataTable<NameAmountRow>
      columns={[
        { header: "Name", sortKey: "name", className: INSIGHT_TH_CLS },
        {
          header: "USD",
          sortKey: "usd",
          width: "150px",
          className: INSIGHT_TH_CLS,
        },
        {
          header: "LBP",
          sortKey: "lbp",
          width: "170px",
          className: INSIGHT_TH_CLS,
        },
      ]}
      data={rows}
      emptyMessage={emptyMessage}
      className="w-full text-left"
      theadClassName="bg-slate-900 text-slate-400 text-xs uppercase sticky top-0 z-10"
      getSortValue={(row, key) =>
        key === "name" ? row.name : key === "usd" ? row.usd : row.lbp
      }
      renderRow={(row) => (
        <tr
          key={row.key}
          className="border-t border-slate-800 text-xs hover:bg-slate-700/30"
        >
          <td className="p-2 truncate text-slate-200">{row.name}</td>
          <td className="p-2 truncate text-slate-100 font-medium">
            {row.usd ? formatAmount(row.usd, "USD") : "—"}
          </td>
          <td className="p-2 truncate text-slate-400">
            {row.lbp ? formatAmount(row.lbp, "LBP") : "—"}
          </td>
        </tr>
      )}
    />
  );
}

/**
 * Format drawer_name from DB into a display label.
 *
 * OMT_System / Whish_System are special-cased: under the Primary Cash
 * Drawer model (plan §1) they are the physical cash drawer at the shop's
 * money-transfer counter, not a provider float balance (PR #66's rejected
 * model) — the generic underscore-replace would otherwise render the bare
 * "OMT System" / "Whish System" wording the plan retires.
 */
function formatDrawerLabel(name: string): string {
  if (name === "OMT_System") return "OMT Cash Drawer";
  if (name === "Whish_System") return "Whish Cash Drawer";
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const { formatAmount, getSymbol } = useCurrencyContext();
  const { isModuleEnabled } = useModules();
  const { flags } = useFeatureFlags();
  const checkpointsEnabled = flags.sessionManagement;
  // Primary Cash Drawer plan §1/§8.1 — the "Cash on Hand" strip's second
  // cell follows whichever system is primary (shop_base_system), not a
  // hardcoded OMT assumption.
  const { baseSystem } = useShopBase();
  const primaryDrawerName =
    baseSystem === "WHISH" ? "Whish_System" : "OMT_System";
  const primaryDrawerLabel =
    baseSystem === "WHISH" ? "Whish Cash Drawer" : "OMT Cash Drawer";

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
  type Debtor = {
    id: number;
    full_name: string;
    total_debt: number;
    total_debt_usd: number;
    total_debt_lbp: number;
  };
  /** Full debtor list (uncapped, debt DESC) powering the Top Debtors table */
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [chartType, setChartType] = useState<ChartType>("Sales");
  const [activeTab, setActiveTab] = useState<DashboardTab>("trend");
  /**
   * Row cap for the Today's Sales / Top Debtors tables — editable, default 50.
   * Allowed to be "" so the field can be cleared while editing; the tables
   * coerce "" → 50 when slicing.
   */
  const [insightRowsLimit, setInsightRowsLimit] = useState<number | "">(50);
  /** Tab bar options; Top Debtors only shows when the debts module is on */
  const insightTabs: ServiceTypeOption[] = [
    { id: "trend", label: "Sales Trend", iconKey: "ArrowUpCircle" },
    { id: "sales", label: "Today's Sales", iconKey: "Clock" },
    ...(debtEnabled
      ? [
          {
            id: "debtors",
            label: "Top Debtors",
            iconKey: "CreditCard",
          } as ServiceTypeOption,
        ]
      : []),
  ];
  /** Editable "Rows:" cap shared by the Today's Sales / Top Debtors tables */
  const rowsControl = (
    <div className="flex items-center gap-1.5">
      <label className="text-xs text-slate-400">Rows:</label>
      <input
        type="number"
        min={1}
        value={insightRowsLimit}
        onChange={(e) => {
          const v = e.target.value;
          setInsightRowsLimit(v === "" ? "" : Math.max(1, Number(v)));
        }}
        className="w-16 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-violet-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );

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
  /** Active carrier lines, every carrier — feeds the expiry/missing-line
   *  banner (D11 / D4). Non-critical: a failed fetch just means no banner. */
  const [carrierLines, setCarrierLines] = useState<CarrierLineEntity[]>([]);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showCashOutModal, setShowCashOutModal] = useState(false);
  const [initialBalancesSet, setInitialBalancesSet] = useState(true);
  const [showInitialDrawerModal, setShowInitialDrawerModal] = useState(false);
  const [startingCheckpointSet, setStartingCheckpointSet] = useState(true);

  type ActiveHold = {
    id: number;
    client_name: string;
    usd_amount: number;
    lbp_amount: number;
    created_at: string;
  };
  const [activeHolds, setActiveHolds] = useState<ActiveHold[]>([]);
  const [collectingHoldId, setCollectingHoldId] = useState<number | null>(null);

  // State for dynamic Y-axis domains
  const [maxUsdSales, setMaxUsdSales] = useState(0);
  const [maxLbpSales, setMaxLbpSales] = useState(0);

  const loadData = useCallback(async () => {
    try {
      // Dual-mode via useApi() — the adapter picks IPC vs REST internally
      // (ipcOrHttp), so no window.api gate belongs here (rule 19a).
      const [
        statsData,
        profitChartData,
        salesTodayData,
        drawerData,
        debtData,
        stockStats,
        monthlyPL,
        debtorsData,
      ] = await Promise.all([
        api.getDashboardStats(),
        api.getProfitSalesChart(chartType),
        api.getTodaysSales(),
        api.getSystemExpectedBalancesDynamic(),
        api.getDebtSummary(),
        api.getInventoryStockStats(),
        api.getMonthlyPL(localMonth()),
        api.getDebtors(),
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
      if (debtData) {
        setDebtSummary(debtData);
      }
      if (Array.isArray(debtorsData)) {
        setDebtors(debtorsData);
      }

      // Load last-checkpoint-per-drawer for staleness badges (admin +
      // session mgmt only). Dual-mode via useApi() — no window.api gate; the
      // REST mirror landed (backend/src/api/closing.ts), so this now works
      // identically in web mode.
      if (checkpointsEnabled) {
        try {
          const statuses = await api.getLastCheckpointPerDrawer();
          if (statuses) {
            setDrawerStatuses(statuses);
          }
        } catch {
          // non-critical
        }
      }

      // Load unsettled summary (non-critical — don't let failures block
      // dashboard). Dual-mode via useApi() — no window.api gate.
      try {
        const unsettled = await api.getUnsettledSummary();
        if (Array.isArray(unsettled)) setUnsettledSummary(unsettled);
      } catch {
        // non-critical
      }

      // Load active carrier lines (non-critical — feeds the expiry/missing-
      // line banner, D11/D4). Dual-mode via useApi() — no window.api gate.
      try {
        const carrierLinesData = await api.getAllActiveCarrierLines();
        if (Array.isArray(carrierLinesData)) setCarrierLines(carrierLinesData);
      } catch {
        // non-critical
      }

      // Load active money holds (non-critical — surfaced as notification
      // cards). Dual-mode via useApi().holdMoney — no window.api gate.
      try {
        const holdsRes = await api.holdMoney.active();
        if (holdsRes.success && holdsRes.data) {
          setActiveHolds(holdsRes.data);
        }
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

  const handleCollectHold = useCallback(
    async (hold: ActiveHold) => {
      setCollectingHoldId(hold.id);
      try {
        const res = await api.holdMoney.collect(hold.id);
        if (res.success) {
          appEvents.emit(
            "notification:show",
            `Returned hold to ${hold.client_name}.`,
            "success",
          );
          await loadData();
        } else {
          appEvents.emit(
            "notification:show",
            res.error ?? "Failed to collect hold.",
            "error",
          );
        }
      } catch {
        appEvents.emit("notification:show", "Failed to collect hold.", "error");
      } finally {
        setCollectingHoldId(null);
      }
    },
    [loadData],
  );

  // Check once on mount whether initial drawer amounts have been set.
  // Dual-mode via useApi() — no window.api gate; the REST mirror landed
  // (backend/src/api/closing.ts), so this now works identically in web mode.
  useEffect(() => {
    api.hasInitialBalancesSet().then((isSet) => {
      setInitialBalancesSet(isSet);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whether a starting checkpoint has ever been recorded. Only relevant when
  // checkpoints (session management) are enabled; otherwise treat as satisfied
  // so the banner never shows for shops that don't use the timeline. Dual-mode
  // via useApi() — no window.api gate.
  const refreshStartingCheckpoint = useCallback(() => {
    if (!checkpointsEnabled) {
      setStartingCheckpointSet(true);
      return;
    }
    api
      .hasStartingCheckpoint()
      .then((isSet) => setStartingCheckpointSet(isSet));
  }, [checkpointsEnabled, api]);

  useEffect(() => {
    refreshStartingCheckpoint();
  }, [refreshStartingCheckpoint]);

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
      // The first checkpoint clears the "no starting checkpoint" banner.
      refreshStartingCheckpoint();
    });
    // Refresh after a money hold is created or collected
    const offHold = appEvents.on("holdMoney:changed", () => {
      loadData();
    });

    return () => {
      clearTimeout(t);
      clearInterval(interval);
      unsubscribe();
      offClosing();
      offHold();
    };
  }, [loadData, refreshStartingCheckpoint]);

  // Carrier-line expiry / missing-line banner (D11 + D4) — pure derivation
  // from the loaded lines + whether the shared `recharge` module is on.
  const carrierLineAlerts = useMemo(
    () => computeCarrierLineAlerts(carrierLines, isModuleEnabled("recharge")),
    [carrierLines, isModuleEnabled],
  );

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

  const DRAWER_COLORS: Record<
    string,
    {
      label: string;
      btn: string;
      borderL: string;
      glow: string;
      hoverShadow: string;
    }
  > = {
    General: {
      label: "text-blue-400",
      btn: "text-blue-400    hover:text-white hover:bg-slate-700",
      borderL: "border-l-blue-500",
      glow: "bg-blue-500",
      hoverShadow: "hover:shadow-blue-500/20 hover:border-blue-500/50",
    },
    OMT_System: {
      label: "text-green-400",
      btn: "text-green-400   hover:text-white hover:bg-slate-700",
      borderL: "border-l-green-500",
      glow: "bg-green-500",
      hoverShadow: "hover:shadow-green-500/20 hover:border-green-500/50",
    },
    OMT_App: {
      label: "text-lime-400",
      btn: "text-lime-400    hover:text-white hover:bg-slate-700",
      borderL: "border-l-lime-500",
      glow: "bg-lime-500",
      hoverShadow: "hover:shadow-lime-500/20 hover:border-lime-500/50",
    },
    Whish_App: {
      label: "text-emerald-400",
      btn: "text-emerald-400 hover:text-white hover:bg-slate-700",
      borderL: "border-l-emerald-500",
      glow: "bg-emerald-500",
      hoverShadow: "hover:shadow-emerald-500/20 hover:border-emerald-500/50",
    },
    Whish_System: {
      label: "text-fuchsia-400",
      btn: "text-fuchsia-400 hover:text-white hover:bg-slate-700",
      borderL: "border-l-fuchsia-500",
      glow: "bg-fuchsia-500",
      hoverShadow: "hover:shadow-fuchsia-500/20 hover:border-fuchsia-500/50",
    },
    Binance: {
      label: "text-yellow-400",
      btn: "text-yellow-400  hover:text-white hover:bg-slate-700",
      borderL: "border-l-yellow-500",
      glow: "bg-yellow-500",
      hoverShadow: "hover:shadow-yellow-500/20 hover:border-yellow-500/50",
    },
    MTC: {
      label: "text-orange-400",
      btn: "text-orange-400  hover:text-white hover:bg-slate-700",
      borderL: "border-l-orange-500",
      glow: "bg-orange-500",
      hoverShadow: "hover:shadow-orange-500/20 hover:border-orange-500/50",
    },
    Alfa: {
      label: "text-red-400",
      btn: "text-red-400     hover:text-white hover:bg-slate-700",
      borderL: "border-l-red-500",
      glow: "bg-red-500",
      hoverShadow: "hover:shadow-red-500/20 hover:border-red-500/50",
    },
    iPick: {
      label: "text-sky-400",
      btn: "text-sky-400     hover:text-white hover:bg-slate-700",
      borderL: "border-l-sky-500",
      glow: "bg-sky-500",
      hoverShadow: "hover:shadow-sky-500/20 hover:border-sky-500/50",
    },
    Katsh: {
      label: "text-amber-400",
      btn: "text-amber-400   hover:text-white hover:bg-slate-700",
      borderL: "border-l-amber-500",
      glow: "bg-amber-500",
      hoverShadow: "hover:shadow-amber-500/20 hover:border-amber-500/50",
    },
  };
  const DRAWER_COLOR_DEFAULT = {
    label: "text-slate-400",
    btn: "text-slate-400 hover:text-white hover:bg-slate-700",
    borderL: "border-l-violet-500",
    glow: "bg-violet-500",
    hoverShadow: "hover:shadow-violet-500/20 hover:border-violet-500/50",
  };

  type CardAccent = {
    labelColor: string;
    borderL: string;
    glow: string;
    hoverShadow: string;
  };
  const FINANCIAL_ACCENTS: Record<string, CardAccent> = {
    "Sales Revenue (Today)": {
      labelColor: "text-violet-400",
      borderL: "border-l-violet-500",
      glow: "bg-violet-500",
      hoverShadow: "hover:shadow-violet-500/20 hover:border-violet-500/50",
    },
    "Cash Collected (Today)": {
      labelColor: "text-emerald-400",
      borderL: "border-l-emerald-500",
      glow: "bg-emerald-500",
      hoverShadow: "hover:shadow-emerald-500/20 hover:border-emerald-500/50",
    },
    "Orders Processed": {
      labelColor: "text-sky-400",
      borderL: "border-l-sky-500",
      glow: "bg-sky-500",
      hoverShadow: "hover:shadow-sky-500/20 hover:border-sky-500/50",
    },
    "Total Debt": {
      labelColor: "text-rose-400",
      borderL: "border-l-rose-500",
      glow: "bg-rose-500",
      hoverShadow: "hover:shadow-rose-500/20 hover:border-rose-500/50",
    },
  };
  const STOCK_ACCENTS: Record<string, CardAccent> = {
    "Stock Budget": {
      labelColor: "text-amber-400",
      borderL: "border-l-amber-500",
      glow: "bg-amber-500",
      hoverShadow: "hover:shadow-amber-500/20 hover:border-amber-500/50",
    },
    "Stock Count": {
      labelColor: "text-cyan-400",
      borderL: "border-l-cyan-500",
      glow: "bg-cyan-500",
      hoverShadow: "hover:shadow-cyan-500/20 hover:border-cyan-500/50",
    },
    "Monthly Net Profit": {
      labelColor: "text-green-400",
      borderL: "border-l-green-500",
      glow: "bg-green-500",
      hoverShadow: "hover:shadow-green-500/20 hover:border-green-500/50",
    },
  };
  const ACCENT_DEFAULT: CardAccent = {
    labelColor: "text-slate-400",
    borderL: "border-l-slate-500",
    glow: "bg-slate-500",
    hoverShadow: "hover:shadow-slate-500/20 hover:border-slate-500/50",
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

  // Page-header alert pill (PageAlerts) — each entry preserves the exact
  // copy/handler/guard of the full-width banner it replaces.
  const pageAlerts = useMemo<PageAlertItem[]>(() => {
    const items: PageAlertItem[] = [];

    if (!initialBalancesSet) {
      items.push({
        id: "initial-balances",
        icon: Wallet,
        title: "Starting drawer amounts not set",
        detail:
          "Set the opening cash for each active drawer so balances are accurate from day one.",
        actionLabel: "Set now",
        onAction: () => setShowInitialDrawerModal(true),
      });
    }

    if (checkpointsEnabled && !startingCheckpointSet) {
      items.push({
        id: "starting-checkpoint",
        icon: ClipboardCheck,
        title: "No starting checkpoint recorded",
        detail:
          "Record an opening checkpoint so the timeline has a baseline to reconcile against.",
        actionLabel: "Record now",
        onAction: () =>
          appEvents.emit("checkpoint:open", {
            drawerName: drawerEntries[0]?.[0] ?? "General",
          }),
      });
    }

    if (carrierLineAlerts.length > 0) {
      items.push({
        id: "carrier-lines",
        icon: Phone,
        title:
          carrierLineAlerts.length > 1
            ? "Carrier lines need attention"
            : "Carrier line needs attention",
        detail: carrierLineAlerts.map(carrierLineAlertText).join(" · "),
        actionLabel: "Review",
        onAction: () => navigate("/settings?tab=carrier-lines"),
      });
    }

    return items;
  }, [
    initialBalancesSet,
    checkpointsEnabled,
    startingCheckpointSet,
    carrierLineAlerts,
    drawerEntries,
    navigate,
  ]);

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
      <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 pt-6 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
        <PageHeader
          title="Dashboard"
          actions={<PageAlerts alerts={pageAlerts} />}
        />

        {/* Active money holds — one notification card per held amount */}
        {activeHolds.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeHolds.map((hold) => (
              <div
                key={hold.id}
                className="flex items-center gap-3 px-4 py-3 bg-orange-500/10 border border-orange-500/30 rounded-xl"
              >
                <Wallet className="w-5 h-5 text-orange-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-orange-200 truncate">
                    Holding for {hold.client_name}
                  </p>
                  <div className="flex items-center gap-2 text-xs mt-0.5">
                    {hold.usd_amount > 0 && (
                      <span className="text-orange-300 font-mono">
                        $
                        {hold.usd_amount.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    )}
                    {hold.lbp_amount > 0 && (
                      <span className="text-orange-300 font-mono">
                        {hold.lbp_amount.toLocaleString()} LBP
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCollectHold(hold)}
                  disabled={collectingHoldId === hold.id}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50 transition-all flex items-center gap-1"
                >
                  <HandCoins size={13} />
                  Collect
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Scrollable content area */}
        <div className="flex-1 min-h-0 overflow-y-auto -mr-6 pr-6 pb-6 space-y-6">
          {/* Financial Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {financialCards.map((stat) => {
              const accent = FINANCIAL_ACCENTS[stat.label] ?? ACCENT_DEFAULT;
              return (
                <div
                  key={stat.label}
                  className={`relative bg-slate-800 p-4 rounded-xl border border-slate-700/40 border-l-2 ${accent.borderL} shadow-lg ${accent.hoverShadow} hover:shadow-xl transition-all duration-200 overflow-hidden`}
                >
                  <div
                    className={`absolute -top-5 -right-5 w-20 h-20 rounded-full blur-2xl opacity-15 pointer-events-none ${accent.glow}`}
                  />
                  <div className="relative">
                    <h3
                      className={`text-xs font-bold uppercase tracking-wider mb-2 ${accent.labelColor}`}
                    >
                      {stat.label}
                    </h3>
                    {stat.singleValue && (
                      <p className="text-xl font-bold text-white">
                        {stat.singleValue}
                      </p>
                    )}
                    {stat.usdValue !== undefined &&
                      stat.lbpValue !== undefined && (
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

          {/* Cash on Hand — compact strip. Both cells are physical cash under
              the Primary Cash Drawer model (plan §1) — General plus
              whichever system is primary — so the pairing is finally
              semantically correct; only the label/name follow shop_base_system. */}
          {(drawerBalances["General"] || drawerBalances[primaryDrawerName]) && (
            <div className="flex items-stretch bg-slate-800 rounded-xl border border-slate-700/40 border-l-2 border-l-emerald-500 shadow-lg hover:shadow-emerald-500/20 hover:shadow-xl hover:border-emerald-500/50 transition-all duration-200 overflow-hidden self-start">
              <div className="flex items-center gap-2 px-4 bg-slate-900/50 border-r border-slate-700/60 shrink-0">
                <Banknote size={13} className="text-emerald-400" />
                <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                  Cash on Hand
                </span>
              </div>
              {[
                { key: "General", label: "General" },
                { key: primaryDrawerName, label: primaryDrawerLabel },
              ].map(({ key, label }, i) => {
                const raw = drawerBalances[key];
                const nonZero = raw
                  ? Object.fromEntries(
                      Object.entries(raw).filter(([, v]) => v !== 0),
                    )
                  : null;
                const display =
                  nonZero && Object.keys(nonZero).length > 0 ? nonZero : raw;
                return (
                  <div
                    key={key}
                    data-testid={`cash-on-hand-${key}`}
                    className={`px-5 py-3 ${i < 1 ? "border-r border-slate-700/60" : ""}`}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
                      {label}
                    </p>
                    {display ? (
                      <div className="flex items-baseline gap-3 flex-wrap">
                        {Object.entries(display)
                          .sort(
                            ([a], [b]) => CURRENCY_ORDER(a) - CURRENCY_ORDER(b),
                          )
                          .map(([code, amount]) => (
                            <span
                              key={code}
                              className="text-sm font-bold text-emerald-400"
                            >
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
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowTopUpModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    <Plus size={14} />
                    Top Up
                  </button>
                  {user?.role === "admin" && (
                    <button
                      onClick={() => setShowCashOutModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      <Minus size={14} />
                      Cash Out
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {drawerCards.map((stat) => {
                  const accent =
                    DRAWER_COLORS[stat.name] ?? DRAWER_COLOR_DEFAULT;
                  return (
                    <div
                      key={stat.label}
                      className={`relative bg-slate-800 rounded-xl border border-slate-700/40 border-l-2 ${accent.borderL} shadow-lg ${accent.hoverShadow} hover:shadow-xl transition-all duration-200 overflow-hidden`}
                    >
                      {/* Corner glow orb */}
                      <div
                        className={`absolute -top-5 -right-5 w-20 h-20 rounded-full blur-2xl opacity-15 pointer-events-none ${accent.glow}`}
                      />

                      <div className="relative p-3">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <h3
                            className={`text-[11px] font-bold uppercase tracking-widest truncate ${accent.label}`}
                          >
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
                            .sort(
                              ([a], [b]) =>
                                CURRENCY_ORDER(a) - CURRENCY_ORDER(b),
                            )
                            .map(([code, amount]) => (
                              <p
                                key={code}
                                className="text-sm font-bold text-white"
                              >
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
                    <div
                      className={`absolute -top-5 -right-5 w-20 h-20 rounded-full blur-2xl opacity-15 pointer-events-none ${accent.glow}`}
                    />
                    <div className="relative">
                      <h3
                        className={`text-xs font-bold uppercase tracking-wider mb-2 ${accent.labelColor}`}
                      >
                        {stat.label}
                      </h3>
                      {stat.singleValue && (
                        <p className="text-xl font-bold text-white">
                          {stat.singleValue}
                        </p>
                      )}
                      {stat.usdValue !== undefined &&
                        stat.lbpValue !== undefined && (
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
                <div className="bg-amber-100 border border-amber-300 dark:bg-amber-950/40 dark:border-amber-700/60 rounded-xl p-4 flex items-start gap-3">
                  <AlertTriangle
                    className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                    size={18}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-amber-800 dark:text-amber-300 font-semibold text-sm">
                      Pending Settlement — {totalTxns} transaction
                      {totalTxns !== 1 ? "s" : ""}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {unsettledSummary.map((r) => (
                        <span
                          key={r.provider}
                          className="text-xs text-amber-700 dark:text-amber-400/80 font-mono"
                        >
                          {r.provider}:{" "}
                          <span className="text-amber-900 dark:text-amber-300 font-semibold">
                            ${r.pending_commission_usd.toFixed(4)}
                          </span>{" "}
                          commission on ${r.total_owed_usd.toFixed(2)} owed (
                          {r.count} txns)
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
                      Total pending:{" "}
                      <span className="text-amber-900 dark:text-amber-300 font-mono font-bold">
                        ${totalPendingUsd.toFixed(4)}
                      </span>{" "}
                      — settle via Settings → Supplier Ledger
                    </p>
                  </div>
                </div>
              );
            })()}

          {/* ── Insights, tabbed: Sales Trend / Today's Sales / Top Debtors ── */}
          <div className="flex flex-col gap-4">
            <ServiceTypeTabs
              options={insightTabs}
              value={activeTab}
              onChange={(v) => setActiveTab(v as DashboardTab)}
              customColor={TAB_ACCENT[activeTab].hex}
              size="sm"
            />

            <div
              className={`relative bg-slate-800 p-4 rounded-xl border border-slate-700/40 border-l-2 ${TAB_ACCENT[activeTab].borderL} shadow-lg transition-all duration-200 flex flex-col lg:h-[520px] min-h-0 overflow-hidden`}
            >
              <div
                className={`absolute -top-6 -right-6 w-24 h-24 rounded-full blur-3xl opacity-10 pointer-events-none ${TAB_ACCENT[activeTab].glow}`}
              />

              {/* Sales Trend */}
              {activeTab === "trend" && (
                <>
                  <div className="relative flex justify-between items-center mb-3">
                    <h3 className="text-lg font-bold text-white">
                      {chartType} Trend (Last 30 Days)
                    </h3>
                    <Select
                      value={chartType}
                      onChange={(v) => setChartType(v as ChartType)}
                      options={[
                        { value: "Sales", label: "Sales" },
                        { value: "Profit", label: "Profit" },
                      ]}
                      buttonClassName="bg-slate-700 text-xs text-white rounded p-1 border border-slate-600 focus:ring-violet-500 focus:border-violet-500"
                    />
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
                </>
              )}

              {/* Today's Sales */}
              {activeTab === "sales" && (
                <>
                  <div className="relative flex justify-between items-center mb-3">
                    <h3 className="text-md font-bold text-white flex items-center gap-2">
                      <Clock size={16} className="text-blue-400" />
                      Today's Sales
                    </h3>
                    {rowsControl}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <NameAmountTable
                      rows={todaysSales
                        .slice(0, insightRowsLimit || 50)
                        .map((sale) => ({
                          key: sale.id,
                          name: sale.client_name || "Walk-in Client",
                          usd: sale.paid_usd,
                          lbp: sale.paid_lbp,
                        }))}
                      emptyMessage="No sales yet today."
                      formatAmount={formatAmount}
                    />
                  </div>
                </>
              )}

              {/* Top Debtors */}
              {activeTab === "debtors" && debtEnabled && (
                <>
                  <div className="relative flex justify-between items-center mb-3">
                    <h3 className="text-md font-bold text-white flex items-center gap-2">
                      <BarChart2 size={16} className="text-rose-400" />
                      Top Debtors
                    </h3>
                    {rowsControl}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <NameAmountTable
                      rows={debtors
                        .filter((d) => d.total_debt > 0.01)
                        .slice(0, insightRowsLimit || 50)
                        .map((d) => ({
                          key: d.id,
                          name: d.full_name,
                          usd: d.total_debt_usd,
                          lbp: d.total_debt_lbp,
                        }))}
                      emptyMessage="No debtors"
                      formatAmount={formatAmount}
                    />
                  </div>
                </>
              )}
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

      <DrawerCashoutModal
        isOpen={showCashOutModal}
        onClose={() => setShowCashOutModal(false)}
        onSuccess={() => {
          setShowCashOutModal(false);
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
