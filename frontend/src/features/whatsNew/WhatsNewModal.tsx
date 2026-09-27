import { useMemo, useState } from "react";
import { X, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { isElectron } from "@/api/backendApi";
import { ReleaseNotesBody } from "./renderReleaseNotes";
import { filterReleaseNotesForPlatform } from "./filterReleaseNotesForPlatform";
import type { ReleaseNoteEntry } from "./types";

export interface WhatsNewModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: ReleaseNoteEntry[];
}

/**
 * "What's new in LiraTek v<version>" — fixed header/footer, scrollable body
 * (same shape as CashReportModal / ConfirmModal). Shows the latest release's
 * notes, with a collapsible "Earlier updates" list for everything older.
 *
 * Each entry's body is filtered for the platform it's running on (web hides
 * the "Desktop app" section, desktop hides the "Web app" section — owner
 * decision) via the pure filterReleaseNotesForPlatform, using the canonical
 * isElectron() to detect the platform (CLAUDE.md rule 19: never raw
 * `window.api`). An entry whose body is emptied by that filter is dropped
 * entirely, including from "Earlier updates".
 */
export function WhatsNewModal({ isOpen, onClose, entries }: WhatsNewModalProps) {
  const [showEarlier, setShowEarlier] = useState(false);

  const platform = isElectron() ? "desktop" : "web";

  const filteredEntries = useMemo(
    () =>
      entries
        .map((entry) => ({
          ...entry,
          body: filterReleaseNotesForPlatform(entry.body, platform),
        }))
        .filter((entry) => entry.body.trim().length > 0),
    [entries, platform],
  );

  if (!isOpen || filteredEntries.length === 0) return null;

  const [latest, ...earlier] = filteredEntries;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="whats-new-modal"
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-400" />
            <h2 className="text-lg font-bold text-white">
              What&apos;s new in LiraTek v{latest.version}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          <ReleaseNotesBody markdown={latest.body} />

          {earlier.length > 0 && (
            <div className="mt-2 pt-3 border-t border-slate-800">
              <button
                data-testid="whats-new-earlier-toggle"
                onClick={() => setShowEarlier((v) => !v)}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
              >
                {showEarlier ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                Earlier updates
              </button>

              {showEarlier && (
                <div className="mt-3 space-y-4">
                  {earlier.map((entry) => (
                    <div key={entry.version}>
                      <h4 className="text-sm font-semibold text-slate-400 mb-1">
                        v{entry.version}
                      </h4>
                      <ReleaseNotesBody markdown={entry.body} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-700 flex justify-end">
          <button
            data-testid="whats-new-got-it-btn"
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-bold transition-colors shadow-lg shadow-violet-900/20"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default WhatsNewModal;
