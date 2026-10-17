/**
 * Rates Panel — the shop's OWN configured trading rates, beside the calculator.
 *
 * Source is `exchange_rates` (local DB, via api.getRates()) — NOT the live
 * market API. That is deliberate: these are the rates the shop actually
 * quotes and the ones that determine stamped profit, so the panel answers
 * "what do I charge, and what do I earn on it?" rather than "what is the
 * market doing?".
 *
 * The timestamp is therefore about how stale the OPERATOR's own rate is
 * (exchange_rates.updated_at) — actionable in a way an API publish time is
 * not. Values change only when someone edits them in Settings → Currencies,
 * so there is nothing to poll.
 */

import { TrendingUp, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { computeLegProfitUsd, type CurrencyRate } from "@liratek/core";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import {
  calculateProfitSpread,
  type ExchangeRate,
} from "@/utils/currencyUtils";

// ─── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format a rate in its own denomination.
 *
 * is_stronger = +1 (LBP-like): the rate is <code> units per 1 USD.
 * is_stronger = -1 (EUR-like): the rate is USD per 1 unit.
 *
 * Uses `row.to_code` rather than a hardcoded "LBP" so a third weak currency
 * (TRY, EGP, …) labels correctly.
 */
function formatRateValue(rate: number, row: ExchangeRate): string {
  return row.is_stronger === 1
    ? `${formatNumber(rate, { maximumFractionDigits: 0 })} ${row.to_code}`
    : `${rate.toFixed(4)} USD`;
}

/** "1 USD = X LBP" / "1 EUR = X USD" — which way the rate reads. */
function rateDirectionLabel(row: ExchangeRate): string {
  return row.is_stronger === 1
    ? `1 USD = X ${row.to_code}`
    : `1 ${row.to_code} = X USD`;
}

/**
 * USD profit on ONE unit, using core's `computeLegProfitUsd` — the SAME
 * function that stamps `leg1_profit_usd` on every exchange. Deliberately not
 * re-derived here: the panel must not be able to disagree with what gets
 * booked.
 *
 * The "unit" differs by currency strength, matching each one's natural quote:
 *   LBP-like → per 1 USD exchanged
 *   EUR-like → per 1 EUR exchanged
 *
 * Note this is HALF the spread — the shop earns the half-spread per leg, not
 * the full sell−buy gap.
 */
function profitPerUnit(row: ExchangeRate): { usd: number; unit: string } {
  const cr: CurrencyRate = {
    to_code: row.to_code,
    market_rate: row.market_rate,
    buy_rate: row.buy_rate,
    sell_rate: row.sell_rate,
    is_stronger: row.is_stronger,
  };
  return row.is_stronger === 1
    ? { usd: computeLegProfitUsd(1, cr, true), unit: "USD" }
    : { usd: computeLegProfitUsd(1, cr, false), unit: row.to_code };
}

/** Compact "2h ago" / "3d ago" for a DB timestamp. */
function formatRelative(
  iso: string | undefined,
  t: TFunction<"exchange">,
): string {
  if (!iso) return t("rates.never");
  const ms = Date.now() - parseDbDate(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return t("rates.justNow");
  if (mins < 60) return t("rates.minutesAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("rates.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  return t("rates.daysAgo", { n: days });
}

/**
 * Staleness buckets for a TRADING RATE — intentionally not the drawer
 * checkpoint buckets on the Dashboard (those are shift-based; a rate is
 * about market drift). Rates are expected to be revised at least daily.
 */
function stalenessColor(iso: string | undefined): {
  dot: string;
  text: string;
} {
  if (!iso) return { dot: "bg-red-400", text: "text-red-400" };
  const hours = (Date.now() - parseDbDate(iso).getTime()) / 3_600_000;
  if (hours < 12) return { dot: "bg-green-400", text: "text-green-400" };
  if (hours < 48) return { dot: "bg-yellow-400", text: "text-yellow-400" };
  return { dot: "bg-red-400", text: "text-red-400" };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface RatesPanelProps {
  /** Raw `exchange_rates` rows, as returned by api.getRates(). */
  rates: ExchangeRate[];
  loading?: boolean;
  className?: string;
  /**
   * Drop the card chrome and the panel's own header — for rendering inside a
   * dialog that already supplies a frame and a title (YourRatesModal). A prop
   * rather than an overriding className because Tailwind conflicts resolve by
   * CSS source order, so `bg-transparent` appended after `bg-slate-800` is not
   * reliably the winner.
   */
  bare?: boolean;
}

export function RatesPanel({
  rates,
  loading = false,
  className = "",
  bare = false,
}: RatesPanelProps) {
  const { t } = useTranslation("exchange");
  const chrome = bare
    ? ""
    : "bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl";
  return (
    <aside
      data-testid="exchange-rates-panel"
      className={`${chrome} overflow-hidden ${className}`}
    >
      {/* Header */}
      {!bare && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-slate-900/60 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-violet-400" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-300">
              {t("rates.yourRates")}
            </span>
          </div>
          <span className="text-[10px] text-slate-500">
            {t("rates.configuredCount", { count: rates.length })}
          </span>
        </div>
      )}

      {loading && rates.length === 0 ? (
        <div className="p-4 space-y-3">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse bg-slate-700/30 rounded-lg"
            />
          ))}
        </div>
      ) : rates.length === 0 ? (
        <p className="p-4 text-xs text-slate-500">
          {t("rates.noneConfigured")}
        </p>
      ) : (
        <div className="divide-y divide-slate-700/60">
          {rates.map((row) => {
            const spread = calculateProfitSpread(rates, row.to_code);
            const spreadPct =
              spread !== null && row.market_rate > 0
                ? (spread / row.market_rate) * 100
                : null;
            const profit = profitPerUnit(row);
            const stale = stalenessColor(row.updated_at);

            return (
              <div key={row.to_code} className="p-4 space-y-2.5">
                {/* Currency + freshness */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white font-mono">
                      {row.to_code}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate" dir="ltr">
                      {rateDirectionLabel(row)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${stale.dot}`}
                      aria-hidden="true"
                    />
                    <span className={`text-[10px] ${stale.text}`}>
                      {formatRelative(row.updated_at, t)}
                    </span>
                  </div>
                </div>

                {/* Buy / Sell / Market — same semantics & colors as
                    Settings → Exchange Rates (emerald = we give,
                    red = customer gives). */}
                <dl className="space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="flex items-center gap-1 text-slate-400">
                      <ArrowUpRight size={11} className="text-emerald-400" />
                      {t("rates.buy")}
                      <span className="text-slate-600">
                        {t("rates.weGive")}
                      </span>
                    </dt>
                    <dd className="font-mono text-emerald-400" dir="ltr">
                      {formatRateValue(row.buy_rate, row)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="flex items-center gap-1 text-slate-400">
                      <ArrowDownLeft size={11} className="text-red-400" />
                      {t("rates.sell")}
                      <span className="text-slate-600">
                        {t("rates.theyGive")}
                      </span>
                    </dt>
                    <dd className="font-mono text-red-400" dir="ltr">
                      {formatRateValue(row.sell_rate, row)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-400 ps-[19px]">
                      {t("rates.market")}
                    </dt>
                    <dd className="font-mono text-slate-300" dir="ltr">
                      {formatRateValue(row.market_rate, row)}
                    </dd>
                  </div>
                </dl>

                {/* Spread + what the shop actually earns (half the spread) */}
                <div className="rounded-lg bg-slate-900/60 border border-slate-700/50 px-2.5 py-2 space-y-1">
                  {spread !== null && (
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-slate-500">
                        {t("rates.spread")}
                      </span>
                      <span className="font-mono text-slate-300" dir="ltr">
                        {formatRateValue(spread, row)}
                        {spreadPct !== null && (
                          <span className="text-slate-500">
                            {" "}
                            ({spreadPct.toFixed(2)}%)
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-slate-500">
                      {t("rates.profitPerUnit", { unit: profit.unit })}
                    </span>
                    <span className="font-mono font-semibold text-emerald-400">
                      <Ltr>${profit.usd.toFixed(4)}</Ltr>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Provenance — the panel shows the shop's own rates, not the market. */}
      <p className="px-4 py-2.5 bg-slate-900/40 border-t border-slate-700/60 text-[10px] leading-relaxed text-slate-500">
        {t("rates.provenance")}
      </p>
    </aside>
  );
}

export default RatesPanel;
