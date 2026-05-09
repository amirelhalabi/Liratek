import type { ProviderConfig, CurrencyStats } from "../types";

function formatCurrencyAmount(amount: number, currency: string): string {
  if (currency === "LBP") {
    return `${Math.round(amount).toLocaleString()} LBP`;
  }
  return `$${amount.toFixed(2)}`;
}

function formatDrawerBalance(balance: {
  usdBalance: number;
  lbpBalance: number;
}): string {
  const parts: string[] = [];
  if (balance.usdBalance !== 0) parts.push(`$${balance.usdBalance.toFixed(2)}`);
  if (balance.lbpBalance !== 0)
    parts.push(`${Math.round(balance.lbpBalance).toLocaleString()} LBP`);
  return parts.length > 0 ? parts.join(" + ") : "$0.00";
}

function formatByCurrency(byCurrency: CurrencyStats[]): string {
  if (byCurrency.length === 0) return "$0.00";
  return (
    byCurrency
      .filter((c) => c.commission !== 0)
      .map((c) => formatCurrencyAmount(c.commission, c.currency))
      .join(" + ") || "$0.00"
  );
}

interface DrawerBalance {
  usdBalance: number;
  lbpBalance: number;
}

interface CompactStatsProps {
  activeConfig?: ProviderConfig;
  todayCommission?: number | undefined;
  todayCount?: number | undefined;
  allProvidersCommission?: number | undefined;
  allProvidersByCurrency?: CurrencyStats[] | undefined;
  todayByCurrency?: CurrencyStats[] | undefined;
  cryptoOutToday?: number | undefined;
  cryptoInToday?: number | undefined;
  showCryptoStats?: boolean | undefined;
  isAdmin?: boolean | undefined;
  drawerBalance?: DrawerBalance | undefined;
}

export function CompactStats({
  activeConfig,
  todayCommission,
  todayCount,
  allProvidersCommission,
  allProvidersByCurrency,
  todayByCurrency,
  cryptoOutToday,
  cryptoInToday,
  showCryptoStats = false,
  isAdmin = false,
  drawerBalance,
}: CompactStatsProps) {
  const profitDisplay =
    todayByCurrency && todayByCurrency.length > 0
      ? formatByCurrency(todayByCurrency)
      : `$${(todayCommission ?? 0).toFixed(2)}`;

  if (showCryptoStats) {
    return (
      <div className="flex flex-wrap gap-2">
        {isAdmin && (
          <div
            className={`px-3 py-1.5 rounded-lg font-medium text-xs ${activeConfig?.activeBg} ${activeConfig?.activeText}`}
          >
            <span className="text-white/70 text-[10px] block mb-0.5">
              Profit
            </span>
            <span className="font-bold">{profitDisplay}</span>
          </div>
        )}
        <div className="px-3 py-1.5 rounded-lg font-medium text-xs bg-slate-800 border border-slate-700">
          <span className="text-slate-400 text-[10px] block mb-0.5">Sent</span>
          <span className="text-red-400 font-bold">
            ${cryptoOutToday?.toFixed(2) ?? "0.00"}
          </span>
        </div>

        <div className="px-3 py-1.5 rounded-lg font-medium text-xs bg-slate-800 border border-slate-700">
          <span className="text-slate-400 text-[10px] block mb-0.5">
            Received
          </span>
          <span className="text-emerald-400 font-bold">
            ${cryptoInToday?.toFixed(2) ?? "0.00"}
          </span>
        </div>

        <div className="px-3 py-1.5 rounded-lg font-medium text-xs bg-slate-800 border border-slate-700">
          <span className="text-slate-400 text-[10px] block mb-0.5">Count</span>
          <span className="text-slate-300 font-bold">{todayCount ?? 0}</span>
        </div>

        {drawerBalance && (
          <div className="px-3 py-1.5 rounded-lg font-medium text-xs bg-slate-800 border border-slate-700">
            <span className="text-slate-400 text-[10px] block mb-0.5">
              Drawer
            </span>
            <span className="text-emerald-400 font-bold">
              {formatDrawerBalance(drawerBalance)}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {isAdmin && (
        <div
          className={`px-3 py-1.5 rounded-lg font-medium text-xs ${activeConfig?.activeBg} ${activeConfig?.activeText}`}
        >
          <span className="text-white/70 text-[10px] block mb-0.5">Profit</span>
          <span className="font-bold">{profitDisplay}</span>
        </div>
      )}

      {allProvidersCommission !== undefined && (
        <div className="px-3 py-1.5 rounded-lg font-medium text-xs bg-slate-800 border border-slate-700">
          <span className="text-slate-400 text-[10px] block mb-0.5">
            Total Profit
          </span>
          <span className="text-white font-bold">
            {allProvidersByCurrency && allProvidersByCurrency.length > 0
              ? formatByCurrency(allProvidersByCurrency)
              : `$${allProvidersCommission.toFixed(2)}`}
          </span>
        </div>
      )}

      <div className="px-3 py-1.5 rounded-lg font-medium text-xs bg-slate-800 border border-slate-700">
        <span className="text-slate-400 text-[10px] block mb-0.5">Count</span>
        <span className="text-slate-300 font-bold">{todayCount ?? 0}</span>
      </div>

      {drawerBalance && (
        <div className="px-3 py-1.5 rounded-lg font-medium text-xs bg-slate-800 border border-slate-700">
          <span className="text-slate-400 text-[10px] block mb-0.5">
            Drawer
          </span>
          <span className="text-emerald-400 font-bold">
            {formatDrawerBalance(drawerBalance)}
          </span>
        </div>
      )}
    </div>
  );
}
