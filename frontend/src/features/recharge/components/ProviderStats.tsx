import { TrendingUp, Calendar, AlertTriangle } from "lucide-react";
import type { SupplierOwed } from "../types";

interface ProviderStatsProps {
  providerLabel: string;
  providerColor: string;
  providerBgTint: string;
  todayCommission: number;
  todayCount: number;
  allProvidersCommission?: number;
  allProvidersCount?: number;
  owedData?: SupplierOwed | null;
  showOwedWarning?: boolean;
}

export function ProviderStats({
  providerLabel,
  providerColor,
  providerBgTint,
  todayCommission,
  todayCount,
  allProvidersCommission,
  allProvidersCount,
  owedData,
  showOwedWarning = false,
}: ProviderStatsProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700/50">
        <div className="flex items-center gap-2 mb-2">
          <div className={`p-1.5 rounded-lg ${providerBgTint}`}>
            <TrendingUp className={`w-4 h-4 ${providerColor}`} />
          </div>
          <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
            {providerLabel} Today
          </span>
        </div>
        <p className="text-xl font-bold text-white">
          ${todayCommission.toFixed(2)}
        </p>
        <p className="text-xs text-slate-500">{todayCount} transactions</p>
      </div>

      {allProvidersCommission !== undefined && (
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-violet-400/10">
              <Calendar className="w-4 h-4 text-violet-400" />
            </div>
            <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
              All Providers Today
            </span>
          </div>
          <p className="text-xl font-bold text-white">
            ${allProvidersCommission.toFixed(2)}
          </p>
          <p className="text-xs text-slate-500">
            {allProvidersCount} transactions
          </p>
        </div>
      )}

      {showOwedWarning && owedData && (
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-red-400/10">
              <AlertTriangle className="w-4 h-4 text-red-400" />
            </div>
            <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
              Owed to {providerLabel}
            </span>
          </div>
          <p className="text-xl font-bold text-red-400">
            ${(owedData.usd ?? 0).toFixed(2)}
          </p>
          <p className="text-xs text-red-400/70">
            {(owedData.lbp ?? 0).toLocaleString()} LBP
          </p>
        </div>
      )}
    </div>
  );
}
