import { TrendingUp, Calendar } from "lucide-react";

interface OwedByProvider {
  usd?: number;
  lbp?: number;
}

interface StatsCardsProps {
  todayCommission: number;
  monthCommission: number;
  owedByProvider: {
    OMT?: OwedByProvider;
    WHISH?: OwedByProvider;
  };
}

function getBalanceColor(usd: number): string {
  if (usd > 0) return "text-red-400";
  if (usd < 0) return "text-emerald-400";
  return "text-slate-300";
}

function getBalanceLabel(usd: number): string {
  if (usd > 0) return "Owe";
  if (usd < 0) return "Due";
  return "";
}

export function StatsCards({
  todayCommission,
  monthCommission,
  owedByProvider,
}: StatsCardsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {/* Today */}
      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <TrendingUp className="w-4 h-4 shrink-0 text-[#ffde00]" />
        <span className="font-medium whitespace-nowrap">Today</span>
        <span className="font-bold text-[#ffde00]">
          $
          {todayCommission.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      </div>

      {/* Month */}
      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <Calendar className="w-4 h-4 shrink-0 text-blue-400" />
        <span className="font-medium whitespace-nowrap">Month</span>
        <span className="font-bold text-blue-400">
          $
          {monthCommission.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      </div>

      {/* OMT */}
      {owedByProvider.OMT && (
        <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
          <span className="font-medium whitespace-nowrap">OMT</span>
          <span
            className={`font-bold ${getBalanceColor(owedByProvider.OMT.usd ?? 0)}`}
          >
            $
            {Math.abs(owedByProvider.OMT.usd ?? 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          {getBalanceLabel(owedByProvider.OMT.usd ?? 0) && (
            <span
              className={`text-sm ${getBalanceColor(owedByProvider.OMT.usd ?? 0)} opacity-70`}
            >
              {getBalanceLabel(owedByProvider.OMT.usd ?? 0)}
            </span>
          )}
        </div>
      )}

      {/* WHISH */}
      {owedByProvider.WHISH && (
        <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
          <span className="font-medium whitespace-nowrap">WHISH</span>
          <span
            className={`font-bold ${getBalanceColor(owedByProvider.WHISH.usd ?? 0)}`}
          >
            $
            {Math.abs(owedByProvider.WHISH.usd ?? 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          {getBalanceLabel(owedByProvider.WHISH.usd ?? 0) && (
            <span
              className={`text-sm ${getBalanceColor(owedByProvider.WHISH.usd ?? 0)} opacity-70`}
            >
              {getBalanceLabel(owedByProvider.WHISH.usd ?? 0)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
