import {
  TrendingUp,
  Calendar,
  ArrowUpCircle,
  ArrowDownCircle,
  History,
} from "lucide-react";
import type { ProviderConfig } from "../types";

interface CompactStatsProps {
  providerLabel: string;
  activeConfig?: ProviderConfig;
  todayCommission?: number | undefined;
  todayCount?: number | undefined;
  allProvidersCommission?: number | undefined;
  cryptoOutToday?: number | undefined;
  cryptoInToday?: number | undefined;
  showCryptoStats?: boolean | undefined;
  showHistoryButton?: boolean | undefined;
  onShowHistory?: () => void;
}

export function CompactStats({
  providerLabel,
  activeConfig,
  todayCommission,
  todayCount,
  allProvidersCommission,
  cryptoOutToday,
  cryptoInToday,
  showCryptoStats = false,
  showHistoryButton = false,
  onShowHistory,
}: CompactStatsProps) {
  if (showCryptoStats) {
    return (
      <div className="flex flex-wrap gap-2">
        <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
          <ArrowUpCircle className="w-4 h-4 shrink-0" />
          <span className="font-medium whitespace-nowrap">Out</span>
          <span className="font-bold text-white">
            ${cryptoOutToday?.toFixed(2) ?? "0.00"}
          </span>
        </div>

        <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
          <ArrowDownCircle className="w-4 h-4 shrink-0" />
          <span className="font-medium whitespace-nowrap">In</span>
          <span className="font-bold text-white">
            ${cryptoInToday?.toFixed(2) ?? "0.00"}
          </span>
        </div>

        <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
          <Calendar className="w-4 h-4 shrink-0" />
          <span className="font-medium whitespace-nowrap">Txns</span>
          <span className="font-bold text-white">{todayCount ?? 0}</span>
        </div>

        {showHistoryButton && onShowHistory && (
          <button
            onClick={onShowHistory}
            className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white"
          >
            <History size={16} />
            <span className="font-medium">History</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <div
        className={`px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 shadow-lg ${activeConfig?.activeBg} ${activeConfig?.activeText}`}
      >
        <TrendingUp className="w-4 h-4 shrink-0" />
        <span className="font-medium whitespace-nowrap">{providerLabel}</span>
        <span className="font-bold">${(todayCommission ?? 0).toFixed(2)}</span>
      </div>

      {allProvidersCommission !== undefined && (
        <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
          <Calendar className="w-4 h-4 shrink-0" />
          <span className="font-medium whitespace-nowrap">All</span>
          <span className="font-bold text-white">
            ${allProvidersCommission.toFixed(2)}
          </span>
        </div>
      )}

      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <Calendar className="w-4 h-4 shrink-0" />
        <span className="font-medium whitespace-nowrap">Txns</span>
        <span className="font-bold text-white">{todayCount ?? 0}</span>
      </div>

      {showHistoryButton && onShowHistory && (
        <button
          onClick={onShowHistory}
          className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white"
        >
          <History size={16} />
          <span className="font-medium">History</span>
        </button>
      )}
    </div>
  );
}
