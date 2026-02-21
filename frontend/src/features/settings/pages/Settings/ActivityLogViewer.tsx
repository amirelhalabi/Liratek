import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  getRecentTransactions,
  voidTransaction,
  refundTransaction,
  type TransactionFiltersParam,
} from "../../../../api/backendApi";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnResizeMode,
} from "@tanstack/react-table";
import { ExportBar } from "@/shared/components/ExportBar";

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

const col = createColumnHelper<TransactionRow>();

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

const columns = [
  col.accessor("created_at", {
    header: "Time",
    size: 160,
    minSize: 100,
    cell: (info) => {
      const val = info.getValue();
      if (!val) return "";
      try {
        return new Date(val).toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch {
        return val;
      }
    },
  }),
  col.accessor("type", {
    header: "Type",
    size: 140,
    minSize: 80,
    cell: (info) => {
      const type = info.getValue();
      const row = info.row.original;
      const isVoided = row.status === "VOIDED";
      const color = TYPE_COLORS[type] || "text-slate-300";
      return (
        <span
          className={`${color} ${isVoided ? "line-through opacity-60" : ""}`}
        >
          {type.replace(/_/g, " ")}
        </span>
      );
    },
  }),
  col.accessor("status", {
    header: "Status",
    size: 80,
    minSize: 60,
    cell: (info) => {
      const status = info.getValue();
      if (status === "VOIDED") {
        return (
          <span className="bg-red-900/50 text-red-300 text-[10px] px-1.5 py-0.5 rounded font-medium">
            VOIDED
          </span>
        );
      }
      return (
        <span className="text-green-500/80 text-[10px] font-medium">
          ACTIVE
        </span>
      );
    },
  }),
  col.accessor((r) => r.username || `#${r.user_id}`, {
    id: "user",
    header: "User",
    size: 90,
    minSize: 60,
  }),
  col.accessor((r) => formatAmount(r.amount_usd, r.amount_lbp), {
    id: "amount",
    header: "Amount",
    size: 160,
    minSize: 80,
    cell: (info) => {
      const row = info.row.original;
      const isVoided = row.status === "VOIDED";
      return (
        <span className={isVoided ? "line-through opacity-60" : ""}>
          {info.getValue()}
        </span>
      );
    },
  }),
  col.accessor("client_name", {
    header: "Client",
    size: 140,
    minSize: 80,
    cell: (info) => info.getValue() || "—",
  }),
  col.accessor("source_table", {
    header: "Source",
    size: 130,
    minSize: 60,
    cell: (info) => {
      const table = info.getValue();
      const id = info.row.original.source_id;
      return `${table} #${id}`;
    },
  }),
  col.accessor("summary", {
    header: "Summary",
    size: 300,
    minSize: 120,
    cell: (info) => info.getValue() || "",
  }),
  col.accessor("reverses_id", {
    header: "Reverses",
    size: 80,
    minSize: 50,
    cell: (info) => {
      const val = info.getValue();
      return val ? `#${val}` : "—";
    },
  }),
];

// Types that support void/refund actions (financial transactions)
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
  const [sorting, setSorting] = useState<SortingState>([]);
  const tableRef = useRef<HTMLTableElement>(null);

  const columnResizeMode: ColumnResizeMode = "onChange";

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
        if (res.success) {
          load();
        } else {
          alert("Failed: " + (res.error || "Unknown error"));
        }
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
        if (res.success) {
          load();
        } else {
          alert("Failed: " + (res.error || "Unknown error"));
        }
      } catch {
        alert("Failed to refund transaction");
      }
    },
    [load],
  );

  const allColumns = useMemo(
    () => [
      ...columns,
      col.display({
        id: "actions",
        header: "Actions",
        size: 100,
        minSize: 80,
        cell: (info) => {
          const row = info.row.original;
          if (!ACTIONABLE_TYPES.has(row.type)) return "—";
          if (row.status === "VOIDED") return null;
          // Don't show actions on REFUND rows themselves
          if (row.type === "REFUND") return null;
          return (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleVoid(row.id)}
                className="px-1.5 py-0.5 text-[10px] rounded bg-red-900/40 text-red-300 hover:bg-red-900/80 transition-colors"
                title="Void transaction"
              >
                Void
              </button>
              <button
                onClick={() => handleRefund(row.id)}
                className="px-1.5 py-0.5 text-[10px] rounded bg-rose-900/40 text-rose-300 hover:bg-rose-900/80 transition-colors"
                title="Refund transaction"
              >
                Refund
              </button>
            </div>
          );
        },
      }),
    ],
    [handleVoid, handleRefund],
  );

  const table = useReactTable({
    data: rows,
    columns: allColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode,
    enableColumnResizing: true,
  });

  useEffect(() => {
    load();
  }, [load]);

  const colSpan = allColumns.length;

  return (
    <div className="space-y-3">
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
      <div className="border border-slate-700 rounded overflow-hidden">
        <ExportBar
          exportExcel
          exportPdf
          exportFilename="activity-log"
          tableRef={tableRef}
          rowCount={rows.length}
        />
        <table
          ref={tableRef}
          className="w-full text-left"
          style={{ tableLayout: "fixed" }}
        >
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="p-2 relative select-none overflow-hidden truncate"
                    style={{ width: header.getSize() }}
                  >
                    <span
                      className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-200"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {{
                        asc: (
                          <span className="text-blue-400 text-[10px]">▲</span>
                        ),
                        desc: (
                          <span className="text-blue-400 text-[10px]">▼</span>
                        ),
                      }[header.column.getIsSorted() as string] ?? null}
                    </span>
                    <span
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onDoubleClick={() => header.column.resetSize()}
                      className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/50 ${
                        header.column.getIsResizing() ? "bg-blue-500/50" : ""
                      }`}
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colSpan} className="p-3 text-slate-500">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="p-3 text-slate-500">
                  No transactions found
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t border-slate-800 ${
                    row.original.status === "VOIDED" ? "bg-red-950/20" : ""
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="p-2 text-xs truncate"
                      style={{ width: cell.column.getSize() }}
                      title={String(cell.getValue() ?? "")}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
