import { useEffect, useState } from "react";
import { Layers, TrendingUp, TrendingDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApi } from "@liratek/ui";
import { formatNumber } from "@liratek/ui/i18n/format";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { DirIcon } from "@liratek/ui/components/ui/DirIcon";
import logger from "@/utils/logger";

/**
 * Open exchange-lot positions panel (EXCHANGE_LOT_SETTLEMENT.md Q16) — one
 * row per lot-tracked (exotic) currency the shop currently holds an open
 * position in: quantity, weighted-average acquisition cost, today's market
 * rate (when available), and the resulting unrealized P&L. Purely
 * display-only/indicative (Q11) — this NEVER feeds Profits totals, only
 * `getExchangeLotService().getPositions()`'s own read.
 */

interface LotPosition {
  currency_code: string;
  open_qty: number;
  avg_unit_cost_usd: number;
  lot_count: number;
  current_market_unit_usd: number | null;
  unrealized_profit_usd: number | null;
}

interface PositionsPanelProps {
  /** Bump this whenever the page's exchange history reloads, so open
   *  positions stay in sync with newly created/settled lots without a
   *  second independent polling loop. */
  refreshKey: number;
  /** Opens the History modal pre-filtered to this currency (Q16). */
  onViewCurrency: (currencyCode: string) => void;
}

export function PositionsPanel({
  refreshKey,
  onViewCurrency,
}: PositionsPanelProps) {
  const api = useApi();
  const { t } = useTranslation("exchange");
  const [positions, setPositions] = useState<LotPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await api.exchangeLots.getPositions();
        if (!cancelled) setPositions(data);
      } catch (err) {
        if (!cancelled) {
          logger.error("Failed to load exchange lot positions", err);
          setError(
            err instanceof Error ? err.message : t("positions.loadFailed"),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const openPositions = positions.filter((p) => p.open_qty > 0.005);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-violet-400" />
          <h3 className="text-sm font-semibold text-white">
            {t("positions.title")}
          </h3>
        </div>
        {!loading && openPositions.length > 0 && (
          <span className="text-[10px] text-slate-500 italic">
            {t("positions.indicative")}
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-xs text-slate-500 py-4 text-center">
          {t("positions.loading")}
        </div>
      ) : error ? (
        <div className="text-xs text-red-400 py-4 text-center">{error}</div>
      ) : openPositions.length === 0 ? (
        <div className="text-xs text-slate-500 py-4 text-center">
          {t("positions.empty")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-700/50">
                <th className="text-start font-medium py-2 pe-3">
                  {t("positions.currency")}
                </th>
                <th className="text-end font-medium py-2 pe-3">
                  {t("positions.openQty")}
                </th>
                <th className="text-end font-medium py-2 pe-3">
                  {t("positions.avgCost")}
                </th>
                <th className="text-end font-medium py-2 pe-3">
                  {t("positions.market")}
                </th>
                <th className="text-end font-medium py-2 pe-3">
                  {t("positions.unrealized")}
                </th>
                <th className="w-8 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {openPositions.map((p) => (
                <tr
                  key={p.currency_code}
                  className="hover:bg-slate-700/20 transition-colors"
                >
                  <td className="py-2 pe-3 font-semibold text-white">
                    {p.currency_code}
                  </td>
                  <td className="py-2 pe-3 text-end font-mono text-slate-300">
                    <Ltr>
                      {formatNumber(p.open_qty, { maximumFractionDigits: 4 })}
                    </Ltr>
                  </td>
                  <td className="py-2 pe-3 text-end font-mono text-slate-300">
                    <Ltr>${p.avg_unit_cost_usd.toFixed(4)}</Ltr>
                  </td>
                  <td className="py-2 pe-3 text-end font-mono text-slate-300">
                    <Ltr>
                      {p.current_market_unit_usd !== null
                        ? `$${p.current_market_unit_usd.toFixed(4)}`
                        : "—"}
                    </Ltr>
                  </td>
                  <td className="py-2 pe-3 text-end font-mono font-semibold">
                    {p.unrealized_profit_usd === null ? (
                      <span className="text-slate-500">—</span>
                    ) : (
                      <span
                        className={`inline-flex items-center justify-end gap-1 ${
                          p.unrealized_profit_usd >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {p.unrealized_profit_usd >= 0 ? (
                          <TrendingUp size={12} />
                        ) : (
                          <TrendingDown size={12} />
                        )}
                        <Ltr>
                          {p.unrealized_profit_usd >= 0 ? "+" : ""}$
                          {p.unrealized_profit_usd.toFixed(2)}
                        </Ltr>
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-end">
                    <button
                      onClick={() => onViewCurrency(p.currency_code)}
                      className="p-1 text-slate-500 hover:text-violet-400 transition-colors"
                      title={t("positions.viewHistory", {
                        code: p.currency_code,
                      })}
                    >
                      <DirIcon icon={ChevronRight} width={14} height={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default PositionsPanel;
