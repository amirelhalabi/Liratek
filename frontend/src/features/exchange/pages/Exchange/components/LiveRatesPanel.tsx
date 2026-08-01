/**
 * Rates Panel (side column) — the shop's configured rates pinned above the
 * full market reference.
 *
 * Two sources, deliberately distinguished on every row:
 *
 *   - `settings` — from `exchange_rates` (Settings → Currencies). These are
 *     the rates the shop actually quotes and the ones that determine stamped
 *     profit. Pinned to the top, LBP then EUR.
 *   - `market` — mid-market from the public feed (open.er-api.com), for every
 *     currency the shop has NOT configured. Reference only: no spread, so it
 *     earns nothing on its own.
 *
 * The free feed publishes about once every 24 hours, so market values do NOT
 * tick. The publish time is shown verbatim rather than styled as a live
 * ticker — an operator must be able to see how old it is before quoting off it.
 */

import { useMemo, useState } from "react";
import { Globe, Search } from "lucide-react";
import type { CurrencyRate } from "@liratek/core";
import { CURRENCY_NAMES, getCurrencySymbol } from "@/utils/liveExchangeRates";
import type { ExchangeRate } from "@/utils/currencyUtils";

// ─── Row model ────────────────────────────────────────────────────────────────

/**
 * Configured currencies pin to the top in this order. Any OTHER configured
 * currency follows alphabetically, still ahead of the market rows — so the
 * shop's own rates always read first, and configuring a third currency later
 * needs no change here.
 */
const PINNED_ORDER = ["LBP", "EUR"];

type RateSource = "settings" | "market";

interface DisplayRow {
  code: string;
  /** Primary value, direction given by `isStronger`. */
  value: number;
  isStronger: 1 | -1;
  source: RateSource;
  /** Configured rows only — the spread the shop actually quotes. */
  buy?: number;
  sell?: number;
}

function toSettingsRow(row: ExchangeRate): DisplayRow {
  return {
    code: row.to_code,
    value: row.market_rate,
    isStronger: row.is_stronger,
    source: "settings",
    buy: row.buy_rate,
    sell: row.sell_rate,
  };
}

function toMarketRow(rate: CurrencyRate): DisplayRow {
  return {
    code: rate.to_code,
    value: rate.market_rate,
    isStronger: rate.is_stronger,
    source: "market",
  };
}

/**
 * Configured rows first, then market rows for every code the shop has NOT
 * configured — a configured code must never appear twice carrying two
 * different numbers.
 */
function buildRows(
  marketRates: CurrencyRate[],
  configuredRates: ExchangeRate[],
): DisplayRow[] {
  const pinnedRank = (code: string): number => {
    const i = PINNED_ORDER.indexOf(code);
    return i === -1 ? PINNED_ORDER.length : i;
  };

  const settings = [...configuredRates]
    .sort(
      (a, b) =>
        pinnedRank(a.to_code) - pinnedRank(b.to_code) ||
        a.to_code.localeCompare(b.to_code),
    )
    .map(toSettingsRow);

  const configuredCodes = new Set(configuredRates.map((r) => r.to_code));
  const market = marketRates
    .filter((r) => !configuredCodes.has(r.to_code))
    .map(toMarketRow);

  return [...settings, ...market];
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/**
 * Decimal places by magnitude: 26,183 VND needs none, 160.57 JPY needs two,
 * 0.7446-style values need four.
 */
function formatNumber(value: number, isStronger: 1 | -1): string {
  if (isStronger === 1) {
    const max = value >= 1000 ? 0 : value >= 10 ? 2 : 4;
    return value.toLocaleString(undefined, {
      maximumFractionDigits: max,
      minimumFractionDigits: Math.min(max, 2),
    });
  }
  // EUR-like: the rate is USD per 1 unit.
  return value.toFixed(4);
}

/** Which way the number reads — never leave this implicit. */
function unitLabel(row: DisplayRow): string {
  return row.isStronger === 1
    ? `${row.code} per 1 USD`
    : `USD per 1 ${row.code}`;
}

/**
 * The feed's own publish time. This is an RFC-1123 string from an HTTP API,
 * NOT a SQLite timestamp — `parseDbDate` would be wrong here.
 */
function formatPublished(utc: string | undefined): string {
  if (!utc) return "—";
  const d = new Date(utc);
  if (isNaN(d.getTime())) return utc;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

interface LiveRatesPanelProps {
  /** Market rates from the feed (`snapshot.marketRates`). */
  rates: CurrencyRate[];
  /**
   * Raw `exchange_rates` rows — pinned to the top of the list and rendered
   * from the shop's OWN configured values, not the feed's.
   */
  configuredRates?: ExchangeRate[];
  /**
   * The feed's publish time, verbatim from `time_last_update_utc`. Explicitly
   * `| undefined` because the page holds it as optional state and
   * `exactOptionalPropertyTypes` otherwise rejects passing it through.
   */
  lastUpdatedUtc?: string | undefined;
  loading?: boolean;
  className?: string;
}

export function LiveRatesPanel({
  rates,
  configuredRates = [],
  lastUpdatedUtc,
  loading = false,
  className = "",
}: LiveRatesPanelProps) {
  const [search, setSearch] = useState("");

  const rows = useMemo(
    () => buildRows(rates, configuredRates),
    [rates, configuredRates],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        (CURRENCY_NAMES[r.code] ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <aside
      data-testid="exchange-live-rates-panel"
      className={`bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl flex flex-col overflow-hidden ${className}`}
    >
      {/* Header + provenance */}
      <div className="px-4 py-3 bg-slate-900/60 border-b border-slate-700/60 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe size={14} className="text-sky-400" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-300">
              Rates
            </span>
          </div>
          <span className="text-[10px] text-slate-500">{rows.length}</span>
        </div>
        <p className="mt-1 text-[10px] text-slate-500">
          Market updated {formatPublished(lastUpdatedUtc)} · once daily
        </p>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-slate-700/60 shrink-0">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search currency…"
            aria-label="Search rates"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-7 pr-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && rows.length === 0 ? (
          <div className="p-3 space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-9 animate-pulse bg-slate-700/30 rounded"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-xs text-slate-500">
            No rates available — configure one in Settings → Currencies, or
            check the internet connection for market rates.
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-xs text-slate-500">
            No currency matches “{search}”.
          </p>
        ) : (
          <ul className="divide-y divide-slate-700/40">
            {filtered.map((row) => {
              const isSettings = row.source === "settings";
              const symbol = getCurrencySymbol(row.code);
              return (
                <li
                  key={row.code}
                  data-testid={`rate-row-${row.code}`}
                  data-source={row.source}
                  // No hover state: the rows are read, not clicked, so a
                  // highlight that follows the cursor only adds noise.
                  className={`flex items-center justify-between gap-2 px-3 py-2 ${
                    isSettings ? "bg-violet-500/[0.07]" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-xs font-bold text-white font-mono">
                      {row.code}
                      {symbol !== row.code && (
                        <span className="text-slate-500 font-sans font-normal">
                          {symbol}
                        </span>
                      )}
                      {isSettings && (
                        <span
                          className="text-[9px] font-sans font-medium uppercase tracking-wide text-violet-300 bg-violet-500/15 border border-violet-500/30 rounded px-1 py-px"
                          title="Your own rate, from Settings → Currencies"
                        >
                          yours
                        </span>
                      )}
                    </p>
                    {isSettings &&
                    row.buy !== undefined &&
                    row.sell !== undefined ? (
                      // More useful than the currency's name here: the spread
                      // the shop actually quotes. Same emerald/red semantics
                      // as Settings and the Your Rates modal.
                      <p className="text-[10px] font-mono">
                        <span className="text-emerald-400">
                          {formatNumber(row.buy, row.isStronger)}
                        </span>
                        <span className="text-slate-600"> / </span>
                        <span className="text-red-400">
                          {formatNumber(row.sell, row.isStronger)}
                        </span>
                      </p>
                    ) : (
                      CURRENCY_NAMES[row.code] && (
                        <p className="text-[10px] text-slate-500 truncate">
                          {CURRENCY_NAMES[row.code]}
                        </p>
                      )
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-mono font-semibold text-slate-100">
                      {formatNumber(row.value, row.isStronger)}
                    </p>
                    <p className="text-[9px] text-slate-500">
                      {unitLabel(row)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer — keeps the market rows from being read as quotable rates. */}
      <p className="px-3 py-2 bg-slate-900/40 border-t border-slate-700/60 text-[10px] leading-relaxed text-slate-500 shrink-0">
        <span className="text-violet-300">Yours</span> shows market · buy / sell
        from Settings. The rest is mid-market reference — no spread, earns
        nothing.
      </p>
    </aside>
  );
}

export default LiveRatesPanel;
