/**
 * LIRA-335 US2 — how one checkpoint difference reads, on the timeline row
 * (`DifferenceStatusLine`) and in the details window
 * (`DifferenceResolutionBlock`).
 *
 * Everything shown comes from the server's `CheckpointDifferenceView`
 * (status, direction, open, resolutions), worked out once by core
 * `describeCheckpointDifference` (rule 14). Nothing is recomputed here.
 */
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check } from "lucide-react";
import type { CheckpointDifferenceView } from "@liratek/core";
import { useFormat } from "@/i18n/useFormat";
import { translateTitle } from "@/features/audit/typeTitleText";
import {
  directionKey,
  formatShopMoney,
  formatWeekdayTime,
  resolutionLabel,
} from "../utils/differenceDisplay";

const PILL =
  "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-sans";

/** "Sale #4821" in the shown language (FR-021). The type words come from
 *  the audit namespace's transaction titles (LIRA-331), the same words the
 *  Transactions table uses — not a second copy. */
function useResolutionLabel() {
  const { t, i18n } = useTranslation("audit");
  return (r: CheckpointDifferenceView["resolutions"][number]) =>
    resolutionLabel(r, (english) => translateTitle(english, t, i18n.language));
}

/** The pill text for a difference; null for an Open one (no pill). */
function useStatusPill(d: CheckpointDifferenceView): string | null {
  const { t } = useTranslation("closing");
  switch (d.status) {
    case "RESOLVED":
      return t("difference.status.RESOLVED");
    case "PARTLY_RESOLVED":
      return t("difference.status.PARTLY_RESOLVED", {
        open: formatShopMoney(d.open, d.currency_code),
      });
    case "CLOSED":
      return t(
        d.direction === "SHORT"
          ? "difference.status.CLOSED_SHORT"
          : "difference.status.CLOSED_OVER",
      );
    default:
      return null;
  }
}

/** One difference on a timeline row: amount, status pill, and a grey line
 *  naming what resolved or closed it. An Open one looks as today. */
export function DifferenceStatusLine({
  difference: d,
}: {
  difference: CheckpointDifferenceView;
}) {
  const { t } = useTranslation("closing");
  const fmt = useFormat();
  const pill = useStatusPill(d);
  const labelOf = useResolutionLabel();
  const amountText = t(directionKey(d), {
    amount: formatShopMoney(Math.abs(d.amount), d.currency_code),
  });

  const sublines: string[] =
    d.status === "CLOSED"
      ? [
          [
            d.shortage_expense_id !== null
              ? t("difference.shortageExpense", { id: d.shortage_expense_id })
              : null,
            d.closed_by_name
              ? t("difference.closedBy", { name: d.closed_by_name })
              : null,
          ]
            .filter((s): s is string => !!s)
            .join(" · "),
        ].filter((s) => s.length > 0)
      : d.resolutions.map((r) =>
          t("difference.byTxn", {
            label: labelOf(r),
            entered: formatWeekdayTime(fmt, r.entered_at),
            time: formatWeekdayTime(fmt, r.effective_time),
          }),
        );

  let status;
  if (d.status === "OPEN") {
    status = (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 font-mono">
        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
        {amountText}
      </span>
    );
  } else if (d.status === "RESOLVED") {
    status = (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold font-mono">
        <span className="inline-flex items-center gap-1 text-emerald-400">
          <Check className="w-3 h-3 flex-shrink-0" />
          <span className="line-through decoration-emerald-400/60">
            {amountText}
          </span>
        </span>
        <span className={`${PILL} text-emerald-300 bg-emerald-500/10`}>
          {pill}
        </span>
      </span>
    );
  } else if (d.status === "PARTLY_RESOLVED") {
    status = (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold font-mono">
        <span className="inline-flex items-center gap-1 text-amber-400">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          {amountText}
        </span>
        <span className={`${PILL} text-sky-300 bg-sky-500/10`}>{pill}</span>
      </span>
    );
  } else {
    status = (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold font-mono">
        <span className="inline-flex items-center gap-1 text-slate-400">
          {amountText}
        </span>
        <span className={`${PILL} text-slate-300 bg-slate-500/20`}>{pill}</span>
      </span>
    );
  }

  return (
    <>
      {status}
      {sublines.map((line, i) => (
        <span key={i} className="text-[11px] text-slate-500">
          {line}
        </span>
      ))}
    </>
  );
}

/** Under a currency line in the details window: what resolved the
 *  difference (who entered it, its custom time, the amount) and what is
 *  still open, or who closed it. */
export function DifferenceResolutionBlock({
  difference: d,
}: {
  difference: CheckpointDifferenceView;
}) {
  const { t } = useTranslation("closing");
  const fmt = useFormat();
  const pill = useStatusPill(d);
  const labelOf = useResolutionLabel();
  const pillClass =
    d.status === "RESOLVED"
      ? "text-emerald-300 bg-emerald-500/10"
      : d.status === "CLOSED"
        ? "text-slate-300 bg-slate-500/20"
        : "text-sky-300 bg-sky-500/10";

  return (
    <div className="border-t border-slate-700/60 pt-2 space-y-1.5">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide">
        <span className="text-slate-400">{t("difference.resolvedBy")}</span>
        {pill && (
          <span className={`px-1.5 py-0.5 rounded ${pillClass}`}>{pill}</span>
        )}
      </div>
      {d.resolutions.map((r) => (
        <div
          key={`${r.transaction_id}-${r.entered_at}`}
          className="flex items-center gap-2 text-xs"
        >
          <span className="flex-1 min-w-0 text-slate-400">
            {t("difference.byTxn", {
              label: `${labelOf(r)}${r.summary ? ` · ${r.summary}` : ""}`,
              entered: formatWeekdayTime(fmt, r.entered_at),
              time: formatWeekdayTime(fmt, r.effective_time),
            })}
            {r.user_name ? ` · ${r.user_name}` : ""}
          </span>
          <span className="font-mono text-slate-200">
            {formatShopMoney(Math.abs(r.amount), d.currency_code)}
          </span>
        </div>
      ))}
      {d.status === "CLOSED" ? (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {d.shortage_expense_id !== null && (
            <span>
              {t("difference.shortageExpense", { id: d.shortage_expense_id })}
            </span>
          )}
          {d.closed_by_name && (
            <span>{t("difference.closedBy", { name: d.closed_by_name })}</span>
          )}
        </div>
      ) : (
        d.open > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-amber-300 flex-1">
              {t("difference.stillOpen")}
            </span>
            <span className="font-mono font-bold text-amber-300">
              {formatShopMoney(d.open, d.currency_code)}
            </span>
          </div>
        )
      )}
    </div>
  );
}
