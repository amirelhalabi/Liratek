import { useEffect, useState, useCallback } from "react";
import type { AuditLogEntry, AuditSearchFilters } from "@/types/electron";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";

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

const ACTION_OPTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "LOGOUT",
  "VOID",
  "REFUND",
  "PROCESS",
  "SETTINGS_CHANGE",
  "IMPORT",
  "EXPORT",
  "BACKUP",
  "RESTORE",
  "SEED",
];

const ENTITY_TYPE_OPTIONS = [
  "user",
  "product",
  "sale",
  "client",
  "debt",
  "financial_service",
  "recharge",
  "exchange",
  "loto_ticket",
  "loto_settings",
  "expense",
  "maintenance",
  "supplier",
  "rate",
  "currency",
  "module",
  "payment_method",
  "mobile_service_item",
  "settings",
  "backup",
  "session",
  "item_cost",
  "custom_service",
];

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

function tryParseJSON(val: string | null): Record<string, unknown> | null {
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function DiffView({
  oldValues,
  newValues,
}: {
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}) {
  if (!oldValues && !newValues) return null;

  const allKeys = Array.from(
    new Set([...Object.keys(oldValues || {}), ...Object.keys(newValues || {})]),
  );

  if (oldValues && newValues) {
    const changedKeys = allKeys.filter(
      (k) => JSON.stringify(oldValues[k]) !== JSON.stringify(newValues[k]),
    );
    if (changedKeys.length === 0) {
      return (
        <span className="text-slate-500 text-xs italic">
          No changes detected
        </span>
      );
    }
    return (
      <div className="space-y-1">
        <span className="text-xs font-semibold text-slate-400">Changes:</span>
        <div className="grid gap-1">
          {changedKeys.map((k) => (
            <div key={k} className="flex items-start gap-2 text-xs font-mono">
              <span className="text-slate-400 min-w-[120px] shrink-0">
                {k}:
              </span>
              <span className="text-red-400 line-through">
                {JSON.stringify(oldValues[k]) ?? "\u2014"}
              </span>
              <span className="text-slate-600">\u2192</span>
              <span className="text-green-400">
                {JSON.stringify(newValues[k]) ?? "\u2014"}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const label = newValues ? "New values" : "Previous values";
  const data = (newValues || oldValues)!;
  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold text-slate-400">{label}:</span>
      <div className="grid gap-0.5">
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="flex gap-2 text-xs font-mono">
            <span className="text-slate-400 min-w-[120px] shrink-0">{k}:</span>
            <span className="text-slate-200">{JSON.stringify(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetadataView({ metadata }: { metadata: Record<string, unknown> }) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold text-slate-400">Metadata:</span>
      <div className="grid gap-0.5">
        {Object.entries(metadata).map(([k, v]) => (
          <div key={k} className="flex gap-2 text-xs font-mono">
            <span className="text-slate-400 min-w-[120px] shrink-0">{k}:</span>
            <span className="text-slate-200">{JSON.stringify(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const selectClass =
  "bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm";
const inputClass =
  "bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm";

export default function AuditLogViewer() {
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(100);
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

  const toggleExpand = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className={selectClass}
        >
          <option value="">All actions</option>
          {ACTION_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {a.replace(/_/g, " ")}
            </option>
          ))}
        </select>

        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className={selectClass}
        >
          <option value="">All entities</option>
          {ENTITY_TYPE_OPTIONS.map((et) => (
            <option key={et} value={et}>
              {et.replace(/_/g, " ")}
            </option>
          ))}
        </select>

        <input
          placeholder="Search summary..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} w-48`}
        />

        <label className="text-xs text-slate-400">From:</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={inputClass}
        />
        <label className="text-xs text-slate-400">To:</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={inputClass}
        />

        <div className="flex items-center gap-1 ml-auto">
          <label className="text-xs text-slate-400">Rows:</label>
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 100)}
            className={`${inputClass} w-16`}
          />
          <button
            onClick={() => load(false)}
            disabled={loading}
            className="p-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {total != null && (
        <div className="text-xs text-slate-500">
          Showing {rows.length} of {total} entries
        </div>
      )}

      {/* Table */}
      <div className="border border-slate-700 rounded overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="p-2 w-6" />
              <th className="p-2" style={{ width: 140 }}>
                Time
              </th>
              <th className="p-2" style={{ width: 90 }}>
                User
              </th>
              <th className="p-2" style={{ width: 120 }}>
                Action
              </th>
              <th className="p-2" style={{ width: 160 }}>
                Entity
              </th>
              <th className="p-2">Summary</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="p-4 text-center text-slate-500 text-sm"
                >
                  Loading...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="p-4 text-center text-slate-500 text-sm"
                >
                  No audit entries found
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const isExpanded = expandedId === row.id;
              const oldVals = tryParseJSON(row.old_values);
              const newVals = tryParseJSON(row.new_values);
              const meta = tryParseJSON(row.metadata);
              const hasDetails = oldVals || newVals || meta;

              return (
                <tr key={row.id} className="group">
                  <td colSpan={6} className="p-0 border-t border-slate-800">
                    <div
                      className={`flex items-center text-xs cursor-pointer hover:bg-slate-800/50 transition-colors ${isExpanded ? "bg-slate-800/30" : ""}`}
                      onClick={() => hasDetails && toggleExpand(row.id)}
                    >
                      <div className="p-2 w-6 shrink-0">
                        {hasDetails &&
                          (isExpanded ? (
                            <ChevronDown size={12} className="text-slate-500" />
                          ) : (
                            <ChevronRight
                              size={12}
                              className="text-slate-500"
                            />
                          ))}
                      </div>
                      <div className="p-2 truncate" style={{ width: 140 }}>
                        {formatTime(row.created_at)}
                      </div>
                      <div className="p-2 truncate" style={{ width: 90 }}>
                        <span className="text-slate-300">{row.username}</span>
                        <span className="text-slate-600 ml-1 text-[10px]">
                          {row.role}
                        </span>
                      </div>
                      <div className="p-2" style={{ width: 120 }}>
                        <span
                          className={
                            ACTION_COLORS[row.action] || "text-slate-300"
                          }
                        >
                          {row.action.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="p-2 truncate" style={{ width: 160 }}>
                        <span className="text-slate-300">
                          {row.entity_type.replace(/_/g, " ")}
                        </span>
                        {row.entity_id && (
                          <span className="text-slate-500 ml-1">
                            #{row.entity_id}
                          </span>
                        )}
                      </div>
                      <div className="p-2 truncate flex-1 text-slate-400">
                        {row.summary}
                      </div>
                    </div>

                    {isExpanded && hasDetails && (
                      <div className="px-8 pb-3 pt-1 space-y-2 bg-slate-900/50 border-t border-slate-800/50">
                        <DiffView oldValues={oldVals} newValues={newVals} />
                        {meta && <MetadataView metadata={meta} />}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total != null && rows.length < total && (
        <div className="flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="px-4 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
