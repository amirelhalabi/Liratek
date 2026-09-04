import type { ReactNode } from "react";
import type { ProviderConfig, CurrencyStats } from "../types";

function formatCurrencyAmount(amount: number, currency: string): string {
  if (currency === "LBP") {
    return `${Math.round(amount).toLocaleString()} LBP`;
  }
  return `$${amount.toFixed(2)}`;
}

function formatDrawerBalance(
  balance: DrawerBalance,
  fallback = "$0.00",
): string {
  const parts: string[] = [];
  if (balance.usdBalance !== 0) parts.push(`$${balance.usdBalance.toFixed(2)}`);
  if (balance.lbpBalance !== 0)
    parts.push(`${Math.round(balance.lbpBalance).toLocaleString()} LBP`);
  if (balance.usdtBalance) parts.push(`${balance.usdtBalance.toFixed(2)} USDT`);
  return parts.length > 0 ? parts.join(" + ") : fallback;
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
  usdtBalance?: number;
}

/** A single read-only metric cell inside the grouped stats panel. */
function Metric({
  label,
  value,
  valueClass = "text-white",
  accentBg,
}: {
  label: string;
  value: string | number;
  valueClass?: string;
  accentBg?: string | undefined;
}) {
  return (
    <div
      className={`flex flex-col justify-center px-3.5 py-1.5 ${accentBg ?? ""}`}
    >
      <span className="text-[10px] uppercase tracking-wide text-slate-500 leading-tight">
        {label}
      </span>
      <span className={`text-sm font-bold leading-tight ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * Bordered, non-interactive container that groups the metrics so they read as a
 * read-only dashboard rather than another row of clickable tabs.
 */
function StatsPanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-11 items-stretch divide-x divide-slate-700/60 overflow-hidden rounded-xl border border-slate-700/60 bg-slate-800/40">
      {children}
    </div>
  );
}

interface CompactStatsProps {
  activeConfig?: ProviderConfig;
  todayCommission?: number | undefined;
  todayCount?: number | undefined;
  allProvidersCommission?: number | undefined;
  allProvidersByCurrency?: CurrencyStats[] | undefined;
  /** LIRA-163: count of today's commission_model = 1 rows (across the
   *  filtered provider set) still awaiting settlement — the "Total Profit"
   *  metric otherwise reads a bare $0.00 for an all-post-cutover provider,
   *  indistinguishable from a day with genuinely no commission. */
  allProvidersAwaitingSettlementCount?: number | undefined;
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
  allProvidersAwaitingSettlementCount,
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
      <StatsPanel>
        {isAdmin && (
          <Metric
            label="Profit"
            value={profitDisplay}
            valueClass={activeConfig?.color ?? "text-white"}
            accentBg={activeConfig?.bgTint}
          />
        )}
        <Metric
          label="Sent"
          value={`$${cryptoOutToday?.toFixed(2) ?? "0.00"}`}
          valueClass="text-red-400"
        />
        <Metric
          label="Received"
          value={`$${cryptoInToday?.toFixed(2) ?? "0.00"}`}
          valueClass="text-emerald-400"
        />
        <Metric
          label="Count"
          value={todayCount ?? 0}
          valueClass="text-slate-300"
        />
        {drawerBalance && (
          <Metric
            label="Drawer"
            value={formatDrawerBalance(drawerBalance)}
            valueClass="text-emerald-400"
          />
        )}
      </StatsPanel>
    );
  }

  return (
    <StatsPanel>
      {isAdmin && (
        <Metric
          label="Profit"
          value={profitDisplay}
          valueClass={activeConfig?.color ?? "text-white"}
          accentBg={activeConfig?.bgTint}
        />
      )}

      {allProvidersCommission !== undefined && (
        <Metric
          label="Total Profit"
          value={
            (allProvidersByCurrency && allProvidersByCurrency.length > 0
              ? formatByCurrency(allProvidersByCurrency)
              : `$${allProvidersCommission.toFixed(2)}`) +
            // LIRA-163: without this, an all-post-cutover provider reads a
            // bare $0.00 — indistinguishable from genuinely zero commission.
            ((allProvidersAwaitingSettlementCount ?? 0) > 0
              ? ` · ${allProvidersAwaitingSettlementCount} pending`
              : "")
          }
        />
      )}

      <Metric
        label="Count"
        value={todayCount ?? 0}
        valueClass="text-slate-300"
      />

      {drawerBalance && (
        <Metric
          label="Drawer"
          value={formatDrawerBalance(drawerBalance)}
          valueClass="text-emerald-400"
        />
      )}
    </StatsPanel>
  );
}
