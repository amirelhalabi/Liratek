import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { AuditLogEntry, AuditSearchFilters } from "@/types/electron";
import {
  DataTable,
  useApi,
  useCursorPages,
  type CursorPage,
} from "@liratek/ui";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { formatCreatedAt } from "../transactionCellText";
import logger from "@/utils/logger";

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

/** "16 Oct, 09:30" — the Transactions table's Time look, in the displayed
 *  language (LIRA-331). */
function formatTime(ts: string, language: string): string {
  return formatCreatedAt(
    ts,
    { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" },
    language,
  );
}

/** A failed page read would otherwise leave an empty table — log it. */
function logPageError(error: unknown): void {
  logger.error("Failed to load the audit log", { error });
}

export interface AuditLogViewerProps {
  action: string;
  entityType: string;
  search: string;
  /** The operator's days (`YYYY-MM-DD`, "" = open end), applied by the
   *  server (LIRA-348, rule 27). */
  from: string;
  to: string;
  /** Rows per page (LIRA-348: 50 — the next page loads as you scroll). */
  limit: number;
  /** LIRA-348 — when given, the table shows its own day filter. */
  onDayRangeChange?: (from: string, to: string) => void;
}

export default function AuditLogViewer({
  action,
  entityType,
  search,
  from,
  to,
  limit,
  onDayRangeChange,
}: AuditLogViewerProps) {
  const { t, i18n } = useTranslation("audit");
  const api = useApi();

  /** LIRA-348 — one page of `limit` rows after `beforeId` (the last id
   *  shown; the log is ordered `id DESC`). Keyset, never an offset. */
  const fetchPage = useCallback(
    async (
      beforeId: number | undefined,
    ): Promise<CursorPage<AuditLogEntry, number>> => {
      const filters: AuditSearchFilters = { limit };
      if (action) filters.action = action;
      if (entityType) filters.entityType = entityType;
      if (search) filters.search = search;
      if (from) filters.dayFrom = from;
      if (to) filters.dayTo = to;
      if (beforeId !== undefined) filters.beforeId = beforeId;
      const res = await api.audit.search(filters);
      if (!res.success) throw new Error(res.error ?? "Audit search failed");
      const rows = (res.rows ?? []) as AuditLogEntry[];
      const last = rows[rows.length - 1];
      return {
        rows,
        nextCursor: rows.length >= limit && last ? last.id : undefined,
      };
    },
    // `api` is read inside the call only; useCursorPages holds this
    // function through a ref, so its identity never re-fires a load
    // (rule 25) — the reset key below decides when to start over.
    [api, action, entityType, search, from, to, limit],
  );
  const pages = useCursorPages(
    fetchPage,
    `${action}|${entityType}|${search}|${from}|${to}|${limit}`,
    logPageError,
  );
  const rows = pages.rows;

  return (
    <>
      <DataTable<AuditLogEntry>
        columns={[
          {
            header: t("columns.time"),
            sortKey: "created_at",
            width: "140px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: t("columns.summary"),
            sortKey: "summary",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: t("columns.user"),
            sortKey: "username",
            width: "90px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: t("columns.action"),
            sortKey: "action",
            width: "120px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
          {
            header: t("columns.entity"),
            sortKey: "entity_type",
            width: "160px",
            className: "p-2 text-xs font-semibold uppercase text-slate-400",
          },
        ]}
        data={rows}
        loading={pages.loading}
        emptyMessage={t("table.noAuditEntries")}
        defaultSortKey="created_at"
        defaultSortDirection="desc"
        exportExcel
        exportPdf
        exportFilename="audit-log"
        showRowCount
        totalRowCount={rows.length}
        loadMore={{
          hasMore: pages.hasMore,
          isLoadingMore: pages.isLoadingMore,
          onLoadMore: pages.loadMore,
          // Export loads every remaining page first.
          loadAll: pages.loadAll,
        }}
        {...(onDayRangeChange
          ? { dayRange: { from, to, onChange: onDayRangeChange } }
          : {})}
        getSortValue={(row, key) => {
          if (key === "created_at")
            return parseDbDate(row.created_at).getTime();
          return String((row as unknown as Record<string, unknown>)[key] ?? "");
        }}
        className="w-full text-start"
        theadClassName="bg-slate-900 text-slate-400 text-xs uppercase"
        renderRow={(row) => (
          <tr
            key={row.id}
            className="border-t border-slate-800 text-xs hover:bg-slate-800/50 transition-colors"
          >
            <td className="p-2 truncate" style={{ width: 140 }}>
              {formatTime(row.created_at, i18n.language)}
            </td>
            <td className="p-2">
              <span className="text-slate-400 truncate block max-w-[480px]">
                {row.summary}
              </span>
            </td>
            <td className="p-2 truncate" style={{ width: 90 }}>
              <span className="text-slate-300">{row.username}</span>
              <span className="text-slate-600 ms-1 text-[10px]">
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
                <span className="text-slate-500 ms-1">#{row.entity_id}</span>
              )}
            </td>
          </tr>
        )}
      />
    </>
  );
}
