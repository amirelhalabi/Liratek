import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import {
  PageHeader,
  useApi,
  DateRangeFilter,
  daysAgoISO,
  todayISO,
} from "@liratek/ui";
import { useModules } from "@/contexts/ModuleContext";
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
  Clock,
  PieChart as PieChartIcon,
  Activity,
} from "lucide-react";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { DataTable } from "@liratek/ui";

const CommissionsChart = lazy(
  () => import("../../dashboard/components/CommissionsChart"),
);

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
  recharges: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
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
  pending_commission_usd?: number;
  is_settled?: number;
  is_debt_repayment_only?: number;
}

interface UserRow {
  user_id: number;
  username: string;
  revenue_usd: number;
  profit_usd: number;
  transaction_count: number;
  pending_profit_usd: number;
}

interface ClientRow {
  client_id: number | null;
  client_name: string;
  client_phone: string | null;
  revenue_usd: number;
  profit_usd: number;
  transaction_count: number;
  pending_profit_usd: number;
}

type TabKey =
  | "overview"
  | "by-module"
  | "by-date"
  | "by-payment"
  | "by-user"
  | "by-client"
  | "pending"
  | "commissions";

interface ProviderStats {
  provider: string;
  commission: number;
  currency: string;
  count: number;
}

interface CommissionsAnalytics {
  today: { commission: number; pending_commission: number; count: number };
  month: { commission: number; pending_commission: number; count: number };
  byProvider: ProviderStats[];
}

interface UnsettledProviderSummary {
  provider: string;
  count: number;
  pending_commission_usd: number;
  pending_commission_lbp: number;
  total_owed_usd: number;
  total_owed_lbp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  const { isModuleEnabled } = useModules();
  const commissionsEnabled =
    isModuleEnabled("services") ||
    isModuleEnabled("recharge") ||
    isModuleEnabled("binance") ||
    isModuleEnabled("ipec_katch");

  const [tab, setTab] = useState<TabKey>("overview");
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [loading, setLoading] = useState(false);

  // Data
  const [summary, setSummary] = useState<ProfitSummary | null>(null);
  const [byModule, setByModule] = useState<ModuleRow[]>([]);
  const [byDate, setByDate] = useState<DateRow[]>([]);
  const [byPayment, setByPayment] = useState<PaymentMethodRow[]>([]);
  const [byUser, setByUser] = useState<UserRow[]>([]);
  const [byClient, setByClient] = useState<ClientRow[]>([]);
  const [commissionsData, setCommissionsData] =
    useState<CommissionsAnalytics | null>(null);
  const [unsettledByProvider, setUnsettledByProvider] = useState<
    UnsettledProviderSummary[]
  >([]);
  const [pendingData, setPendingData] = useState<{
    rows: {
      sale_id: number;
      created_at: string;
      client_name: string;
      client_phone: string;
      total_amount_usd: number;
      paid_usd: number;
      outstanding_usd: number;
      potential_profit_usd: number;
      items_summary: string;
    }[];
    totals: {
      total_outstanding_usd: number;
      total_pending_profit_usd: number;
      count: number;
    };
    unsettled_commissions: {
      id: number;
      provider: string;
      omt_service_type: string | null;
      amount: number;
      currency: string;
      commission: number;
      omt_fee: number | null;
      created_at: string;
    }[];
    unsettled_totals: {
      total_pending_commission_usd: number;
      total_pending_commission_lbp: number;
      count: number;
    };
  } | null>(null);

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

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const data = window.api
        ? await window.api.profits.pending(from, to)
        : await api.getPendingProfit(from, to);
      setPendingData(data || null);
    } catch {
      setPendingData(null);
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadCommissions = useCallback(async () => {
    setLoading(true);
    try {
      const [data, unsettled] = await Promise.all([
        window.api ? window.api.omt.getAnalytics() : api.getOMTAnalytics(),
        window.api
          ? window.api.suppliers.getUnsettledSummary()
          : ((api as any).getUnsettledSummary?.() ?? []),
      ]);
      setCommissionsData(data);
      setUnsettledByProvider(unsettled || []);
    } catch {
      setCommissionsData(null);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (tab === "overview") loadSummary();
    else if (tab === "by-module") loadByModule();
    else if (tab === "by-date") loadByDate();
    else if (tab === "by-payment") loadByPayment();
    else if (tab === "by-user") loadByUser();
    else if (tab === "by-client") loadByClient();
    else if (tab === "pending") loadPending();
    else if (tab === "commissions") loadCommissions();
  }, [
    tab,
    loadSummary,
    loadByModule,
    loadByDate,
    loadByPayment,
    loadByUser,
    loadByClient,
    loadPending,
    loadCommissions,
  ]);

  // ---------- Tabs ----------

  const tabs: { key: TabKey; label: string; icon: typeof TrendingUp }[] = [
    { key: "overview", label: "Overview", icon: TrendingUp },
    { key: "by-module", label: "By Module", icon: BarChart2 },
    { key: "by-date", label: "By Date", icon: Calendar },
    { key: "by-payment", label: "By Payment", icon: CreditCard },
    { key: "by-user", label: "By Cashier", icon: UserCheck },
    { key: "by-client", label: "By Client", icon: Users },
    { key: "pending", label: "Pending Profit", icon: Clock },
    // Only show Commissions tab when a commission-generating module is enabled
    ...(commissionsEnabled
      ? [{ key: "commissions" as TabKey, label: "Commissions", icon: Activity }]
      : []),
  ];

  // ---------- Render ----------

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
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

        <DateRangeFilter
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
          className="ml-auto"
        />
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 min-h-0 overflow-auto space-y-6">
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

              {/* Recharges */}
              {summary.recharges && summary.recharges.count > 0 && (
                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">
                      Mobile Recharges
                    </span>
                    <span className="text-xs bg-teal-500/20 text-teal-400 px-2 py-0.5 rounded-full">
                      {summary.recharges.count} txns
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 space-y-1">
                    <div className="flex justify-between">
                      <span>Revenue</span>
                      <span className="text-white">
                        {formatAmount(summary.recharges.revenue_usd, "USD")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cost</span>
                      <span className="text-red-400">
                        -{formatAmount(summary.recharges.cost_usd, "USD")}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-gray-700 pt-1">
                      <span className="font-semibold">Profit</span>
                      <span className="text-emerald-400 font-semibold">
                        {formatAmount(summary.recharges.profit_usd, "USD")}
                      </span>
                    </div>
                  </div>
                </div>
              )}

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
            <DataTable<ModuleRow>
              columns={[
                { header: "Module", className: "text-left px-4 py-3" },
                { header: "Revenue (USD)", className: "text-right px-4 py-3" },
                { header: "Revenue (LBP)", className: "text-right px-4 py-3" },
                { header: "Profit (USD)", className: "text-right px-4 py-3" },
                { header: "Profit (LBP)", className: "text-right px-4 py-3" },
                { header: "Count", className: "text-right px-4 py-3" },
                { header: "Margin", className: "text-right px-4 py-3" },
              ]}
              data={byModule}
              exportExcel
              exportPdf
              exportFilename="profit-by-module"
              className="w-full text-sm"
              theadClassName="border-b border-gray-700 text-gray-400 text-xs uppercase"
              emptyMessage="No data for this period"
              renderRow={(row) => (
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
              )}
            />
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
              <DataTable<DateRow>
                columns={[
                  { header: "Date", className: "text-left px-4 py-3" },
                  { header: "Revenue", className: "text-right px-4 py-3" },
                  { header: "Gross Profit", className: "text-right px-4 py-3" },
                  { header: "Expenses", className: "text-right px-4 py-3" },
                  { header: "Net Profit", className: "text-right px-4 py-3" },
                ]}
                data={byDate}
                exportExcel
                exportPdf
                exportFilename="profit-by-date"
                className="w-full text-sm"
                theadClassName="border-b border-gray-700 text-gray-400 text-xs uppercase"
                emptyMessage="No data for this period"
                footerContent={
                  byDate.length > 0 ? (
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
                  ) : undefined
                }
                renderRow={(d) => (
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
                )}
              />
            </div>
          </div>
        )}

        {/* ==================== By Payment Method Tab ==================== */}
        {!loading && tab === "by-payment" && (
          <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
            <DataTable<PaymentMethodRow>
              columns={[
                { header: "Payment Method", className: "text-left px-4 py-3" },
                { header: "Total (USD)", className: "text-right px-4 py-3" },
                { header: "Total (LBP)", className: "text-right px-4 py-3" },
                { header: "Count", className: "text-right px-4 py-3" },
                { header: "Status", className: "text-right px-4 py-3" },
                { header: "Share", className: "text-right px-4 py-3" },
              ]}
              data={byPayment}
              exportExcel
              exportPdf
              exportFilename="profit-by-payment"
              className="w-full text-sm"
              theadClassName="border-b border-gray-700 text-gray-400 text-xs uppercase"
              emptyMessage="No payment data for this period"
              renderRow={(row) => {
                const totalAll = byPayment
                  .filter(
                    (r) =>
                      r.method !== "PM_FEE" &&
                      r.is_settled !== 0 &&
                      !r.is_debt_repayment_only,
                  )
                  .reduce((s, r) => s + r.total_usd, 0);
                const isPending = row.is_settled === 0;
                const isCommission = row.method.startsWith("Commission");
                const isPmFee = row.method === "PM_FEE";
                const isDebtRepayment = !!row.is_debt_repayment_only;
                return (
                  <tr
                    key={row.method}
                    className={`border-b border-gray-700/50 hover:bg-gray-700/30 ${
                      isPending
                        ? "bg-amber-950/20"
                        : isPmFee
                          ? "bg-violet-950/20"
                          : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-white">
                      <div className="flex items-center gap-2">
                        <CreditCard
                          className={`h-4 w-4 ${
                            isCommission
                              ? "text-emerald-400"
                              : isPmFee
                                ? "text-violet-400"
                                : "text-gray-400"
                          }`}
                        />
                        {isPmFee
                          ? "Payment Method Fee (Wallet Surcharge)"
                          : row.method}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {isPending && (row.pending_commission_usd ?? 0) > 0 ? (
                        <span className="text-amber-400">
                          ${(row.pending_commission_usd ?? 0).toFixed(4)}
                        </span>
                      ) : (
                        <span
                          className={
                            isCommission
                              ? "text-emerald-400 font-semibold"
                              : isPmFee
                                ? "text-violet-300 font-semibold"
                                : "text-white"
                          }
                        >
                          {formatAmount(row.total_usd, "USD")}
                        </span>
                      )}
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
                      {isPending ? (
                        <span className="text-xs font-medium text-amber-400">
                          Profit Pending
                        </span>
                      ) : isCommission ? (
                        <span className="text-xs font-medium text-emerald-400">
                          Settled
                        </span>
                      ) : isPmFee ? (
                        <span className="text-xs font-medium text-violet-400">
                          Immediate Profit
                        </span>
                      ) : isDebtRepayment ? (
                        <span className="text-xs font-medium text-slate-500">
                          No Profit
                        </span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isPending && !isPmFee && !isDebtRepayment && (
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
                      )}
                      {isPending && (
                        <span className="text-xs text-amber-500/70">
                          → Settle in Settings
                        </span>
                      )}
                      {isPmFee && (
                        <span className="text-xs text-violet-500/70">
                          In wallet drawer
                        </span>
                      )}
                      {isDebtRepayment && (
                        <span className="text-xs text-slate-600">0%</span>
                      )}
                    </td>
                  </tr>
                );
              }}
            />
          </div>
        )}

        {/* ==================== By User/Cashier Tab ==================== */}
        {!loading && tab === "by-user" && (
          <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
            <DataTable<UserRow>
              columns={[
                { header: "Cashier", className: "text-left px-4 py-3" },
                { header: "Revenue (USD)", className: "text-right px-4 py-3" },
                { header: "Profits", className: "text-right px-4 py-3" },
                {
                  header: "Pending Profits",
                  className: "text-right px-4 py-3",
                },
                { header: "Transactions", className: "text-right px-4 py-3" },
                { header: "Avg Profit/Txn", className: "text-right px-4 py-3" },
              ]}
              data={byUser}
              exportExcel
              exportPdf
              exportFilename="profit-by-cashier"
              className="w-full text-sm"
              theadClassName="border-b border-gray-700 text-gray-400 text-xs uppercase"
              emptyMessage="No data for this period"
              renderRow={(row) => (
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
                  <td className="px-4 py-3 text-right">
                    {(row.pending_profit_usd ?? 0) > 0 ? (
                      <span className="text-amber-400 font-medium">
                        ⚠ {formatAmount(row.pending_profit_usd, "USD")}
                      </span>
                    ) : (
                      <span className="text-gray-600 text-xs">—</span>
                    )}
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
              )}
            />
          </div>
        )}

        {/* ==================== By Client Tab ==================== */}
        {!loading && tab === "by-client" && (
          <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
            <DataTable<ClientRow>
              columns={[
                { header: "#", className: "text-left px-4 py-3" },
                { header: "Client", className: "text-left px-4 py-3" },
                { header: "Revenue (USD)", className: "text-right px-4 py-3" },
                { header: "Profits", className: "text-right px-4 py-3" },
                {
                  header: "Pending Profits",
                  className: "text-right px-4 py-3",
                },
                { header: "Transactions", className: "text-right px-4 py-3" },
              ]}
              data={byClient}
              exportExcel
              exportPdf
              exportFilename="profit-by-client"
              className="w-full text-sm"
              theadClassName="border-b border-gray-700 text-gray-400 text-xs uppercase"
              emptyMessage="No data for this period"
              renderRow={(row, i) => (
                <tr
                  key={row.client_id ?? `session-${row.client_name}-${i}`}
                  className="border-b border-gray-700/50 hover:bg-gray-700/30"
                >
                  <td className="px-4 py-3 text-gray-500 text-xs">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">
                      {row.client_name}
                    </div>
                    {row.client_phone && (
                      <div className="text-xs text-gray-500">
                        {row.client_phone}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-white">
                    {formatAmount(row.revenue_usd, "USD")}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">
                    {formatAmount(row.profit_usd, "USD")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(row.pending_profit_usd ?? 0) > 0 ? (
                      <span className="text-amber-400 font-medium">
                        ⚠ {formatAmount(row.pending_profit_usd, "USD")}
                      </span>
                    ) : (
                      <span className="text-gray-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {row.transaction_count}
                  </td>
                </tr>
              )}
            />
          </div>
        )}

        {/* ==================== Commissions Tab ==================== */}
        {!loading && tab === "commissions" && !commissionsData && (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        )}
        {!loading && tab === "commissions" && commissionsData && (
          <div className="space-y-6">
            {/* Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
                <p className="text-slate-400 text-sm font-medium uppercase mb-4">
                  Realized Commissions (Month)
                </p>
                <div className="flex items-end gap-3">
                  <span className="text-3xl font-bold text-white">
                    {formatAmount(commissionsData.month.commission, "USD")}
                  </span>
                </div>
                {commissionsData.month.pending_commission > 0 && (
                  <p className="text-xs text-amber-400 mt-2 font-mono">
                    + ${commissionsData.month.pending_commission.toFixed(4)}{" "}
                    pending settlement
                  </p>
                )}
              </div>

              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
                <p className="text-slate-400 text-sm font-medium uppercase mb-4">
                  Realized Commissions (Today)
                </p>
                <div className="flex items-end gap-3">
                  <span className="text-3xl font-bold text-emerald-400">
                    {formatAmount(commissionsData.today.commission, "USD")}
                  </span>
                </div>
                {commissionsData.today.pending_commission > 0 && (
                  <p className="text-xs text-amber-400 mt-2 font-mono">
                    + ${commissionsData.today.pending_commission.toFixed(4)}{" "}
                    pending settlement
                  </p>
                )}
              </div>

              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
                <p className="text-slate-400 text-sm font-medium uppercase mb-4">
                  Transaction Volume
                </p>
                <div className="flex items-end gap-3">
                  <span className="text-3xl font-bold text-blue-400">
                    {commissionsData.month.count}
                  </span>
                  <span className="text-slate-500 mb-1">
                    services this month
                  </span>
                </div>
                <div className="mt-2 text-blue-500/70 text-sm">
                  {commissionsData.today.count} processed today
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Market Share / Provider Breakdown */}
              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
                <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <PieChartIcon size={18} className="text-pink-500" />
                  Revenue by Provider
                </h3>
                <div className="h-80">
                  <Suspense
                    fallback={
                      <div className="h-80 animate-pulse bg-slate-700/30 rounded-xl" />
                    }
                  >
                    <CommissionsChart
                      pieData={commissionsData.byProvider.map((p) => ({
                        name: p.provider,
                        value: p.commission,
                        pending:
                          unsettledByProvider.find(
                            (u) => u.provider === p.provider,
                          )?.pending_commission_usd ?? 0,
                      }))}
                      formatAmount={formatAmount}
                    />
                  </Suspense>
                </div>
              </div>

              {/* Detailed Table */}
              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg flex flex-col">
                <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <Activity size={18} className="text-blue-400" />
                  Provider Performance (Today)
                </h3>
                {/* fetch unsettled per provider from pendingData if available, else show from commissionsData */}
                <div className="flex-1 overflow-auto">
                  <DataTable
                    columns={[
                      { header: "Provider", className: "pb-3" },
                      { header: "Transactions", className: "pb-3 text-right" },
                      {
                        header: "Commission (Realized)",
                        className: "pb-3 text-right",
                      },
                      {
                        header: "Commission (Pending)",
                        className: "pb-3 text-right",
                      },
                      { header: "Status", className: "pb-3 text-right" },
                    ]}
                    data={commissionsData.byProvider}
                    exportExcel
                    exportPdf
                    exportFilename="commissions"
                    className="w-full text-left"
                    theadClassName="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/50"
                    tbodyClassName="divide-y divide-slate-700/30"
                    emptyMessage="No provider data"
                    renderRow={(p) => {
                      // Per-provider pending from unsettledByProvider (exact, not global)
                      const providerUnsettled = unsettledByProvider.find(
                        (u) => u.provider === p.provider,
                      );
                      const pendingUsd =
                        providerUnsettled?.pending_commission_usd ?? 0;
                      return (
                        <tr
                          key={p.provider}
                          className="group hover:bg-slate-700/30 transition-colors"
                        >
                          <td className="py-4 font-medium text-slate-200">
                            {p.provider}
                          </td>
                          <td className="py-4 text-right text-slate-400">
                            {p.count}
                          </td>
                          <td className="py-4 text-right text-emerald-400 font-mono font-medium">
                            ${p.commission.toFixed(4)}
                          </td>
                          <td className="py-4 text-right text-amber-400 font-mono">
                            {pendingUsd > 0 ? `$${pendingUsd.toFixed(4)}` : "—"}
                          </td>
                          <td className="py-4 text-right">
                            {pendingUsd > 0 ? (
                              <span className="text-xs font-medium text-amber-400">
                                Profit Pending
                              </span>
                            ) : p.commission > 0 ? (
                              <span className="text-xs font-medium text-emerald-400">
                                Settled
                              </span>
                            ) : (
                              <span className="text-slate-600 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== Pending Profit Tab ==================== */}
        {/* ── Unsettled commissions section (OMT/WHISH RECEIVE pending settlement) ── */}
        {!loading &&
          tab === "pending" &&
          pendingData &&
          pendingData.unsettled_commissions.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">
                  Pending OMT/WHISH Commissions
                </h3>
                <span className="text-xs bg-amber-900/50 text-amber-400 px-2 py-0.5 rounded-full border border-amber-700">
                  {pendingData.unsettled_totals.count} txns
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-4">
                  <p className="text-xs text-amber-400/70 uppercase tracking-wider mb-1">
                    Pending Commission (USD)
                  </p>
                  <p className="text-2xl font-bold text-amber-300 font-mono">
                    $
                    {pendingData.unsettled_totals.total_pending_commission_usd.toFixed(
                      4,
                    )}
                  </p>
                  <p className="text-xs text-amber-500/70 mt-1">
                    Will be realized after settlement with supplier
                  </p>
                </div>
                {pendingData.unsettled_totals.total_pending_commission_lbp >
                  0 && (
                  <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-4">
                    <p className="text-xs text-amber-400/70 uppercase tracking-wider mb-1">
                      Pending Commission (LBP)
                    </p>
                    <p className="text-2xl font-bold text-amber-300 font-mono">
                      {pendingData.unsettled_totals.total_pending_commission_lbp.toLocaleString()}{" "}
                      LBP
                    </p>
                  </div>
                )}
              </div>
              <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
                <div className="grid grid-cols-12 gap-2 bg-gray-800 text-gray-400 text-xs font-semibold uppercase px-4 py-2">
                  <div className="col-span-2">Provider</div>
                  <div className="col-span-3">Service Type</div>
                  <div className="col-span-2 text-right">Amount</div>
                  <div className="col-span-2 text-right">OMT Fee</div>
                  <div className="col-span-2 text-right">Commission</div>
                  <div className="col-span-1 text-right">Date</div>
                </div>
                {pendingData.unsettled_commissions.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-12 gap-2 px-4 py-2.5 text-sm border-t border-gray-700/50"
                  >
                    <div className="col-span-2 font-medium text-white">
                      {r.provider}
                    </div>
                    <div className="col-span-3 text-gray-400 text-xs">
                      {r.omt_service_type || "—"}
                    </div>
                    <div className="col-span-2 text-right font-mono text-white">
                      ${Math.abs(r.amount).toFixed(2)}
                    </div>
                    <div className="col-span-2 text-right font-mono text-amber-400">
                      {r.omt_fee ? `$${r.omt_fee.toFixed(2)}` : "—"}
                    </div>
                    <div className="col-span-2 text-right font-mono text-amber-300 font-bold">
                      ${r.commission.toFixed(4)}
                    </div>
                    <div className="col-span-1 text-right text-xs text-gray-500">
                      {new Date(r.created_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                → Settle these in{" "}
                <span className="text-white font-medium">
                  Settings → Supplier Ledger
                </span>
              </p>
            </div>
          )}

        {!loading && tab === "pending" && !pendingData && (
          <div className="text-center py-12 text-gray-500">
            No data for this period
          </div>
        )}
        {!loading && tab === "pending" && pendingData && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4">
              <SummaryCard
                label="Unpaid Sales"
                value={String(pendingData.totals.count)}
                icon={Clock}
                color="text-amber-400"
              />
              <SummaryCard
                label="Outstanding Amount"
                value={formatAmount(
                  pendingData.totals.total_outstanding_usd,
                  "USD",
                )}
                icon={DollarSign}
                color="text-red-400"
              />
              <SummaryCard
                label="Pending Profit"
                value={formatAmount(
                  pendingData.totals.total_pending_profit_usd,
                  "USD",
                )}
                subValue="Recognized once fully paid"
                icon={TrendingUp}
                color="text-amber-400"
              />
            </div>

            {/* Table */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
              <DataTable<(typeof pendingData.rows)[number]>
                columns={[
                  { header: "Date", className: "text-left px-4 py-3" },
                  { header: "Client", className: "text-left px-4 py-3" },
                  { header: "Items", className: "text-left px-4 py-3" },
                  { header: "Sale Total", className: "text-right px-4 py-3" },
                  { header: "Paid", className: "text-right px-4 py-3" },
                  { header: "Outstanding", className: "text-right px-4 py-3" },
                  {
                    header: "Pending Profit",
                    className: "text-right px-4 py-3",
                  },
                ]}
                data={pendingData.rows}
                exportExcel
                exportPdf
                exportFilename="pending-profit"
                className="w-full text-sm"
                theadClassName="border-b border-gray-700 text-gray-400 text-xs uppercase"
                emptyMessage="No unpaid sales in this period"
                renderRow={(row) => (
                  <tr
                    key={row.sale_id}
                    className="border-b border-gray-700/50 hover:bg-gray-700/30"
                  >
                    <td className="px-4 py-3 text-gray-300 text-xs">
                      {new Date(row.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">
                        {row.client_name}
                      </div>
                      {row.client_phone && (
                        <div className="text-xs text-gray-500">
                          {row.client_phone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-300 text-xs max-w-[200px] truncate">
                      {row.items_summary}
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {formatAmount(row.total_amount_usd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400">
                      {formatAmount(row.paid_usd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-red-400 font-medium">
                      {formatAmount(row.outstanding_usd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-amber-400 font-medium">
                      {formatAmount(row.potential_profit_usd, "USD")}
                    </td>
                  </tr>
                )}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
