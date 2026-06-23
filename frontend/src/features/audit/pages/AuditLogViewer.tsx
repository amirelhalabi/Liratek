import { useEffect, useState, useCallback } from "react";
import type { AuditLogEntry, AuditSearchFilters } from "@/types/electron";
import { DataTable } from "@liratek/ui";

const ACTION_COLORS: Record<string, string> = {
  CREATE: "text-green-400",
  UPDATE: "text-blue-400",
  DELETE: "text-red-400",
  LOGIN: "text-emerald-400",
  LOGOUT: "text-slate-400",
  VOID: "text-rose-400",
  REFUND: "text-orange-400",
  PROCESS: "text-purple-400",
  SETTINGS_CHANGE: "text-yellow-400",
  BACKUP: "text-cyan-400",
  RESTORE: "text-cyan-400",
  SEED: "text-indigo-400",
  IMPORT: "text-indigo-400",
  EXPORT: "text-indigo-300",
};

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

export interface AuditLogViewerProps {
  action: string;
  entityType: string;
  search: string;
  from: string;
  to: string;
  limit: number;
}

export default function AuditLogViewer({
  action,
  entityType,
  search,
  from,
  to,
  limit,
}: AuditLogViewerProps) {
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  const load = useCallback(
    async (append = false) => {
      setLoading(true);
      try {
        const filters: AuditSearchFilters = {
          limit,
          offset: append ? offset : 0,
        };
        if (action) filters.action = action;
        if (entityType) filters.entityType = entityType;
        if (search) filters.search = search;
        if (from) filters.from = from;
        if (to) filters.to = to;

        const res = await window.api.audit.search(filters);
        if (res.success && res.rows) {
          if (append) {
            setRows((prev) => [...prev, ...res.rows!]);
          } else {
            setRows(res.rows);
            setOffset(0);
          }
          if (res.total != null) setTotal(res.total);
        }
      } finally {
        setLoading(false);
      }
    },
    [action, entityType, search, from, to, limit, offset],
  );

  const handleLoadMore = useCallback(() => {
    const newOffset = offset + limit;
    setOffset(newOffset);
    (async () => {
      setLoading(true);
      try {
        const filters: AuditSearchFilters = { limit, offset: newOffset };
        if (action) filters.action = action;
        if (entityType) filters.entityType = entityType;
        if (search) filters.search = search;
        if (from) filters.from = from;
        if (to) filters.to = to;
        const res = await window.api.audit.search(filters);
        if (res.success && res.rows) {
          setRows((prev) => [...prev, ...res.rows!]);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [offset, limit, action, entityType, search, from, to]);

  useEffect(() => {
    setOffset(0);
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, entityType, search, from, to, limit]);

  return (
    <>
      <DataTable<AuditLogEntry>
        columns={[
          {
            header: "Time",
            sortKey: "created_at",
            width: "140px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Summary",
            sortKey: "summary",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "User",
            sortKey: "username",
            width: "90px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Action",
            sortKey: "action",
            width: "120px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: "Entity",
            sortKey: "entity_type",
            width: "160px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
        ]}
        data={rows}
        loading={loading}
        emptyMessage="No audit entries found"
        defaultSortKey="created_at"
        defaultSortDirection="desc"
        exportExcel
        exportPdf
        exportFilename="audit-log"
        showRowCount
        totalRowCount={total ?? rows.length}
        getSortValue={(row, key) => {
          if (key === "created_at") return new Date(row.created_at).getTime();
          return String((row as unknown as Record<string, unknown>)[key] ?? "");
        }}
        className="w-full text-left"
        theadClassName="bg-slate-900 text-slate-400 text-xs uppercase"
        renderRow={(row) => (
          <tr
            key={row.id}
            className="border-t border-slate-800 text-xs hover:bg-slate-800/50 transition-colors"
          >
            <td className="p-2 truncate" style={{ width: 140 }}>
              {formatTime(row.created_at)}
            </td>
            <td className="p-2">
              <span className="text-slate-400 truncate block max-w-[480px]">
                {row.summary}
              </span>
            </td>
            <td className="p-2 truncate" style={{ width: 90 }}>
              <span className="text-slate-300">{row.username}</span>
              <span className="text-slate-600 ml-1 text-[10px]">
                {row.role}
              </span>
            </td>
            <td className="p-2" style={{ width: 120 }}>
              <span className={ACTION_COLORS[row.action] || "text-slate-300"}>
                {row.action.replace(/_/g, " ")}
              </span>
            </td>
            <td className="p-2 truncate" style={{ width: 160 }}>
              <span className="text-slate-300">
                {row.entity_type.replace(/_/g, " ")}
              </span>
              {row.entity_id && (
                <span className="text-slate-500 ml-1">#{row.entity_id}</span>
              )}
            </td>
          </tr>
        )}
      />
      {total != null && rows.length < total && (
        <div className="flex justify-center p-3">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="px-4 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
