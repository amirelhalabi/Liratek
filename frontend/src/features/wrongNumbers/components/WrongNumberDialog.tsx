/**
 * LIRA-312 — the Transactions page's "Wrong number…" / "Credits…" dialog.
 *
 * - From a card sale: shows the wrong-number records already linked to the
 *   sale (with their credits), or the form to record one. A cart can hold
 *   several cards, so another one can be recorded too.
 * - From a credits entry or a wrong-number expense: shows that one record
 *   and its credits form.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@liratek/ui";
import type { WrongNumberCardRow } from "@liratek/core";
import logger from "@/utils/logger";
import type { WrongNumberProviderCode } from "@/features/audit/actionGating";
import { WrongNumberPanel } from "./WrongNumberPanel";
import { CreditsReceivedPanel } from "./CreditsReceivedPanel";

export type WrongNumberDialogTarget =
  | {
      kind: "sale";
      saleTransactionId: number;
      provider: WrongNumberProviderCode;
      saleText: string | null;
    }
  | { kind: "record"; recordId: number }
  | { kind: "expense"; expenseTransactionId: number };

export function WrongNumberDialog({
  target,
  onClose,
  onChanged,
}: {
  target: WrongNumberDialogTarget;
  onClose: () => void;
  /** Called after anything was saved, so the caller reloads its rows. */
  onChanged: () => void;
}) {
  const api = useApi();
  const { t } = useTranslation("wrongNumbers");
  // rule 25: read `api` through a ref, kept current after each render (not
  // during it), so the loader below never depends on its identity.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });

  const [records, setRecords] = useState<WrongNumberCardRow[] | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Bumped after a save so the effect below reloads the records.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiRef.current.getWrongNumbers(
          target.kind === "sale"
            ? { sale_transaction_id: target.saleTransactionId }
            : target.kind === "record"
              ? { id: target.recordId }
              : { expense_transaction_id: target.expenseTransactionId },
        );
        if (cancelled) return;
        setRecords(rows);
        if (target.kind === "sale" && rows.length === 0) setShowForm(true);
      } catch (err) {
        logger.error("Failed to load wrong-number records", err);
        if (!cancelled) setRecords([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target, reloadKey]);

  const changed = () => {
    onChanged();
    setReloadKey((k) => k + 1);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label={t("dialog.title")}
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-slate-700 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">
            {target.kind === "sale"
              ? t("dialog.title")
              : t("dialog.creditsTitle")}
          </h3>
          <button
            onClick={onClose}
            aria-label={t("dialog.close")}
            className="text-slate-400 hover:text-white text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {records === null ? (
            <p className="text-sm text-slate-400">{t("dialog.loading")}</p>
          ) : (
            <>
              {records.map((r) => (
                <CreditsReceivedPanel key={r.id} record={r} onDone={changed} />
              ))}
              {target.kind !== "sale" && records.length === 0 && (
                <p className="text-sm text-slate-400">
                  {t("dialog.notFound")}
                </p>
              )}
              {target.kind === "sale" &&
                (showForm ? (
                  <WrongNumberPanel
                    provider={target.provider}
                    saleTransactionId={target.saleTransactionId}
                    saleText={target.saleText}
                    onDone={() => {
                      setShowForm(false);
                      changed();
                    }}
                    onCancel={records.length === 0 ? onClose : () => setShowForm(false)}
                  />
                ) : (
                  <button
                    onClick={() => setShowForm(true)}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-sm"
                  >
                    {t("dialog.another")}
                  </button>
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
