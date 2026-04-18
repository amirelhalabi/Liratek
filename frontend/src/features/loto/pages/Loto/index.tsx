/**
 * Loto Module - Ticket Sales Page
 */

import { useState, useEffect } from "react";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useApi, PageHeader } from "@liratek/ui";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";
import { getExchangeRates } from "@/utils/exchangeRates";
import { Ticket, Plus, History, ClipboardCheck, Trophy } from "lucide-react";
import { StatsCards } from "../../components/StatsCards";
import { CheckpointHistory } from "../../components/CheckpointHistory";
import { CheckpointScheduler } from "../../components/CheckpointScheduler";
import { SettlementVerification } from "../../components/SettlementVerification";

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
  // Tab state: "sell" or "cashPrize"
  const [activeTab, setActiveTab] = useState<"sell" | "cashPrize">("sell");

  // Sell ticket form state
  const [saleAmount, setSaleAmount] = useState<string>("");
  const [_paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);

  // Cash prize form state
  const [cashPrizeTicketNumber, setCashPrizeTicketNumber] = useState("");
  const [cashPrizeAmount, setCashPrizeAmount] = useState<string>("");
  const [isSubmittingCashPrize, setIsSubmittingCashPrize] = useState(false);

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

  // Modal states
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [isCreatingCheckpoint, setIsCreatingCheckpoint] = useState(false);

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
        return;
      }

      const ratesList = await getRatesApi();
      const { sellRate } = getExchangeRates(ratesList);
      setExchangeRate(sellRate);
    } catch {
      // silent
    }
  }

  async function loadSettings() {
    try {
      const lotoApi = (api as any)?.loto;
      if (!lotoApi) {
        return;
      }

      const result = await lotoApi.settings.get();
      if (result.success && result.settings) {
        setSettings(result.settings as unknown as LotoSettings);
      }
    } catch {
      // silent
    }
  }

  async function loadTodayStats() {
    try {
      const lotoApi = (api as any)?.loto;
      if (!lotoApi) {
        return;
      }

      const today = new Date().toISOString().split("T")[0];
      const result = await lotoApi.report(today, today);
      if (result.success && result.reportData) {
        setStats({
          ticketsSold: result.reportData.total_tickets,
          totalSales: result.reportData.total_sales,
          totalCommission: result.reportData.total_commission,
          totalPrizes: result.reportData.total_cash_prizes,
        });
      }
    } catch {
      // silent
    }
  }

  async function handleCreateCheckpoint() {
    setIsCreatingCheckpoint(true);
    try {
      const lotoApi = (api as any)?.loto;
      if (!lotoApi) {
        alert("Loto API is not available");
        return;
      }

      // Get the last checkpoint to determine period_start
      const lastResult = await lotoApi.checkpoint.getLast();
      let periodStart = "1970-01-01";
      if (lastResult.success && lastResult.checkpoint) {
        // Start from the day AFTER the last checkpoint's period_end
        const nextDay = new Date(lastResult.checkpoint.period_end);
        nextDay.setDate(nextDay.getDate() + 1);
        periodStart = nextDay.toISOString().split("T")[0];
      }

      const today = new Date().toISOString().split("T")[0];

      // Check if there are any sales or cash prizes to checkpoint
      const ticketsResult = await lotoApi.getByDateRange(periodStart, today);
      const tickets = ticketsResult.tickets || [];
      const cashPrizeResult = await lotoApi.cashPrize.getTotalUnreimbursed();
      const hasCashPrizes =
        cashPrizeResult.success && cashPrizeResult.total > 0;

      if (tickets.length === 0 && !hasCashPrizes) {
        alert("No sales or cash prizes to checkpoint.");
        return;
      }

      const result = await lotoApi.checkpoint.create({
        checkpoint_date: today,
        period_start: periodStart,
        period_end: today,
        note: `Manual checkpoint for ${new Date().toLocaleDateString()}`,
      });

      if (result.success) {
        alert("Checkpoint created successfully!");
        loadTodayStats();
      } else {
        alert("Failed to create checkpoint: " + result.error);
      }
    } catch (error) {
      alert(
        "Error creating checkpoint: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
    } finally {
      setIsCreatingCheckpoint(false);
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
      const ticketData = {
        sale_amount: parseFloat(saleAmount),
        commission_rate: commissionRate,
        commission_amount: commissionAmount,
        sale_date: new Date().toISOString().split("T")[0],
        payment_method:
          _paymentLines.length > 1
            ? "SPLIT"
            : _paymentLines[0]?.method || "CASH",
        currency: "LBP",
      };

      const result = await lotoApi.sell(ticketData);

      if (result.success) {
        alert("Ticket sold successfully!");
        // Reset form
        setSaleAmount("");
        setPaymentLines([]);
        // Reload stats
        loadTodayStats();
      } else {
        alert("Failed to sell ticket: " + result.error);
      }
    } catch {
      alert("Failed to sell ticket");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCashPrizeSubmit() {
    if (!cashPrizeAmount || parseFloat(cashPrizeAmount) <= 0) {
      alert("Please enter a valid prize amount");
      return;
    }

    const lotoApi = (api as any)?.loto;
    if (!lotoApi) {
      alert("Loto API is not available");
      return;
    }

    setIsSubmittingCashPrize(true);

    try {
      const prizeData = {
        prize_amount: parseFloat(cashPrizeAmount),
        prize_date: new Date().toISOString().split("T")[0],
        ticket_number: cashPrizeTicketNumber.trim() || undefined,
      };

      const result = await lotoApi.cashPrize.create(prizeData);

      if (result.success) {
        alert("Cash prize recorded successfully!");
        // Reset form
        setCashPrizeTicketNumber("");
        setCashPrizeAmount("");
        // Reload stats
        loadTodayStats();
      } else {
        alert("Failed to record cash prize: " + result.error);
      }
    } catch {
      alert("Failed to record cash prize");
    } finally {
      setIsSubmittingCashPrize(false);
    }
  }

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 min-h-0 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      <PageHeader
        icon={Ticket}
        title="Loto"
        actions={
          <div className="flex items-center gap-2">
            <StatsCards
              ticketsSold={stats.ticketsSold}
              totalSales={stats.totalSales}
              totalCommission={stats.totalCommission}
              totalPrizes={stats.totalPrizes}
            />
            <button
              onClick={handleCreateCheckpoint}
              disabled={isCreatingCheckpoint}
              className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white"
            >
              <ClipboardCheck size={16} />
              <span className="font-medium">
                {isCreatingCheckpoint ? "Creating..." : "Checkpoint"}
              </span>
            </button>
            <button
              onClick={() => setShowHistoryModal(true)}
              className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white"
            >
              <History size={16} />
              <span className="font-medium">History</span>
            </button>
            <SettlementVerification />
          </div>
        }
      />

      {/* Centered Forms with Tabs */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-3xl mx-auto">
          {/* Tab Switcher */}
          <div className="flex gap-1 mb-4 bg-slate-800 rounded-lg p-1 border border-slate-700/50">
            <button
              onClick={() => setActiveTab("sell")}
              className={`flex-1 py-2.5 px-4 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                activeTab === "sell"
                  ? "bg-orange-500 text-white shadow-lg"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              <Plus className="w-4 h-4" />
              Sell Ticket
            </button>
            <button
              onClick={() => setActiveTab("cashPrize")}
              className={`flex-1 py-2.5 px-4 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                activeTab === "cashPrize"
                  ? "bg-yellow-500 text-white shadow-lg"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              <Trophy className="w-4 h-4" />
              Cash Prize
            </button>
          </div>

          {activeTab === "sell" ? (
            <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-6 shadow-2xl">
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Plus className="w-5 h-5 text-orange-500" />
                Sell Ticket
              </h2>

              <div className="space-y-5">
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

                {/* Payment Method */}
                <div>
                  <MultiPaymentInput
                    totalAmount={saleAmount ? parseFloat(saleAmount) : 0}
                    totalAmountCurrency="LBP"
                    currency="LBP"
                    onChange={setPaymentLines}
                    showPmFee={false}
                    paymentMethods={methods}
                    currencies={[
                      { code: "USD", symbol: "$" },
                      { code: "LBP", symbol: "LBP" },
                    ]}
                    exchangeRate={exchangeRate}
                  />
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
          ) : (
            <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-6 shadow-2xl">
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                Cash Prize
              </h2>

              <div className="space-y-5">
                {/* Prize Amount */}
                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    Prize Amount (LBP) *
                  </label>
                  <input
                    type="number"
                    value={cashPrizeAmount}
                    onChange={(e) => setCashPrizeAmount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500 transition-colors"
                    placeholder="Enter prize amount"
                  />
                </div>

                {/* Ticket Number */}
                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    Ticket Number
                  </label>
                  <input
                    type="text"
                    value={cashPrizeTicketNumber}
                    onChange={(e) => setCashPrizeTicketNumber(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-500 transition-colors"
                    placeholder="Winning ticket number (optional)"
                  />
                </div>

                {/* Submit Button */}
                <button
                  onClick={handleCashPrizeSubmit}
                  disabled={isSubmittingCashPrize || !cashPrizeAmount}
                  className="w-full py-3.5 bg-yellow-500 hover:bg-yellow-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-lg transition-all mt-6 shadow-lg hover:shadow-yellow-500/20"
                >
                  {isSubmittingCashPrize ? "Recording..." : "Record Cash Prize"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Scheduled Checkpoint Popup (Thu/Mon 7pm) */}
      <CheckpointScheduler onCheckpointCreated={() => loadTodayStats()} />

      {/* Checkpoint History Modal */}
      {showHistoryModal && (
        <CheckpointHistory onClose={() => setShowHistoryModal(false)} />
      )}
    </div>
  );
}

export default LotoPage;
