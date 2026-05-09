import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Clock,
  ChevronDown,
  Loader2,
  AlertCircle,
  History,
} from "lucide-react";
import type { AuditLogEntry } from "@/types/electron";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EditHistoryPopoverProps {
  entityType: string;
  entityId: string | number;
  /** The badge / element that triggers the popover on click */
  trigger: React.ReactNode;
}

interface ParsedChange {
  field: string;
  oldValue: string;
  newValue: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Attempt to parse JSON; return null on failure.
 */
function tryParse(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract changed fields by diffing old_values vs new_values JSON blobs.
 * Returns all keys present in new_values; falls back to summary string.
 */
function extractChanges(entry: AuditLogEntry): ParsedChange[] {
  const oldObj = tryParse(entry.old_values);
  const newObj = tryParse(entry.new_values);

  if (!newObj) return [];

  const fields = Object.keys(newObj);
  return fields
    .map((field): ParsedChange => {
      const rawOld = oldObj?.[field];
      const rawNew = newObj[field];

      const fmt = (v: unknown): string => {
        if (v === null || v === undefined) return "—";
        if (typeof v === "string" && v.trim() === "") return "—";
        return String(v);
      };

      return {
        field: field
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        oldValue: fmt(rawOld),
        newValue: fmt(rawNew),
      };
    })
    .filter((c) => c.oldValue !== c.newValue);
}

/**
 * Format ISO timestamp into a human-readable local string.
 */
function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export const EditHistoryPopover: React.FC<EditHistoryPopoverProps> = ({
  entityType,
  entityId,
  trigger,
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // ── Close on outside click ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;

    function handleOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  // ── Fetch history ──────────────────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.audit.getByEntity(
        entityType,
        String(entityId),
      );
      if (result.success) {
        setEntries(result.rows ?? []);
      } else {
        setError(result.error ?? "Failed to load edit history.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  // ── Toggle open ────────────────────────────────────────────────────────────
  function handleTriggerClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open) {
      setOpen(true);
      // Always refresh when opening
      void fetchHistory();
    } else {
      setOpen(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative inline-flex">
      {/* Trigger wrapper – intercepts click */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={handleTriggerClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleTriggerClick(e as unknown as React.MouseEvent);
          }
        }}
        className="cursor-pointer select-none"
      >
        <span className="inline-flex items-center gap-1">
          {trigger}
          <ChevronDown
            size={8}
            className={`text-yellow-400 transition-transform duration-150 ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
      </div>

      {/* Popover panel */}
      {open && (
        <div
          className="
            absolute z-50 top-full mt-1.5 left-1/2 -translate-x-1/2
            w-80 max-h-96 overflow-y-auto
            bg-slate-900 border border-slate-700 rounded-xl shadow-2xl
            animate-in fade-in zoom-in-95 duration-150
          "
          role="dialog"
          aria-label="Edit history"
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/70 sticky top-0 bg-slate-900 rounded-t-xl z-10">
            <History size={13} className="text-yellow-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-200 tracking-wide uppercase">
              Edit History
            </span>
          </div>

          {/* Body */}
          <div className="p-3">
            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-xs">Loading…</span>
              </div>
            )}

            {/* Error */}
            {!loading && error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-3">
                <AlertCircle
                  size={14}
                  className="text-red-400 mt-0.5 shrink-0"
                />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}

            {/* Empty */}
            {!loading && !error && entries !== null && entries.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-slate-500">
                <Clock size={20} />
                <span className="text-xs">No edit history</span>
              </div>
            )}

            {/* Timeline */}
            {!loading && !error && entries && entries.length > 0 && (
              <ol className="relative border-l border-slate-700 ml-2 space-y-4 py-1">
                {entries.map((entry, idx) => {
                  const changes = extractChanges(entry);
                  return (
                    <li key={entry.id} className="ml-4">
                      {/* Timeline dot */}
                      <span
                        className={`
                          absolute -left-[5px] mt-0.5 h-2.5 w-2.5 rounded-full border-2
                          ${
                            idx === 0
                              ? "border-yellow-400 bg-yellow-400/30"
                              : "border-slate-600 bg-slate-800"
                          }
                        `}
                      />

                      {/* Entry header */}
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-slate-200">
                          {entry.username}
                        </span>
                        <span className="text-[10px] text-slate-500 shrink-0">
                          {formatTimestamp(entry.created_at)}
                        </span>
                      </div>

                      {/* Summary line (always shown) */}
                      {entry.summary && (
                        <p className="text-[11px] text-slate-400 mb-1 leading-snug">
                          {entry.summary}
                        </p>
                      )}

                      {/* Changed fields */}
                      {changes.length > 0 && (
                        <ul className="space-y-1 mt-1.5">
                          {changes.map((change) => (
                            <li
                              key={change.field}
                              className="text-[10px] bg-slate-800/60 rounded-md px-2 py-1.5 border border-slate-700/50"
                            >
                              <span className="text-slate-400 font-medium block mb-0.5">
                                {change.field}
                              </span>
                              <span className="inline-flex items-center gap-1.5 flex-wrap">
                                <span className="line-through text-red-400/80 bg-red-500/10 rounded px-1 py-0.5">
                                  {change.oldValue}
                                </span>
                                <span className="text-slate-500">→</span>
                                <span className="text-green-400/90 bg-green-500/10 rounded px-1 py-0.5">
                                  {change.newValue}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EditHistoryPopover;
