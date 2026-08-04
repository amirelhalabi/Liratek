import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { appEvents, useApi, DecimalInput } from "@liratek/ui";
import logger from "@/utils/logger";

type WalletDrawerName = "OMT_App" | "Whish_App";
type WalletCurrency = "USD" | "LBP";

interface WalletExchangePanelProps {
  drawerName: WalletDrawerName;
  /** Current wallet balance, if known — shown so the operator can see what's
   *  available before converting. Omitted while still loading. */
  balance?: { usd: number; lbp: number } | undefined;
  /** Called after a successful exchange so the parent can refresh balances. */
  onDone: () => void;
}

const DEFAULT_RATE = "89000";

/**
 * Internal wallet exchange (owner req 2026-07-28): convert this wallet's own
 * USD balance to LBP or vice versa, at an operator-entered rate — never
 * touches General, never a customer. Both directions share the same `rate`
 * field (always LBP-per-USD): USD→LBP multiplies, LBP→USD divides.
 */
export function WalletExchangePanel({
  drawerName,
  balance,
  onDone,
}: WalletExchangePanelProps) {
  const api = useApi();
  const [fromCurrency, setFromCurrency] = useState<WalletCurrency>("USD");
  const [amount, setAmount] = useState(0);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toCurrency: WalletCurrency = fromCurrency === "USD" ? "LBP" : "USD";
  const rateNum = Number(rate) || 0;
  const amountOut =
    amount > 0 && rateNum > 0
      ? fromCurrency === "USD"
        ? Math.round(amount * rateNum)
        : Math.round((amount / rateNum) * 100) / 100
      : 0;

  const fmt = (n: number, currency: WalletCurrency) =>
    currency === "LBP"
      ? `${Math.round(n).toLocaleString()} LBP`
      : `$${n.toFixed(2)}`;

  const drawerLabel = drawerName === "OMT_App" ? "OMT App" : "Whish App";
  const availableInFrom =
    fromCurrency === "USD" ? (balance?.usd ?? 0) : (balance?.lbp ?? 0);

  function swapDirection() {
    setFromCurrency((c) => (c === "USD" ? "LBP" : "USD"));
    setAmount(0);
  }

  async function handleSubmit() {
    if (!(amount > 0)) {
      appEvents.emit(
        "notification:show",
        "Enter an amount to exchange.",
        "error",
      );
      return;
    }
    if (!(rateNum > 0)) {
      appEvents.emit(
        "notification:show",
        "Enter a valid exchange rate.",
        "error",
      );
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await api.walletExchange.create({
        drawerName,
        fromCurrency,
        toCurrency,
        amountIn: amount,
        rate: rateNum,
      });
      if (!result.success) {
        appEvents.emit(
          "notification:show",
          result.error || "Wallet exchange failed.",
          "error",
        );
        return;
      }
      appEvents.emit(
        "notification:show",
        `Converted ${fmt(amount, fromCurrency)} to ${fmt(result.amountOut ?? amountOut, toCurrency)} in ${drawerLabel}.`,
        "success",
      );
      setAmount(0);
      onDone();
    } catch (error) {
      logger.error("Wallet exchange failed:", error);
      appEvents.emit("notification:show", "Wallet exchange failed.", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-slate-400">
        Convert {drawerLabel}&apos;s own USD/LBP balance — this never touches
        the General drawer or a customer.
      </p>

      {balance && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-900 rounded-lg border border-slate-700 px-3 py-2">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">
              {drawerLabel} USD
            </span>
            <p className="text-sm font-semibold text-white">
              ${balance.usd.toFixed(2)}
            </p>
          </div>
          <div className="bg-slate-900 rounded-lg border border-slate-700 px-3 py-2">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">
              {drawerLabel} LBP
            </span>
            <p className="text-sm font-semibold text-white">
              {Math.round(balance.lbp).toLocaleString()} LBP
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
            Amount to exchange ({fromCurrency})
          </label>
          <DecimalInput
            value={amount}
            onChange={setAmount}
            decimals={fromCurrency === "LBP" ? 0 : 2}
            placeholder="0"
            data-testid="wallet-exchange-amount"
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Available: {fmt(availableInFrom, fromCurrency)}
          </p>
        </div>
        <button
          type="button"
          onClick={swapDirection}
          title="Swap direction"
          data-testid="wallet-exchange-swap"
          className="mt-6 p-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
        >
          <ArrowLeftRight className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
            Result ({toCurrency})
          </label>
          <div
            data-testid="wallet-exchange-result"
            className="w-full bg-slate-900/60 border border-dashed border-slate-600 rounded-lg px-3 py-2 text-slate-200 text-sm"
          >
            {amountOut > 0 ? fmt(amountOut, toCurrency) : "—"}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
          Exchange rate (LBP per USD)
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))}
          data-testid="wallet-exchange-rate"
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
        />
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmitting || !(amount > 0) || !(rateNum > 0)}
        data-testid="wallet-exchange-confirm"
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
      >
        {isSubmitting ? "Converting..." : `Convert to ${toCurrency}`}
      </button>
    </div>
  );
}
