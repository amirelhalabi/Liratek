import { useState, useEffect, useCallback } from "react";
import { appEvents } from "../../../shared/utils/appEvents";
import {
  DollarSign,
  Users,
  TrendingUp,
  Clock,
  Inbox,
  BarChart2,
  Package,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
type ChartType = "Sales" | "Profit";

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalSalesUSD: 0,
    totalSalesLBP: 0,
    cashCollectedUSD: 0,
    cashCollectedLBP: 0,
    ordersCount: 0,
    activeClients: 0,
    stockBudgetUSD: 0,
    stockCount: 0,
    mtcCredits: 0,
    alfaCredits: 0,
    monthlyNetProfit: 0,
  });
  const [drawerBalances, setDrawerBalances] = useState({
    generalDrawer: { usd: 0, lbp: 0 },
    omtDrawer: { usd: 0, lbp: 0 },
  });
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
    topDebtors: { full_name: string; total_debt: number }[];
  };
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [todaysSales, setTodaysSales] = useState<TodaySale[]>([]);
  const [debtSummary, setDebtSummary] = useState<DebtSummary>({
    totalDebt: 0,
    topDebtors: [],
  });
  const [chartType, setChartType] = useState<ChartType>("Sales");

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
        rechargeStock,
        monthlyPL,
      ] = window.api
        ? await Promise.all([
            window.api.getDashboardStats(),
            window.api.getProfitSalesChart(chartType),
            window.api.getTodaysSales(),
            window.api.getDrawerBalances(),
            window.api.getDebtSummary(),
            window.api.getInventoryStockStats(),
            window.api.getRechargeStock(),
            window.api.getMonthlyPL(new Date().toISOString().slice(0, 7)),
          ])
        : await (async () => {
            const api = await import("../../../api/backendApi");
            return Promise.all([
              api.getDashboardStats(),
              api.getProfitSalesChart(chartType),
              api.getTodaysSales(),
              api.getDrawerBalances(),
              api.getDebtSummary(),
              api.getInventoryStockStats(),
              api.getRechargeStock(),
              api.getMonthlyPL(new Date().toISOString().slice(0, 7)),
            ]);
          })();

      setStats({
        ...statsData,
        stockBudgetUSD: stockStats?.stock_budget_usd || 0,
        stockCount: stockStats?.stock_count || 0,
        mtcCredits: rechargeStock?.mtc || 0,
        alfaCredits: rechargeStock?.alfa || 0,
        monthlyNetProfit: monthlyPL?.netProfitUSD || 0,
      });
      const formattedChartData = profitChartData.map((d) => ({
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

      // Calculate max values for Y-axis domain
      if (chartType === "Sales" && formattedChartData.length > 0) {
        const currentMaxUsd = Math.max(
          ...formattedChartData.map((d) => d.usd || 0),
        );
        const currentMaxLbp = Math.max(
          ...formattedChartData.map((d) => d.lbp || 0),
        );

        // Round up USD to the next thousand
        setMaxUsdSales(Math.ceil(currentMaxUsd / 1000) * 1000);

        // Round up LBP to the next million
        setMaxLbpSales(Math.ceil(currentMaxLbp / 1_000_000) * 1_000_000);
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    }
  }, [chartType]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadData();
    }, 0);
    const interval = setInterval(loadData, 30000); // 30s refresh

    // Subscribe to refresh events
    const unsubscribe = appEvents.on("sale:completed", () => {
      console.log("[DASHBOARD] Sale completed, refreshing stats...");
      loadData();
    });

    return () => {
      clearTimeout(t);
      clearInterval(interval);
      unsubscribe();
    };
  }, [loadData]);

  // Financial Metrics (Row 1)
  const financialCards = [
    {
      label: "Sales Revenue (Today)",
      usdValue: stats.totalSalesUSD,
      lbpValue: stats.totalSalesLBP,
      icon: DollarSign,
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
    },
    {
      label: "Cash Collected (Today)",
      usdValue: stats.cashCollectedUSD,
      lbpValue: stats.cashCollectedLBP,
      icon: DollarSign,
      color: "text-green-400",
      bg: "bg-green-400/10",
    },
    {
      label: "Orders Processed",
      singleValue: stats.ordersCount.toString(),
      icon: DollarSign,
      color: "text-blue-400",
      bg: "bg-blue-400/10",
    },
    {
      label: "Total Debt",
      singleValue: `$${debtSummary.totalDebt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      icon: Users,
      color: "text-red-400",
      bg: "bg-red-400/10",
    },
  ];

  // Drawer Balances (Row 2)
  const drawerCards = [
    {
      label: "General Drawer",
      usdValue: drawerBalances.generalDrawer.usd,
      lbpValue: drawerBalances.generalDrawer.lbp,
      icon: Inbox,
      color: "text-sky-400",
      bg: "bg-sky-400/10",
    },
    {
      label: "OMT Drawer",
      usdValue: drawerBalances.omtDrawer.usd,
      lbpValue: drawerBalances.omtDrawer.lbp,
      icon: Inbox,
      color: "text-rose-400",
      bg: "bg-rose-400/10",
    },
    {
      label: "MTC Credits",
      singleValue: `$${stats.mtcCredits?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || "0"}`,
      icon: Inbox,
      color: "text-purple-400",
      bg: "bg-purple-400/10",
    },
    {
      label: "Alfa Credits",
      singleValue: `$${stats.alfaCredits?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || "0"}`,
      icon: Inbox,
      color: "text-pink-400",
      bg: "bg-pink-400/10",
    },
  ];

  // Stock Overview
  const stockCards = [
    {
      label: "Stock Budget",
      singleValue: `$${stats.stockBudgetUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      icon: BarChart2,
      color: "text-amber-400",
      bg: "bg-amber-400/10",
    },
    {
      label: "Stock Count",
      singleValue: `${stats.stockCount.toLocaleString()} items`,
      icon: Package,
      color: "text-teal-400",
      bg: "bg-teal-400/10",
    },
  ];

  return (
    <>
      <div className="space-y-6 animate-in fade-in duration-500">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <TrendingUp className="text-violet-500" />
          Dashboard
        </h1>

        {/* Financial Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {financialCards.map((stat) => (
            <div
              key={stat.label}
              className="bg-slate-800 p-4 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-lg ${stat.bg}`}>
                  <stat.icon className={`w-4 h-4 ${stat.color}`} />
                </div>
              </div>
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
                      $
                      {stat.usdValue.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </p>
                  </div>
                  <div className="flex-1">
                    <p className="text-base font-bold text-violet-400">
                      {stat.lbpValue.toLocaleString()} LBP
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Drawer Balances */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {drawerCards.map((stat) => (
            <div
              key={stat.label}
              className="bg-slate-800 p-4 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-lg ${stat.bg}`}>
                  <stat.icon className={`w-4 h-4 ${stat.color}`} />
                </div>
              </div>
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
                      $
                      {stat.usdValue.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </p>
                  </div>
                  <div className="flex-1">
                    <p className="text-base font-bold text-violet-400">
                      {stat.lbpValue.toLocaleString()} LBP
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <DollarSign size={18} className="text-emerald-400" />
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
            <div className="flex-1 h-80 w-full min-h-0">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart
                  data={chartData}
                  margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#94a3b8" }}
                    fontSize={12}
                  />
                  {chartType === "Sales" ? (
                    <>
                      <YAxis
                        yAxisId="left"
                        orientation="left"
                        stroke="#34d399"
                        tick={{ fill: "#34d399" }}
                        fontSize={12}
                        tickFormatter={(value) =>
                          `${(value / 1000).toFixed(0)}k`
                        }
                        domain={[0, maxUsdSales > 0 ? maxUsdSales : "auto"]} // Dynamic domain for USD
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        stroke="#8b5cf6"
                        tick={{ fill: "#8b5cf6" }}
                        fontSize={12}
                        tickFormatter={(value) =>
                          `${(value / 1_000_000).toFixed(1)}M`
                        } // Show in millions of LBP
                        domain={[0, maxLbpSales > 0 ? maxLbpSales : "auto"]} // Dynamic domain for LBP
                      />
                    </>
                  ) : (
                    <YAxis
                      tick={{ fill: "#94a3b8" }}
                      fontSize={12}
                      tickFormatter={(value) => `$${value}`}
                    />
                  )}
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(30, 41, 59, 0.9)",
                      borderColor: "#475569",
                      color: "#cbd5e1",
                    }}
                    labelStyle={{ fontWeight: "bold" }}
                    formatter={(
                      value: number | string | undefined,
                      name?: string,
                    ) => {
                      const valNum =
                        typeof value === "number" ? value : Number(value ?? 0);
                      const label = name ?? "";
                      if (label === "LBP Sales") {
                        return [`${valNum.toLocaleString()} LBP`, label];
                      }
                      if (label === "Profit") {
                        return [
                          `$${valNum.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                          label,
                        ];
                      }
                      return [
                        `${valNum.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                        label,
                      ];
                    }}
                  />
                  <Legend />
                  {chartType === "Sales" ? (
                    <>
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="usd"
                        name="USD Sales"
                        stroke="#34d399"
                        strokeWidth={2}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="lbp"
                        name="LBP Sales"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                      />
                    </>
                  ) : (
                    <Line
                      type="monotone"
                      dataKey="profit"
                      name="Profit"
                      stroke="#34d399"
                      strokeWidth={2}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex flex-col h-full gap-4">
            <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg flex-1 flex flex-col">
              <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2">
                <BarChart2 size={16} className="text-red-400" />
                Top Debtors
              </h3>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={debtSummary.topDebtors}
                    layout="vertical"
                    margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
                  >
                    <XAxis type="number" hide />
                    <YAxis
                      dataKey="full_name"
                      type="category"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#a1a1aa", fontSize: 12 }}
                      width={80}
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(156, 163, 175, 0.1)" }}
                      formatter={(value) =>
                        typeof value === "number"
                          ? `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          : value
                      }
                      contentStyle={{
                        backgroundColor: "rgba(30, 41, 59, 0.9)",
                        borderColor: "#475569",
                      }}
                    />
                    <Bar
                      dataKey="total_debt"
                      name="Debt"
                      fill="#ef4444"
                      barSize={10}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg flex-1 flex flex-col">
              <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2">
                <Clock size={16} className="text-blue-400" />
                Today's Sales
              </h3>
              <div className="space-y-3 overflow-y-auto flex-1">
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
                            +${sale.paid_usd.toFixed(2)}
                          </p>
                        )}
                        {sale.paid_lbp > 0 && (
                          <p className="text-sky-400 font-semibold text-xs">
                            +{sale.paid_lbp.toLocaleString()} LBP
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

        {/* Stock Overview */}
        <div>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Package className="text-amber-400" />
            Stock Overview
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stockCards.map((stat) => (
              <div
                key={stat.label}
                className="bg-slate-800 p-4 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className={`p-2 rounded-lg ${stat.bg}`}>
                    <stat.icon className={`w-4 h-4 ${stat.color}`} />
                  </div>
                </div>
                <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-2">
                  {stat.label}
                </h3>
                {stat.singleValue && (
                  <p className="text-xl font-bold text-white">
                    {stat.singleValue}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
