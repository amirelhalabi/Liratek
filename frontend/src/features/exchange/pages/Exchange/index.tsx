import { useState, useEffect, useCallback } from "react";
import logger from "../../../../utils/logger";
import {
  RefreshCw,
  ArrowRightLeft,
  History,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { PageHeader, useApi } from "@liratek/ui";
import { useSession } from "../../../sessions/context/SessionContext";
import { useCurrencyContext } from "../../../../contexts/CurrencyContext";
import { DataTable } from "@/shared/components/DataTable";
import {
  calculateExchange,
  type CurrencyRate,
  type CurrencyExchangeResult,
} from "@liratek/core";

// ─── Types ────────────────────────────────────────────────────────────────────

type ExchangeTx = {
  id: number;
  created_at: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  leg1_rate: number | null;
  leg1_market_rate: number | null;
  leg1_profit_usd: number | null;
  leg2_rate: number | null;
  leg2_market_rate: number | null;
  leg2_profit_usd: number | null;
  via_currency: string | null;
  profit_usd: number | null;
  amount_in: string | number;
  amount_out: string | number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toCurrencyRates(
  rows: Array<{
    to_code: string;
    market_rate: number;
    delta: number;
    is_stronger: number;
  }>,
): CurrencyRate[] {
  return rows.map((r) => ({
    to_code: r.to_code,
    market_rate: r.market_rate,
    delta: r.delta,
    is_stronger: r.is_stronger as 1 | -1,
  }));
}

/**
 * Format a leg rate with proper currency label.
 * e.g. "90,000 LBP per USD" or "1.1600 USD per EUR"
 */
function formatLegRate(
  fromCurrency: string,
  toCurrency: string,
  rate: number,
  rates: CurrencyRate[],
): string {
  const nonUsd = fromCurrency === "USD" ? toCurrency : fromCurrency;
  const cr = rates.find((r) => r.to_code === nonUsd);
  if (!cr) return rate.toLocaleString();
  if (cr.is_stronger === 1) {
    // LBP-like: rate = X LBP per 1 USD
    return `${rate.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${nonUsd} per USD`;
  } else {
    // EUR-like: rate = X USD per 1 EUR
    return `${rate.toFixed(4)} USD per ${nonUsd}`;
  }
}

/**
 * Format an amount with its currency code.
 */
function formatAmount(amount: number, currency: string, decimals = 2): string {
  const d = currency === "LBP" ? 0 : decimals;
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: d })} ${currency}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Exchange() {
  const api = useApi();
  const { activeSession, linkTransaction } = useSession();
  const {
    activeCurrencies: currencies,
    getSymbol,
    getDecimals,
  } = useCurrencyContext();

  const [transactions, setTransactions] = useState<ExchangeTx[]>([]);
  const [fromCurrency, setFromCurrency] = useState<string>("");
  const [toCurrency, setToCurrency] = useState<string>("");
  const [amountIn, setAmountIn] = useState<string>("");
  const [amountOut, setAmountOut] = useState<string>("");
  const [rates, setRates] = useState<CurrencyRate[]>([]);
  const [clientName, setClientName] = useState("");

  // Live calculation result (auto from DB rates)
  const [calcResult, setCalcResult] = useState<CurrencyExchangeResult | null>(
    null,
  );
  const [calcError, setCalcError] = useState<string | null>(null);
  const [profitWarning, setProfitWarning] = useState<string | null>(null);

  // Custom rate overrides (per leg — user editable, never saved to DB)
  // Key: 0 = leg1 rate, 1 = leg2 rate
  const [customRates, setCustomRates] = useState<{ [leg: number]: string }>({});
  // Whether user has overridden each leg's rate
  const [rateOverridden, setRateOverridden] = useState<{
    [leg: number]: boolean;
  }>({});

  // Set initial currencies once loaded
  useEffect(() => {
    if (currencies.length >= 2 && !fromCurrency && !toCurrency) {
      setFromCurrency(currencies[0].code);
      setToCurrency(currencies[1].code);
    }
  }, [currencies, fromCurrency, toCurrency]);

  // Load history + auto-fill session customer
  useEffect(() => {
    loadHistory();
    if (activeSession?.customer_name) {
      setClientName(activeSession.customer_name);
    }
  }, [activeSession]);

  // Load rates from DB (new 4-column schema)
  useEffect(() => {
    const load = async () => {
      try {
        const list = await api.getRates();
        setRates(toCurrencyRates(list));
      } catch (e) {
        logger.error("Failed to load rates", e);
      }
    };
    load();
  }, []);

  // Reset custom rate overrides when currencies change
  useEffect(() => {
    setCustomRates({});
    setRateOverridden({});
  }, [fromCurrency, toCurrency]);

  /**
   * Apply custom rate overrides to a base calculation result.
   * Recomputes leg amounts and profits based on user-edited rates.
   * Never touches DB rates.
   */
  const applyCustomRates = useCallback(
    (base: CurrencyExchangeResult): CurrencyExchangeResult => {
      if (!Object.keys(rateOverridden).some((k) => rateOverridden[Number(k)])) {
        return base; // no overrides — return as-is
      }

      const isCross = base.legs.length === 2;
      const legs = base.legs.map((leg, i) => {
        if (!rateOverridden[i]) return leg;
        const customRate = parseFloat(customRates[i] ?? "");
        if (isNaN(customRate) || customRate <= 0) return leg;

        const cr = rates.find(
          (r) =>
            r.to_code ===
            (leg.fromCurrency === "USD" ? leg.toCurrency : leg.fromCurrency),
        );
        if (!cr) return leg;

        // Recompute amountOut with custom rate
        let amountOut: number;
        if (cr.is_stronger === 1) {
          // LBP-like
          amountOut =
            leg.fromCurrency === "USD"
              ? leg.amountIn * customRate // USD → LBP: multiply
              : leg.amountIn / customRate; // LBP → USD: divide
        } else {
          // EUR-like
          amountOut =
            leg.fromCurrency === "USD"
              ? leg.amountIn / customRate // USD → EUR: divide
              : leg.amountIn * customRate; // EUR → USD: multiply
        }

        // Recompute profit vs market rate
        const marketOut =
          leg.fromCurrency === "USD"
            ? cr.is_stronger === 1
              ? leg.amountIn * cr.market_rate
              : leg.amountIn / cr.market_rate
            : cr.is_stronger === 1
              ? leg.amountIn / cr.market_rate
              : leg.amountIn * cr.market_rate;

        // Profit = difference between market and actual, in USD
        const diff =
          cr.is_stronger === 1
            ? Math.abs(marketOut - amountOut) / cr.market_rate
            : Math.abs(marketOut - amountOut);
        const profitUsd = diff;

        return { ...leg, rate: customRate, amountOut, profitUsd };
      });

      // Recompute leg2 amountIn for cross-currency (= leg1 amountOut)
      if (isCross && legs[1]) {
        const leg1Out = legs[0].amountOut;
        const leg2 = legs[1];
        const cr = rates.find(
          (r) =>
            r.to_code ===
            (leg2.fromCurrency === "USD" ? leg2.toCurrency : leg2.fromCurrency),
        );
        const rate2 = rateOverridden[1]
          ? parseFloat(customRates[1] ?? "") || leg2.rate
          : leg2.rate;

        let amountOut2: number;
        if (cr) {
          amountOut2 =
            cr.is_stronger === 1
              ? leg1Out * rate2 // USD → LBP
              : leg1Out / rate2; // USD → EUR
          const marketOut2 =
            cr.is_stronger === 1
              ? leg1Out * cr.market_rate
              : leg1Out / cr.market_rate;
          const diff2 =
            cr.is_stronger === 1
              ? Math.abs(marketOut2 - amountOut2) / cr.market_rate
              : Math.abs(marketOut2 - amountOut2);
          legs[1] = {
            ...leg2,
            amountIn: leg1Out,
            rate: rate2,
            amountOut: amountOut2,
            profitUsd: diff2,
          };
        }
      }

      const totalAmountOut = legs[legs.length - 1].amountOut;
      const totalProfitUsd = legs.reduce((s, l) => s + l.profitUsd, 0);
      return { ...base, legs, totalAmountOut, totalProfitUsd };
    },
    [customRates, rateOverridden, rates],
  );

  // Effective result (base calc + any custom rate overrides)
  const effectiveResult = calcResult ? applyCustomRates(calcResult) : null;

  // Sync amountOut with effectiveResult
  useEffect(() => {
    if (effectiveResult) {
      const decimals = getDecimals(toCurrency);
      setAmountOut(effectiveResult.totalAmountOut.toFixed(decimals));
    }
  }, [effectiveResult, toCurrency, getDecimals]);

  // Recalculate whenever inputs change (base calculation from DB rates)
  const recalculate = useCallback(() => {
    const val = parseFloat(amountIn);
    if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) {
      setCalcResult(null);
      setCalcError(null);
      setAmountOut("");
      return;
    }
    if (!rates.length) return;

    try {
      if (!isNaN(val) && val > 0) {
        const result = calculateExchange(fromCurrency, toCurrency, val, rates);
        setCalcResult(result);
        setCalcError(null);
        const decimals = getDecimals(toCurrency);
        setAmountOut(result.totalAmountOut.toFixed(decimals));

        // Sanity check: profit should not exceed 10% of input USD equivalent
        const inputUsd =
          fromCurrency === "USD"
            ? val
            : (result.legs[0]?.amountOut ?? val / 89500);
        const profitPct =
          inputUsd > 0 ? (result.totalProfitUsd / inputUsd) * 100 : 0;
        if (profitPct > 10) {
          setProfitWarning(
            `Unusually high profit: $${result.totalProfitUsd.toFixed(2)} USD (${profitPct.toFixed(1)}% of input). Please verify your rates.`,
          );
        } else {
          setProfitWarning(null);
        }
      } else {
        setCalcResult(null);
        setCalcError(null);
        setAmountOut("");
        setProfitWarning(null);
      }
    } catch (err) {
      setCalcError(err instanceof Error ? err.message : "Calculation error");
      setCalcResult(null);
      setAmountOut("");
      setProfitWarning(null);
    }
  }, [amountIn, fromCurrency, toCurrency, rates, getDecimals]);

  useEffect(() => {
    recalculate();
  }, [recalculate]);

  // Handler: user edits a leg rate
  const handleRateChange = (legIndex: number, value: string) => {
    setCustomRates((prev) => ({ ...prev, [legIndex]: value }));
    setRateOverridden((prev) => ({ ...prev, [legIndex]: value !== "" }));
  };

  // Reset a leg rate back to DB default
  const resetRate = (legIndex: number) => {
    setCustomRates((prev) => {
      const n = { ...prev };
      delete n[legIndex];
      return n;
    });
    setRateOverridden((prev) => ({ ...prev, [legIndex]: false }));
  };

  const loadHistory = async () => {
    try {
      const history = await api.getExchangeHistory();
      setTransactions(history);
    } catch (error) {
      logger.error("Failed to load history:", error);
    }
  };

  const handleSwap = () => {
    const prev = fromCurrency;
    setFromCurrency(toCurrency);
    setToCurrency(prev);
    setAmountIn(amountOut);
  };

  const handleProcess = async () => {
    const inp = parseFloat(amountIn);
    const out = parseFloat(amountOut);

    if (!inp || !out || !effectiveResult) {
      alert("Please enter a valid amount.");
      return;
    }

    try {
      const leg1 = effectiveResult.legs[0];
      const leg2 = effectiveResult.legs[1];

      const result = await api.addExchangeTransaction({
        fromCurrency,
        toCurrency,
        amountIn: inp,
        amountOut: out,
        // Leg data for backend (new schema) — uses effective (possibly custom) rates
        leg1Rate: leg1.rate,
        leg1MarketRate: leg1.marketRate,
        leg1ProfitUsd: leg1.profitUsd,
        leg2Rate: leg2?.rate,
        leg2MarketRate: leg2?.marketRate,
        leg2ProfitUsd: leg2?.profitUsd,
        viaCurrency: effectiveResult.viaCurrency ?? undefined,
        totalProfitUsd: effectiveResult.totalProfitUsd,
        clientName: clientName || undefined,
        note: `Exchange ${fromCurrency} → ${toCurrency}${effectiveResult.viaCurrency ? ` via ${effectiveResult.viaCurrency}` : ""}`,
      });

      if (result.success) {
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "exchange",
              transactionId: result.id,
              amountUsd:
                fromCurrency === "USD" ? inp : toCurrency === "USD" ? out : 0,
              amountLbp:
                fromCurrency === "LBP" ? inp : toCurrency === "LBP" ? out : 0,
            });
          } catch (err) {
            logger.error("Failed to link exchange to session:", err);
          }
        }
        setAmountIn("");
        setAmountOut("");
        setClientName("");
        setCalcResult(null);
        loadHistory();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Operation failed", { error });
      alert("Transaction failed");
    }
  };

  const isCrossCurrency =
    fromCurrency &&
    toCurrency &&
    fromCurrency !== "USD" &&
    toCurrency !== "USD";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col h-full min-h-0 gap-6 overflow-hidden animate-in fade-in duration-500">
      <PageHeader icon={RefreshCw} title="Exchange" />

      <div className="flex-1 min-h-0 flex gap-6">
        {/* ── Left: Calculator ── */}
        <div className="w-1/3 min-w-[380px] h-full overflow-auto bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl p-4 flex flex-col gap-4">
          {/* Currency Selectors */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <span className="block text-xs font-medium text-slate-400 mb-1 uppercase">
                From
              </span>
              <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-lg">
                {currencies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setFromCurrency(c.code)}
                    className={`py-2 rounded text-xs font-bold transition-all ${
                      fromCurrency === c.code
                        ? "bg-slate-700 text-white shadow"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {c.code}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleSwap}
              className="mt-5 p-2 rounded-full bg-slate-700 text-slate-400 hover:bg-violet-600 hover:text-white transition-all"
            >
              <ArrowRightLeft size={16} />
            </button>

            <div className="flex-1">
              <span className="block text-xs font-medium text-slate-400 mb-1 uppercase">
                To
              </span>
              <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-lg">
                {currencies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setToCurrency(c.code)}
                    className={`py-2 rounded text-xs font-bold transition-all ${
                      toCurrency === c.code
                        ? "bg-slate-700 text-white shadow"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {c.code}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Error Banner */}
          {calcError && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded border border-red-500/20">
              <AlertCircle size={14} />
              {calcError}
            </div>
          )}

          {/* Profit Sanity Warning */}
          {profitWarning && (
            <div className="flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 px-3 py-2 rounded border border-amber-500/20">
              <AlertCircle size={14} className="shrink-0" />
              {profitWarning}
            </div>
          )}

          {/* Cross-Currency Leg Breakdown (2 legs, each with editable rate) */}
          {isCrossCurrency && effectiveResult && (
            <div className="bg-slate-900/60 rounded-xl border border-amber-500/20 p-3 space-y-2">
              <div className="text-xs font-semibold text-amber-400 uppercase tracking-wide">
                ⚡ Cross-Currency via USD
              </div>
              {effectiveResult.legs.map((leg, i) => (
                <div
                  key={i}
                  className="text-xs bg-slate-800/50 rounded px-3 py-2 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300">
                      Leg {i + 1}:{" "}
                      <span className="text-violet-400">
                        {leg.fromCurrency}
                      </span>
                      {" → "}
                      <span className="text-violet-400">{leg.toCurrency}</span>
                    </span>
                    <span className="text-emerald-400 font-bold">
                      +${leg.profitUsd.toFixed(4)} USD profit
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>
                      In:{" "}
                      <span className="text-slate-300 font-mono">
                        {formatAmount(leg.amountIn, leg.fromCurrency)}
                      </span>
                    </span>
                    <span>
                      Out:{" "}
                      <span className="text-slate-300 font-mono">
                        {formatAmount(leg.amountOut, leg.toCurrency)}
                      </span>
                    </span>
                  </div>
                  {/* Editable rate input */}
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 shrink-0">Rate:</span>
                    <input
                      type="number"
                      value={customRates[i] ?? leg.rate}
                      onChange={(e) => handleRateChange(i, e.target.value)}
                      className={`flex-1 bg-slate-700 border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none transition-colors ${
                        rateOverridden[i]
                          ? "border-amber-500/60 bg-amber-500/10"
                          : "border-slate-600 focus:border-violet-500"
                      }`}
                    />
                    <span className="text-slate-500 text-xs shrink-0">
                      {formatLegRate(
                        leg.fromCurrency,
                        leg.toCurrency,
                        leg.rate,
                        rates,
                      )
                        .split(" ")
                        .slice(1)
                        .join(" ")}
                    </span>
                    {rateOverridden[i] && (
                      <button
                        onClick={() => resetRate(i)}
                        className="text-xs text-slate-500 hover:text-white transition-colors shrink-0"
                        title="Reset to default rate"
                      >
                        ↺
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex justify-between text-xs text-emerald-400 font-semibold pt-1 border-t border-slate-700">
                <span>Total Profit</span>
                <span>${effectiveResult.totalProfitUsd.toFixed(4)} USD</span>
              </div>
            </div>
          )}

          {/* Direct Exchange Rate Info (1 leg, editable rate) */}
          {!isCrossCurrency && effectiveResult && (
            <div className="bg-slate-900/50 px-3 py-2 rounded border border-slate-700 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 shrink-0">Rate:</span>
                <input
                  type="number"
                  value={customRates[0] ?? effectiveResult.legs[0]?.rate ?? ""}
                  onChange={(e) => handleRateChange(0, e.target.value)}
                  className={`flex-1 bg-slate-700 border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none transition-colors ${
                    rateOverridden[0]
                      ? "border-amber-500/60 bg-amber-500/10"
                      : "border-slate-600 focus:border-violet-500"
                  }`}
                />
                <span className="text-xs text-slate-500 shrink-0">
                  {effectiveResult.legs[0]
                    ? formatLegRate(
                        effectiveResult.legs[0].fromCurrency,
                        effectiveResult.legs[0].toCurrency,
                        effectiveResult.legs[0].rate,
                        rates,
                      )
                        .split(" ")
                        .slice(1)
                        .join(" ")
                    : ""}
                </span>
                {rateOverridden[0] && (
                  <button
                    onClick={() => resetRate(0)}
                    className="text-xs text-slate-500 hover:text-white transition-colors"
                    title="Reset to default rate"
                  >
                    ↺
                  </button>
                )}
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">
                  Profit:{" "}
                  <span className="text-emerald-400 font-bold">
                    ${effectiveResult.totalProfitUsd.toFixed(4)} USD
                  </span>
                </span>
                {rateOverridden[0] && (
                  <span className="text-amber-400 text-xs">⚡ Custom rate</span>
                )}
              </div>
            </div>
          )}

          {/* Amount Inputs */}
          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-700/50 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">
                You Receive ({fromCurrency})
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 font-bold">
                  {getSymbol(fromCurrency)}
                </span>
                <input
                  type="number"
                  value={amountIn}
                  onChange={(e) => setAmountIn(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-10 pr-4 py-4 text-xl font-bold text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="flex items-center justify-center -my-1">
              <div className="bg-slate-700 rounded-full p-1.5 border-4 border-slate-800">
                <ArrowRight size={16} className="text-slate-400" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">
                Customer Gets ({toCurrency})
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-red-400 font-bold">
                  {getSymbol(toCurrency)}
                </span>
                <input
                  type="number"
                  value={amountOut}
                  readOnly
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-lg pl-10 pr-4 py-4 text-xl font-bold text-slate-300 cursor-not-allowed"
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>

          {/* Client Name */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">
              Client Name (Optional)
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 transition-colors"
              placeholder="Walk-in Client"
            />
          </div>

          <button
            onClick={handleProcess}
            disabled={!effectiveResult || !!calcError || !!profitWarning}
            className="w-full py-4 mt-2 rounded-xl font-bold text-lg bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm Exchange
          </button>
        </div>

        {/* ── Right: History ── */}
        <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-700 bg-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-white flex items-center gap-2">
              <History className="text-slate-400" size={18} />
              Today's Exchanges
            </h2>
            <button
              onClick={loadHistory}
              className="text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-auto">
            <DataTable
              columns={[
                {
                  header: "Time",
                  className: "px-4 py-3",
                  sortKey: "created_at",
                },
                {
                  header: "Pair",
                  className: "px-4 py-3",
                  sortKey: "from_currency",
                },
                {
                  header: "Amount In",
                  className: "px-4 py-3 text-right",
                  sortKey: "amount_in",
                },
                {
                  header: "Amount Out",
                  className: "px-4 py-3 text-right",
                  sortKey: "amount_out",
                },
                { header: "Via", className: "px-4 py-3 text-center" },
                {
                  header: "Profit",
                  className: "px-4 py-3 text-right",
                  sortKey: "profit_usd",
                },
              ]}
              data={transactions}
              exportExcel
              exportPdf
              exportFilename="exchange-history"
              className="w-full"
              theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
              tbodyClassName="divide-y divide-slate-700/50"
              emptyMessage="No exchanges yet today."
              renderRow={(tx) => {
                const totalProfit =
                  tx.leg1_profit_usd !== null || tx.leg2_profit_usd !== null
                    ? (tx.leg1_profit_usd ?? 0) + (tx.leg2_profit_usd ?? 0)
                    : tx.profit_usd;

                return (
                  <tr
                    key={tx.id}
                    className="hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-slate-400">
                      {new Date(tx.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400">
                          {tx.from_currency}
                        </span>
                        <ArrowRight size={10} className="text-slate-600" />
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400">
                          {tx.to_currency}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-emerald-400 text-right font-mono">
                      {Number(tx.amount_in).toLocaleString()} {tx.from_currency}
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-red-400 text-right font-mono">
                      {Number(tx.amount_out).toLocaleString()} {tx.to_currency}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {tx.via_currency ? (
                        <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                          via {tx.via_currency}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-right">
                      {totalProfit !== null && totalProfit !== undefined ? (
                        <span
                          className={
                            totalProfit >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }
                        >
                          ${Number(totalProfit).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
