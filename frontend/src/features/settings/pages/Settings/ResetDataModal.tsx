import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useApi } from "@liratek/ui";
import { DATABASE_RESET_CONFIRMATION_PHRASE } from "@liratek/core";
import { isElectron } from "@/api/backendApi";
import { reloadApp } from "@/shared/utils/reloadApp";

export interface ResetDataModalProps {
  /** The preview's total row count — repeated here so the confirmation
   *  screen states the exact magnitude of what's about to be deleted. */
  totalRows: number;
  onClose: () => void;
}

type Status = "idle" | "submitting" | "success";

/**
 * The Reset Data confirmation modal (LIRA-165). Deliberately NOT built on
 * `@liratek/ui`'s `ConfirmModal` — that component only takes a flat
 * `message` string, and this modal needs a typed confirmation input plus an
 * itemised keep/delete summary. Keeps ConfirmModal's overlay/z-index and the
 * Windows focus-fix behaviour (see the effect below) so it still matches the
 * rest of the app visually and functionally.
 */
export function ResetDataModal({ totalRows, onClose }: ResetDataModalProps) {
  const api = useApi();
  const [phrase, setPhrase] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [deletedTotal, setDeletedTotal] = useState<number | null>(null);

  // Fix Electron/Windows focus bug: nudge window focus when the modal
  // closes (same pattern as @liratek/ui's ConfirmModal.tsx). The modal is
  // now conditionally mounted (see ResetDataPanel), so this is a plain
  // mount/unmount effect — its cleanup fires exactly when the modal closes.
  useEffect(() => {
    const isWindows = navigator.userAgent.includes("Windows");
    if (!isWindows) return;
    return () => {
      try {
        if (isElectron()) window.api.display.fixFocus();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const isMatch = phrase === DATABASE_RESET_CONFIRMATION_PHRASE;
  const busy = status === "submitting" || status === "success";

  async function handleConfirm() {
    if (!isMatch || busy) return;
    setError(null);
    setStatus("submitting");
    try {
      const result = await api.resetDatabase({ confirmation: phrase });
      if (result.success) {
        setDeletedTotal(result.data?.totalDeleted ?? null);
        setStatus("success");
        // Every in-memory context (drawer balances, the mobile-services
        // catalog, the dashboard) was seeded before the wipe and stays stale
        // otherwise — a full reload is the only way every context re-reads
        // the emptied (and re-seeded-where-applicable) database.
        window.setTimeout(() => reloadApp(), 1500);
      } else {
        setError(result.error ?? "Reset failed");
        setStatus("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
      setStatus("idle");
    }
  }

  function handleCancel() {
    if (busy) return;
    onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        data-testid="reset-data-modal"
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl text-red-400 bg-red-400/10">
              <AlertTriangle size={24} />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-white mb-2">
                Reset all data?
              </h3>
              {status === "success" ? (
                <p className="text-slate-300 text-sm leading-relaxed">
                  Done — {(deletedTotal ?? 0).toLocaleString()} rows removed.
                  Reloading...
                </p>
              ) : (
                <>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    This permanently deletes{" "}
                    <strong className="text-white">
                      {totalRows.toLocaleString()}
                    </strong>{" "}
                    rows of operational data. This cannot be undone. (A backup
                    is taken first on desktop.)
                  </p>
                  <p className="text-slate-400 text-sm leading-relaxed mt-2">
                    Type{" "}
                    <strong className="text-white">
                      {DATABASE_RESET_CONFIRMATION_PHRASE}
                    </strong>{" "}
                    below to confirm.
                  </p>
                </>
              )}
            </div>
            {!busy && (
              <button
                onClick={handleCancel}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            )}
          </div>

          {status !== "success" && (
            <input
              type="text"
              data-testid="reset-data-phrase-input"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              disabled={busy}
              placeholder={DATABASE_RESET_CONFIRMATION_PHRASE}
              autoComplete="off"
              className="mt-4 w-full bg-slate-950 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500 disabled:opacity-50"
            />
          )}

          {error && (
            <div className="mt-3 p-3 rounded-lg text-sm bg-red-500/15 border border-red-500/40 text-red-300">
              {error}
            </div>
          )}
        </div>

        {status !== "success" && (
          <div className="flex gap-3 p-6 bg-slate-800/50 border-t border-slate-700">
            <button
              data-testid="reset-data-cancel-btn"
              onClick={handleCancel}
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              data-testid="reset-data-confirm-btn"
              onClick={handleConfirm}
              disabled={!isMatch || busy}
              className="flex-1 px-4 py-2.5 rounded-lg text-white font-bold transition-all shadow-lg bg-red-600 hover:bg-red-500 shadow-red-900/20 disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none"
            >
              {status === "submitting" ? "Resetting..." : "Reset everything"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ResetDataModal;
