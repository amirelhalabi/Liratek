/**
 * LIRA-304 (spec US2, FR-006/FR-007) — the repayment screen's list of open
 * debt items. Separate visits are one line each; the items of a session
 * basket are grouped under "Session #N basket" and can be ticked one by
 * one.
 *
 * LIRA-308 (owner decisions 2026-10-11) — the ticks and the amount stay in
 * step: the page owns which items are ticked (the cashier's ticks plus the
 * ones the amount ticked by itself, flagged `auto`) and what each ticked
 * item is paid; this list only shows them and reports a tick change.
 */
import type { OpenDebtItem, DebtItemRef } from "@liratek/core";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { Ltr } from "@liratek/ui/components/ui/Ltr";

interface DebtItemPickerProps {
  items: OpenDebtItem[];
  /** What is ticked on screen: the cashier's ticks and the amount's own
   *  (`auto`). */
  selected: DebtItemRef[];
  /** A tick box was clicked. */
  onToggle: (item: OpenDebtItem) => void;
  onClear: () => void;
  /** What this payment (with any discount) pays on each item — the
   *  "pays $X · leaves $Y" figures. */
  coverage: Array<{ kind: string; id: number; usd: number; lbp: number }>;
  /** The modal's USD→LBP rate, for the USD figure of an LBP item. */
  rate: number;
}

const sameRef = (a: DebtItemRef, b: DebtItemRef): boolean =>
  a.kind === b.kind && a.id === b.id;

const fmtUsd = (n: number): string => `$${n.toFixed(2).replace(/\.00$/, "")}`;
const fmtLbp = (n: number): string => `${formatNumber(Math.round(n))} LBP`;

/** One amount in the item's own currency (or both, for a mixed item). */
function money(usd: number, lbp: number, hasUsd: boolean, hasLbp: boolean) {
  const parts = [
    hasUsd ? fmtUsd(Math.max(0, usd)) : "",
    hasLbp ? fmtLbp(Math.max(0, lbp)) : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" + ") : fmtUsd(0);
}

export default function DebtItemPicker({
  items,
  selected,
  onToggle,
  onClear,
  coverage,
  rate,
}: DebtItemPickerProps) {
  const { t } = useTranslation("debts");
  if (items.length === 0) return null;

  // Group basket items under their session; everything else stands alone,
  // in the order the server returned (oldest first).
  const groups: Array<{ sessionId: number | null; items: OpenDebtItem[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (item.sessionId != null && last && last.sessionId === item.sessionId) {
      last.items.push(item);
    } else {
      groups.push({ sessionId: item.sessionId, items: [item] });
    }
  }

  const row = (item: OpenDebtItem, indent: boolean) => {
    const tick = selected.find((s) => sameRef(s, item));
    const hasUsd = item.openUsd > 0.004;
    const hasLbp = item.openLbp > 0.5;
    const take = coverage.find((c) => sameRef(c as DebtItemRef, item)) ?? {
      usd: 0,
      lbp: 0,
    };
    return (
      <label
        key={`${item.kind}-${item.id}`}
        data-testid={`debt-item-${item.kind}-${item.id}`}
        className={`flex flex-col py-1.5 text-sm cursor-pointer ${
          indent ? "ps-4" : ""
        }`}
      >
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!tick}
            onChange={() => onToggle(item)}
            className="accent-emerald-500"
          />
          <span className="flex-1 min-w-0 truncate text-slate-200">
            {item.label}
          </span>
          {item.isPrimary && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-300 shrink-0">
              {t("picker.cashDrawer")}
            </span>
          )}
          <span className="font-mono text-slate-300 shrink-0">
            <Ltr>{money(item.openUsd, item.openLbp, hasUsd, hasLbp)}</Ltr>
            {hasLbp && !hasUsd && rate > 0 && (
              <span className="text-slate-500">
                {" "}
                (≈ <Ltr>{fmtUsd(item.openLbp / rate)}</Ltr>)
              </span>
            )}
          </span>
        </span>
        {tick && (
          <span
            data-testid={`debt-item-pays-${item.kind}-${item.id}`}
            className="ps-6 text-[11px] text-slate-400"
          >
            {tick.auto && (
              <span className="text-emerald-400">
                {t("picker.addedByAmount")}{" "}
              </span>
            )}
            {t("picker.pays")}{" "}
            <Ltr>{money(take.usd, take.lbp, hasUsd, hasLbp)}</Ltr> ·{" "}
            {t("picker.leaves")}{" "}
            <Ltr>
              {money(
                item.openUsd - take.usd,
                item.openLbp - take.lbp,
                hasUsd,
                hasLbp,
              )}
            </Ltr>
          </span>
        )}
      </label>
    );
  };

  const nothingTicked = !selected.some((s) => !s.auto);

  return (
    <div
      data-testid="debt-item-picker"
      className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-3"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-300 uppercase tracking-wider">
          {t("picker.title")}
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-slate-400 hover:text-slate-200"
          >
            {t("picker.clear")}
          </button>
        )}
      </div>
      <div className="divide-y divide-slate-700/40 max-h-56 overflow-y-auto">
        {groups.map((g, gi) =>
          g.sessionId != null ? (
            <div key={`session-${g.sessionId}-${gi}`} className="py-1">
              <div className="text-xs text-slate-400 py-1">
                {t("picker.sessionBasket", { id: g.sessionId })}
              </div>
              {g.items.map((i) => row(i, true))}
            </div>
          ) : (
            g.items.map((i) => row(i, false))
          ),
        )}
      </div>
      {nothingTicked ? (
        <p
          data-testid="debt-item-picker-hint"
          className="text-[11px] text-amber-400 mt-1"
        >
          {t("picker.tickHint")}
        </p>
      ) : (
        <p className="text-[11px] text-slate-500 mt-1">
          {t("picker.orderHint")}
        </p>
      )}
    </div>
  );
}
