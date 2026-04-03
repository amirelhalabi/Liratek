/**
 * Loto Module - Ticket Sales Page
 */

import { useState, useEffect } from "react";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useApi, PageHeader } from "@liratek/ui";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";
import { getExchangeRates } from "@/utils/exchangeRates";
import { Ticket, DollarSign, Percent, TrendingUp, Plus } from "lucide-react";

interface LotoSettings {
  commission_rate: string;
  monthly_fee_amount: string;
  auto_record_monthly_fee: string;
}

interface TodayStats {
  ticketsSold: number;
  totalSales: number;
  totalCommission: number;
  totalPrizes: number;
}

export function LotoPage() {
  const api = useApi();
  const [ticketNumber, setTicketNumber] = useState("");
  const [saleAmount, setSaleAmount] = useState<string>("");
  const [isWinner, setIsWinner] = useState(false);
  const [prizeAmount, setPrizeAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [useMultiPayment, setUseMultiPayment] = useState(false);

  const [_paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [note, setNote] = useState("");
  const [settings, setSettings] = useState<LotoSettings | null>(null);
  const [stats, setStats] = useState<TodayStats>({
    ticketsSold: 0,
    totalSales: 0,
    totalCommission: 0,
    totalPrizes: 0,
  });
  const [exchangeRate, setExchangeRate] = useState(100000); // Default fallback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { methods } = usePaymentMethods();

  const commissionRate = settings
    ? parseFloat(settings.commission_rate)
    : 0.0445;
  const commissionAmount = saleAmount
    ? parseFloat(saleAmount) * commissionRate
    : 0;

  useEffect(() => {
    loadSettings();
    loadTodayStats();
    loadExchangeRate();
  }, []);

  async function loadExchangeRate() {
    try {
      // Check if getRates API is available
      const getRatesApi = (api as any)?.getRates;
      if (!getRatesApi) {
        console.error("getRates API is not available");
        return;
      }
      
      const ratesList = await getRatesApi();
      const { sellRate } = getExchangeRates(ratesList);
      setExchangeRate(sellRate);
    } catch (error) {
      console.error("Failed to load exchange rate:", error);
    }
  }

  async function loadSettings() {
    try {
      const lotoApi = (api as any)?.loto;
      if (!lotoApi) {
        console.error("Loto API is not available");
        return;
      }
      
      const result = await lotoApi.settings.get();
      if (result.success && result.settings) {
        setSettings(result.settings as unknown as LotoSettings);
      }
    } catch (error) {
      console.error("Failed to load Loto settings:", error);
    }
  }

  async function loadTodayStats() {
    try {
      const lotoApi = (api as any)?.loto;
      if (!lotoApi) {
        console.error("Loto API is not available");
        return;
      }
      
      const today = new Date().toISOString().split("T")[0];
      const result = await lotoApi.report(today, today);
      if (result.success && result.reportData) {
        setStats({
          ticketsSold: result.reportData.total_tickets,
          totalSales: result.reportData.total_sales,
          totalCommission: result.reportData.total_commission,
          totalPrizes: result.reportData.total_prizes,
        });
      }
    } catch (error) {
      console.error("Failed to load today's stats:", error);
    }
  }

  async function handleSubmit() {
    if (!saleAmount || parseFloat(saleAmount) <= 0) {
      alert("Please enter a valid sale amount");
      return;
    }

    const lotoApi = (api as any)?.loto;
    if (!lotoApi) {
      alert("Loto API is not available");
      return;
    }

    setIsSubmitting(true);

    try {
      const ticketData: any = {
        // ticket_number added conditionally below
        sale_amount: parseFloat(saleAmount),
        commission_rate: commissionRate,
        commission_amount: commissionAmount,
        is_winner: isWinner,
        prize_amount: isWinner
          ? prizeAmount
            ? parseFloat(prizeAmount)
            : 0
          : 0,
        sale_date: new Date().toISOString().split("T")[0],
        payment_method: useMultiPayment ? "SPLIT" : paymentMethod,
        currency: "LBP",
        // Optional properties added conditionally below
      };
      // Conditionally add optional properties
      if (ticketNumber) ticketData.ticket_number = ticketNumber;
      if (note) ticketData.note = note;

      const result = await lotoApi.sell(ticketData);

      if (result.success) {
        alert("Ticket sold successfully!");
        // Reset form
        setTicketNumber("");
        setSaleAmount("");
        setIsWinner(false);
        setPrizeAmount("");
        setNote("");
        setPaymentLines([]);
        // Reload stats
        loadTodayStats();
      } else {
        alert("Failed to sell ticket: " + result.error);
      }
    } catch (error) {
      console.error("Failed to sell ticket:", error);
      alert("Failed to sell ticket");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 min-h-0 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      <PageHeader icon={Ticket} title="Loto" subtitle="Lottery ticket sales and management" />

      {/* Today's Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Ticket className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-slate-400">Tickets Sold</span>
          </div>
          <p className="text-2xl font-bold text-white">{stats.ticketsSold}</p>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-slate-400">Total Sales</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {stats.totalSales.toLocaleString()} L
          </p>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Percent className="w-4 h-4 text-orange-400" />
            <span className="text-xs text-slate-400">Commission</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {stats.totalCommission.toLocaleString()} L
          </p>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-slate-400">Prizes Paid</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {stats.totalPrizes.toLocaleString()} L
          </p>
        </div>
      </div>

      {/* Centered Ticket Sales Form */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-3xl mx-auto">
          <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <Plus className="w-5 h-5 text-orange-500" />
              Sell Ticket
            </h2>

            <div className="space-y-5">
              {/* Ticket Number */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Ticket Number (Optional)
                </label>
                <input
                  type="text"
                  value={ticketNumber}
                  onChange={(e) => setTicketNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors"
                  placeholder="Enter ticket number"
                />
              </div>

              {/* Sale Amount */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Sale Amount (LBP) *
                </label>
                <input
                  type="number"
                  value={saleAmount}
                  onChange={(e) => setSaleAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors"
                  placeholder="Enter sale amount"
                />
              </div>

              {/* Commission Display */}
              {saleAmount && (
                <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400">
                      Commission Rate
                    </span>
                    <span className="text-xs text-white font-medium">
                      {(commissionRate * 100).toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      Commission Amount
                    </span>
                    <span className="text-lg text-emerald-400 font-bold">
                      {commissionAmount.toLocaleString()} L
                    </span>
                  </div>
                </div>
              )}

              {/* Winner Checkbox */}
              <div className="flex items-center gap-2 p-3 bg-slate-900 rounded-lg border border-slate-700">
                <input
                  type="checkbox"
                  id="isWinner"
                  checked={isWinner}
                  onChange={(e) => setIsWinner(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-600 text-orange-500 focus:ring-orange-500"
                />
                <label htmlFor="isWinner" className="text-sm text-white font-medium">
                  This is a winning ticket
                </label>
              </div>

              {/* Prize Amount */}
              {isWinner && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    Prize Amount (LBP) *
                  </label>
                  <input
                    type="number"
                    value={prizeAmount}
                    onChange={(e) => setPrizeAmount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors"
                    placeholder="Enter prize amount"
                  />
                </div>
              )}

              {/* Note */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Note (Optional)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors resize-none"
                  placeholder="Add a note"
                />
              </div>

              {/* Payment Method */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-slate-400">Payment Method</label>
                  <button
                    type="button"
                    onClick={() => setUseMultiPayment(!useMultiPayment)}
                    className="text-xs px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                  >
                    {useMultiPayment ? "Single Payment" : "Split Payment"}
                  </button>
                </div>
                {useMultiPayment ? (
                  <MultiPaymentInput
                    totalAmount={saleAmount ? parseFloat(saleAmount) : 0}
                    currency="LBP"
                    onChange={setPaymentLines}
                    showPmFee={false}
                    paymentMethods={methods}
                    currencies={[
                      { code: "USD", symbol: "$" },
                      { code: "LBP", symbol: "L£" },
                    ]}
                    exchangeRate={exchangeRate}
                  />
                ) : (
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors"
                  >
                    {methods.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Submit Button */}
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !saleAmount}
                className="w-full py-3.5 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-lg transition-all mt-6 shadow-lg hover:shadow-orange-500/20"
              >
                {isSubmitting ? "Selling..." : "Sell Ticket"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LotoPage;
