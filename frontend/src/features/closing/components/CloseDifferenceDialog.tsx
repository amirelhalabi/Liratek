/**
 * LIRA-335 US3 — close a checkpoint difference nobody can explain, and undo
 * it with Reopen.
 *
 * The server does the work (`closeCheckpointDifference` /
 * `reopenCheckpointDifference`): a Short books the books-only "Drawer
 * shortage" expense dated the checkpoint's day, an Over records nothing, and
 * no drawer moves. This window only explains that and sends the one field
 * the schema takes. The amount and direction shown are the server view's
 * own (`open`, `direction`, rule 14).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useApi } from "@liratek/ui";
import {
  DRAWER_SHORTAGE_EXPENSE_CURRENCIES,
  type CheckpointDifferenceView,
  type CloseCheckpointDifferenceInput,
  type ReopenCheckpointDifferenceInput,
} from "@liratek/core";
import { useFormat } from "@/i18n/useFormat";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { directionKey, formatShopMoney } from "../utils/differenceDisplay";

interface CloseDifferenceDialogProps {
  difference: CheckpointDifferenceView;
  /** e.g. "OMT Cash Drawer · Oct 12, 06:00 PM" */
  checkpointLabel: string;
  onCancel: () => void;
  /** Called with the server's updated view after a successful close. */
  onDone: (updated: CheckpointDifferenceView | undefined) => void;
}

export function CloseDifferenceDialog({
  difference,
  checkpointLabel,
  onCancel,
  onDone,
}: CloseDifferenceDialogProps) {
  const { t } = useTranslation("closing");
  const { t: tc } = useTranslation("common");
  const fmt = useFormat();
  const api = useApi();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const short = difference.direction === "SHORT";
  const amount = formatShopMoney(difference.open, difference.currency_code);
  const day = fmt.formatDate(parseDbDate(difference.closing_created_at), {
    month: "short",
    day: "numeric",
  });
  const body = !short
    ? t("close.overBody")
    : DRAWER_SHORTAGE_EXPENSE_CURRENCIES.includes(difference.currency_code)
      ? t("close.shortBody", { amount, day })
      : t("close.noExpenseCurrency", { currency: difference.currency_code });

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const payload: CloseCheckpointDifferenceInput = {
        difference_id: difference.id,
      };
      const result = await api.closeCheckpointDifference(payload);
      if (result.success) onDone(result.data);
      else setError(result.error ?? t("save.unexpected"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("save.unexpected"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-difference-title"
        className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="p-5 border-b border-slate-700 flex items-center justify-between">
          <h2
            id="close-difference-title"
            className="text-lg font-semibold text-white"
          >
            {t("close.title")}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
            aria-label={tc("actions.close")}
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">{t("close.checkpoint")}</span>
            <span className="text-white text-end">{checkpointLabel}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">{t("close.stillOpen")}</span>
            <span className="font-mono font-bold text-amber-400">
              {t(directionKey(difference), { amount })}
            </span>
          </div>
          <div
            data-testid="close-difference-body"
            className="rounded-lg bg-slate-900/50 border border-slate-700/50 p-3 text-slate-300 text-[13px] leading-relaxed"
          >
            {body}
          </div>
          <p className="text-xs text-slate-500">{t("close.reopenNote")}</p>
          {error && (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          )}
        </div>
        <div className="p-4 border-t border-slate-700 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-slate-300 border border-slate-600 hover:bg-slate-700 text-sm transition-colors disabled:opacity-50"
          >
            {t("close.cancel")}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={saving}
            className={`px-4 py-2 rounded-lg text-white font-semibold text-sm transition-colors disabled:opacity-50 ${
              short
                ? "bg-amber-600 hover:bg-amber-500"
                : "bg-slate-600 hover:bg-slate-500"
            }`}
          >
            {t(short ? "close.confirmShort" : "close.confirmOver")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ReopenDifferenceButtonProps {
  differenceId: number;
  /** Called with the server's updated view after a successful reopen. */
  onDone: (updated: CheckpointDifferenceView | undefined) => void;
}

/** The details footer's Reopen: voids the Drawer shortage expense (if any)
 *  and returns the difference to Open or Partly resolved, server side. */
export function ReopenDifferenceButton({
  differenceId,
  onDone,
}: ReopenDifferenceButtonProps) {
  const { t } = useTranslation("closing");
  const api = useApi();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reopen() {
    setSaving(true);
    setError(null);
    try {
      const payload: ReopenCheckpointDifferenceInput = {
        difference_id: differenceId,
      };
      const result = await api.reopenCheckpointDifference(payload);
      if (result.success) onDone(result.data);
      else setError(result.error ?? t("save.unexpected"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("save.unexpected"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={reopen}
        disabled={saving}
        className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-100 bg-slate-600/40 hover:bg-slate-600/60 border border-slate-500/40 whitespace-nowrap transition-colors disabled:opacity-50"
      >
        {t("details.reopenButton")}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}
