/**
 * LIRA-296 — the one badge for a warranty state (Covered / Expired / Void),
 * shared by the Warranty lookup page and the sale details.
 */
import clsx from "clsx";
import type { WarrantyState } from "@liratek/core";
import { useTranslation } from "react-i18next";

const TONE: Record<WarrantyState, string> = {
  COVERED: "bg-emerald-900/40 text-emerald-300 border-emerald-700/40",
  EXPIRED: "bg-amber-900/40 text-amber-300 border-amber-700/40",
  VOID: "bg-slate-700/60 text-slate-300 border-slate-600",
  NONE: "bg-slate-800 text-slate-400 border-slate-700",
};

export function WarrantyStateBadge({ state }: { state: WarrantyState }) {
  const { t } = useTranslation("warranty");
  return (
    <span
      className={clsx(
        "inline-block px-2 py-0.5 rounded-md border text-xs font-medium",
        TONE[state],
      )}
    >
      {t(`state.${state}`)}
    </span>
  );
}
