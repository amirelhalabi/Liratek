import { Ticket, Banknote, Percent, TrendingUp } from "lucide-react";
import { formatMoneyAmount } from "@liratek/core";

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
        <span className="font-medium whitespace-nowrap">Tickets Sold</span>
        <span className="font-bold text-white">{ticketsSold}</span>
      </div>

      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <Banknote className="w-4 h-4 shrink-0 text-emerald-400" />
        <span className="font-medium whitespace-nowrap">Total Sales</span>
        <span className="font-bold text-white">
          {totalSales.toLocaleString()} LBP
        </span>
      </div>

      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <Percent className="w-4 h-4 shrink-0 text-orange-400" />
        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-2">
            <span className="font-medium whitespace-nowrap">Commission</span>
            <span
              className="font-bold text-white"
              data-testid="loto-commission-value"
            >
              {totalCommission.toLocaleString()} LBP
            </span>
          </div>
          <div
            className="flex items-center gap-2 text-xs"
            data-testid="loto-kept-change"
          >
            <span className="whitespace-nowrap">Kept change</span>
            <span className="font-semibold text-white whitespace-nowrap">
              {keptChangeParts.join(" + ")}
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <TrendingUp className="w-4 h-4 shrink-0 text-purple-400" />
        <span className="font-medium whitespace-nowrap">Prizes Paid</span>
        <span className="font-bold text-white">
          {totalPrizes.toLocaleString()} LBP
        </span>
      </div>
    </div>
  );
}
