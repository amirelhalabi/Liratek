import { useState, useEffect, useCallback, useRef } from "react";
import { PageHeader, useApi } from "@liratek/ui";
import {
  TrendingUp,
  DollarSign,
  BarChart2,
  Calendar,
  CreditCard,
  Users,
  UserCheck,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";
import { useCurrencyContext } from "../../../contexts/CurrencyContext";
import { ExportBar } from "@/shared/components/ExportBar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfitSummary {
  period: string;
  sales: {
    revenue_usd: number;
    cost_usd: number;
    profit_usd: number;
    count: number;
  };
  financial_services: {
    revenue_usd: number;
    revenue_lbp: number;
    commission_usd: number;
    commission_lbp: number;
    count: number;
  };
  custom_services: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  maintenance: {
    revenue_usd: number;
    cost_usd: number;
    profit_usd: number;
    count: number;
  };
  expenses: { total_usd: number; total_lbp: number; count: number };
  totals: {
    gross_revenue_usd: number;
    gross_revenue_lbp: number;
    total_cost_usd: number;
    total_cost_lbp: number;
    gross_profit_usd: number;
    gross_profit_lbp: number;
    net_profit_usd: number;
    net_profit_lbp: number;
  };
}

interface ModuleRow {
  module: string;
  label: string;
  revenue_usd: number;
  revenue_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  count: number;
}

interface DateRow {
  date: string;
  revenue_usd: number;
  profit_usd: number;
  profit_lbp: number;
  expenses_usd: number;
  net_profit_usd: number;
  net_profit_lbp: number;
}

interface PaymentMethodRow {
  method: string;
  total_usd: number;
  total_lbp: number;
  count: number;
}

interface UserRow {
  user_id: number;
  username: string;
  revenue_usd: number;
  profit_usd: number;
  transaction_count: number;
}

interface ClientRow {
  client_id: number;
  client_name: string;
  revenue_usd: number;
  profit_usd: number;
  transaction_count: number;
}

type TabKey =
  | "overview"
  | "by-module"
  | "by-date"
  | "by-payment"
  | "by-user"
  | "by-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function formatPct(value: number, total: number): string {
  if (total === 0) return "0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  subValue,
  icon: Icon,
  color,
  trend,
}: {
  label: string;
  value: string;
  subValue?: string | undefined;
  icon: typeof DollarSign;
  color: string;
  trend?: "up" | "down" | "neutral" | undefined;
}) {
  const TrendIcon =
    trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  const trendColor =
    trend === "up"
      ? "text-emerald-400"
      : trend === "down"
        ? "text-red-400"
        : "text-gray-400";

  return (
    <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400 uppercase tracking-wider">
          {label}
        </span>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className="flex items-end gap-2">
        <p className="text-xl font-bold text-white">{value}</p>
        {trend && <TrendIcon className={`h-4 w-4 ${trendColor}`} />}
      </div>
      {subValue && <p className="text-xs text-gray-500 mt-1">{subValue}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function Profits() {
  const api = useApi();
  const { formatAmount } = useCurrencyContext();

  const [tab, setTab] = useState<TabKey>("overview");
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [loading, setLoading] = useState(false);

  // Table refs for export
  const moduleTableRef = useRef<HTMLTableElement>(null);
  const dateTableRef = useRef<HTMLTableElement>(null);
  const paymentTableRef = useRef<HTMLTableElement>(null);
  const cashierTableRef = useRef<HTMLTableElement>(null);
  const clientTableRef = useRef<HTMLTableElement>(null);

  // Data
  const [summary, setSummary] = useState<ProfitSummary | null>(null);
  const [byModule, setByModule] = useState<ModuleRow[]>([]);
  const [byDate, setByDate] = useState<DateRow[]>([]);
  const [byPayment, setByPayment] = useState<PaymentMethodRow[]>([]);
  const [byUser, setByUser] = useState<UserRow[]>([]);
  const [byClient, setByClient] = useState<ClientRow[]>([]);

  // ---------- Fetchers ----------

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const data = window.api
        ? await window.api.profits.summary(from, to)
        : await api.getProfitSummary(from, to);
      setSummary(data);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadByModule = useCallback(async () => {
    setLoading(true);
    try {
      const data = window.api
        ? await window.api.profits.byModule(from, to)
        : await api.getProfitByModule(from, to);
      setByModule(data || []);
    } catch {
      setByModule([]);
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadByDate = useCallback(async () => {
    setLoading(true);
    try {
      const data = window.api
        ? await window.api.profits.byDate(from, to)
        : await api.getProfitByDate(from, to);
      setByDate(data || []);
    } catch {
      setByDate([]);
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadByPayment = useCallback(async () => {
    setLoading(true);
    try {
      const data = window.api
        ? await window.api.profits.byPaymentMethod(from, to)
        : await api.getProfitByPaymentMethod(from, to);
      setByPayment(data || []);
    } catch {
      setByPayment([]);
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadByUser = useCallback(async () => {
    setLoading(true);
    try {
      const data = window.api
        ? await window.api.profits.byUser(from, to)
        : await api.getProfitByUser(from, to);
      setByUser(data || []);
    } catch {
      setByUser([]);
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadByClient = useCallback(async () => {
    setLoading(true);
    try {
      const data = window.api
        ? await window.api.profits.byClient(from, to, 30)
        : await api.getProfitByClient(from, to, 30);
      setByClient(data || []);
    } catch {
      setByClient([]);
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  useEffect(() => {
    if (tab === "overview") loadSummary();
    else if (tab === "by-module") loadByModule();
    else if (tab === "by-date") loadByDate();
    else if (tab === "by-payment") loadByPayment();
    else if (tab === "by-user") loadByUser();
    else if (tab === "by-client") loadByClient();
  }, [
    tab,
    loadSummary,
    loadByModule,
    loadByDate,
    loadByPayment,
    loadByUser,
    loadByClient,
  ]);

  // ---------- Tabs ----------

  const tabs: { key: TabKey; label: string; icon: typeof TrendingUp }[] = [
    { key: "overview", label: "Overview", icon: TrendingUp },
    { key: "by-module", label: "By Module", icon: BarChart2 },
    { key: "by-date", label: "By Date", icon: Calendar },
    { key: "by-payment", label: "By Payment", icon: CreditCard },
    { key: "by-user", label: "By Cashier", icon: UserCheck },
    { key: "by-client", label: "By Client", icon: Users },
  ];

  // ---------- Render ----------

  return (
    <div className="p-6 space-y-6">
      <PageHeader icon={TrendingUp} title="Profits" />

      {/* Tab bar + date range */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex bg-gray-800 rounded-lg p-1 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-gray-400">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
          />
          <label className="text-xs text-gray-400">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
          />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      )}

      {/* ==================== Overview Tab ==================== */}
      {!loading && tab === "overview" && !summary && (
        <div className="text-center py-12 text-gray-500">
          No data for this period
        </div>
      )}
      {!loading && tab === "overview" && summary && (
        <div className="space-y-6">
          {/* Top-level KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              label="Net Profit (USD)"
              value={formatAmount(summary.totals.net_profit_usd, "USD")}
              subValue={`Gross: ${formatAmount(summary.totals.gross_profit_usd, "USD")}`}
              icon={DollarSign}
              color="text-emerald-400"
              trend={
                summary.totals.net_profit_usd > 0
                  ? "up"
                  : summary.totals.net_profit_usd < 0
                    ? "down"
                    : "neutral"
              }
            />
            <SummaryCard
              label="Net Profit (LBP)"
              value={formatAmount(summary.totals.net_profit_lbp, "LBP")}
              icon={DollarSign}
              color="text-blue-400"
              trend={
                summary.totals.net_profit_lbp > 0
                  ? "up"
                  : summary.totals.net_profit_lbp < 0
                    ? "down"
                    : "neutral"
              }
            />
            <SummaryCard
              label="Total Revenue"
              value={formatAmount(summary.totals.gross_revenue_usd, "USD")}
              subValue={
                summary.totals.gross_revenue_lbp > 0
                  ? formatAmount(summary.totals.gross_revenue_lbp, "LBP")
                  : undefined
              }
              icon={TrendingUp}
              color="text-blue-400"
            />
            <SummaryCard
              label="Total Expenses"
              value={formatAmount(summary.expenses.total_usd, "USD")}
              subValue={
                summary.expenses.total_lbp > 0
                  ? formatAmount(summary.expenses.total_lbp, "LBP")
                  : undefined
              }
              icon={ArrowDownRight}
              color="text-red-400"
            />
          </div>

          {/* Module breakdown cards */}
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Breakdown by Source
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Sales */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">
                  Product Sales
                </span>
                <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                  {summary.sales.count} sales
                </span>
              </div>
              <div className="text-xs text-gray-400 space-y-1">
                <div className="flex justify-between">
                  <span>Revenue</span>
                  <span className="text-white">
                    {formatAmount(summary.sales.revenue_usd, "USD")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Cost</span>
                  <span className="text-red-400">
                    -{formatAmount(summary.sales.cost_usd, "USD")}
                  </span>
                </div>
                <div className="flex justify-between border-t border-gray-700 pt-1">
                  <span className="font-semibold">Profit</span>
                  <span className="text-emerald-400 font-semibold">
                    {formatAmount(summary.sales.profit_usd, "USD")}
                  </span>
                </div>
              </div>
            </div>

            {/* Financial Services */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">
                  Financial Services
                </span>
                <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
                  {summary.financial_services.count} txns
                </span>
              </div>
              <div className="text-xs text-gray-400 space-y-1">
                <div className="flex justify-between">
                  <span>Revenue (USD)</span>
                  <span className="text-white">
                    {formatAmount(
                      summary.financial_services.revenue_usd,
                      "USD",
                    )}
                  </span>
                </div>
                {summary.financial_services.revenue_lbp > 0 && (
                  <div className="flex justify-between">
                    <span>Revenue (LBP)</span>
                    <span className="text-white">
                      {formatAmount(
                        summary.financial_services.revenue_lbp,
                        "LBP",
                      )}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-gray-700 pt-1">
                  <span className="font-semibold">Commission</span>
                  <span className="text-emerald-400 font-semibold">
                    {formatAmount(
                      summary.financial_services.commission_usd,
                      "USD",
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Custom Services */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">
                  Custom Services
                </span>
                <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
                  {summary.custom_services.count} jobs
                </span>
              </div>
              <div className="text-xs text-gray-400 space-y-1">
                <div className="flex justify-between">
                  <span>Revenue</span>
                  <span className="text-white">
                    {formatAmount(summary.custom_services.revenue_usd, "USD")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Cost</span>
                  <span className="text-red-400">
                    -{formatAmount(summary.custom_services.cost_usd, "USD")}
                  </span>
                </div>
                <div className="flex justify-between border-t border-gray-700 pt-1">
                  <span className="font-semibold">Profit</span>
                  <span className="text-emerald-400 font-semibold">
                    {formatAmount(summary.custom_services.profit_usd, "USD")}
                  </span>
                </div>
              </div>
            </div>

            {/* Maintenance */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">
                  Maintenance
                </span>
                <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                  {summary.maintenance.count} jobs
                </span>
              </div>
              <div className="text-xs text-gray-400 space-y-1">
                <div className="flex justify-between">
                  <span>Revenue</span>
                  <span className="text-white">
                    {formatAmount(summary.maintenance.revenue_usd, "USD")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Cost</span>
                  <span className="text-red-400">
                    -{formatAmount(summary.maintenance.cost_usd, "USD")}
                  </span>
                </div>
                <div className="flex justify-between border-t border-gray-700 pt-1">
                  <span className="font-semibold">Profit</span>
                  <span className="text-emerald-400 font-semibold">
                    {formatAmount(summary.maintenance.profit_usd, "USD")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Expense breakdown */}
          <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-white">
                Expenses Deducted
              </span>
              <span className="text-xs text-gray-400">
                {summary.expenses.count} entries
              </span>
            </div>
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-gray-400">USD: </span>
                <span className="text-red-400 font-semibold">
                  -{formatAmount(summary.expenses.total_usd, "USD")}
                </span>
              </div>
              {summary.expenses.total_lbp > 0 && (
                <div>
                  <span className="text-gray-400">LBP: </span>
                  <span className="text-red-400 font-semibold">
                    -{formatAmount(summary.expenses.total_lbp, "LBP")}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== By Module Tab ==================== */}
      {!loading && tab === "by-module" && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
          <ExportBar
            exportExcel
            exportPdf
            exportFilename="profit-by-module"
            tableRef={moduleTableRef}
            rowCount={byModule.length}
          />
          <table ref={moduleTableRef} className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
                <th className="text-left px-4 py-3">Module</th>
                <th className="text-right px-4 py-3">Revenue (USD)</th>
                <th className="text-right px-4 py-3">Revenue (LBP)</th>
                <th className="text-right px-4 py-3">Profit (USD)</th>
                <th className="text-right px-4 py-3">Profit (LBP)</th>
                <th className="text-right px-4 py-3">Count</th>
                <th className="text-right px-4 py-3">Margin</th>
              </tr>
            </thead>
            <tbody>
              {byModule.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-500">
                    No data for this period
                  </td>
                </tr>
              )}
              {byModule.map((row) => (
                <tr
                  key={row.module}
                  className="border-b border-gray-700/50 hover:bg-gray-700/30"
                >
                  <td className="px-4 py-3 font-medium text-white">
                    {row.label}
                  </td>
                  <td className="px-4 py-3 text-right text-white">
                    {formatAmount(row.revenue_usd, "USD")}
                  </td>
                  <td className="px-4 py-3 text-right text-white">
                    {row.revenue_lbp > 0
                      ? formatAmount(row.revenue_lbp, "LBP")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">
                    {formatAmount(row.profit_usd, "USD")}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-400">
                    {row.profit_lbp > 0
                      ? formatAmount(row.profit_lbp, "LBP")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {row.count}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {formatPct(row.profit_usd, row.revenue_usd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ==================== By Date Tab ==================== */}
      {!loading && tab === "by-date" && (
        <div className="space-y-4">
          {/* Visual bar chart */}
          {byDate.length > 0 && (
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">
                Daily Net Profit (USD)
              </h3>
              <div className="flex items-end gap-1 h-40">
                {(() => {
                  const maxVal = Math.max(
                    ...byDate.map((d) => Math.abs(d.net_profit_usd)),
                    1,
                  );
                  return byDate.map((d) => {
                    const pct = Math.abs(d.net_profit_usd) / maxVal;
                    const isPositive = d.net_profit_usd >= 0;
                    return (
                      <div
                        key={d.date}
                        className="flex-1 flex flex-col justify-end items-center group relative"
                      >
                        <div
                          className={`w-full rounded-t ${
                            isPositive ? "bg-emerald-500/70" : "bg-red-500/70"
                          }`}
                          style={{
                            height: `${Math.max(pct * 100, 2)}%`,
                            minHeight: "2px",
                          }}
                        />
                        {/* Tooltip */}
                        <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white whitespace-nowrap z-10">
                          {d.date}: {formatAmount(d.net_profit_usd, "USD")}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                <span>{byDate[0]?.date}</span>
                <span>{byDate[byDate.length - 1]?.date}</span>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
            <ExportBar
              exportExcel
              exportPdf
              exportFilename="profit-by-date"
              tableRef={dateTableRef}
              rowCount={byDate.length}
            />
            <table ref={dateTableRef} className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-right px-4 py-3">Revenue</th>
                  <th className="text-right px-4 py-3">Gross Profit</th>
                  <th className="text-right px-4 py-3">Expenses</th>
                  <th className="text-right px-4 py-3">Net Profit</th>
                </tr>
              </thead>
              <tbody>
                {byDate.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-gray-500">
                      No data for this period
                    </td>
                  </tr>
                )}
                {byDate.map((d) => (
                  <tr
                    key={d.date}
                    className="border-b border-gray-700/50 hover:bg-gray-700/30"
                  >
                    <td className="px-4 py-3 font-medium text-white">
                      {d.date}
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {formatAmount(d.revenue_usd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400">
                      {formatAmount(d.profit_usd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-red-400">
                      {d.expenses_usd > 0
                        ? `-${formatAmount(d.expenses_usd, "USD")}`
                        : "—"}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${
                        d.net_profit_usd >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {formatAmount(d.net_profit_usd, "USD")}
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                {byDate.length > 0 && (
                  <tr className="border-t-2 border-gray-600 bg-gray-800/80 font-bold">
                    <td className="px-4 py-3 text-white">TOTAL</td>
                    <td className="px-4 py-3 text-right text-white">
                      {formatAmount(
                        byDate.reduce((s, d) => s + d.revenue_usd, 0),
                        "USD",
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400">
                      {formatAmount(
                        byDate.reduce((s, d) => s + d.profit_usd, 0),
                        "USD",
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-red-400">
                      -
                      {formatAmount(
                        byDate.reduce((s, d) => s + d.expenses_usd, 0),
                        "USD",
                      )}
                    </td>
                    <td
                      className={`px-4 py-3 text-right ${
                        byDate.reduce((s, d) => s + d.net_profit_usd, 0) >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {formatAmount(
                        byDate.reduce((s, d) => s + d.net_profit_usd, 0),
                        "USD",
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== By Payment Method Tab ==================== */}
      {!loading && tab === "by-payment" && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
          <ExportBar
            exportExcel
            exportPdf
            exportFilename="profit-by-payment"
            tableRef={paymentTableRef}
            rowCount={byPayment.length}
          />
          <table ref={paymentTableRef} className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
                <th className="text-left px-4 py-3">Payment Method</th>
                <th className="text-right px-4 py-3">Total (USD)</th>
                <th className="text-right px-4 py-3">Total (LBP)</th>
                <th className="text-right px-4 py-3">Count</th>
                <th className="text-right px-4 py-3">Share</th>
              </tr>
            </thead>
            <tbody>
              {byPayment.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-500">
                    No payment data for this period
                  </td>
                </tr>
              )}
              {byPayment.map((row) => {
                const totalAll = byPayment.reduce((s, r) => s + r.total_usd, 0);
                return (
                  <tr
                    key={row.method}
                    className="border-b border-gray-700/50 hover:bg-gray-700/30"
                  >
                    <td className="px-4 py-3 font-medium text-white">
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-gray-400" />
                        {row.method}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {formatAmount(row.total_usd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {row.total_lbp > 0
                        ? formatAmount(row.total_lbp, "LBP")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {row.count}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-gray-700 rounded-full h-1.5">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full"
                            style={{
                              width: `${totalAll > 0 ? (row.total_usd / totalAll) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <span className="text-gray-300 text-xs w-10 text-right">
                          {formatPct(row.total_usd, totalAll)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ==================== By User/Cashier Tab ==================== */}
      {!loading && tab === "by-user" && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
          <ExportBar
            exportExcel
            exportPdf
            exportFilename="profit-by-cashier"
            tableRef={cashierTableRef}
            rowCount={byUser.length}
          />
          <table ref={cashierTableRef} className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
                <th className="text-left px-4 py-3">Cashier</th>
                <th className="text-right px-4 py-3">Revenue (USD)</th>
                <th className="text-right px-4 py-3">Profit (USD)</th>
                <th className="text-right px-4 py-3">Transactions</th>
                <th className="text-right px-4 py-3">Avg Profit/Txn</th>
              </tr>
            </thead>
            <tbody>
              {byUser.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-500">
                    No data for this period
                  </td>
                </tr>
              )}
              {byUser.map((row) => (
                <tr
                  key={row.user_id}
                  className="border-b border-gray-700/50 hover:bg-gray-700/30"
                >
                  <td className="px-4 py-3 font-medium text-white">
                    <div className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-gray-400" />
                      {row.username}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-white">
                    {formatAmount(row.revenue_usd, "USD")}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">
                    {formatAmount(row.profit_usd, "USD")}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {row.transaction_count}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {row.transaction_count > 0
                      ? formatAmount(
                          row.profit_usd / row.transaction_count,
                          "USD",
                        )
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ==================== By Client Tab ==================== */}
      {!loading && tab === "by-client" && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
          <ExportBar
            exportExcel
            exportPdf
            exportFilename="profit-by-client"
            tableRef={clientTableRef}
            rowCount={byClient.length}
          />
          <table ref={clientTableRef} className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
                <th className="text-left px-4 py-3">#</th>
                <th className="text-left px-4 py-3">Client</th>
                <th className="text-right px-4 py-3">Revenue (USD)</th>
                <th className="text-right px-4 py-3">Profit (USD)</th>
                <th className="text-right px-4 py-3">Transactions</th>
              </tr>
            </thead>
            <tbody>
              {byClient.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-500">
                    No data for this period
                  </td>
                </tr>
              )}
              {byClient.map((row, i) => (
                <tr
                  key={row.client_id ?? `walk-in-${i}`}
                  className="border-b border-gray-700/50 hover:bg-gray-700/30"
                >
                  <td className="px-4 py-3 text-gray-500 text-xs">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-white">
                    {row.client_name}
                  </td>
                  <td className="px-4 py-3 text-right text-white">
                    {formatAmount(row.revenue_usd, "USD")}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">
                    {formatAmount(row.profit_usd, "USD")}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {row.transaction_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
