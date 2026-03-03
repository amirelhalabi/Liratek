import { useEffect, useState, useCallback } from "react";
import {
  getRecentTransactions,
  voidTransaction,
  refundTransaction,
  type TransactionFiltersParam,
} from "../../../../api/backendApi";
import { DataTable } from "@/shared/components/DataTable";

type TransactionRow = {
  id: number;
  type: string;
  status: string;
  source_table: string;
  source_id: number;
  user_id: number;
  amount_usd: number;
  amount_lbp: number;
  exchange_rate: number | null;
  client_id: number | null;
  reverses_id: number | null;
  summary: string | null;
  metadata_json: string | null;
  device_id: string | null;
  created_at: string;
  username: string;
  client_name: string | null;
};

const TYPE_COLORS: Record<string, string> = {
  SALE: "text-green-400",
  FINANCIAL_SERVICE: "text-blue-400",
  EXCHANGE: "text-yellow-400",
  BINANCE: "text-orange-400",
  RECHARGE: "text-purple-400",
  RECHARGE_TOPUP: "text-purple-300",
  CUSTOM_SERVICE: "text-cyan-400",
  MAINTENANCE: "text-amber-400",
  EXPENSE: "text-red-400",
  DEBT_REPAYMENT: "text-emerald-400",
  SUPPLIER_PAYMENT: "text-indigo-400",
  CLOSING: "text-slate-300",
  OPENING: "text-slate-300",
  REFUND: "text-rose-400",
  CLIENT_CREATED: "text-teal-400",
  CLIENT_UPDATED: "text-teal-300",
  CLIENT_DELETED: "text-teal-500",
};

function formatAmount(usd: number, lbp: number): string {
  const parts: string[] = [];
  if (usd) parts.push(`$${usd.toLocaleString()}`);
  if (lbp) parts.push(`${lbp.toLocaleString()} LBP`);
  return parts.join(" + ") || "—";
}

const ACTIONABLE_TYPES = new Set([
  "SALE",
  "FINANCIAL_SERVICE",
  "EXCHANGE",
  "BINANCE",
  "RECHARGE",
  "CUSTOM_SERVICE",
  "MAINTENANCE",
  "EXPENSE",
  "DEBT_REPAYMENT",
  "SUPPLIER_PAYMENT",
]);

const TRANSACTION_TYPES = [
  "SALE",
  "FINANCIAL_SERVICE",
  "EXCHANGE",
  "BINANCE",
  "RECHARGE",
  "CUSTOM_SERVICE",
  "MAINTENANCE",
  "EXPENSE",
  "DEBT_REPAYMENT",
  "SUPPLIER_PAYMENT",
  "CLOSING",
  "REFUND",
  "CLIENT_CREATED",
  "CLIENT_UPDATED",
  "CLIENT_DELETED",
];

export default function ActivityLogViewer() {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [limit, setLimit] = useState("50");
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters: TransactionFiltersParam = {};
      if (typeFilter) filters.type = typeFilter;
      const res = await getRecentTransactions(Number(limit) || 50, filters);
      setRows((res as TransactionRow[]) || []);
    } finally {
      setLoading(false);
    }
  }, [limit, typeFilter]);

  const handleVoid = useCallback(
    async (id: number) => {
      if (!confirm("Void this transaction? This cannot be undone.")) return;
      try {
        const res = await voidTransaction(id);
        if (res.success) load();
        else alert("Failed: " + (res.error || "Unknown error"));
      } catch {
        alert("Failed to void transaction");
      }
    },
    [load],
  );

  const handleRefund = useCallback(
    async (id: number) => {
      if (
        !confirm("Refund this transaction? A reversal entry will be created.")
      )
        return;
      try {
        const res = await refundTransaction(id);
        if (res.success) load();
        else alert("Failed: " + (res.error || "Unknown error"));
      } catch {
        alert("Failed to refund transaction");
      }
    },
    [load],
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm"
          >
            <option value="">All types</option>
            {TRANSACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">Rows:</label>
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white w-16"
          />
        </div>
      </div>

      {/* Table */}
      <div className="border border-slate-700 rounded overflow-hidden">
        <DataTable<TransactionRow>
          columns={[
            {
              header: "Time",
              sortKey: "created_at",
              width: "160px",
              className: "p-2 text-xs font-semibold uppercase text-slate-400",
            },
            {
              header: "Type",
              sortKey: "type",
              width: "140px",
              className: "p-2 text-xs font-semibold uppercase text-slate-400",
            },
            {
              header: "Status",
              sortKey: "status",
              width: "80px",
              className: "p-2 text-xs font-semibold uppercase text-slate-400",
            },
            {
              header: "User",
              sortKey: "username",
              width: "90px",
              className: "p-2 text-xs font-semibold uppercase text-slate-400",
            },
            {
              header: "Amount",
              sortKey: "amount_usd",
              width: "160px",
              className: "p-2 text-xs font-semibold uppercase text-slate-400",
            },
            {
              header: "Client",
              sortKey: "client_name",
              width: "140px",
              className: "p-2 text-xs font-semibold uppercase text-slate-400",
            },
            {
              header: "Source",
              sortKey: "source_table",
              width: "130px",
              className: "p-2 text-xs font-semibold uppercase text-slate-400",
            },
            {
              header: "Summary",
              sortKey: "summary",
              className: "p-2 text-xs font-semibold uppercase text-slate-400",
            },
            {
              header: "Reverses",
              sortKey: "reverses_id",
              width: "80px",
              className: "p-2 text-xs font-semibold uppercase text-slate-400",
            },
            {
              header: "Actions",
              width: "100px",
              className: "p-2 text-xs font-semibold uppercase text-slate-400",
            },
          ]}
          data={rows}
          loading={loading}
          emptyMessage="No transactions found"
          defaultSortKey="created_at"
          defaultSortDirection="desc"
          resizable
          exportExcel
          exportPdf
          exportFilename="activity-log"
          className="w-full text-left"
          theadClassName="bg-slate-900 text-slate-400 text-xs uppercase"
          tbodyClassName=""
          getSortValue={(row, key) => {
            if (key === "created_at")
              return row.created_at ? new Date(row.created_at).getTime() : 0;
            if (key === "amount_usd") return row.amount_usd ?? 0;
            if (key === "reverses_id") return row.reverses_id ?? 0;
            return String((row as any)[key] ?? "");
          }}
          renderRow={(row) => (
            <tr
              key={row.id}
              className={`border-t border-slate-800 text-xs ${row.status === "VOIDED" ? "bg-red-950/20" : ""}`}
            >
              {/* Time */}
              <td className="p-2 truncate" style={{ width: 160 }}>
                {row.created_at
                  ? (() => {
                      try {
                        return new Date(row.created_at).toLocaleString(
                          "en-GB",
                          {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        );
                      } catch {
                        return row.created_at;
                      }
                    })()
                  : ""}
              </td>
              {/* Type */}
              <td className="p-2 truncate" style={{ width: 140 }}>
                <span
                  className={`${TYPE_COLORS[row.type] || "text-slate-300"} ${row.status === "VOIDED" ? "line-through opacity-60" : ""}`}
                >
                  {row.type.replace(/_/g, " ")}
                </span>
              </td>
              {/* Status */}
              <td className="p-2" style={{ width: 80 }}>
                {row.status === "VOIDED" ? (
                  <span className="bg-red-900/50 text-red-300 text-[10px] px-1.5 py-0.5 rounded font-medium">
                    VOIDED
                  </span>
                ) : (
                  <span className="text-green-500/80 text-[10px] font-medium">
                    ACTIVE
                  </span>
                )}
              </td>
              {/* User */}
              <td className="p-2 truncate" style={{ width: 90 }}>
                {row.username || `#${row.user_id}`}
              </td>
              {/* Amount */}
              <td className="p-2 truncate" style={{ width: 160 }}>
                <span
                  className={
                    row.status === "VOIDED" ? "line-through opacity-60" : ""
                  }
                >
                  {formatAmount(row.amount_usd, row.amount_lbp)}
                </span>
              </td>
              {/* Client */}
              <td className="p-2 truncate" style={{ width: 140 }}>
                {row.client_name || "—"}
              </td>
              {/* Source */}
              <td className="p-2 truncate" style={{ width: 130 }}>
                {row.source_table} #{row.source_id}
              </td>
              {/* Summary */}
              <td className="p-2 truncate">{row.summary || ""}</td>
              {/* Reverses */}
              <td className="p-2" style={{ width: 80 }}>
                {row.reverses_id ? `#${row.reverses_id}` : "—"}
              </td>
              {/* Actions */}
              <td className="p-2" style={{ width: 100 }}>
                {ACTIONABLE_TYPES.has(row.type) &&
                row.status !== "VOIDED" &&
                row.type !== "REFUND" ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleVoid(row.id)}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-red-900/40 text-red-300 hover:bg-red-900/80 transition-colors"
                    >
                      Void
                    </button>
                    <button
                      onClick={() => handleRefund(row.id)}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-rose-900/40 text-rose-300 hover:bg-rose-900/80 transition-colors"
                    >
                      Refund
                    </button>
                  </div>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}
