import { useState } from "react";
import { GitMerge, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApi } from "@liratek/ui";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { formatNumber } from "@liratek/ui/i18n/format";
import type { ProductSupplierImpact } from "@/api/backendApi";

export interface MergeSupplierDialogProps {
  source: { id: number; name: string };
  impact: ProductSupplierImpact;
  /** Every other supplier the source can be merged into. */
  targets: Array<{ id: number; name: string }>;
  /** Pre-selected target (rename to an existing name). */
  initialTargetId?: number | undefined;
  onClose: () => void;
  onMerged: () => void;
}

/**
 * LIRA-361 — "Merge into…": folds a mistyped duplicate supplier into the
 * real one. Products, stock and all debt/payments move; the duplicate is
 * then removed. Opened instead of a plain delete whenever the supplier
 * still has products or debt history, and when a rename hits a name that
 * already exists.
 */
export function MergeSupplierDialog({
  source,
  impact,
  targets,
  initialTargetId,
  onClose,
  onMerged,
}: MergeSupplierDialogProps) {
  const { t } = useTranslation("settingsCatalog");
  const api = useApi();
  const [targetId, setTargetId] = useState<number | "">(initialTargetId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetName = targets.find((s) => s.id === targetId)?.name ?? "";
  const hasDebt = impact.balance_usd !== 0 || impact.balance_lbp !== 0;

  async function handleMerge() {
    if (targetId === "" || busy) return;
    setBusy(true);
    setError(null);
    const res = await api.mergeProductSupplier({
      sourceId: source.id,
      targetId,
    });
    setBusy(false);
    if (res?.success) onMerged();
    else setError(res?.error ?? t("suppliers.merge.failed"));
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        data-testid="merge-supplier-dialog"
        role="dialog"
        aria-modal="true"
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
      >
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl text-sky-400 bg-sky-400/10">
              <GitMerge size={24} />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-white mb-2">
                {t("suppliers.merge.title", { name: source.name })}
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                {t("suppliers.merge.intro", { name: source.name })}
              </p>
            </div>
            {!busy && (
              <button
                onClick={onClose}
                aria-label={t("suppliers.merge.cancel")}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            )}
          </div>

          <ul className="text-sm text-slate-300 space-y-1 bg-slate-800/50 rounded-lg p-3">
            <li>
              {t("suppliers.merge.products", { count: impact.product_count })}
            </li>
            <li data-testid="merge-supplier-debt">
              {hasDebt ? (
                <>
                  {t("suppliers.merge.debt")}{" "}
                  <strong className="text-white">
                    <Ltr>
                      ${formatNumber(impact.balance_usd)}
                      {impact.balance_lbp !== 0 &&
                        ` · ${formatNumber(impact.balance_lbp)} LBP`}
                    </Ltr>
                  </strong>
                </>
              ) : (
                t("suppliers.merge.noDebt")
              )}
            </li>
          </ul>

          <label className="block text-sm text-slate-300">
            {t("suppliers.merge.into")}
            <select
              data-testid="merge-supplier-target"
              value={targetId}
              onChange={(e) =>
                setTargetId(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="mt-1 w-full bg-slate-800 border border-slate-600 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-sky-500"
            >
              <option value="">{t("suppliers.merge.pick")}</option>
              {targets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          {targetName && (
            <p className="text-xs text-slate-400">
              {t("suppliers.merge.result", {
                source: source.name,
                target: targetName,
              })}
            </p>
          )}

          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-sm text-slate-300 bg-slate-700/50 hover:bg-slate-700 transition-colors"
            >
              {t("suppliers.merge.cancel")}
            </button>
            <button
              data-testid="merge-supplier-confirm"
              onClick={handleMerge}
              disabled={targetId === "" || busy}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t("suppliers.merge.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
