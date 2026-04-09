import type { ProviderConfig } from "../types";

interface CompactStatsProps {
  activeConfig?: ProviderConfig;
  todayCommission?: number | undefined;
  todayCount?: number | undefined;
  allProvidersCommission?: number | undefined;
  cryptoOutToday?: number | undefined;
  cryptoInToday?: number | undefined;
  showCryptoStats?: boolean | undefined;
  isAdmin?: boolean | undefined;
}

export function CompactStats({
  activeConfig,
  todayCommission,
  todayCount,
  allProvidersCommission,
  cryptoOutToday,
  cryptoInToday,
  showCryptoStats = false,
  isAdmin = false,
}: CompactStatsProps) {
  if (showCryptoStats) {
    return (
      <div className="flex flex-wrap gap-2">
        {isAdmin && (
          <div className="px-3 py-1.5 rounded-lg font-medium text-xs bg-slate-800 border border-slate-700">
            <span className="text-emerald-400 font-bold">
              ${(todayCommission ?? 0).toFixed(2)}
            </span>
          </div>
        )}
        <div className="px-3 py-1.5 rounded-lg font-medium text-xs bg-slate-800 border border-slate-700">
          <span className="text-red-400 font-bold">
            ${cryptoOutToday?.toFixed(2) ?? "0.00"}
          </span>
        </div>

        <div className="px-3 py-1.5 rounded-lg font-medium text-xs bg-slate-800 border border-slate-700">
          <span className="text-emerald-400 font-bold">
            ${cryptoInToday?.toFixed(2) ?? "0.00"}
          </span>
        </div>

        <div className="px-3 py-1.5 rounded-lg font-medium text-xs bg-slate-800 border border-slate-700">
          <span className="text-slate-300 font-bold">{todayCount ?? 0}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {isAdmin && (
        <div
          className={`px-3 py-1.5 rounded-lg font-medium text-xs ${activeConfig?.activeBg} ${activeConfig?.activeText}`}
        >
          <span className="font-bold">
            ${(todayCommission ?? 0).toFixed(2)}
          </span>
        </div>
      )}

      {allProvidersCommission !== undefined && (
        <div className="px-3 py-1.5 rounded-lg font-medium text-xs bg-slate-800 border border-slate-700">
          <span className="text-white font-bold">
            ${allProvidersCommission.toFixed(2)}
          </span>
        </div>
      )}

      <div className="px-3 py-1.5 rounded-lg font-medium text-xs bg-slate-800 border border-slate-700">
        <span className="text-slate-300 font-bold">{todayCount ?? 0}</span>
      </div>
    </div>
  );
}
