import { useState, useEffect, useCallback, Fragment } from "react";
import {
  PageHeader,
  useApi,
  DateRangeFilter,
  daysAgoISO,
  todayISO,
} from "@liratek/ui";
import {
  TrendingUp,
  Calendar,
  AlertTriangle,
  DollarSign,
  Users,
  BarChart2,
  ChevronDown,
  ChevronUp,
  ShoppingCart,
} from "lucide-react";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { DataTable } from "@/shared/components/DataTable";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailySummaryRow {
  date: string;
  total_usd: number;
  total_lbp: number;
  by_type: Array<{
    type: string;
    count: number;
    total_usd: number;
    total_lbp: number;
  }>;
  void_count: number;
  void_usd: number;
  void_lbp: number;
}

interface RevenueRow {
  type: string;
  count: number;
  total_usd: number;
  total_lbp: number;
}

interface OverdueRow {
  client_id: number;
  client_name: string;
  phone_number: string | null;
  total_usd: number;
  total_lbp: number;
  oldest_due_date: string;
  max_days_overdue: number;
  entry_count: number;
}

type TabKey = "daily" | "revenue" | "overdue" | "sales";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Friendly type label */
function formatType(t: string): string {
  return t
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Types for Sales tab
// ---------------------------------------------------------------------------

interface SaleRow {
  id: number;
  client_name: string | null;
  client_phone: string | null;
  total_amount_usd: number;
  discount_usd: number;
  final_amount_usd: number;
  paid_usd: number;
  paid_lbp: number;
  change_given_usd: number;
  change_given_lbp: number;
  exchange_rate_snapshot: number;
  drawer_name: string;
  status: string;
  note: string | null;
  created_at: string;
  item_count?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Reports() {
  const api = useApi();
  const { formatAmount } = useCurrencyContext();

  const [tab, setTab] = useState<TabKey>("daily");
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());

  // Data states
  const [dailySummaries, setDailySummaries] = useState<DailySummaryRow[]>([]);
  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [overdue, setOverdue] = useState<OverdueRow[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // ---------- Fetchers ----------

  const loadDaily = useCallback(async () => {
    setLoading(true);
    try {
      const data = window.api
        ? await window.api.reporting.dailySummaries(from, to)
        : await api.getDailySummaries(from, to);
      // Show most recent first
      setDailySummaries((data || []).reverse());
    } catch {
      setDailySummaries([]);
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadRevenue = useCallback(async () => {
    setLoading(true);
    try {
      const data = window.api
        ? await window.api.reporting.revenueByModule(from, to)
        : await api.getRevenueByModule(from, to);
      setRevenue(data || []);
    } catch {
      setRevenue([]);
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadOverdue = useCallback(async () => {
    setLoading(true);
    try {
      const data = window.api
        ? await window.api.reporting.overdueDebts()
        : await api.getReportOverdueDebts();
      setOverdue(data || []);
    } catch {
      setOverdue([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadSales = useCallback(async () => {
    setLoading(true);
    try {
      const data = window.api
        ? await window.api.sales.getByDateRange(from, to)
        : [];
      setSales(data || []);
    } catch {
      setSales([]);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    if (tab === "daily") loadDaily();
    else if (tab === "revenue") loadRevenue();
    else if (tab === "overdue") loadOverdue();
    else if (tab === "sales") loadSales();
  }, [tab, loadDaily, loadRevenue, loadOverdue, loadSales]);

  // ---------- Sales summary stats ----------

  const salesStats = {
    totalSales: sales.length,
    totalRevenue: sales.reduce((s, r) => s + r.final_amount_usd, 0),
    totalDiscount: sales.reduce((s, r) => s + r.discount_usd, 0),
    totalPaidUsd: sales.reduce((s, r) => s + r.paid_usd, 0),
    totalPaidLbp: sales.reduce((s, r) => s + r.paid_lbp, 0),
    avgSaleValue:
      sales.length > 0
        ? sales.reduce((s, r) => s + r.final_amount_usd, 0) / sales.length
        : 0,
    refundedCount: sales.filter((s) => s.status === "refunded").length,
  };

  // ---------- Tab buttons ----------

  const tabs: { key: TabKey; label: string; icon: typeof TrendingUp }[] = [
    { key: "daily", label: "Daily Summaries", icon: Calendar },
    { key: "revenue", label: "Revenue by Module", icon: BarChart2 },
    { key: "overdue", label: "Overdue Debts", icon: AlertTriangle },
    { key: "sales", label: "Sales", icon: ShoppingCart },
  ];

  // ---------- Render ----------

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 space-y-6">
      <PageHeader icon={BarChart2} title="Reports" />

      {/* Tab bar + date range */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex bg-gray-800 rounded-lg p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
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

        {/* Date range (not shown for overdue) */}
        {tab !== "overdue" && (
          <DateRangeFilter
            from={from}
            to={to}
            onFromChange={setFrom}
            onToChange={setTo}
            className="ml-auto"
          />
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-400">
          Loading…
        </div>
      )}

      {/* ==================== Daily Summaries ==================== */}
      {!loading && tab === "daily" && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
          <DataTable<DailySummaryRow>
            columns={[
              { header: "Date", className: "text-left px-4 py-3" },
              { header: "USD", className: "text-right px-4 py-3" },
              { header: "LBP", className: "text-right px-4 py-3" },
              { header: "Voids", className: "text-right px-4 py-3" },
              { header: "", className: "px-4 py-3 w-10" },
            ]}
            data={dailySummaries}
            exportExcel
            exportPdf
            exportFilename="daily-summaries"
            className="w-full text-sm"
            theadClassName="border-b border-gray-700 text-gray-400"
            tbodyClassName="divide-y divide-gray-700/60"
            emptyMessage="No data for this period"
            renderRow={(d) => (
              <Fragment key={d.date}>
                <tr
                  key={d.date}
                  className="hover:bg-gray-700/30 cursor-pointer"
                  onClick={() =>
                    setExpandedDay(expandedDay === d.date ? null : d.date)
                  }
                >
                  <td className="px-4 py-3 font-medium text-white">{d.date}</td>
                  <td className="px-4 py-3 text-right text-emerald-400">
                    {formatAmount(d.total_usd, "USD")}
                  </td>
                  <td className="px-4 py-3 text-right text-blue-400">
                    {formatAmount(d.total_lbp, "LBP")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {d.void_count > 0 ? (
                      <span className="text-red-400">{d.void_count}</span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {expandedDay === d.date ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </td>
                </tr>
                {expandedDay === d.date && d.by_type.length > 0 && (
                  <tr key={`${d.date}-detail`}>
                    <td colSpan={5} className="bg-gray-900/40 px-8 py-3">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="text-left py-1">Type</th>
                            <th className="text-right py-1">Count</th>
                            <th className="text-right py-1">USD</th>
                            <th className="text-right py-1">LBP</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.by_type.map((bt) => (
                            <tr key={bt.type} className="text-gray-300">
                              <td className="py-1">{formatType(bt.type)}</td>
                              <td className="text-right py-1">{bt.count}</td>
                              <td className="text-right py-1 text-emerald-400">
                                {formatAmount(bt.total_usd, "USD")}
                              </td>
                              <td className="text-right py-1 text-blue-400">
                                {formatAmount(bt.total_lbp, "LBP")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            )}
          />
        </div>
      )}

      {/* ==================== Revenue by Module ==================== */}
      {!loading && tab === "revenue" && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SummaryCard
              icon={DollarSign}
              label="Total Revenue (USD)"
              value={formatAmount(
                revenue.reduce((s, r) => s + r.total_usd, 0),
                "USD",
              )}
              color="text-emerald-400"
            />
            <SummaryCard
              icon={DollarSign}
              label="Total Revenue (LBP)"
              value={formatAmount(
                revenue.reduce((s, r) => s + r.total_lbp, 0),
                "LBP",
              )}
              color="text-blue-400"
            />
            <SummaryCard
              icon={Users}
              label="Total Transactions"
              value={revenue.reduce((s, r) => s + r.count, 0).toLocaleString()}
              color="text-purple-400"
            />
          </div>

          {/* Table */}
          <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
            <DataTable<RevenueRow>
              columns={[
                { header: "Module", className: "text-left px-4 py-3" },
                { header: "Count", className: "text-right px-4 py-3" },
                { header: "USD", className: "text-right px-4 py-3" },
                { header: "LBP", className: "text-right px-4 py-3" },
              ]}
              data={revenue}
              exportExcel
              exportPdf
              exportFilename="revenue-by-module"
              className="w-full text-sm"
              theadClassName="border-b border-gray-700 text-gray-400"
              tbodyClassName="divide-y divide-gray-700/60"
              emptyMessage="No revenue data for this period"
              renderRow={(r) => (
                <tr key={r.type} className="hover:bg-gray-700/30">
                  <td className="px-4 py-3 font-medium text-white">
                    {formatType(r.type)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {r.count}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-400">
                    {formatAmount(r.total_usd, "USD")}
                  </td>
                  <td className="px-4 py-3 text-right text-blue-400">
                    {formatAmount(r.total_lbp, "LBP")}
                  </td>
                </tr>
              )}
            />
          </div>
        </div>
      )}

      {/* ==================== Overdue Debts ==================== */}
      {!loading && tab === "overdue" && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
          <DataTable<OverdueRow>
            columns={[
              { header: "Client", className: "text-left px-4 py-3" },
              { header: "Phone", className: "text-left px-4 py-3" },
              { header: "USD Owed", className: "text-right px-4 py-3" },
              { header: "LBP Owed", className: "text-right px-4 py-3" },
              { header: "Days Overdue", className: "text-right px-4 py-3" },
              { header: "Entries", className: "text-right px-4 py-3" },
            ]}
            data={overdue}
            exportExcel
            exportPdf
            exportFilename="overdue-debts"
            className="w-full text-sm"
            theadClassName="border-b border-gray-700 text-gray-400"
            tbodyClassName="divide-y divide-gray-700/60"
            emptyMessage="No overdue debts"
            renderRow={(o) => (
              <tr key={o.client_id} className="hover:bg-gray-700/30">
                <td className="px-4 py-3 font-medium text-white">
                  {o.client_name}
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {o.phone_number || "\u2014"}
                </td>
                <td className="px-4 py-3 text-right text-rose-400">
                  {formatAmount(o.total_usd, "USD")}
                </td>
                <td className="px-4 py-3 text-right text-rose-300">
                  {formatAmount(o.total_lbp, "LBP")}
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={`font-medium ${
                      o.max_days_overdue > 90
                        ? "text-red-400"
                        : o.max_days_overdue > 60
                          ? "text-orange-400"
                          : o.max_days_overdue > 30
                            ? "text-yellow-400"
                            : "text-gray-300"
                    }`}
                  >
                    {o.max_days_overdue}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-gray-300">
                  {o.entry_count}
                </td>
              </tr>
            )}
          />
        </div>
      )}

      {/* ==================== Sales ==================== */}
      {!loading && tab === "sales" && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              icon={ShoppingCart}
              label="Total Sales"
              value={salesStats.totalSales.toLocaleString()}
              color="text-blue-400"
            />
            <SummaryCard
              icon={DollarSign}
              label="Total Revenue"
              value={formatAmount(salesStats.totalRevenue, "USD")}
              color="text-emerald-400"
            />
            <SummaryCard
              icon={DollarSign}
              label="Avg Sale Value"
              value={formatAmount(salesStats.avgSaleValue, "USD")}
              color="text-purple-400"
            />
            <SummaryCard
              icon={DollarSign}
              label="Total Discounts"
              value={formatAmount(salesStats.totalDiscount, "USD")}
              color="text-amber-400"
            />
          </div>

          {/* Table */}
          <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
            <DataTable<SaleRow>
              columns={[
                {
                  header: "Date/Time",
                  className: "text-left px-4 py-3",
                  sortKey: "created_at",
                },
                {
                  header: "Sale #",
                  className: "text-left px-4 py-3",
                  sortKey: "id",
                },
                { header: "Client", className: "text-left px-4 py-3" },
                { header: "Items", className: "text-right px-4 py-3" },
                {
                  header: "Total",
                  className: "text-right px-4 py-3",
                  sortKey: "total_amount_usd",
                },
                { header: "Discount", className: "text-right px-4 py-3" },
                {
                  header: "Final",
                  className: "text-right px-4 py-3",
                  sortKey: "final_amount_usd",
                },
                { header: "Paid USD", className: "text-right px-4 py-3" },
                { header: "Paid LBP", className: "text-right px-4 py-3" },
                { header: "Status", className: "text-center px-4 py-3" },
                { header: "Drawer", className: "text-left px-4 py-3" },
              ]}
              data={sales}
              exportExcel
              exportPdf
              exportFilename="sales-report"
              paginate
              pageSize={20}
              pageLabel="sales"
              className="w-full text-sm"
              theadClassName="border-b border-gray-700 text-gray-400 text-xs uppercase"
              tbodyClassName="divide-y divide-gray-700/60"
              emptyMessage="No sales for this period"
              footerContent={
                sales.length > 0 ? (
                  <tr className="border-t-2 border-gray-600 bg-gray-800/80 font-bold">
                    <td className="px-4 py-3 text-white">TOTAL</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right text-gray-300">
                      {sales.reduce((s, r) => s + (r.item_count ?? 0), 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {formatAmount(
                        salesStats.totalRevenue + salesStats.totalDiscount,
                        "USD",
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-amber-400">
                      {salesStats.totalDiscount > 0
                        ? `-${formatAmount(salesStats.totalDiscount, "USD")}`
                        : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400">
                      {formatAmount(salesStats.totalRevenue, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {formatAmount(salesStats.totalPaidUsd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-blue-400">
                      {formatAmount(salesStats.totalPaidLbp, "LBP")}
                    </td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3" />
                  </tr>
                ) : undefined
              }
              renderRow={(sale) => {
                const dt = new Date(sale.created_at);
                const dateStr = dt.toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                });
                const timeStr = dt.toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <tr key={sale.id} className="hover:bg-gray-700/30">
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                      <div>{dateStr}</div>
                      <div className="text-xs text-gray-500">{timeStr}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-white">
                      #{sale.id}
                    </td>
                    <td className="px-4 py-3 text-white">
                      {sale.client_name || "Walk-in"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {sale.item_count ?? "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {formatAmount(sale.total_amount_usd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {sale.discount_usd > 0 ? (
                        <span className="text-amber-400">
                          -{formatAmount(sale.discount_usd, "USD")}
                        </span>
                      ) : (
                        <span className="text-gray-600">\u2014</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400 font-medium">
                      {formatAmount(sale.final_amount_usd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {formatAmount(sale.paid_usd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-blue-400">
                      {sale.paid_lbp > 0
                        ? formatAmount(sale.paid_lbp, "LBP")
                        : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          sale.status === "completed"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : sale.status === "refunded"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-gray-500/20 text-gray-400"
                        }`}
                      >
                        {sale.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {sale.drawer_name}
                    </td>
                  </tr>
                );
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary Card
// ---------------------------------------------------------------------------

function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-gray-800/60 rounded-xl border border-gray-700 p-4 flex items-center gap-4">
      <div className={`p-2 rounded-lg bg-gray-700/50 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className={`text-lg font-semibold ${color}`}>{value}</p>
      </div>
    </div>
  );
}
