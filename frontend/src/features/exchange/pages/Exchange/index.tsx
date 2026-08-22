import { useState, useEffect, useCallback, useMemo } from "react";
import logger from "@/utils/logger";
import {
  RefreshCw,
  ArrowRightLeft,
  ArrowRight,
  AlertCircle,
  History,
  ChevronDown,
  Info,
} from "lucide-react";
import {
  appEvents,
  PageHeader,
  useApi,
  DecimalInput,
  roundForCurrency,
  ConfirmModal,
  type PaymentLine,
} from "@liratek/ui";
import { PaymentSheet } from "@/features/recharge/components/PaymentSheet";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { toCamelLegs } from "@/utils/paymentUtils";
import { useSession } from "@/features/sessions/context/SessionContext";
import { useSessionAutoFill } from "@/features/sessions/hooks/useSessionAutoFill";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { HistoryModal } from "./components/HistoryModal";
import { LiveRatesPanel } from "./components/LiveRatesPanel";
import { YourRatesModal } from "./components/YourRatesModal";
import { PositionsPanel } from "./components/PositionsPanel";
import type { ExchangeRate } from "@/utils/currencyUtils";
import {
  calculateExchange,
  convertFromUSD,
  TAKE_USD,
  isLotTrackedCurrency,
  type CurrencyRate,
  type CurrencyExchangeResult,
} from "@liratek/core";
import {
  fetchLiveRatesSnapshot,
  CURRENCY_NAMES,
  getCurrencySymbol,
} from "@/utils/liveExchangeRates";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import {
  ForPartnerToggle,
  ForPartnerNotice,
} from "@/features/partners/components/ForPartnerToggle";

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

// EXCHANGE_LOT_SETTLEMENT.md Phase 5 — mirrors the ApiAdapter's inline
// `exchangeLots.preview` return shape (packages/ui/src/api/types.ts) verbatim;
// kept as a local type since that shape isn't exported there as a standalone
// named type.
type LotSettlementResult = {
  id: number | null;
  lot_id: number | null;
  basis_source: "LOT" | "MARKET";
  qty: number;
  unit_cost_usd: number;
  unit_proceeds_usd: number;
  profit_usd: number;
};

type LotSettlementPreview =
  | { lotTracked: false; reason?: "NO_RATE_ANCHOR" }
  | {
      lotTracked: true;
      marketUnitCostUsd: number;
      settlements: LotSettlementResult[];
      realizedProfitUsd: number;
      coveredQty: number;
      marketQty: number;
    };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toCurrencyRates(
  rows: Array<{
    to_code: string;
    market_rate: number;
    buy_rate: number;
    sell_rate: number;
    is_stronger: number;
  }>,
): CurrencyRate[] {
  return rows.map((r) => ({
    to_code: r.to_code,
    market_rate: r.market_rate,
    buy_rate: r.buy_rate,
    sell_rate: r.sell_rate,
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
 * Compact unit label for a leg's rate input.
 * e.g. "LBP/USD" (LBP-like, rate = X LBP per USD) or "USD/EUR" (EUR-like).
 */
function legRateUnit(
  fromCurrency: string,
  toCurrency: string,
  rates: CurrencyRate[],
): string {
  const nonUsd = fromCurrency === "USD" ? toCurrency : fromCurrency;
  const cr = rates.find((r) => r.to_code === nonUsd);
  if (!cr) return "";
  return cr.is_stronger === 1 ? `${nonUsd}/USD` : `USD/${nonUsd}`;
}

/**
 * Format an amount with its currency code.
 */
function formatAmount(amount: number, currency: string, decimals = 2): string {
  const d = currency === "LBP" ? 0 : decimals;
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: d })} ${currency}`;
}

// ─── Currency Selector ────────────────────────────────────────────────────────

interface CurrencySelectorProps {
  selected: string;
  onSelect: (code: string) => void;
  currencies: Array<{ id: number; code: string }>; // from CurrencyContext (USD, LBP, EUR)
  liveCurrencyRates: CurrencyRate[];
}

/**
 * Currency selector with USD + LBP as fixed buttons, and a searchable dropdown
 * for EUR (from settings) + all other live currencies from the public API.
 */
function CurrencySelector({
  selected,
  onSelect,
  currencies,
  liveCurrencyRates,
}: CurrencySelectorProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Fixed currencies always shown as buttons
  const fixedCodes = ["USD", "LBP"];
  // EUR and other currencies go in the dropdown
  const eurCurrency = currencies.find((c) => c.code === "EUR");
  const dropdownOptions = useMemo(
    () => [
      ...(eurCurrency ? [{ code: "EUR", symbol: "€" }] : []),
      ...liveCurrencyRates.map((r) => ({
        code: r.to_code,
        symbol: getCurrencySymbol(r.to_code),
      })),
    ],
    [eurCurrency, liveCurrencyRates],
  );

  // Filter options by search
  const filteredOptions = useMemo(() => {
    if (!search.trim()) return dropdownOptions;
    const q = search.toLowerCase();
    return dropdownOptions.filter(
      (opt) =>
        opt.code.toLowerCase().includes(q) ||
        opt.symbol.toLowerCase().includes(q),
    );
  }, [dropdownOptions, search]);

  // Is the selected currency one from the dropdown?
  const isDropdownSelection = selected && !fixedCodes.includes(selected);
  const dropdownLabel = isDropdownSelection ? selected : "More";

  return (
    <div className="flex gap-1 bg-slate-900 p-1 rounded-lg relative">
      {fixedCodes.map((code) => (
        <button
          key={code}
          onClick={() => {
            onSelect(code);
            setDropdownOpen(false);
          }}
          className={`flex-1 py-2 rounded text-xs font-bold transition-all ${
            selected === code
              ? "bg-slate-700 text-white shadow"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          {code}
        </button>
      ))}

      {/* Dropdown trigger for other currencies */}
      <div className="relative flex-1">
        <button
          onClick={() => {
            setDropdownOpen(!dropdownOpen);
            if (!dropdownOpen) setSearch("");
          }}
          className={`w-full py-2 rounded text-xs font-bold transition-all flex items-center justify-center gap-1 ${
            isDropdownSelection
              ? "bg-slate-700 text-white shadow"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          {dropdownLabel}
          <ChevronDown
            size={12}
            className={`transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
          />
        </button>

        {dropdownOpen && (
          <div className="absolute top-full left-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 w-48">
            {/* Search input */}
            <div className="p-2 border-b border-slate-700/50">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search currency..."
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                autoFocus
              />
            </div>

            {/* Options list */}
            <div className="max-h-52 overflow-y-auto">
              {filteredOptions.map((opt) => (
                <button
                  key={opt.code}
                  onClick={() => {
                    onSelect(opt.code);
                    setDropdownOpen(false);
                    setSearch("");
                  }}
                  className={`w-full px-3 py-2 text-left text-xs font-medium transition-colors flex items-center justify-between ${
                    selected === opt.code
                      ? "bg-violet-600/30 text-violet-300"
                      : "text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  <span>{opt.code}</span>
                  <span className="text-slate-500">{opt.symbol}</span>
                </button>
              ))}
              {filteredOptions.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-500">
                  {dropdownOptions.length === 0 ? "Loading..." : "No match"}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Exchange() {
  const api = useApi();
  const { activeSession, linkTransaction } = useSession();
  const { activeCurrencies: currencies, getDecimals } = useCurrencyContext();

  const [transactions, setTransactions] = useState<ExchangeTx[]>([]);
  const [fromCurrency, setFromCurrency] = useState<string>("");
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [toCurrency, setToCurrency] = useState<string>("");
  const [amountIn, setAmountIn] = useState<number>(0);
  const [amountOut, setAmountOut] = useState<string>("");
  const [rates, setRates] = useState<CurrencyRate[]>([]);
  // Raw `exchange_rates` rows — kept alongside `rates` because
  // toCurrencyRates() narrows to CurrencyRate and drops `updated_at`, which
  // the RatesPanel needs for its staleness indicator.
  const [rateRows, setRateRows] = useState<ExchangeRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [liveCurrencyRates, setLiveCurrencyRates] = useState<CurrencyRate[]>(
    [],
  );
  // Market reference for the side panel: the FULL feed (keeps LBP/EUR so the
  // operator can compare against their own configured rates) plus the feed's
  // publish time, which LiveRatesPanel shows verbatim — the free tier updates
  // roughly once a day, so it must never be styled as a live ticker.
  const [marketRates, setMarketRates] = useState<CurrencyRate[]>([]);
  const [liveUpdatedUtc, setLiveUpdatedUtc] = useState<string | undefined>();
  const [liveLoading, setLiveLoading] = useState(true);
  const [showRatesModal, setShowRatesModal] = useState(false);
  const [clientName, setClientName] = useState("");
  const [transactionTime, setTransactionTime] = useState<string | undefined>();

  // LIRA-081 (PFT-R): "For Partner" — the partner stands in for the walk-in
  // customer, no counter cash is taken, and the toCurrency amount is still
  // disbursed for real. Partner debt is booked in fromCurrency, so it is
  // restricted to USD/LBP (same restriction the repository enforces).
  const [forPartner, setForPartner] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(
    null,
  );
  const [isSubmittingPartner, setIsSubmittingPartner] = useState(false);

  // Split payout (owner-requested 2026-07-30): every walk-in exchange with a
  // USD/LBP target confirms through the PaymentSheet, so the payout can be
  // split across lines (e.g. $100 + 11,050,000 LBP for one 20,000,000 LBP
  // payout). Cash-only in v1 (owner decision); the repository reconciles the
  // legs hard-reject against amountOut. Partner mode and exotic target
  // currencies keep the direct one-click submit.
  const [showPayoutSheet, setShowPayoutSheet] = useState(false);
  const [payoutLines, setPayoutLines] = useState<PaymentLine[]>([]);
  // The USD→LBP rate the sheet is ACTUALLY converting at (seed, or the
  // operator's edit of the sheet's header field) — sent as
  // tender_exchange_rate so the repository reconciles at the till's rate.
  const [payoutTenderRate, setPayoutTenderRate] = useState<
    number | undefined
  >();
  const [payoutSheetKey, setPayoutSheetKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { methods: allPaymentMethods } = usePaymentMethods();

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

  // EXCHANGE_LOT_SETTLEMENT.md Q8/Q10 — debounced FIFO realized-profit
  // preview for a lot-tracked (exotic) toCurrency, and the loss-confirm
  // dialog it feeds. Any operator may confirm a loss — never a hard block;
  // the >10% sanity guard below is bypassed for this case instead (recalculate()).
  const [lotPreview, setLotPreview] = useState<LotSettlementPreview | null>(
    null,
  );
  const [lotPreviewLoading, setLotPreviewLoading] = useState(false);
  // FIX 3 (adversarial review) — true only when the preview call itself
  // errored (network/IPC failure), never merely "not started yet" or "not
  // applicable" (both of which also leave lotPreview at null). Drives a
  // visible warning; never gates submit.
  const [lotPreviewError, setLotPreviewError] = useState(false);
  const [showLossConfirm, setShowLossConfirm] = useState(false);
  // Q16 — bumped whenever history reloads so PositionsPanel refetches
  // without a second independent polling loop.
  const [positionsRefreshKey, setPositionsRefreshKey] = useState(0);
  // Preset by PositionsPanel's per-row "view" action (Q16).
  const [historyCurrencyFilter, setHistoryCurrencyFilter] = useState<
    string | undefined
  >();

  // Lot policy (Q1) — USD/LBP are exempt; every other currency is lot-tracked.
  const fromIsLotTracked = !!fromCurrency && isLotTrackedCurrency(fromCurrency);
  const toIsLotTracked = !!toCurrency && isLotTrackedCurrency(toCurrency);

  // Set initial currencies once loaded
  useEffect(() => {
    if (currencies.length >= 2 && !fromCurrency && !toCurrency) {
      setFromCurrency(currencies[0].code);
      setToCurrency(currencies[1].code);
    }
  }, [currencies, fromCurrency, toCurrency]);

  // Load history + auto-fill session customer, clear when session closes
  useSessionAutoFill([
    { select: (s) => s.customer_name, set: setClientName, clearValue: "" },
  ]);

  useEffect(() => {
    loadHistory();
  }, [activeSession]);

  // Load rates from DB (new 4-column schema)
  useEffect(() => {
    const load = async () => {
      try {
        const list = (await api.getRates()) as ExchangeRate[];
        setRateRows(list);
        setRates(toCurrencyRates(list));
      } catch (e) {
        logger.error("Failed to load rates", e);
      } finally {
        setRatesLoading(false);
      }
    };
    load();
  }, []);

  // Fetch live exchange rates from public API
  useEffect(() => {
    const loadLive = async () => {
      try {
        const snapshot = await fetchLiveRatesSnapshot();
        setLiveCurrencyRates(snapshot.rates);
        setMarketRates(snapshot.marketRates);
        setLiveUpdatedUtc(snapshot.lastUpdatedUtc);
      } catch (e) {
        logger.error("Failed to load live rates", e);
      } finally {
        setLiveLoading(false);
      }
    };
    loadLive();
  }, []);

  // Combined rates: local DB rates + selected live currency rate (if applicable)
  const effectiveRates = useMemo(() => {
    const localCodes = new Set(rates.map((r) => r.to_code));
    // Find live rates for currencies not in local DB
    const selectedCodes = [fromCurrency, toCurrency];
    const extras = liveCurrencyRates.filter(
      (lr) => selectedCodes.includes(lr.to_code) && !localCodes.has(lr.to_code),
    );
    return [...rates, ...extras];
  }, [rates, liveCurrencyRates, fromCurrency, toCurrency]);

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

        const cr = effectiveRates.find(
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

        // Profit = difference between market and actual output, in USD.
        // marketOut/amountOut are in leg.toCurrency — convert to USD accordingly.
        const diffRaw = Math.abs(marketOut - amountOut);
        const profitUsd =
          leg.toCurrency === "USD"
            ? diffRaw // already in USD
            : cr.is_stronger === 1
              ? diffRaw / cr.market_rate // LBP output → ÷ rate
              : diffRaw * cr.market_rate; // EUR output → × rate

        return { ...leg, rate: customRate, amountOut, profitUsd };
      });

      // Recompute leg2 amountIn for cross-currency (= leg1 amountOut)
      if (isCross && legs[1]) {
        const leg1Out = legs[0].amountOut;
        const leg2 = legs[1];
        const cr = effectiveRates.find(
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
          const diffRaw2 = Math.abs(marketOut2 - amountOut2);
          const diff2 =
            cr.is_stronger === 1
              ? diffRaw2 / cr.market_rate // LBP output → ÷ rate
              : diffRaw2 * cr.market_rate; // EUR output → × rate
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
    [customRates, rateOverridden, effectiveRates],
  );

  // Effective result (base calc + any custom rate overrides)
  const effectiveResult = calcResult ? applyCustomRates(calcResult) : null;

  // The leg that disburses toCurrency — for a direct exchange this is the
  // sole leg; for cross-currency (via USD) it's always leg2 (USD→toCurrency
  // structurally, since isCrossCurrency requires both sides ≠ USD). Reused
  // by the lot-preview effect below AND the profit-display overrides in the
  // render (Q7/Q8/Q10) — never invent a second way to find "the leg that
  // sells toCurrency".
  const consumingLeg = effectiveResult
    ? effectiveResult.legs[effectiveResult.legs.length - 1]
    : null;

  // Q8 — a buy leg (acquire, from-side exotic) books ZERO profit until sold;
  // a consume leg (to-side exotic) books the FIFO-realized profit from the
  // preview below, replacing the local spread estimate entirely. Neither
  // override applies to a USD/LBP leg — byte-identical to the pre-lot
  // behavior for those (Q1).
  const displayLegProfits = useMemo<number[]>(() => {
    if (!effectiveResult) return [];
    const lastIdx = effectiveResult.legs.length - 1;
    return effectiveResult.legs.map((leg, i) => {
      if (i === 0 && fromIsLotTracked) return 0;
      if (i === lastIdx && toIsLotTracked) {
        return lotPreview?.lotTracked
          ? lotPreview.realizedProfitUsd
          : leg.profitUsd;
      }
      return leg.profitUsd;
    });
  }, [effectiveResult, fromIsLotTracked, toIsLotTracked, lotPreview]);

  const displayTotalProfitUsd = useMemo(
    () => displayLegProfits.reduce((sum, p) => sum + p, 0),
    [displayLegProfits],
  );

  /**
   * Dual-currency view of what the customer receives.
   * Surfaces the output amount in BOTH USD and LBP simultaneously, mirroring
   * the POS Checkout Modal's dual-currency display — regardless of the exchange
   * direction. Both values are derived from the same effective (possibly custom)
   * rates already used by the calculation; no new conversion math is invented.
   */
  const outputDual = useMemo<{ usd: number; lbp: number } | null>(() => {
    if (!effectiveResult) return null;

    const total = effectiveResult.totalAmountOut;

    // USD-equivalent of the output, taken from the transaction's internal USD pivot.
    let usd: number;
    if (toCurrency === "USD") {
      usd = total; // output already in USD
    } else if (fromCurrency === "USD") {
      usd = effectiveResult.legs[0]?.amountIn ?? 0; // USD the customer gave
    } else {
      // Cross-currency (X → USD → Y): leg2 receives the USD pivot as its input.
      usd =
        effectiveResult.legs[1]?.amountIn ??
        effectiveResult.legs[0]?.amountOut ??
        0;
    }

    // LBP-equivalent of the output.
    let lbp: number;
    if (toCurrency === "LBP") {
      lbp = total; // output already in LBP — exact, no re-conversion
    } else {
      const lbpRate = effectiveRates.find((r) => r.to_code === "LBP");
      // Customer receives currency → shop sells USD (TAKE_USD), same direction
      // as the final leg of the calculation.
      lbp = lbpRate ? convertFromUSD(usd, lbpRate, TAKE_USD).amountOut : 0;
    }

    return { usd, lbp };
  }, [effectiveResult, fromCurrency, toCurrency, effectiveRates]);

  // The exchange's OWN USD↔LBP rate seeds the payout sheet (owner decision
  // 2026-07-30): the LBP leg's effective (possibly operator-overridden) rate
  // when the exchange touches LBP — leg rates for LBP-like currencies are
  // always LBP-per-USD (currencyConverter, is_stronger = +1) — otherwise the
  // rate table's LBP buy side (paying out LBP in lieu of USD converts in the
  // same direction as a USD→LBP exchange). The operator can still edit the
  // sheet's header rate; the edit is captured via onExchangeRateChange.
  const payoutSeedRate = useMemo<number | undefined>(() => {
    const lbpLeg = effectiveResult?.legs.find(
      (l) => l.fromCurrency === "LBP" || l.toCurrency === "LBP",
    );
    if (lbpLeg) return lbpLeg.rate;
    const lbpRate = effectiveRates.find((r) => r.to_code === "LBP");
    return lbpRate?.buy_rate;
  }, [effectiveResult, effectiveRates]);

  // Split payout is USD/LBP-target only (reconciliation + MultiPaymentInput
  // are USD/LBP-native) and never applies in partner mode (no walk-in
  // customer). Everything else keeps the direct one-click submit.
  const canSplitPayout =
    !forPartner && (toCurrency === "USD" || toCurrency === "LBP");

  // Sync amountOut with effectiveResult
  useEffect(() => {
    if (effectiveResult) {
      const decimals = getDecimals(toCurrency);
      setAmountOut(effectiveResult.totalAmountOut.toFixed(decimals));
    }
  }, [effectiveResult, toCurrency, getDecimals]);

  // Recalculate whenever inputs change (base calculation from DB rates)
  const recalculate = useCallback(() => {
    const val = amountIn;
    if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) {
      setCalcResult(null);
      setCalcError(null);
      setAmountOut("");
      return;
    }
    if (!effectiveRates.length) return;

    try {
      if (!isNaN(val) && val > 0) {
        const result = calculateExchange(
          fromCurrency,
          toCurrency,
          val,
          effectiveRates,
        );
        setCalcResult(result);
        setCalcError(null);
        const decimals = getDecimals(toCurrency);
        setAmountOut(result.totalAmountOut.toFixed(decimals));

        // Sanity check: profit should not exceed 10% of input USD equivalent.
        // EXCHANGE_LOT_SETTLEMENT.md Q10 — for a GENUINELY lot-tracked sell
        // (server confirms it consumed cost-basis lots) this spread-based
        // totalProfitUsd is no longer authoritative (realized profit comes
        // from the FIFO preview instead, which CAN legitimately exceed 10%
        // either way on a real rate move); the loss-confirm dialog on submit
        // replaces this guard for that case rather than stacking on top of
        // it. USD/LBP stays byte-identical.
        //
        // Gating bug fix (adversarial review, FIX 2 item 3): whether the
        // bypass applies can NOT be decided here, synchronously, off
        // `isLotTrackedCurrency(toCurrency)` alone — a lot-tracked
        // toCurrency with no USD rate anchor (NO_RATE_ANCHOR) keeps the OLD
        // spread-based profit model server-side, for which this guard is
        // exactly as meaningful as it always was. That decision needs the
        // (debounced, async) lot-preview result, so it now lives in its own
        // effect below that reacts to `lotPreview`/`lotPreviewLoading`
        // settling — this branch only ever handles the plain, never-lot-
        // tracked case (byte-identical to before).
        if (!isLotTrackedCurrency(toCurrency)) {
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
  }, [amountIn, fromCurrency, toCurrency, effectiveRates, getDecimals]);

  useEffect(() => {
    recalculate();
  }, [recalculate]);

  // EXCHANGE_LOT_SETTLEMENT.md Q10 gating-bug fix (adversarial review, FIX 2
  // item 3) — the >10% sanity-guard bypass for a lot-tracked toCurrency,
  // moved out of recalculate() into its own effect. recalculate() runs
  // SYNCHRONOUSLY on amountIn/fromCurrency/toCurrency/rate changes and
  // computes calcResult/effectiveResult BEFORE the debounced lot-preview
  // effect (400ms) has resolved a fresh `lotPreview` for the new inputs —
  // so `lotPreview` at that moment may be stale (from the previous input)
  // or null. This effect instead reacts to `effectiveResult` (the base calc
  // + any custom-rate overrides) and `lotPreview`/`lotPreviewLoading`
  // settling, so it always judges the CURRENT inputs' actual preview
  // outcome, never a stale one.
  //
  // - Not lot-tracked: nothing to do — recalculate() above already applies
  //   the guard for this case, unaffected by any of this.
  // - Lot-tracked, preview still in flight / not yet resolved: suppress the
  //   warning (as before) rather than flashing something that immediately
  //   changes once the preview settles.
  // - Lot-tracked, preview genuinely tracked (server confirms it consumed
  //   cost-basis lots): suppress permanently — FIFO-realized profit can
  //   legitimately exceed 10% either way on a real rate move; the
  //   loss-confirm dialog is the guard for this case.
  // - Lot-tracked, preview resolved `lotTracked: false` (NO_RATE_ANCHOR —
  //   the only way this case reaches here, since `toIsLotTracked` is
  //   already true by definition): the server falls back to the plain
  //   spread-based profit model, so apply the SAME 10% check non-lot-tracked
  //   currencies get, off `effectiveResult.totalProfitUsd` — the total the
  //   server will actually keep.
  useEffect(() => {
    if (!toIsLotTracked) return;
    if (!effectiveResult) {
      setProfitWarning(null);
      return;
    }
    if (lotPreviewLoading || lotPreview === null) {
      setProfitWarning(null);
      return;
    }
    if (lotPreview.lotTracked) {
      setProfitWarning(null);
      return;
    }
    const val = amountIn;
    const inputUsd =
      fromCurrency === "USD"
        ? val
        : (effectiveResult.legs[0]?.amountOut ?? val / 89500);
    const profitPct =
      inputUsd > 0 ? (effectiveResult.totalProfitUsd / inputUsd) * 100 : 0;
    if (profitPct > 10) {
      setProfitWarning(
        `Unusually high profit: $${effectiveResult.totalProfitUsd.toFixed(2)} USD (${profitPct.toFixed(1)}% of input). Please verify your rates.`,
      );
    } else {
      setProfitWarning(null);
    }
  }, [
    toIsLotTracked,
    effectiveResult,
    lotPreview,
    lotPreviewLoading,
    amountIn,
    fromCurrency,
  ]);

  // EXCHANGE_LOT_SETTLEMENT.md Q10 — debounced FIFO realized-profit preview
  // for a lot-tracked toCurrency. `unitProceedsUsd` is the executed USD
  // notional per unit disbursed: direct USD→X reuses amountIn/amountOut off
  // the sole leg; cross-currency (via USD) reuses the SAME ratio off the
  // final leg (always USD→toCurrency structurally — see consumingLeg above),
  // never new math. `lotPreviewLoading` flips true synchronously (before the
  // debounce fires) so a rushed submit click can be gated on it below.
  useEffect(() => {
    // FIX 3 (adversarial review) — reset at the start of every attempt,
    // including an early bail-out below, so a stale error from a previous
    // (now-inapplicable) input never lingers.
    setLotPreviewError(false);

    // FIX 4 (adversarial review) — the guard and the FIFO cost-basis ratio
    // still use the raw, unrounded leg amount (mathematically exact); only
    // the `qty` actually SENT to the preview call is switched to the same
    // rounded value `handleProcess` sends as `amountOut` (see below).
    const rawQty = consumingLeg?.amountOut;
    const usdIn = consumingLeg?.amountIn;

    if (!toCurrency || !toIsLotTracked || !rawQty || rawQty <= 0 || !usdIn) {
      setLotPreview(null);
      setLotPreviewLoading(false);
      return;
    }
    const unitProceedsUsd = usdIn / rawQty;
    if (!Number.isFinite(unitProceedsUsd) || unitProceedsUsd <= 0) {
      setLotPreview(null);
      setLotPreviewLoading(false);
      return;
    }

    // FIX 4 — mirrors handleProcess's `out = parseFloat(amountOut)` exactly:
    // consumingLeg.amountOut === effectiveResult.totalAmountOut === the raw
    // value `amountOut` (string state) was rounded from, so this is the
    // SAME number submit will actually send as amountOut/qty — never the
    // raw unrounded leg amount, which the server never sees.
    const previewQty = parseFloat(amountOut);

    let cancelled = false;
    setLotPreviewLoading(true);
    const timer = setTimeout(() => {
      api.exchangeLots
        .preview({
          currencyCode: toCurrency,
          qty: previewQty,
          unitProceedsUsd,
          fromCurrency,
        })
        .then((preview) => {
          if (!cancelled) setLotPreview(preview);
        })
        .catch((err) => {
          if (!cancelled) {
            logger.error("Failed to preview exchange lot settlement", err);
            setLotPreview(null);
            setLotPreviewError(true);
          }
        })
        .finally(() => {
          if (!cancelled) setLotPreviewLoading(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    toCurrency,
    toIsLotTracked,
    consumingLeg?.amountOut,
    consumingLeg?.amountIn,
    amountOut,
    fromCurrency,
  ]);

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
    } finally {
      // Q16 — keep the open-positions panel in sync with newly created or
      // settled lots whenever history reloads (no second polling loop).
      setPositionsRefreshKey((k) => k + 1);
    }
  };

  const handleSwap = () => {
    const prev = fromCurrency;
    setFromCurrency(toCurrency);
    setToCurrency(prev);
    setAmountIn(parseFloat(amountOut) || 0);
  };

  const handleProcess = async (lines?: PaymentLine[]) => {
    const inp = amountIn;
    const out = parseFloat(amountOut);

    if (!inp || !out || !effectiveResult) {
      alert("Please enter a valid amount.");
      return;
    }
    if (forPartner && !selectedPartnerId) {
      alert("Select a partner for this exchange.");
      return;
    }

    try {
      const leg1 = effectiveResult.legs[0];
      const leg2 = effectiveResult.legs[1];

      setIsSubmitting(true);
      setIsSubmittingPartner(forPartner);
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
        fromCurrencyName: CURRENCY_NAMES[fromCurrency] ?? fromCurrency,
        toCurrencyName: CURRENCY_NAMES[toCurrency] ?? toCurrency,
        transaction_time: transactionTime,
        ...(forPartner && selectedPartnerId
          ? { partnerId: selectedPartnerId, partnerMode: "FOR" as const }
          : {}),
        // Split payout: the sheet's lines (IN legs, cash-only v1) + the rate
        // it actually converted at — the repository reconciles hard-reject
        // against amountOut and debits each leg per-currency.
        ...(lines && lines.length > 0
          ? {
              payments: toCamelLegs(lines),
              tender_exchange_rate: payoutTenderRate ?? payoutSeedRate,
            }
          : {}),
      });

      if (result.success) {
        // LIRA-081: a for-partner exchange has no walk-in customer — never
        // link it into the active session basket (mirrors every other FOR_%
        // form, which bypasses the session entirely in partner mode).
        if (activeSession && result.id && !forPartner) {
          try {
            await linkTransaction({
              transactionType: "exchange",
              transactionId: result.id,
              amountUsd:
                fromCurrency === "USD" ? inp : toCurrency === "USD" ? out : 0,
              amountLbp:
                fromCurrency === "LBP" ? inp : toCurrency === "LBP" ? out : 0,
              // EXCHANGE_LOT_SETTLEMENT.md item 9 — the server-authoritative
              // realized profit (present whenever the toCurrency leg
              // consumed lot(s)) MUST win over the client's pre-submit
              // preview/spread estimate.
              profitUsd: result.realizedProfitUsd ?? effectiveResult.totalProfitUsd,
            });
          } catch (err) {
            logger.error("Failed to link exchange to session:", err);
          }
        }
        appEvents.emit(
          "notification:show",
          "Exchange processed successfully",
          "success",
        );
        setAmountIn(0);
        setAmountOut("");
        setClientName("");
        setCalcResult(null);
        setLotPreview(null);
        setTransactionTime(undefined);
        setShowPayoutSheet(false);
        setPayoutLines([]);
        setPayoutTenderRate(undefined);
        loadHistory();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Operation failed", { error });
      alert("Transaction failed");
    } finally {
      setIsSubmitting(false);
      setIsSubmittingPartner(false);
    }
  };

  const isCrossCurrency =
    fromCurrency &&
    toCurrency &&
    fromCurrency !== "USD" &&
    toCurrency !== "USD";

  // "Customer Gets" hierarchy: the box matching the SELECTED target currency
  // is the actual payout; the other is only its conversion (prefixed "≈",
  // dimmed). For an exotic target (EUR etc.) neither USD nor LBP is the
  // payout — both render as dimmed equivalents (the label already says
  // "(X equivalent)") — and a THIRD box (below) renders the actual exotic
  // quantity prominently (FIX 6, owner-reported 2026-08-23): without it the
  // till operator had no way to see how many EUR (etc.) to hand the
  // customer, only its USD/LBP value-equivalents.
  const usdIsPayout = toCurrency === "USD";
  const lbpIsPayout = toCurrency === "LBP";
  const exoticIsPayout = !!toCurrency && !usdIsPayout && !lbpIsPayout;

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col min-h-0 gap-6 overflow-hidden animate-in fade-in duration-500">
      <PageHeader
        icon={RefreshCw}
        title="Exchange"
        actions={
          <>
            {/* Your Rates — the shop's own configured buy/sell spreads and the
                profit they earn. Occasional reference, so it lives here rather
                than in the always-visible side column. */}
            <button
              data-testid="exchange-your-rates-button"
              onClick={() => setShowRatesModal(true)}
              title="Your configured rates"
              className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white"
            >
              <Info size={16} />
              <span className="font-medium">Your Rates</span>
            </button>
            <button
              onClick={() => setShowHistoryModal(true)}
              className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white"
            >
              <History size={16} />
              <span className="font-medium">History</span>
            </button>
          </>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full max-w-6xl mx-auto flex flex-col gap-6">
        <div className="w-full flex flex-col lg:flex-row lg:items-stretch gap-6">
          {/* ── Exchange Calculator ── */}
          <div className="w-full lg:flex-1 max-w-2xl mx-auto lg:mx-0 bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl p-4 flex flex-col gap-4">
            {/* Currency Selectors */}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <span className="block text-xs font-medium text-slate-400 mb-1 uppercase">
                  From
                </span>
                <CurrencySelector
                  selected={fromCurrency}
                  onSelect={setFromCurrency}
                  currencies={currencies}
                  liveCurrencyRates={liveCurrencyRates}
                />
              </div>

              <button
                data-testid="exchange-swap-button"
                onClick={handleSwap}
                className="mt-5 p-2 rounded-full bg-slate-700 text-slate-400 hover:bg-violet-600 hover:text-white transition-all"
              >
                <ArrowRightLeft size={16} />
              </button>

              <div className="flex-1">
                <span className="block text-xs font-medium text-slate-400 mb-1 uppercase">
                  To
                </span>
                <CurrencySelector
                  selected={toCurrency}
                  onSelect={setToCurrency}
                  currencies={currencies}
                  liveCurrencyRates={liveCurrencyRates}
                />
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

            {/* FIX 3 (adversarial review) — the FIFO preview call itself
              errored; distinct from "not yet started"/"not applicable"
              (both leave lotPreview at null too). Never blocks or disables
              submit — the server still computes profit authoritatively. */}
            {toIsLotTracked && lotPreviewError && (
              <div className="flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 px-3 py-2 rounded border border-amber-500/20">
                <AlertCircle size={14} className="shrink-0" />
                Realized-profit preview unavailable — profit will be computed
                at submit
              </div>
            )}

            {/* Cross-Currency Leg Breakdown (2 legs, each with editable rate,
              one compact row per leg; total profit lives in the header) */}
            {isCrossCurrency && effectiveResult && (
              <div className="bg-slate-900/60 rounded-xl border border-amber-500/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">
                    ⚡ Cross-Currency via USD
                  </span>
                  <span
                    className={`text-xs font-semibold whitespace-nowrap ${
                      displayTotalProfitUsd >= 0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    Total {displayTotalProfitUsd >= 0 ? "+" : ""}$
                    {displayTotalProfitUsd.toFixed(4)}
                  </span>
                </div>
                {effectiveResult.legs.map((leg, i) => {
                  const isAcquireLeg = i === 0 && fromIsLotTracked;
                  const isConsumeLeg =
                    i === effectiveResult.legs.length - 1 && toIsLotTracked;
                  const legProfit = displayLegProfits[i] ?? leg.profitUsd;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs bg-slate-800/50 rounded px-2 py-1.5"
                    >
                      <span className="w-4 h-4 rounded-full bg-slate-700 text-slate-400 text-[10px] font-bold flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <span className="font-mono text-slate-300 whitespace-nowrap">
                        {formatAmount(leg.amountIn, leg.fromCurrency)}
                        <span className="text-slate-500"> → </span>
                        {formatAmount(leg.amountOut, leg.toCurrency)}
                      </span>
                      <input
                        type="number"
                        value={customRates[i] ?? leg.rate}
                        onChange={(e) => handleRateChange(i, e.target.value)}
                        title={`Rate (${legRateUnit(leg.fromCurrency, leg.toCurrency, effectiveRates)})`}
                        className={`flex-1 min-w-[70px] bg-slate-700 border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none transition-colors ${
                          rateOverridden[i]
                            ? "border-amber-500/60 bg-amber-500/10"
                            : "border-slate-600 focus:border-violet-500"
                        }`}
                      />
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {legRateUnit(
                          leg.fromCurrency,
                          leg.toCurrency,
                          effectiveRates,
                        )}
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
                      {isAcquireLeg ? (
                        <span
                          className="text-[10px] text-slate-500 italic whitespace-nowrap shrink-0"
                          title="EXCHANGE_LOT_SETTLEMENT.md Q8 — a buy books zero profit; realized profit is stamped when this lot is later sold."
                        >
                          Buy · books at sale
                        </span>
                      ) : isConsumeLeg && lotPreviewLoading && !lotPreview ? (
                        <span className="text-[10px] text-slate-500 whitespace-nowrap shrink-0">
                          Calculating…
                        </span>
                      ) : (
                        <span
                          className={`font-semibold whitespace-nowrap shrink-0 ${
                            legProfit >= 0 ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {legProfit >= 0 ? "+" : ""}${legProfit.toFixed(4)}
                        </span>
                      )}
                    </div>
                  );
                })}
                {toIsLotTracked && lotPreview?.lotTracked && (
                  <div className="text-[10px] text-slate-500 pt-1">
                    FIFO vs cost basis
                    {lotPreview.marketQty > 0 && (
                      <span className="text-amber-400">
                        {" "}
                        · {lotPreview.marketQty.toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })}{" "}
                        {toCurrency} uncovered — settled at today's market rate
                      </span>
                    )}
                  </div>
                )}
                {/* FIX 2 item 3 (adversarial review) — no cost-basis was
                  actually calculated for this pair (no USD rate anchor), so
                  the "FIFO vs cost basis" line above must NOT show; the
                  profit figures above already fall back to the plain
                  spread model, which is what the server will actually keep. */}
                {toIsLotTracked &&
                  lotPreview?.lotTracked === false &&
                  lotPreview.reason === "NO_RATE_ANCHOR" && (
                    <div className="text-[10px] text-amber-400 pt-1">
                      Cost-basis tracking unavailable for this pair —
                      configure a rate in Settings to enable it
                    </div>
                  )}
              </div>
            )}

            {/* Direct Exchange Rate Info (1 leg, editable rate) */}
            {!isCrossCurrency && effectiveResult && (
              <div className="bg-slate-900/50 px-3 py-2 rounded border border-slate-700 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 shrink-0">Rate:</span>
                  <input
                    type="number"
                    value={
                      customRates[0] ?? effectiveResult.legs[0]?.rate ?? ""
                    }
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
                          effectiveRates,
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
                  {fromIsLotTracked ? (
                    <span
                      className="text-slate-500 italic"
                      title="EXCHANGE_LOT_SETTLEMENT.md Q8 — a buy books zero profit; realized profit is stamped when this lot is later sold."
                    >
                      Buy — profit books when this {fromCurrency} is later
                      sold (cost-basis lot)
                    </span>
                  ) : toIsLotTracked ? (
                    lotPreviewLoading && !lotPreview ? (
                      <span className="text-slate-500">
                        Calculating realized profit…
                      </span>
                    ) : (
                      <span className="text-slate-400">
                        Realized profit:{" "}
                        <span
                          className={`font-bold ${
                            displayTotalProfitUsd >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {displayTotalProfitUsd >= 0 ? "" : "-"}$
                          {Math.abs(displayTotalProfitUsd).toFixed(4)} USD
                        </span>
                      </span>
                    )
                  ) : (
                    <span className="text-slate-400">
                      Profit:{" "}
                      <span className="text-emerald-400 font-bold">
                        ${effectiveResult.totalProfitUsd.toFixed(4)} USD
                      </span>
                    </span>
                  )}
                  {rateOverridden[0] && (
                    <span className="text-amber-400 text-xs">
                      ⚡ Custom rate
                    </span>
                  )}
                </div>
                {toIsLotTracked && lotPreview?.lotTracked && (
                  <div className="text-[10px] text-slate-500">
                    FIFO vs cost basis
                    {lotPreview.marketQty > 0 && (
                      <span className="text-amber-400">
                        {" "}
                        · {lotPreview.marketQty.toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })}{" "}
                        {toCurrency} uncovered — settled at today's market rate
                      </span>
                    )}
                  </div>
                )}
                {/* FIX 2 item 3 (adversarial review) — see cross-currency
                  block above for the reasoning: no cost-basis was actually
                  calculated for this pair, so no "FIFO vs cost basis" line. */}
                {toIsLotTracked &&
                  lotPreview?.lotTracked === false &&
                  lotPreview.reason === "NO_RATE_ANCHOR" && (
                    <div className="text-[10px] text-amber-400">
                      Cost-basis tracking unavailable for this pair —
                      configure a rate in Settings to enable it
                    </div>
                  )}
              </div>
            )}

            {/* Amount Inputs */}
            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-700/50 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">
                  You Receive ({fromCurrency})
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500 font-bold z-10 pointer-events-none">
                    {getCurrencySymbol(fromCurrency)}
                  </span>
                  <DecimalInput
                    value={amountIn}
                    onChange={setAmountIn}
                    decimals={getDecimals(fromCurrency)}
                    className="w-full bg-slate-800/50 border border-slate-700 rounded-lg pl-14 pr-4 py-4 text-xl font-bold text-white focus:outline-none focus:border-emerald-500 transition-colors"
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
                  Customer Gets
                  {toCurrency !== "USD" && toCurrency !== "LBP" && (
                    <span className="ml-1 normal-case text-slate-500">
                      ({toCurrency} equivalent)
                    </span>
                  )}
                </label>
                {/* FIX 6 (owner-reported 2026-08-23) — for an exotic target
                  (neither USD nor LBP), show the ACTUAL payout quantity in
                  that currency prominently, first. Before this, only the
                  USD/LBP value-equivalents below existed, so the till
                  operator had no way to see how many (e.g.) EUR to hand the
                  customer. Styled identically to the USD box's own
                  "prominent" treatment below (same classes, no new visual
                  language) — USD-target and LBP-target rendering is
                  untouched; this is purely an added third case. */}
                {exoticIsPayout && (
                  <div
                    data-testid="exchange-exotic-payout"
                    className="relative mb-2"
                  >
                    <input
                      type="text"
                      value={
                        effectiveResult
                          ? effectiveResult.totalAmountOut.toLocaleString(
                              undefined,
                              {
                                minimumFractionDigits: getDecimals(toCurrency),
                                maximumFractionDigits: getDecimals(toCurrency),
                              },
                            )
                          : ""
                      }
                      readOnly
                      className="w-full rounded-lg pl-4 pr-16 py-4 text-xl font-bold cursor-not-allowed bg-slate-800/80 border border-violet-500/50 text-white"
                      placeholder="0.00"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-violet-300">
                      {toCurrency}
                    </span>
                  </div>
                )}

                {/* The two values are EQUIVALENTS of one payout, not a sum —
                  the target-currency box is primary, the other is a dimmed
                  "≈" conversion, and the "or" separator seals the reading.
                  For an exotic target (above), both boxes below render
                  dimmed automatically (usdIsPayout/lbpIsPayout are both
                  false) — no change needed to their own logic. */}
                <div className="flex items-center gap-2">
                  {/* USD output */}
                  <div className="relative flex-1 min-w-0">
                    <span
                      className={`absolute left-4 top-1/2 -translate-y-1/2 font-bold ${
                        usdIsPayout ? "text-red-400" : "text-slate-500"
                      }`}
                    >
                      $
                    </span>
                    <input
                      type="text"
                      value={
                        outputDual
                          ? `${usdIsPayout ? "" : "≈ "}${outputDual.usd.toLocaleString(
                              undefined,
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              },
                            )}`
                          : ""
                      }
                      readOnly
                      className={`w-full rounded-lg pl-9 pr-12 py-4 text-xl font-bold cursor-not-allowed ${
                        usdIsPayout
                          ? "bg-slate-800/80 border border-violet-500/50 text-white"
                          : "bg-slate-800/40 border border-slate-700/60 text-slate-500"
                      }`}
                      placeholder="0.00"
                    />
                    <span
                      className={`absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium ${
                        usdIsPayout ? "text-violet-300" : "text-slate-600"
                      }`}
                    >
                      USD
                    </span>
                  </div>

                  <span className="text-[11px] font-semibold text-slate-500 uppercase shrink-0">
                    or
                  </span>

                  {/* LBP output */}
                  <div className="relative flex-1 min-w-0">
                    <input
                      type="text"
                      value={
                        outputDual
                          ? `${lbpIsPayout ? "" : "≈ "}${Math.round(outputDual.lbp).toLocaleString()}`
                          : ""
                      }
                      readOnly
                      className={`w-full rounded-lg pl-4 pr-12 py-4 text-xl font-bold cursor-not-allowed ${
                        lbpIsPayout
                          ? "bg-slate-800/80 border border-violet-500/50 text-white"
                          : "bg-slate-800/40 border border-slate-700/60 text-slate-500"
                      }`}
                      placeholder="0"
                    />
                    <span
                      className={`absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium ${
                        lbpIsPayout ? "text-violet-300" : "text-slate-600"
                      }`}
                    >
                      LBP
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* LIRA-081 (PFT-R): "For Partner" — takes no counter cash; the
              partner owes the exchange's fromCurrency amount instead. */}
            <div>
              <ForPartnerToggle
                testId="exchange-for-partner-toggle"
                checked={forPartner}
                onChange={setForPartner}
                selectedPartnerId={selectedPartnerId}
                onPartnerChange={setSelectedPartnerId}
                checkboxClassName="w-4 h-4 rounded border-slate-600 bg-slate-900 text-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>

            {/* Client Name — hidden in for-partner mode (no walk-in customer) */}
            {forPartner ? (
              <ForPartnerNotice
                testId="exchange-partner-no-payment-notice"
                className="text-sm text-violet-200 bg-violet-500/10 border border-violet-500/30 rounded-xl px-4 py-4"
              >
                No payment is collected for a partner exchange. The full{" "}
                <span className="font-bold">
                  {amountIn.toLocaleString()} {fromCurrency}
                </span>{" "}
                goes on the selected partner&apos;s account, settled later on
                the Partners page.
              </ForPartnerNotice>
            ) : (
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
            )}

            <TransactionTimeOverride
              value={transactionTime}
              onChange={setTransactionTime}
            />

            <button
              onClick={() => {
                // Split payout (2026-07-30): USD/LBP-target walk-in exchanges
                // confirm through the PaymentSheet so the payout can be split;
                // partner mode and exotic targets keep the direct submit.
                if (canSplitPayout) {
                  setPayoutLines([]);
                  setPayoutTenderRate(undefined);
                  setPayoutSheetKey((k) => k + 1);
                  setShowPayoutSheet(true);
                } else if (
                  toIsLotTracked &&
                  lotPreview?.lotTracked &&
                  lotPreview.realizedProfitUsd < 0
                ) {
                  // Q10 — a legitimate loss is never a hard block; any
                  // operator confirms before it submits.
                  setShowLossConfirm(true);
                } else {
                  void handleProcess();
                }
              }}
              disabled={
                !effectiveResult ||
                !!calcError ||
                !!profitWarning ||
                isSubmitting ||
                isSubmittingPartner ||
                (forPartner && !selectedPartnerId) ||
                (toIsLotTracked && lotPreviewLoading)
              }
              className="w-full py-4 mt-2 rounded-xl font-bold text-lg bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {forPartner
                ? "Submit to Partner"
                : canSplitPayout
                  ? "Proceed to Payout"
                  : "Confirm Exchange"}
            </button>
          </div>

          {/* ── Rates: the shop's configured rates (LBP, EUR — from Settings)
                pinned above the market reference for every other currency the
                feed carries. Full spread + stamped-profit detail is behind the
                "Your Rates" button in the header. ── */}
          {/* The wrapper stretches to the row's height — which the calculator
              alone determines, because on `lg` the panel inside is absolutely
              positioned and so contributes no intrinsic height. That is what
              makes the two columns exactly equal: without it, 165 rows of
              content would make the panel the tallest item and drive the row.
              Below `lg` the panel is static and self-caps instead. */}
          <div className="w-full lg:w-72 shrink-0 relative">
            <LiveRatesPanel
              rates={marketRates}
              configuredRates={rateRows}
              lastUpdatedUtc={liveUpdatedUtc}
              loading={liveLoading || ratesLoading}
              className="w-full max-h-[28rem] lg:max-h-none lg:absolute lg:inset-0"
            />
          </div>
        </div>

        {/* Open Positions (Q16) — one row per lot-tracked currency the shop
            currently holds; links into the History modal pre-filtered to
            that currency. */}
        <PositionsPanel
          refreshKey={positionsRefreshKey}
          onViewCurrency={(code) => {
            setHistoryCurrencyFilter(code);
            setShowHistoryModal(true);
          }}
        />
        </div>
      </div>

      {/* Payout Sheet — how the shop pays the customer's amountOut. Cash-only
          in v1 (owner decision); the repository reconciles the legs
          hard-reject against amountOut and debits each leg per-currency. */}
      <PaymentSheet
        open={showPayoutSheet}
        onClose={() => setShowPayoutSheet(false)}
        onConfirm={() => void handleProcess(payoutLines)}
        isSubmitting={isSubmitting}
        title="Confirm Payout"
        {...(effectiveResult
          ? {
              subtitle: `Pay customer — ${formatAmount(effectiveResult.totalAmountOut, toCurrency)}`,
              confirmLabel: `Pay ${formatAmount(effectiveResult.totalAmountOut, toCurrency)}`,
            }
          : {})}
        accentColor="bg-violet-600 hover:bg-violet-500 text-white"
        summary={[
          {
            label: `You receive (${fromCurrency})`,
            value: formatAmount(amountIn, fromCurrency),
            color: "text-emerald-400",
          },
          {
            label: `Customer gets (${toCurrency})`,
            value: effectiveResult
              ? formatAmount(effectiveResult.totalAmountOut, toCurrency)
              : "",
            color: "text-red-400",
          },
        ]}
        totalAmount={
          effectiveResult
            ? roundForCurrency({
                amount: effectiveResult.totalAmountOut,
                currency: toCurrency,
              }).amount
            : 0
        }
        totalAmountCurrency={toCurrency}
        currency={toCurrency}
        paymentMethods={
          allPaymentMethods.filter((m) => m.code === "CASH").length > 0
            ? allPaymentMethods.filter((m) => m.code === "CASH")
            : [{ code: "CASH", label: "Cash" }]
        }
        {...(payoutSeedRate !== undefined
          ? { exchangeRate: payoutSeedRate }
          : {})}
        onExchangeRateChange={setPayoutTenderRate}
        showDiscount={false}
        paymentInputKey={payoutSheetKey}
        initialPaymentMethod="CASH"
        onPaymentChange={setPayoutLines}
      />

      {/* Your Rates — configured buy/sell spreads + stamped-profit preview */}
      {showRatesModal && (
        <YourRatesModal
          rates={rateRows}
          loading={ratesLoading}
          onClose={() => setShowRatesModal(false)}
        />
      )}

      {/* History Modal */}
      {showHistoryModal && (
        <HistoryModal
          transactions={transactions}
          loading={false}
          onClose={() => {
            setShowHistoryModal(false);
            setHistoryCurrencyFilter(undefined);
          }}
          onRefresh={loadHistory}
          {...(historyCurrencyFilter !== undefined
            ? { initialCurrencyFilter: historyCurrencyFilter }
            : {})}
        />
      )}

      {/* Loss confirm (Q10) — a lot-tracked toCurrency sell whose FIFO
          preview realizes a loss is never hard-blocked; any operator
          confirms before it submits. */}
      {showLossConfirm && lotPreview?.lotTracked && (
        <ConfirmModal
          isOpen={showLossConfirm}
          title="Confirm Loss"
          message={`This sale realizes -$${Math.abs(lotPreview.realizedProfitUsd).toFixed(2)} against acquisition cost — proceed?`}
          confirmLabel="Proceed Anyway"
          cancelLabel="Cancel"
          variant="warning"
          onConfirm={() => {
            setShowLossConfirm(false);
            void handleProcess();
          }}
          onCancel={() => setShowLossConfirm(false)}
        />
      )}
    </div>
  );
}
