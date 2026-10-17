import { TrendingUp, Calendar } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { PROVIDER_BRANDS } from "@/shared/brand/providerBrands";

interface CurrencyStats {
  currency: string;
  commission: number;
  count: number;
}

interface OwedByProvider {
  usd?: number;
  lbp?: number;
}

interface StatsCardsProps {
  todayCommission: number;
  monthCommission: number;
  todayByCurrency?: CurrencyStats[] | undefined;
  monthByCurrency?: CurrencyStats[] | undefined;
  /** LIRA-163: count of today's/this month's commission_model = 1 rows
   *  still awaiting settlement — see FinancialServiceRepository
   *  .getAnalytics's own doc comment. Renders a caption when the chip's
   *  dollar figure reads $0.00 purely because settlement hasn't happened
   *  yet, not because nothing was earned. */
  todayAwaitingSettlementCount?: number | undefined;
  monthAwaitingSettlementCount?: number | undefined;
  owedByProvider: {
    OMT?: OwedByProvider;
    WHISH?: OwedByProvider;
  };
}

function formatCurrencyAmount(amount: number, currency: string): string {
  if (currency === "LBP") {
    return `${formatNumber(Math.round(amount))} LBP`;
  }
  return `$${formatNumber(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function getBalanceColor(usd: number): string {
  if (usd > 0) return "text-red-400";
  if (usd < 0) return "text-emerald-400";
  return "text-slate-300";
}

/** The key of the owed/due caption, or null when the balance is zero. */
function getBalanceLabelKey(usd: number): "stats.owe" | "stats.due" | null {
  if (usd > 0) return "stats.owe";
  if (usd < 0) return "stats.due";
  return null;
}

export function StatsCards({
  todayCommission,
  monthCommission,
  todayByCurrency,
  monthByCurrency,
  todayAwaitingSettlementCount,
  monthAwaitingSettlementCount,
  owedByProvider,
}: StatsCardsProps) {
  const { t } = useTranslation("services");
  const balanceLabel = (usd: number) => {
    const key = getBalanceLabelKey(usd);
    return key ? t(key) : "";
  };
  return (
    <div className="flex flex-wrap gap-2">
      {/* Today */}
      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <TrendingUp
          className={`w-4 h-4 shrink-0 ${PROVIDER_BRANDS.OMT.text}`}
        />
        <span className="font-medium whitespace-nowrap">
          {t("stats.today")}
        </span>
        <span
          className={`font-bold ${PROVIDER_BRANDS.OMT.text} flex flex-col items-end leading-tight`}
        >
          <span>
            {todayByCurrency && todayByCurrency.length > 0
              ? formatByCurrency(todayByCurrency)
              : `$${formatNumber(todayCommission, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`}
          </span>
          {/* LIRA-163: without this, an all-post-cutover today reads a bare
              $0.00 — indistinguishable from a day with genuinely no
              commission earned. */}
          {(todayAwaitingSettlementCount ?? 0) > 0 && (
            <span
              data-testid="services-today-awaiting-settlement"
              className="text-[10px] font-normal text-slate-400"
            >
              {t("stats.awaitingSettlement", {
                n: todayAwaitingSettlementCount,
              })}
            </span>
          )}
        </span>
      </div>

      {/* Month */}
      <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
        <Calendar className="w-4 h-4 shrink-0 text-blue-400" />
        <span className="font-medium whitespace-nowrap">
          {t("stats.month")}
        </span>
        <span className="font-bold text-blue-400 flex flex-col items-end leading-tight">
          <span>
            {monthByCurrency && monthByCurrency.length > 0
              ? formatByCurrency(monthByCurrency)
              : `$${formatNumber(monthCommission, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`}
          </span>
          {(monthAwaitingSettlementCount ?? 0) > 0 && (
            <span
              data-testid="services-month-awaiting-settlement"
              className="text-[10px] font-normal text-slate-400"
            >
              {t("stats.awaitingSettlement", {
                n: monthAwaitingSettlementCount,
              })}
            </span>
          )}
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
            {formatNumber(Math.abs(owedByProvider.OMT.usd ?? 0), {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          {balanceLabel(owedByProvider.OMT.usd ?? 0) && (
            <span
              className={`text-sm ${getBalanceColor(owedByProvider.OMT.usd ?? 0)} opacity-70`}
            >
              {balanceLabel(owedByProvider.OMT.usd ?? 0)}
            </span>
          )}
        </div>
      )}

      {/* WHISH */}
      {owedByProvider.WHISH && (
        <div className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white">
          {/* Provider code, shown as is (brand). */}
          <span className="font-medium whitespace-nowrap">{"WHISH"}</span>
          <span
            className={`font-bold ${getBalanceColor(owedByProvider.WHISH.usd ?? 0)}`}
          >
            $
            {formatNumber(Math.abs(owedByProvider.WHISH.usd ?? 0), {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          {balanceLabel(owedByProvider.WHISH.usd ?? 0) && (
            <span
              className={`text-sm ${getBalanceColor(owedByProvider.WHISH.usd ?? 0)} opacity-70`}
            >
              {balanceLabel(owedByProvider.WHISH.usd ?? 0)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
