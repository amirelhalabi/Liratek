import { useState, useMemo } from "react";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import {
  AlertTriangle,
  Check,
  X,
  Phone,
  Trash2,
  GitMerge,
  UserPlus,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImportEntry = {
  date: string | null;
  amount_usd: number;
  amount_lbp: number;
  description: string;
  type: "debt" | "payment";
};

export type ImportClient = {
  name: string;
  phone: string;
  entries: ImportEntry[];
};

type ResolutionAction = "merge" | "manual" | "keep" | "discard";

interface ClientResolution {
  action: ResolutionAction;
  targetIndex: number; // index into `clients` for merge target
  manualPhone: string; // phone typed by user
}

interface ImportCleanupModalProps {
  clients: ImportClient[];
  onConfirm: (cleanedClients: ImportClient[]) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Name similarity helpers
// ---------------------------------------------------------------------------

function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\(.*?\)/g, "") // remove parenthesized content
    .replace(/[^A-Z0-9\s]/g, " ") // remove special chars
    .replace(/\b(L|AL|EL|MA3|ABU|ABO|IBN)\b/g, "") // remove common prefixes
    .replace(/\s+/g, " ")
    .trim();
}

function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;

  const wordsA = new Set(na.split(" ").filter(Boolean));
  const wordsB = new Set(nb.split(" ").filter(Boolean));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SIMILARITY_THRESHOLD = 0.4;

const ACTION_LABELS: Record<ResolutionAction, string> = {
  merge: "Merge into...",
  manual: "Enter phone",
  keep: "Keep (no phone)",
  discard: "Discard",
};

const ACTION_COLORS: Record<ResolutionAction, string> = {
  merge: "bg-sky-500/20 text-sky-400 border-sky-500/40",
  manual: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  keep: "bg-slate-500/20 text-slate-400 border-slate-500/40",
  discard: "bg-red-500/20 text-red-400 border-red-500/40",
};

export function ImportCleanupModal({
  clients,
  onConfirm,
  onCancel,
}: ImportCleanupModalProps) {
  useModalFocusFix(true);
  // Separate flagged (no phone) and valid (has phone) clients
  const flaggedIndices = useMemo(
    () => clients.map((c, i) => (!c.phone ? i : -1)).filter((i) => i >= 0),
    [clients],
  );

  const validClients = useMemo(
    () =>
      clients
        .map((c, i) => ({ client: c, index: i }))
        .filter((x) => !!x.client.phone),
    [clients],
  );

  // Pre-compute suggestions for each flagged client
  const suggestions = useMemo(() => {
    const map = new Map<
      number,
      { index: number; name: string; phone: string; similarity: number }[]
    >();
    for (const fi of flaggedIndices) {
      const flagged = clients[fi];
      const matches = validClients
        .map((v) => ({
          index: v.index,
          name: v.client.name,
          phone: v.client.phone,
          similarity: nameSimilarity(flagged.name, v.client.name),
        }))
        .filter((m) => m.similarity >= SIMILARITY_THRESHOLD)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);
      map.set(fi, matches);
    }
    return map;
  }, [flaggedIndices, validClients, clients]);

  // Resolution state for each flagged client
  const [resolutions, setResolutions] = useState<Map<number, ClientResolution>>(
    () => {
      const init = new Map<number, ClientResolution>();
      for (const fi of flaggedIndices) {
        const sug = suggestions.get(fi) ?? [];
        // Default: if there's a high-confidence suggestion, pre-select merge; otherwise discard
        if (sug.length > 0 && sug[0].similarity >= 0.6) {
          init.set(fi, {
            action: "merge",
            targetIndex: sug[0].index,
            manualPhone: "",
          });
        } else {
          init.set(fi, { action: "discard", targetIndex: -1, manualPhone: "" });
        }
      }
      return init;
    },
  );

  const updateResolution = (fi: number, updates: Partial<ClientResolution>) => {
    setResolutions((prev) => {
      const next = new Map(prev);
      const current = next.get(fi) ?? {
        action: "discard" as ResolutionAction,
        targetIndex: -1,
        manualPhone: "",
      };
      next.set(fi, { ...current, ...updates });
      return next;
    });
  };

  // Build final client list
  const handleConfirm = () => {
    // Clone clients
    const result: ImportClient[] = clients.map((c) => ({
      ...c,
      entries: [...c.entries],
    }));

    // Track indices to remove (flagged clients that are merged or discarded)
    const toRemove = new Set<number>();

    for (const fi of flaggedIndices) {
      const res = resolutions.get(fi);
      if (!res) {
        toRemove.add(fi);
        continue;
      }

      switch (res.action) {
        case "merge": {
          if (res.targetIndex >= 0 && res.targetIndex < result.length) {
            // Move entries from flagged → target
            result[res.targetIndex].entries.push(...result[fi].entries);
          }
          toRemove.add(fi);
          break;
        }
        case "manual": {
          const phone = res.manualPhone.replace(/\D/g, "").trim();
          if (phone) {
            result[fi].phone = phone;
          } else {
            toRemove.add(fi); // no phone entered, discard
          }
          break;
        }
        case "keep":
          // Keep as-is, no phone
          break;
        case "discard":
          toRemove.add(fi);
          break;
      }
    }

    // Filter out removed indices
    const cleaned = result.filter((_, i) => !toRemove.has(i));
    onConfirm(cleaned);
  };

  const totalEntries = clients.reduce((s, c) => s + c.entries.length, 0);
  const flaggedEntries = flaggedIndices.reduce(
    (s, fi) => s + clients[fi].entries.length,
    0,
  );

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl"
        role="presentation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
              <AlertTriangle size={20} className="text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                Clean Up Import Data
              </h2>
              <p className="text-sm text-slate-400">
                {flaggedIndices.length} client
                {flaggedIndices.length !== 1 ? "s" : ""} need attention (
                {flaggedEntries} entries)
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Summary bar */}
        <div className="px-6 py-3 border-b border-slate-700/50 bg-slate-800/30 flex gap-6 text-sm">
          <div>
            <span className="text-slate-500">Total:</span>{" "}
            <span className="text-white font-medium">
              {clients.length} clients
            </span>
          </div>
          <div>
            <span className="text-slate-500">With phone:</span>{" "}
            <span className="text-emerald-400 font-medium">
              {clients.length - flaggedIndices.length}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Without phone:</span>{" "}
            <span className="text-amber-400 font-medium">
              {flaggedIndices.length}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Entries:</span>{" "}
            <span className="text-white font-medium">
              {totalEntries.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                <th className="pb-3 pr-3">Client Name</th>
                <th className="pb-3 pr-3 w-16 text-center">Entries</th>
                <th className="pb-3 pr-3">Action</th>
                <th className="pb-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {flaggedIndices.map((fi) => {
                const client = clients[fi];
                const res = resolutions.get(fi) ?? {
                  action: "discard" as ResolutionAction,
                  targetIndex: -1,
                  manualPhone: "",
                };
                const sug = suggestions.get(fi) ?? [];

                return (
                  <tr key={fi} className="hover:bg-slate-800/30">
                    {/* Name */}
                    <td className="py-3 pr-3">
                      <div className="font-medium text-white text-sm">
                        {client.name}
                      </div>
                    </td>

                    {/* Entries count */}
                    <td className="py-3 pr-3 text-center">
                      <span className="text-sm text-slate-400">
                        {client.entries.length}
                      </span>
                    </td>

                    {/* Action selector */}
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {(
                          [
                            "merge",
                            "manual",
                            "keep",
                            "discard",
                          ] as ResolutionAction[]
                        ).map((action) => (
                          <button
                            key={action}
                            onClick={() => updateResolution(fi, { action })}
                            className={`px-2 py-1 rounded text-xs font-medium border transition-all ${
                              res.action === action
                                ? ACTION_COLORS[action]
                                : "bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-500"
                            }`}
                          >
                            {action === "merge" && (
                              <GitMerge size={10} className="inline mr-1" />
                            )}
                            {action === "manual" && (
                              <Phone size={10} className="inline mr-1" />
                            )}
                            {action === "keep" && (
                              <UserPlus size={10} className="inline mr-1" />
                            )}
                            {action === "discard" && (
                              <Trash2 size={10} className="inline mr-1" />
                            )}
                            {ACTION_LABELS[action]}
                          </button>
                        ))}
                      </div>
                    </td>

                    {/* Details column — context-dependent */}
                    <td className="py-3">
                      {res.action === "merge" && (
                        <select
                          value={res.targetIndex}
                          onChange={(e) =>
                            updateResolution(fi, {
                              targetIndex: Number(e.target.value),
                            })
                          }
                          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500"
                        >
                          <option value={-1}>Select client...</option>
                          {sug.map((m) => (
                            <option key={m.index} value={m.index}>
                              {m.name} ({m.phone}) —{" "}
                              {Math.round(m.similarity * 100)}%
                            </option>
                          ))}
                          {/* Also allow picking any valid client */}
                          {validClients
                            .filter(
                              (v) => !sug.some((s) => s.index === v.index),
                            )
                            .map((v) => (
                              <option key={v.index} value={v.index}>
                                {v.client.name} ({v.client.phone})
                              </option>
                            ))}
                        </select>
                      )}
                      {res.action === "manual" && (
                        <input
                          type="text"
                          value={res.manualPhone}
                          onChange={(e) =>
                            updateResolution(fi, {
                              manualPhone: e.target.value,
                            })
                          }
                          placeholder="e.g. 03/123456"
                          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
                        />
                      )}
                      {res.action === "discard" && (
                        <span className="text-xs text-red-400/60">
                          {client.entries.length} entries will be lost
                        </span>
                      )}
                      {res.action === "keep" && (
                        <span className="text-xs text-slate-500">
                          Will create client without phone
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {
              flaggedIndices.filter(
                (fi) => resolutions.get(fi)?.action === "discard",
              ).length
            }{" "}
            will be discarded,{" "}
            {
              flaggedIndices.filter(
                (fi) => resolutions.get(fi)?.action === "merge",
              ).length
            }{" "}
            will be merged,{" "}
            {
              flaggedIndices.filter(
                (fi) => resolutions.get(fi)?.action === "manual",
              ).length
            }{" "}
            manual phone,{" "}
            {
              flaggedIndices.filter(
                (fi) => resolutions.get(fi)?.action === "keep",
              ).length
            }{" "}
            kept as-is
          </div>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="px-5 py-2.5 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-5 py-2.5 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20 active:scale-95 transition-all flex items-center gap-2"
            >
              <Check size={18} />
              Confirm & Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
