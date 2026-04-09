import { TrendingUp, Calendar, DollarSign } from "lucide-react";

interface StatsCardsProps {
  count: number;
  totalPriceUsd: number;
  totalPriceLbp: number;
  totalProfitUsd: number;
  totalProfitLbp: number;
}

export function StatsCards({
  count,
  totalPriceUsd,
  totalPriceLbp,
  totalProfitUsd,
  totalProfitLbp,
}: StatsCardsProps) {
  const formatCurrency = (usd: number, lbp: number) => {
    const parts: string[] = [];
    if (usd > 0) parts.push(`$${usd.toFixed(2)}`);
    if (lbp > 0) parts.push(`${lbp.toLocaleString()} LBP`);
    return parts.join(" + ") || "$0.00";
  };

  return (
    <div className="flex flex-wrap gap-2">
      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <Calendar className="w-4 h-4 shrink-0" />
        <span className="font-medium whitespace-nowrap">Today's Services</span>
        <span className="font-bold text-white">{count}</span>
      </div>

      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <DollarSign className="w-4 h-4 shrink-0" />
        <span className="font-medium whitespace-nowrap">Today's Revenue</span>
        <span className="font-bold text-white">
          {formatCurrency(totalPriceUsd, totalPriceLbp)}
        </span>
      </div>

      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <TrendingUp className="w-4 h-4 shrink-0" />
        <span className="font-medium whitespace-nowrap">Today's Profit</span>
        <span
          className={`font-bold ${
            totalProfitUsd >= 0 && totalProfitLbp >= 0
              ? "text-emerald-400"
              : "text-red-400"
          }`}
        >
          {formatCurrency(totalProfitUsd, totalProfitLbp)}
        </span>
      </div>
    </div>
  );
}
