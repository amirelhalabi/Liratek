import { Ticket, Banknote, Percent, TrendingUp } from "lucide-react";

interface StatsCardsProps {
  ticketsSold: number;
  totalSales: number;
  totalCommission: number;
  totalPrizes: number;
}

export function StatsCards({
  ticketsSold,
  totalSales,
  totalCommission,
  totalPrizes,
}: StatsCardsProps) {
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
        <span className="font-medium whitespace-nowrap">Commission</span>
        <span className="font-bold text-white">
          {totalCommission.toLocaleString()} LBP
        </span>
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
