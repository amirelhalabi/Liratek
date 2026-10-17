import { Ticket, Banknote, Percent, TrendingUp } from "lucide-react";
import { formatMoneyAmount } from "@liratek/core";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";

interface StatsCardsProps {
  ticketsSold: number;
  totalSales: number;
  totalCommission: number;
  /** LIRA-185 — kept (not returned) change on the same tickets, per
   *  currency. Shown under the pure-commission figure so commission + kept
   *  change reads as the Profits page's loto profit. */
  totalKeptChangeUsd: number;
  totalKeptChangeLbp: number;
  totalPrizes: number;
}

export function StatsCards({
  ticketsSold,
  totalSales,
  totalCommission,
  totalKeptChangeUsd,
  totalKeptChangeLbp,
  totalPrizes,
}: StatsCardsProps) {
  const { t } = useTranslation("loto");
  // LBP is the module's native currency, so its figure is always shown (0
  // included); a USD figure is added only when USD kept change exists.
  const keptChangeParts: string[] = [];
  if (totalKeptChangeLbp !== 0 || totalKeptChangeUsd === 0) {
    keptChangeParts.push(formatMoneyAmount(totalKeptChangeLbp, "LBP"));
  }
  if (totalKeptChangeUsd !== 0) {
    keptChangeParts.push(formatMoneyAmount(totalKeptChangeUsd, "USD"));
  }

  return (
    <div className="flex flex-wrap gap-2">
      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <Ticket className="w-4 h-4 shrink-0 text-blue-400" />
        <span className="font-medium whitespace-nowrap">{t("stats.ticketsSold")}</span>
        <span className="font-bold text-white">{ticketsSold}</span>
      </div>

      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <Banknote className="w-4 h-4 shrink-0 text-emerald-400" />
        <span className="font-medium whitespace-nowrap">{t("stats.totalSales")}</span>
        <span className="font-bold text-white">
          {formatNumber(totalSales)} LBP
        </span>
      </div>

      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <Percent className="w-4 h-4 shrink-0 text-orange-400" />
        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-2">
            <span className="font-medium whitespace-nowrap">{t("stats.commission")}</span>
            <span
              className="font-bold text-white"
              data-testid="loto-commission-value"
            >
              {formatNumber(totalCommission)} LBP
            </span>
          </div>
          <div
            className="flex items-center gap-2 text-xs"
            data-testid="loto-kept-change"
          >
            <span className="whitespace-nowrap">{t("stats.keptChange")}</span>
            <span className="font-semibold text-white whitespace-nowrap">
              {keptChangeParts.join(" + ")}
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <TrendingUp className="w-4 h-4 shrink-0 text-purple-400" />
        <span className="font-medium whitespace-nowrap">{t("stats.prizesPaid")}</span>
        <span className="font-bold text-white">
          {formatNumber(totalPrizes)} LBP
        </span>
      </div>
    </div>
  );
}
