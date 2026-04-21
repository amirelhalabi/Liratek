import { useState, useMemo } from "react";
import {
  AlertTriangle,
  Check,
  X,
  Phone,
  PhoneOff,
  Trash2,
  GitMerge,
  UserPlus,
  Link2,
  FileQuestion,
  FileX2,
  ChevronDown,
  ChevronRight,
  ArrowLeftRight,
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

export type ListNameEntry = {
  name: string;
  phone: string;
};

export type ParsedClientPage = {
  sheetName: string;
  name: string;
  phone: string;
  entries: ImportEntry[];
};

export type ImportClient = {
  name: string;
  phone: string;
  entries: ImportEntry[];
};

type IssueCategory = 1 | 2 | 3 | 4;

interface ValidationIssue {
  id: string; // unique key for React
  category: IssueCategory;
  name: string;
  phone: string;
  entryCount: number;
  sourceType: "listName" | "page";
  sourceIndex: number;
}

type ResolutionAction = "keep" | "discard" | "link" | "manual_phone" | "merge";

interface Resolution {
  action: ResolutionAction;
  manualPhone: string;
  linkTargetIndex: number;
  mergeTargetIndex: number;
}

interface ImportValidationModalProps {
  listNameEntries: ListNameEntry[];
  parsedPages: ParsedClientPage[];
  onConfirm: (resolvedClients: ImportClient[]) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Name similarity helpers (same logic as ImportCleanupModal)
// ---------------------------------------------------------------------------

function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\b(L|AL|EL|MA3|ABU|ABO|IBN)\b/g, "")
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

const MATCH_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Section config
// ---------------------------------------------------------------------------

const SECTION_CONFIG: Record<
  IssueCategory,
  {
    label: string;
    color: string;
    badgeColor: string;
    icon: typeof FileQuestion;
    actions: ResolutionAction[];
  }
> = {
  1: {
    label: "In List, No Matching Page",
    color: "text-orange-400",
    badgeColor: "bg-orange-500/20 text-orange-400",
    icon: FileQuestion,
    actions: ["link", "keep", "discard"],
  },
  2: {
    label: "Page Without List Entry",
    color: "text-purple-400",
    badgeColor: "bg-purple-500/20 text-purple-400",
    icon: FileX2,
    actions: ["keep", "link", "discard"],
  },
  3: {
    label: "List Entry Missing Phone",
    color: "text-amber-400",
    badgeColor: "bg-amber-500/20 text-amber-400",
    icon: PhoneOff,
    actions: ["manual_phone", "merge", "keep", "discard"],
  },
  4: {
    label: "Page Missing Phone",
    color: "text-red-400",
    badgeColor: "bg-red-500/20 text-red-400",
    icon: PhoneOff,
    actions: ["manual_phone", "merge", "keep", "discard"],
  },
};

const ACTION_LABELS: Record<ResolutionAction, string> = {
  keep: "Keep",
  discard: "Discard",
  link: "Link to...",
  manual_phone: "Enter phone",
  merge: "Merge into...",
};

const ACTION_COLORS: Record<ResolutionAction, string> = {
  keep: "bg-slate-500/20 text-slate-400 border-slate-500/40",
  discard: "bg-red-500/20 text-red-400 border-red-500/40",
  link: "bg-sky-500/20 text-sky-400 border-sky-500/40",
  manual_phone: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  merge: "bg-violet-500/20 text-violet-400 border-violet-500/40",
};

const ACTION_ICONS: Record<ResolutionAction, typeof Check> = {
  keep: UserPlus,
  discard: Trash2,
  link: Link2,
  manual_phone: Phone,
  merge: GitMerge,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImportValidationModal({
  listNameEntries,
  parsedPages,
  onConfirm,
  onCancel,
}: ImportValidationModalProps) {
  // -------------------------------------------------------------------------
  // Cross-reference: build match maps
  // -------------------------------------------------------------------------

  const { listToPageMap, pageToListMap } = useMemo(() => {
    const l2p = new Map<number, number>(); // listIndex → pageIndex
    const p2l = new Map<number, number>(); // pageIndex → listIndex

    for (let li = 0; li < listNameEntries.length; li++) {
      let bestPageIdx = -1;
      let bestSim = 0;
      for (let pi = 0; pi < parsedPages.length; pi++) {
        const sim = nameSimilarity(
          listNameEntries[li].name,
          parsedPages[pi].name,
        );
        if (sim >= MATCH_THRESHOLD && sim > bestSim) {
          bestSim = sim;
          bestPageIdx = pi;
        }
      }
      if (bestPageIdx >= 0) {
        l2p.set(li, bestPageIdx);
        // Only set if this page hasn't been claimed by a higher-similarity list entry
        if (!p2l.has(bestPageIdx)) {
          p2l.set(bestPageIdx, li);
        }
      }
    }
    return { listToPageMap: l2p, pageToListMap: p2l };
  }, [listNameEntries, parsedPages]);

  // -------------------------------------------------------------------------
  // Identify issues
  // -------------------------------------------------------------------------

  const issues = useMemo(() => {
    const result: ValidationIssue[] = [];

    // Case 1: In list, no matching page
    for (let li = 0; li < listNameEntries.length; li++) {
      if (!listToPageMap.has(li)) {
        const entry = listNameEntries[li];
        result.push({
          id: `c1-${li}`,
          category: 1,
          name: entry.name,
          phone: entry.phone,
          entryCount: 0,
          sourceType: "listName",
          sourceIndex: li,
        });
      }
    }

    // Case 2: Page without list entry
    for (let pi = 0; pi < parsedPages.length; pi++) {
      if (!pageToListMap.has(pi)) {
        const page = parsedPages[pi];
        result.push({
          id: `c2-${pi}`,
          category: 2,
          name: page.name,
          phone: page.phone,
          entryCount: page.entries.length,
          sourceType: "page",
          sourceIndex: pi,
        });
      }
    }

    // Case 3: List entry missing phone
    for (let li = 0; li < listNameEntries.length; li++) {
      if (!listNameEntries[li].phone) {
        const matchedPageIdx = listToPageMap.get(li);
        const entryCount =
          matchedPageIdx !== undefined
            ? parsedPages[matchedPageIdx].entries.length
            : 0;
        result.push({
          id: `c3-${li}`,
          category: 3,
          name: listNameEntries[li].name,
          phone: "",
          entryCount,
          sourceType: "listName",
          sourceIndex: li,
        });
      }
    }

    // Case 4: Page missing phone
    for (let pi = 0; pi < parsedPages.length; pi++) {
      if (!parsedPages[pi].phone) {
        result.push({
          id: `c4-${pi}`,
          category: 4,
          name: parsedPages[pi].name,
          phone: "",
          entryCount: parsedPages[pi].entries.length,
          sourceType: "page",
          sourceIndex: pi,
        });
      }
    }

    return result;
  }, [listNameEntries, parsedPages, listToPageMap, pageToListMap]);

  // Group by category
  const issuesByCategory = useMemo(() => {
    const map: Record<IssueCategory, ValidationIssue[]> = {
      1: [],
      2: [],
      3: [],
      4: [],
    };
    for (const issue of issues) {
      map[issue.category].push(issue);
    }
    return map;
  }, [issues]);

  // -------------------------------------------------------------------------
  // Resolution state
  // -------------------------------------------------------------------------

  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(
    () => {
      const init = new Map<string, Resolution>();
      for (const issue of issues) {
        const defaultAction: ResolutionAction =
          issue.category === 2 ? "keep" : "discard";
        init.set(issue.id, {
          action: defaultAction,
          manualPhone: "",
          linkTargetIndex: -1,
          mergeTargetIndex: -1,
        });
      }
      return init;
    },
  );

  const updateResolution = (id: string, updates: Partial<Resolution>) => {
    setResolutions((prev) => {
      const next = new Map(prev);
      const current = next.get(id) ?? {
        action: "discard" as ResolutionAction,
        manualPhone: "",
        linkTargetIndex: -1,
        mergeTargetIndex: -1,
      };
      next.set(id, { ...current, ...updates });
      return next;
    });
  };

  // -------------------------------------------------------------------------
  // Fuzzy suggestions for linking
  // -------------------------------------------------------------------------

  const pageSuggestionsForList = useMemo(() => {
    const map = new Map<
      number,
      { index: number; name: string; similarity: number }[]
    >();
    for (let li = 0; li < listNameEntries.length; li++) {
      const matches = parsedPages
        .map((p, pi) => ({
          index: pi,
          name: p.name,
          similarity: nameSimilarity(listNameEntries[li].name, p.name),
        }))
        .filter((m) => m.similarity >= 0.3)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 8);
      map.set(li, matches);
    }
    return map;
  }, [listNameEntries, parsedPages]);

  const listSuggestionsForPage = useMemo(() => {
    const map = new Map<
      number,
      { index: number; name: string; similarity: number }[]
    >();
    for (let pi = 0; pi < parsedPages.length; pi++) {
      const matches = listNameEntries
        .map((l, li) => ({
          index: li,
          name: l.name,
          similarity: nameSimilarity(parsedPages[pi].name, l.name),
        }))
        .filter((m) => m.similarity >= 0.3)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 8);
      map.set(pi, matches);
    }
    return map;
  }, [listNameEntries, parsedPages]);

  // Clients with phone (for merge targets)
  const clientsWithPhone = useMemo(() => {
    const result: { index: number; name: string; phone: string }[] = [];
    for (let pi = 0; pi < parsedPages.length; pi++) {
      if (parsedPages[pi].phone) {
        result.push({
          index: pi,
          name: parsedPages[pi].name,
          phone: parsedPages[pi].phone,
        });
      }
    }
    return result;
  }, [parsedPages]);

  // -------------------------------------------------------------------------
  // Accordion state
  // -------------------------------------------------------------------------

  const [expanded, setExpanded] = useState<Set<IssueCategory>>(() => {
    const initial = new Set<IssueCategory>();
    for (const cat of [1, 2, 3, 4] as IssueCategory[]) {
      if (issuesByCategory[cat].length > 0) initial.add(cat);
    }
    return initial;
  });

  const toggleSection = (cat: IssueCategory) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // -------------------------------------------------------------------------
  // Build final result on confirm
  // -------------------------------------------------------------------------

  const handleConfirm = () => {
    // Track which pages are included/excluded/modified
    const pageIncluded = new Set<number>();
    const pageExcluded = new Set<number>();
    const pagePhoneOverrides = new Map<number, string>(); // pageIndex → phone
    const pageMergeTargets = new Map<number, number>(); // sourcePageIdx → targetPageIdx
    const extraClients: ImportClient[] = []; // from Case 1 "keep"

    // Process issues by category
    for (const issue of issues) {
      const res = resolutions.get(issue.id);
      if (!res) continue;

      switch (issue.category) {
        case 1: {
          // In list, no page
          if (res.action === "keep") {
            extraClients.push({
              name: issue.name,
              phone: issue.phone,
              entries: [],
            });
          } else if (res.action === "link" && res.linkTargetIndex >= 0) {
            // Link list entry to a page — apply list phone to page if page lacks phone
            const pageIdx = res.linkTargetIndex;
            pageIncluded.add(pageIdx);
            if (!parsedPages[pageIdx].phone && issue.phone) {
              pagePhoneOverrides.set(pageIdx, issue.phone);
            }
          }
          // discard: do nothing
          break;
        }
        case 2: {
          // Page, not in list
          const pageIdx = issue.sourceIndex;
          if (res.action === "keep") {
            pageIncluded.add(pageIdx);
          } else if (res.action === "link" && res.linkTargetIndex >= 0) {
            // Link page to list entry — apply list phone if page lacks phone
            const listIdx = res.linkTargetIndex;
            pageIncluded.add(pageIdx);
            if (!parsedPages[pageIdx].phone && listNameEntries[listIdx].phone) {
              pagePhoneOverrides.set(pageIdx, listNameEntries[listIdx].phone);
            }
          } else if (res.action === "discard") {
            pageExcluded.add(pageIdx);
          }
          break;
        }
        case 3: {
          // List entry missing phone — find their matched page
          const matchedPageIdx = listToPageMap.get(issue.sourceIndex);
          if (res.action === "manual_phone" && res.manualPhone.trim()) {
            const phone = res.manualPhone.replace(/\D/g, "").trim();
            if (matchedPageIdx !== undefined) {
              pagePhoneOverrides.set(matchedPageIdx, phone);
              pageIncluded.add(matchedPageIdx);
            } else {
              extraClients.push({ name: issue.name, phone, entries: [] });
            }
          } else if (res.action === "merge" && res.mergeTargetIndex >= 0) {
            if (matchedPageIdx !== undefined) {
              pageMergeTargets.set(matchedPageIdx, res.mergeTargetIndex);
              pageExcluded.add(matchedPageIdx);
            }
          } else if (res.action === "keep") {
            if (matchedPageIdx !== undefined) {
              pageIncluded.add(matchedPageIdx);
            } else {
              extraClients.push({
                name: issue.name,
                phone: "",
                entries: [],
              });
            }
          } else if (res.action === "discard") {
            if (matchedPageIdx !== undefined) {
              pageExcluded.add(matchedPageIdx);
            }
          }
          break;
        }
        case 4: {
          // Page missing phone
          const pageIdx = issue.sourceIndex;
          if (res.action === "manual_phone" && res.manualPhone.trim()) {
            const phone = res.manualPhone.replace(/\D/g, "").trim();
            pagePhoneOverrides.set(pageIdx, phone);
            pageIncluded.add(pageIdx);
          } else if (res.action === "merge" && res.mergeTargetIndex >= 0) {
            pageMergeTargets.set(pageIdx, res.mergeTargetIndex);
            pageExcluded.add(pageIdx);
          } else if (res.action === "keep") {
            pageIncluded.add(pageIdx);
          } else if (res.action === "discard") {
            pageExcluded.add(pageIdx);
          }
          break;
        }
      }
    }

    // Build final clients array from pages
    const clients: ImportClient[] = [];
    const mergedEntries = new Map<number, ImportEntry[]>(); // targetIdx → extra entries

    // Collect merge entries
    for (const [sourceIdx, targetIdx] of pageMergeTargets) {
      const existing = mergedEntries.get(targetIdx) ?? [];
      existing.push(...parsedPages[sourceIdx].entries);
      mergedEntries.set(targetIdx, existing);
    }

    for (let pi = 0; pi < parsedPages.length; pi++) {
      if (pageExcluded.has(pi)) continue;

      const page = parsedPages[pi];
      const phone = pagePhoneOverrides.get(pi) ?? page.phone;
      const extraEntries = mergedEntries.get(pi) ?? [];

      clients.push({
        name: page.name,
        phone,
        entries: [...page.entries, ...extraEntries],
      });
    }

    // Add extra clients from Case 1 "keep" and Case 3 without matched page
    clients.push(...extraClients);

    onConfirm(clients);
  };

  // -------------------------------------------------------------------------
  // Summary stats
  // -------------------------------------------------------------------------

  const summaryStats = useMemo(() => {
    let kept = 0;
    let discarded = 0;
    let linked = 0;
    let manualPhone = 0;
    let merged = 0;
    for (const [, res] of resolutions) {
      switch (res.action) {
        case "keep":
          kept++;
          break;
        case "discard":
          discarded++;
          break;
        case "link":
          linked++;
          break;
        case "manual_phone":
          manualPhone++;
          break;
        case "merge":
          merged++;
          break;
      }
    }
    return { kept, discarded, linked, manualPhone, merged };
  }, [resolutions]);

  const totalIssues = issues.length;

  if (totalIssues === 0) {
    // No issues at all — shouldn't normally be shown, but handle gracefully
    onConfirm(
      parsedPages.map((p) => ({
        name: p.name,
        phone: p.phone,
        entries: [...p.entries],
      })),
    );
    return null;
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl"
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
                Import Validation
              </h2>
              <p className="text-sm text-slate-400">
                {totalIssues} issue{totalIssues !== 1 ? "s" : ""} found — review
                before importing
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
        <div className="px-6 py-3 border-b border-slate-700/50 bg-slate-800/30 flex gap-6 text-sm flex-wrap">
          <div>
            <span className="text-slate-500">List Names:</span>{" "}
            <span className="text-white font-medium">
              {listNameEntries.length}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Pages:</span>{" "}
            <span className="text-white font-medium">{parsedPages.length}</span>
          </div>
          {([1, 2, 3, 4] as IssueCategory[]).map((cat) => (
            <div key={cat}>
              <span className="text-slate-500">Case {cat}:</span>{" "}
              <span
                className={`font-medium ${issuesByCategory[cat].length > 0 ? SECTION_CONFIG[cat].color : "text-emerald-400"}`}
              >
                {issuesByCategory[cat].length}
              </span>
            </div>
          ))}
        </div>

        {/* Accordion sections */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {([1, 2, 3, 4] as IssueCategory[]).map((cat) => {
            const config = SECTION_CONFIG[cat];
            const sectionIssues = issuesByCategory[cat];
            const isExpanded = expanded.has(cat);
            const SectionIcon = config.icon;

            return (
              <div
                key={cat}
                className="border border-slate-700/50 rounded-xl overflow-hidden"
              >
                {/* Section header */}
                <button
                  onClick={() => toggleSection(cat)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800/50 hover:bg-slate-800 transition-colors text-left"
                >
                  {isExpanded ? (
                    <ChevronDown size={16} className="text-slate-400" />
                  ) : (
                    <ChevronRight size={16} className="text-slate-400" />
                  )}
                  <SectionIcon size={16} className={config.color} />
                  <span className={`font-medium text-sm ${config.color}`}>
                    {config.label}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-bold ${config.badgeColor}`}
                  >
                    {sectionIssues.length}
                  </span>
                  {sectionIssues.length === 0 && (
                    <span className="text-xs text-emerald-400/60 ml-auto">
                      No issues
                    </span>
                  )}
                </button>

                {/* Section content */}
                {isExpanded && sectionIssues.length > 0 && (
                  <div className="border-t border-slate-700/30">
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                          <th className="px-4 py-2 pr-3">Client Name</th>
                          <th className="px-4 py-2 pr-3 w-24">Phone</th>
                          <th className="px-4 py-2 pr-3 w-20 text-center">
                            Entries
                          </th>
                          <th className="px-4 py-2 pr-3">Action</th>
                          <th className="px-4 py-2">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/20">
                        {sectionIssues.map((issue) => {
                          const res = resolutions.get(issue.id) ?? {
                            action: "discard" as ResolutionAction,
                            manualPhone: "",
                            linkTargetIndex: -1,
                            mergeTargetIndex: -1,
                          };

                          return (
                            <tr
                              key={issue.id}
                              className="hover:bg-slate-800/30"
                            >
                              <td className="px-4 py-2.5 pr-3">
                                <span className="font-medium text-white text-sm">
                                  {issue.name}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 pr-3">
                                <span className="text-sm text-slate-400 font-mono">
                                  {issue.phone || (
                                    <span className="text-slate-600">—</span>
                                  )}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 pr-3 text-center">
                                {issue.entryCount === 0 ? (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-400">
                                    0
                                  </span>
                                ) : (
                                  <span className="text-sm text-slate-400">
                                    {issue.entryCount}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 pr-3">
                                <div className="flex flex-wrap gap-1">
                                  {config.actions.map((action) => {
                                    const Icon = ACTION_ICONS[action];
                                    return (
                                      <button
                                        key={action}
                                        onClick={() =>
                                          updateResolution(issue.id, { action })
                                        }
                                        className={`px-2 py-1 rounded text-xs font-medium border transition-all ${
                                          res.action === action
                                            ? ACTION_COLORS[action]
                                            : "bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-500"
                                        }`}
                                      >
                                        <Icon
                                          size={10}
                                          className="inline mr-1"
                                        />
                                        {ACTION_LABELS[action]}
                                      </button>
                                    );
                                  })}
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                {renderDetails(
                                  issue,
                                  res,
                                  cat,
                                  updateResolution,
                                  pageSuggestionsForList,
                                  listSuggestionsForPage,
                                  clientsWithPhone,
                                  parsedPages,
                                  listNameEntries,
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700 flex items-center justify-between">
          <div className="text-xs text-slate-500 flex gap-4 flex-wrap">
            <span>{summaryStats.kept} kept</span>
            <span>{summaryStats.discarded} discarded</span>
            <span>{summaryStats.linked} linked</span>
            <span>{summaryStats.manualPhone} manual phone</span>
            <span>{summaryStats.merged} merged</span>
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
              Confirm & Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details column renderer
// ---------------------------------------------------------------------------

function renderDetails(
  issue: ValidationIssue,
  res: Resolution,
  category: IssueCategory,
  updateRes: (id: string, updates: Partial<Resolution>) => void,
  pageSuggestions: Map<
    number,
    { index: number; name: string; similarity: number }[]
  >,
  listSuggestions: Map<
    number,
    { index: number; name: string; similarity: number }[]
  >,
  clientsWithPhone: { index: number; name: string; phone: string }[],
  parsedPages: ParsedClientPage[],
  listNameEntries: ListNameEntry[],
) {
  if (res.action === "discard") {
    return (
      <span className="text-xs text-red-400/60">
        {issue.entryCount > 0
          ? `${issue.entryCount} entries will be lost`
          : "Will be skipped"}
      </span>
    );
  }

  if (res.action === "keep") {
    return (
      <span className="text-xs text-slate-500">
        {category === 1
          ? "Create client with no debt entries"
          : issue.phone
            ? "Import as-is"
            : "Will create client without phone"}
      </span>
    );
  }

  if (res.action === "link") {
    if (category === 1) {
      // Link list entry to a page
      const sug = pageSuggestions.get(issue.sourceIndex) ?? [];
      return (
        <select
          value={res.linkTargetIndex}
          onChange={(e) =>
            updateRes(issue.id, { linkTargetIndex: Number(e.target.value) })
          }
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500"
        >
          <option value={-1}>Select page...</option>
          {sug.map((m) => (
            <option key={m.index} value={m.index}>
              {m.name} — {Math.round(m.similarity * 100)}%
            </option>
          ))}
          {parsedPages
            .map((p, pi) => ({ name: p.name, index: pi }))
            .filter((p) => !sug.some((s) => s.index === p.index))
            .map((p) => (
              <option key={p.index} value={p.index}>
                {p.name}
              </option>
            ))}
        </select>
      );
    }
    if (category === 2) {
      // Link page to list entry
      const sug = listSuggestions.get(issue.sourceIndex) ?? [];
      return (
        <select
          value={res.linkTargetIndex}
          onChange={(e) =>
            updateRes(issue.id, { linkTargetIndex: Number(e.target.value) })
          }
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500"
        >
          <option value={-1}>Select list entry...</option>
          {sug.map((m) => (
            <option key={m.index} value={m.index}>
              {m.name} ({listNameEntries[m.index].phone || "no phone"}) —{" "}
              {Math.round(m.similarity * 100)}%
            </option>
          ))}
          {listNameEntries
            .map((l, li) => ({ name: l.name, phone: l.phone, index: li }))
            .filter((l) => !sug.some((s) => s.index === l.index))
            .map((l) => (
              <option key={l.index} value={l.index}>
                {l.name} ({l.phone || "no phone"})
              </option>
            ))}
        </select>
      );
    }
  }

  if (res.action === "manual_phone") {
    return (
      <input
        type="text"
        value={res.manualPhone}
        onChange={(e) => updateRes(issue.id, { manualPhone: e.target.value })}
        placeholder="e.g. 03/123456"
        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
      />
    );
  }

  if (res.action === "merge") {
    return (
      <select
        value={res.mergeTargetIndex}
        onChange={(e) =>
          updateRes(issue.id, { mergeTargetIndex: Number(e.target.value) })
        }
        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-violet-500"
      >
        <option value={-1}>Select client...</option>
        {clientsWithPhone.map((c) => (
          <option key={c.index} value={c.index}>
            {c.name} ({c.phone})
          </option>
        ))}
      </select>
    );
  }

  return null;
}
