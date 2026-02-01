import { useState, useEffect, useCallback } from "react";
import { RefreshCw, ArrowRightLeft, History, ArrowRight } from "lucide-react";
import * as api from "../../../../api/backendApi";

type Currency = { id: number; code: string; name: string; is_active: number };

type RateRow = { from_code: string; to_code: string; rate: number };

export default function Exchange() {
  type ExchangeTx = {
    id: number;
    created_at: string;
    from_currency: string;
    to_currency: string;
    rate: number;
    amount_in: string | number;
    amount_out: string | number;
  };
  const [transactions, setTransactions] = useState<ExchangeTx[]>([]);

  // Exchange State
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [fromCurrency, setFromCurrency] = useState<string>("USD");
  const [toCurrency, setToCurrency] = useState<string>("LBP");

  const [amountIn, setAmountIn] = useState<string>("");
  const [amountOut, setAmountOut] = useState<string>("");
  const [rate, setRate] = useState<string>("89500");
  const [rates, setRates] = useState<RateRow[]>([]);

  const [clientName, setClientName] = useState("");

  useEffect(() => {
    loadHistory();
    loadCurrencies();
  }, []);

  useEffect(() => {
    const loadRates = async () => {
      try {
        const list = await api.getRates();
        setRates(list);
      } catch (e) {
        console.error("Failed to load rates", e);
      }
    };
    loadRates();
  }, []);

  const findRate = useCallback(
    (from: string, to: string): number | undefined => {
      if (from === to) return 1;
      const direct = rates.find(
        (r) => r.from_code === from && r.to_code === to,
      )?.rate;
      if (direct !== undefined) return direct;
      const viaToUsd = rates.find(
        (r) => r.from_code === from && r.to_code === "USD",
      )?.rate;
      const viaFromUsd = rates.find(
        (r) => r.from_code === "USD" && r.to_code === to,
      )?.rate;
      if (viaToUsd !== undefined && viaFromUsd !== undefined)
        return viaToUsd * viaFromUsd;
      return undefined;
    },
    [rates],
  );

  const calculateOutput = useCallback(() => {
    const val = parseFloat(amountIn);
    const rParsed = parseFloat(rate);

    if (isNaN(val) || isNaN(rParsed) || rParsed === 0) {
      setAmountOut("");
      return;
    }

    let result = 0;
    const mr = findRate(fromCurrency, toCurrency);
    if (mr !== undefined) {
      result = val * mr;
    } else if (fromCurrency === "USD" && toCurrency === "LBP") {
      result = val * rParsed;
    } else if (fromCurrency === "LBP" && toCurrency === "USD") {
      result = val / rParsed;
    } else if (fromCurrency === "EUR" && toCurrency === "USD") {
      result = val * rParsed;
    } else if (fromCurrency === "USD" && toCurrency === "EUR") {
      result = val / rParsed;
    } else {
      result = val * rParsed;
    }

    if (toCurrency === "LBP") {
      setAmountOut(result.toFixed(0));
    } else {
      setAmountOut(result.toFixed(2));
    }
  }, [amountIn, rate, fromCurrency, toCurrency, findRate]);

  useEffect(() => {
    calculateOutput();
  }, [calculateOutput]);

  const loadCurrencies = async () => {
    try {
      const list = await api.getCurrencies();
      const active = (list as Currency[]).filter((c: any) => c.is_active === 1);
      setCurrencies(active);
      if (active.length >= 2) {
        setFromCurrency(active[0].code);
        setToCurrency(active[1].code);
      }
    } catch (e) {
      console.error("Failed to load currencies", e);
    }
  };

  const loadHistory = async () => {
    try {
      const history = await api.getExchangeHistory();
      setTransactions(history);
    } catch (error) {
      console.error("Failed to load history:", error);
    }
  };

  /* calculateOutput defined via useCallback above */

  const handleSwap = () => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
    setAmountIn(amountOut);
    // Rate might need inversion logic, but for now let user adjust
  };

  const handleProcess = async () => {
    const inp = parseFloat(amountIn);
    const out = parseFloat(amountOut);
    const r = parseFloat(rate);

    if (!inp || !out || !r) {
      alert("Please check amounts and rate.");
      return;
    }

    try {
      const result = await api.addExchangeTransaction({
        fromCurrency,
        toCurrency,
        amountIn: inp,
        amountOut: out,
        rate: r,
        clientName: clientName,
        note: `Exchange ${fromCurrency} to ${toCurrency}`,
      });

      if (result.success) {
        setAmountIn("");
        setAmountOut("");
        setClientName("");
        loadHistory();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      console.error(error);
      alert("Transaction failed");
    }
  };

  const getCurrencyIcon = (curr: string) => {
    switch (curr) {
      case "USD":
        return "$";
      case "EUR":
        return "€";
      case "LBP":
        return "LBP";
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-6 overflow-hidden animate-in fade-in duration-500">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <RefreshCw className="text-violet-500" />
        Currency Exchange
      </h1>

      <div className="flex-1 min-h-0 flex gap-6">
        {/* Left: Calculator */}
        <div className="w-1/3 min-w-[380px] h-full overflow-hidden bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl p-4 flex flex-col">
          {/* Currency Selectors */}
          <div className="flex items-center gap-2 mb-8">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">
                From
              </label>
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
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">
                To
              </label>
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

          <div className="space-y-6 flex-1">
            {/* Rate Input */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">
                Exchange Rate
              </label>
              <div className="relative">
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-bold">
                  {toCurrency} / {fromCurrency}
                </span>
                <input
                  type="number"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white font-mono focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
            </div>

            {/* Amount Inputs */}
            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-700/50 space-y-4 relative">
              {/* Arrow Indicator */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                <div className="bg-slate-700 rounded-full p-1.5 border-4 border-slate-800">
                  <ArrowRight size={16} className="text-slate-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">
                  You Receive ({fromCurrency})
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 font-bold">
                    {getCurrencyIcon(fromCurrency)}
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

              <div className="pt-2">
                <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">
                  You Pay ({toCurrency})
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-red-400 font-bold">
                    {getCurrencyIcon(toCurrency)}
                  </span>
                  <input
                    type="number"
                    value={amountOut}
                    readOnly
                    className="w-full bg-slate-800/50 border border-slate-700 rounded-lg pl-10 pr-4 py-4 text-xl font-bold text-slate-300 focus:outline-none cursor-not-allowed"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

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
          </div>

          <button
            onClick={handleProcess}
            className="w-full py-4 mt-6 rounded-xl font-bold text-lg bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/20 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            Confirm Exchange
          </button>
        </div>

        {/* Right: History */}
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
            <table className="w-full">
              <thead className="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="px-6 py-3">Time</th>
                  <th className="px-6 py-3">From</th>
                  <th className="px-6 py-3">To</th>
                  <th className="px-6 py-3 text-right">Rate</th>
                  <th className="px-6 py-3 text-right">Amount In</th>
                  <th className="px-6 py-3 text-right">Amount Out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {new Date(tx.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400">
                        {tx.from_currency}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400">
                        {tx.to_currency}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400 text-right font-mono">
                      {tx.rate.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-emerald-400 text-right">
                      {Number(tx.amount_in).toLocaleString()} {tx.from_currency}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-red-400 text-right">
                      {Number(tx.amount_out).toLocaleString()} {tx.to_currency}
                    </td>
                  </tr>
                ))}
                {transactions.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-8 text-center text-slate-500 text-sm"
                    >
                      No exchanges yet today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
