import { useState, useEffect, useCallback } from "react";
import { PageHeader, useApi } from "@liratek/ui";
import {
  TrendingUp,
  Calendar,
  AlertTriangle,
  DollarSign,
  Users,
  BarChart2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useCurrencyContext } from "../../../contexts/CurrencyContext";
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

type TabKey = "daily" | "revenue" | "overdue";

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

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
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

  useEffect(() => {
    if (tab === "daily") loadDaily();
    else if (tab === "revenue") loadRevenue();
    else if (tab === "overdue") loadOverdue();
  }, [tab, loadDaily, loadRevenue, loadOverdue]);

  // ---------- Tab buttons ----------

  const tabs: { key: TabKey; label: string; icon: typeof TrendingUp }[] = [
    { key: "daily", label: "Daily Summaries", icon: Calendar },
    { key: "revenue", label: "Revenue by Module", icon: BarChart2 },
    { key: "overdue", label: "Overdue Debts", icon: AlertTriangle },
  ];

  // ---------- Render ----------

  return (
    <div className="p-6 space-y-6">
      <PageHeader icon={TrendingUp} title="Reports" />

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
              <>
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
              </>
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
                  {o.phone_number || "—"}
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
