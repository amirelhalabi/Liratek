import { useState, useEffect } from "react";
import {
  DollarSign,
  Users,
  TrendingUp,
  Clock,
  Inbox,
  BarChart2,
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
import { appEvents } from "../../../shared/utils/appEvents";
type ChartType = "Sales" | "Profit";

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalSalesUSD: 0,
    totalSalesLBP: 0,
    ordersCount: 0,
    activeClients: 0,
    stockBudgetUSD: 0,
    stockCount: 0,
    virtualStockCredits: 0,
  });
  const [drawerBalances, setDrawerBalances] = useState({
    generalDrawer: { usd: 0, lbp: 0 },
    omtDrawer: { usd: 0, lbp: 0 },
  });
  const [chartData, setChartData] = useState<any[]>([]);
  const [todaysSales, setTodaysSales] = useState<any[]>([]);
  const [debtSummary, setDebtSummary] = useState<{
    totalDebt: number;
    topDebtors: any[];
  }>({ totalDebt: 0, topDebtors: [] });
  const [chartType, setChartType] = useState<ChartType>("Sales");

  // State for dynamic Y-axis domains
  const [maxUsdSales, setMaxUsdSales] = useState(0);
  const [maxLbpSales, setMaxLbpSales] = useState(0);

  const loadData = async () => {
    try {
      const [
        statsData,
        profitChartData,
        salesTodayData,
        drawerData,
        debtData,
        stockStats,
        rechargeStock,
      ] = await Promise.all([
        window.api.getDashboardStats(),
        window.api.getProfitSalesChart(chartType),
        window.api.getTodaysSales(),
        window.api.getDrawerBalances(),
        window.api.getDebtSummary(),
        window.api.getInventoryStockStats(),
        window.api.getRechargeStock(),
      ]);

      setStats({
        ...statsData,
        stockBudgetUSD: stockStats?.stock_budget_usd || 0,
        stockCount: stockStats?.stock_count || 0,
        virtualStockCredits:
          (rechargeStock?.mtc || 0) + (rechargeStock?.alfa || 0),
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

      // Calculate max values for Y-axis domain
      if (chartType === "Sales" && formattedChartData.length > 0) {
        const currentMaxUsd = Math.max(
          ...formattedChartData.map((d: any) => d.usd),
        );
        const currentMaxLbp = Math.max(
          ...formattedChartData.map((d: any) => d.lbp),
        );

        // Round up USD to the next thousand
        setMaxUsdSales(Math.ceil(currentMaxUsd / 1000) * 1000);

        // Round up LBP to the next million
        setMaxLbpSales(Math.ceil(currentMaxLbp / 1_000_000) * 1_000_000);
      }
    } catch (error) {
      // console.error('Failed to load dashboard data:', error);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // 30s refresh

    // Subscribe to refresh events
    const unsubscribe = appEvents.on("sale:completed", () => {
      console.log("[DASHBOARD] Sale completed, refreshing stats...");
      loadData();
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [chartType]);

  const statCards = [
    {
      label: "Total Sales (Today)",
      value: `${stats.totalSalesUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      secondaryValue: `${stats.totalSalesLBP.toLocaleString()} LBP`,
      icon: DollarSign,
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
    },
    {
      label: "Orders Processed",
      value: stats.ordersCount.toString(),
      icon: DollarSign,
      color: "text-blue-400",
      bg: "bg-blue-400/10",
    },
    {
      label: "Total Debt",
      value: `${debtSummary.totalDebt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      icon: Users,
      color: "text-red-400",
      bg: "bg-red-400/10",
    },
    {
      label: "Stock Budget (USD)",
      value: `$${stats.stockBudgetUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      icon: BarChart2,
      color: "text-amber-400",
      bg: "bg-amber-400/10",
    },
    {
      label: "Stock Count",
      value: `${stats.stockCount.toLocaleString()}`,
      icon: Inbox,
      color: "text-teal-400",
      bg: "bg-teal-400/10",
    },
    {
      label: "Virtual Stock (MTC+Alfa Credits)",
      value: `${stats.virtualStockCredits.toLocaleString()}`,
      icon: Inbox,
      color: "text-indigo-400",
      bg: "bg-indigo-400/10",
    },
    {
      label: "General Drawer",
      value: `${drawerBalances.generalDrawer.usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      secondaryValue: `${drawerBalances.generalDrawer.lbp.toLocaleString()} LBP`,
      icon: Inbox,
      color: "text-sky-400",
      bg: "bg-sky-400/10",
    },
    {
      label: "OMT Drawer",
      value: `${drawerBalances.omtDrawer.usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      secondaryValue: `${drawerBalances.omtDrawer.lbp.toLocaleString()} LBP`,
      icon: Inbox,
      color: "text-rose-400",
      bg: "bg-rose-400/10",
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <TrendingUp className="text-violet-500" />
        Dashboard
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((stat) => (
          <div
            key={stat.label}
            className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors"
          >
            <div className="flex items-center justify-between mb-3">
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
            </div>
            <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
              {stat.label}
            </h3>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
              {stat.secondaryValue && (
                <p className="text-sm font-semibold text-slate-400">
                  {stat.secondaryValue}
                </p>
              )}
            </div>
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
                      tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
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
                    tickFormatter={(value) => `${value}`}
                  />
                )}
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(30, 41, 59, 0.9)",
                    borderColor: "#475569",
                    color: "#cbd5e1",
                  }}
                  labelStyle={{ fontWeight: "bold" }}
                  formatter={(value: any, name: any) => {
                    if (name === "LBP Sales") {
                      return [`${value.toLocaleString()} LBP`, name];
                    }
                    return [
                      `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                      name,
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

        <div className="space-y-6">
          <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg">
            <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2">
              <BarChart2 size={16} className="text-red-400" />
              Top Debtors
            </h3>
            <div className="h-40">
              <ResponsiveContainer width="100%" height={160}>
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
                    formatter={(value: any) =>
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

          <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg">
            <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2">
              <Clock size={16} className="text-blue-400" />
              Today's Sales
            </h3>
            <div className="space-y-3">
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
    </div>
  );
}
