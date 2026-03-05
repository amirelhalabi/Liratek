import { useState, useEffect, useCallback } from "react";
import { PageHeader, useApi } from "@liratek/ui";
import { useModules } from "../../../contexts/ModuleContext";
import {
  ClipboardList,
  History,
  Filter,
  DollarSign,
  RefreshCw,
  X,
} from "lucide-react";
import { useCurrencyContext } from "../../../contexts/CurrencyContext";
import { DataTable } from "@/shared/components/DataTable";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Transaction {
  id: number;
  type: string;
  source_table: string;
  source_id: number;
  status: string;
  total_amount_usd: number;
  total_amount_lbp: number;
  user_id: number;
  user_name: string;
  client_id?: number;
  client_name?: string;
  drawer_code?: string;
  created_at: string;
  note?: string;
}

type DrawerFilter = "ALL" | "General" | "OMT_System" | "WHISH" | "MTC";
type ModuleFilter =
  | "ALL"
  | "SALE"
  | "OMT_WHISH"
  | "EXCHANGE"
  | "CUSTOM_SERVICE"
  | "MAINTENANCE";
type StatusFilter = "ALL" | "ACTIVE" | "VOID" | "REFUNDED";

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

function formatType(t: string): string {
  return t
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    case "VOID":
      return "bg-red-500/10 text-red-400 border-red-500/30";
    case "REFUNDED":
      return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    default:
      return "bg-slate-500/10 text-slate-400 border-slate-500/30";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TransactionHistory() {
  const api = useApi();
  const { formatAmount } = useCurrencyContext();
  const { isModuleEnabled } = useModules();

  // Filters
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [drawerFilter, setDrawerFilter] = useState<DrawerFilter>("ALL");
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [searchTerm, setSearchTerm] = useState("");

  // Data
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Load transactions
  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const filters: any = { from, to };

      if (statusFilter !== "ALL") {
        filters.status = statusFilter;
      }

      if (moduleFilter !== "ALL") {
        filters.source_table = moduleFilter.toLowerCase();
      }

      const data = await api.getRecentTransactions(500, filters);

      let filtered = data || [];

      // Client-side drawer filtering (if backend doesn't support it)
      if (drawerFilter !== "ALL") {
        filtered = filtered.filter(
          (t: Transaction) => t.drawer_code === drawerFilter,
        );
      }

      // Client-side search
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        filtered = filtered.filter(
          (t: Transaction) =>
            t.client_name?.toLowerCase().includes(term) ||
            t.user_name?.toLowerCase().includes(term) ||
            t.note?.toLowerCase().includes(term) ||
            t.id.toString().includes(term),
        );
      }

      setTransactions(filtered);
    } catch (error) {
      console.error("Failed to load transactions:", error);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [api, from, to, drawerFilter, moduleFilter, statusFilter, searchTerm]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  // Calculate totals
  const totals = transactions.reduce(
    (acc, t) => {
      if (t.status === "ACTIVE") {
        acc.usd += t.total_amount_usd || 0;
        acc.lbp += t.total_amount_lbp || 0;
      }
      return acc;
    },
    { usd: 0, lbp: 0 },
  );

  const activeCount = transactions.filter((t) => t.status === "ACTIVE").length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* Header */}
        <PageHeader icon={ClipboardList} title="Transactions" />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <History className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">
                  {transactions.length}
                </div>
                <div className="text-xs text-slate-400">Total Transactions</div>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <DollarSign className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">
                  {activeCount}
                </div>
                <div className="text-xs text-slate-400">Active</div>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <DollarSign className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <div className="text-lg font-bold text-white">
                  {formatAmount(totals.usd, "USD")}
                </div>
                <div className="text-xs text-slate-400">Total USD</div>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <DollarSign className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <div className="text-lg font-bold text-white">
                  {formatAmount(totals.lbp, "LBP")}
                </div>
                <div className="text-xs text-slate-400">Total LBP</div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Filter size={16} />
              Filters
            </h3>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="text-xs px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
            >
              {showFilters ? "Hide" : "Show"} Advanced
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            {/* Date Range */}
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">
                Date Range
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                />
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>
            </div>

            {/* Search */}
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">
                Search
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Client, user, note, ID..."
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-3 pr-8 py-2 text-white text-sm"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* Refresh Button */}
            <div className="md:col-span-2 flex items-end gap-2">
              <button
                onClick={loadTransactions}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw
                  size={16}
                  className={loading ? "animate-spin" : ""}
                />
                Refresh
              </button>
            </div>
          </div>

          {/* Advanced Filters */}
          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-700/50">
              {/* Drawer Filter */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Drawer
                </label>
                <select
                  value={drawerFilter}
                  onChange={(e) =>
                    setDrawerFilter(e.target.value as DrawerFilter)
                  }
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="ALL">All Drawers</option>
                  <option value="General">General</option>
                  <option value="OMT_System">OMT System</option>
                  <option value="WHISH">WHISH</option>
                  <option value="MTC">MTC</option>
                </select>
              </div>

              {/* Module Filter */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Module
                </label>
                <select
                  value={moduleFilter}
                  onChange={(e) =>
                    setModuleFilter(e.target.value as ModuleFilter)
                  }
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="ALL">All Modules</option>
                  <option value="SALE">POS (Sales)</option>
                  {isModuleEnabled("services") && (
                    <option value="OMT_WHISH">Services (OMT/WHISH)</option>
                  )}
                  {isModuleEnabled("exchange") && (
                    <option value="EXCHANGE">Exchange</option>
                  )}
                  {isModuleEnabled("custom_services") && (
                    <option value="CUSTOM_SERVICE">Custom Services</option>
                  )}
                  {isModuleEnabled("maintenance") && (
                    <option value="MAINTENANCE">Maintenance</option>
                  )}
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as StatusFilter)
                  }
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="ALL">All Status</option>
                  <option value="ACTIVE">Active</option>
                  <option value="VOID">Void</option>
                  <option value="REFUNDED">Refunded</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Transactions Table */}
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
              Loading transactions...
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <History className="w-12 h-12 mx-auto mb-2 opacity-50" />
              No transactions found
            </div>
          ) : (
            <DataTable
              columns={[
                { header: "ID", className: "w-16", sortKey: "id" },
                {
                  header: "Date & Time",
                  className: "w-40",
                  sortKey: "created_at",
                },
                { header: "Type", className: "w-32", sortKey: "type" },
                {
                  header: "Module",
                  className: "w-32",
                  sortKey: "source_table",
                },
                {
                  header: "Client/User",
                  className: "flex-1",
                  sortKey: "client_name",
                },
                { header: "Drawer", className: "w-24", sortKey: "drawer_code" },
                {
                  header: "Amount USD",
                  className: "w-28 text-right",
                  sortKey: "total_amount_usd",
                },
                {
                  header: "Amount LBP",
                  className: "w-32 text-right",
                  sortKey: "total_amount_lbp",
                },
                { header: "Status", className: "w-24", sortKey: "status" },
              ]}
              data={transactions}
              exportExcel
              exportPdf
              exportFilename={`transactions_${from}_${to}`}
              className="w-full"
              theadClassName="bg-slate-900/50 text-xs text-slate-400 uppercase tracking-wider"
              tbodyClassName="divide-y divide-slate-700/30"
              renderRow={(txn) => (
                <tr
                  key={txn.id}
                  className="group hover:bg-slate-700/30 transition-colors"
                >
                  <td className="px-4 py-3 text-sm font-mono text-slate-300">
                    #{txn.id}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-300">
                    {formatDateTime(txn.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-200">
                    {formatType(txn.type)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {formatType(txn.source_table)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="text-white">{txn.client_name || "—"}</div>
                    <div className="text-xs text-slate-500">
                      by {txn.user_name}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {txn.drawer_code || "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-mono text-emerald-400">
                    {formatAmount(txn.total_amount_usd, "USD")}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-mono text-amber-400">
                    {formatAmount(txn.total_amount_lbp, "LBP")}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-medium border ${getStatusBadgeClass(
                        txn.status,
                      )}`}
                    >
                      {txn.status}
                    </span>
                  </td>
                </tr>
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
