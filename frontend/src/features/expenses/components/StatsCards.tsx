import { TrendingUp, Calendar } from "lucide-react";

interface StatsCardsProps {
  totalUSD: number;
  totalLBP: number;
  count?: number;
  showTransactionCount?: boolean;
}

export function StatsCards({
  totalUSD,
  totalLBP,
  count = 0,
  showTransactionCount = false,
}: StatsCardsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <TrendingUp className="w-4 h-4 shrink-0" />
        <span className="font-medium whitespace-nowrap">Total USD</span>
        <span className="font-bold text-white">${totalUSD.toFixed(2)}</span>
      </div>

      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <TrendingUp className="w-4 h-4 shrink-0" />
        <span className="font-medium whitespace-nowrap">Total LBP</span>
        <span className="font-bold text-white">
          {totalLBP.toLocaleString()}
        </span>
      </div>

      {showTransactionCount && (
        <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
          <Calendar className="w-4 h-4 shrink-0" />
          <span className="font-medium whitespace-nowrap">Txns</span>
          <span className="font-bold text-white">{count}</span>
        </div>
      )}
    </div>
  );
}
