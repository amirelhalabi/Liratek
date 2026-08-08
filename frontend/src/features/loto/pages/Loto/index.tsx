/**
 * Loto Module - Ticket Sales Page
 */

import { useState, useEffect } from "react";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { localDay } from "@/shared/utils/localDay";
import { appEvents, useApi, PageHeader, DecimalInput } from "@liratek/ui";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";
import { useSellRate } from "@/hooks/useSellRate";
import { useSession } from "@/features/sessions/context/SessionContext";
import {
  Ticket,
  Plus,
  History,
  ClipboardCheck,
  Trophy,
  Phone,
  Receipt,
} from "lucide-react";
import { StatsCards } from "../../components/StatsCards";
import { CheckpointHistory } from "../../components/CheckpointHistory";
import { TicketHistoryModal } from "../../components/TicketHistoryModal";
import { CheckpointScheduler } from "../../components/CheckpointScheduler";
import { SettlementVerification } from "../../components/SettlementVerification";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import { ensureRechargeClient } from "@/features/recharge/utils/ensureClient";
import { useAutoPrintReceipt } from "@/shared/hooks/useAutoPrintReceipt";
import {
  ForPartnerToggle,
  ForPartnerNotice,
} from "@/features/partners/components/ForPartnerToggle";

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
  const { activeSession, addToCart: addToSessionCart } = useSession();
  // LIRA-069 W1.d — auto-print on a successful STANDALONE ticket sale
  // (skipped when a session is active; the session gets its own Print
  // button at checkout, W1.b). Never fires for a "for partner" ticket — no
  // cash is collected from a walk-in customer, so there's no one to hand a
  // receipt to.
  const autoPrintReceipt = useAutoPrintReceipt();
  // Tab state: "sell" or "cashPrize"
  const [activeTab, setActiveTab] = useState<"sell" | "cashPrize">("sell");

  // Sell ticket form state
  const [saleAmount, setSaleAmount] = useState<string>("");
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [returnLegs, setReturnLegs] = useState<PaymentLine[]>([]);
  // T3 keep-change: kept (not returned) change → profit stamp on the ticket.
  const [keptChange, setKeptChange] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [initialPaymentMethod, setInitialPaymentMethod] =
    useState<string>("CASH");
  // PFT-R "For Partner": this ticket is sold on a partner's behalf — no
  // walk-in customer, no counter cash. The partner owes the full sale_amount,
  // settled later on the Partners page (loto:sell already enforces this
  // server-side: any counter-payment leg in partner mode is rejected).
  const [forPartner, setForPartner] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(
    null,
  );

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
  // Payments use the BUY rate (owner decision 2026-07-06): every
  // MultiPaymentInput converts LBP↔USD at buyRate.
  const { buyRate: exchangeRate } = useSellRate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();
  const { methods } = usePaymentMethods();

  // Modal states
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  // LIRA-100 — ticket-level History/reprint UI (checkpoint history above is
  // aggregate-only: total_tickets, settlement_id, no per-ticket reprint).
  const [showTicketHistoryModal, setShowTicketHistoryModal] = useState(false);
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
  }, []);

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

      const today = localDay();
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
        periodStart = localDay(nextDay);
      }

      const today = localDay();

      // Check if there are any uncheckpointed sales or cash prizes
      const ticketsResult = await lotoApi.getUncheckpointed();
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
        appEvents.emit(
          "notification:show",
          "Checkpoint created successfully!",
          "success",
        );
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

    // PFT-R "For Partner": block + notify if no partner is selected — the
    // backend requires partnerId whenever partnerMode is "FOR".
    if (forPartner && !selectedPartnerId) {
      alert("Please select a partner for this ticket");
      return;
    }

    // Resolve client (creates one on-the-fly if name+phone entered without existing clientId)
    const clientResult = await ensureRechargeClient({
      clientId,
      name: clientName,
      phone: clientPhone,
      // A partner ticket sends no payment legs at all (see `payments` below),
      // so evaluate the CUSTOMER_ACCOUNT requirement against what's actually
      // submitted — not against stale lines left over from before the toggle.
      paymentLines: forPartner ? [] : paymentLines,
    });
    if (!clientResult.ok) {
      alert(clientResult.error);
      return;
    }

    const resolvedClientId = clientResult.id;
    const resolvedClientName = resolvedClientId
      ? clientName.trim() || undefined
      : undefined;

    const ticketData = {
      sale_amount: parseFloat(saleAmount),
      commission_rate: commissionRate,
      commission_amount: commissionAmount,
      sale_date: localDay(),
      // PFT-R: omit entirely in partner mode — the backend rejects the
      // ticket if payment_method resolves to ANY drawer-affecting value
      // (including an unrecognized code, which defaults drawer-affecting),
      // so this key must not be present at all, not just falsy.
      ...(forPartner
        ? {}
        : {
            payment_method:
              paymentLines.length > 1
                ? "SPLIT"
                : paymentLines[0]?.method || "CASH",
          }),
      currency: "LBP",
      // What the customer ACTUALLY handed over, per currency — the backend
      // books these legs into the drawers (a 500,000 LBP ticket paid with $5
      // must credit General +$5, not +500,000 LBP).
      // PFT-R: a for-partner ticket collects NO counter cash at all — the
      // backend rejects any leg here when partnerMode is "FOR".
      payments: forPartner
        ? []
        : [
            ...paymentLines.map((l) => ({
              method: l.method,
              currencyCode: l.currencyCode,
              amount: l.amount,
              ...(l.direction ? { direction: l.direction } : {}),
            })),
            // Change handed back to the customer — booked negative by the repo.
            ...returnLegs.map((l) => ({
              method: l.method,
              currencyCode: l.currencyCode,
              amount: l.amount,
              direction: "OUT" as const,
            })),
          ],
      transaction_time: transactionTime,
      // T3 keep-change: kept amounts join the ticket's profit stamp. Never
      // applicable in partner mode (no counter cash to keep).
      ...(keptChange &&
      !forPartner &&
      (keptChange.usd > 0 || keptChange.lbp > 0)
        ? {
            kept_change_usd: keptChange.usd,
            kept_change_lbp: keptChange.lbp,
          }
        : {}),
      clientId: resolvedClientId,
      clientName: resolvedClientName,
      // PFT-R: routes the FULL sale amount to the selected partner's ledger
      // (FOR_LOTO DEBIT) instead of a client's debt_ledger.
      ...(forPartner && selectedPartnerId
        ? { partnerId: selectedPartnerId, partnerMode: "FOR" as const }
        : {}),
    };

    // If session is active, add to cart instead of submitting — EXCEPT a
    // partner ticket, which never joins a walk-in customer's basket: the
    // session-basket replay forces deferPayment:true on every cart item
    // (SessionCheckoutService), which would silently skip the partner_ledger
    // write (isForPartner requires !deferPayment). A partner ticket always
    // submits directly below so the partner is charged immediately.
    if (activeSession && !forPartner) {
      addToSessionCart({
        module: "loto_ticket",
        label: `Loto Ticket - ${parseFloat(saleAmount).toLocaleString()} LBP`,
        amount: parseFloat(saleAmount),
        currency: "LBP",
        ipcChannel: "loto:sell",
        formData: ticketData,
      });

      setSaleAmount("");
      setPaymentLines([]);
      setReturnLegs([]);
      setKeptChange(null);
      setClientId(null);
      setClientName("");
      setClientPhone("");
      setInitialPaymentMethod("CASH");
      setPaymentInputKey((k) => k + 1);
      setForPartner(false);
      setSelectedPartnerId(null);
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await lotoApi.sell(ticketData);

      if (result.success) {
        appEvents.emit(
          "notification:show",
          "Ticket sold successfully!",
          "success",
        );
        if (!forPartner) {
          void autoPrintReceipt({
            type: "LOTO",
            sourceTable: "loto_tickets",
            sourceId: result.ticket?.id,
            hasActiveSession: !!activeSession,
          });
        }
        setSaleAmount("");
        setPaymentLines([]);
        setReturnLegs([]);
        setClientId(null);
        setClientName("");
        setClientPhone("");
        setInitialPaymentMethod("CASH");
        setPaymentInputKey((k) => k + 1);
        setTransactionTime(undefined);
        setForPartner(false);
        setSelectedPartnerId(null);
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

    const prizeData = {
      prize_amount: parseFloat(cashPrizeAmount),
      prize_date: localDay(),
      ticket_number: cashPrizeTicketNumber.trim() || undefined,
    };

    // If session is active, add to cart instead of submitting
    if (activeSession) {
      addToSessionCart({
        module: "loto_prize",
        label: `Loto Prize - ${parseFloat(cashPrizeAmount).toLocaleString()} LBP${cashPrizeTicketNumber.trim() ? ` (#${cashPrizeTicketNumber.trim()})` : ""}`,
        amount: -parseFloat(cashPrizeAmount),
        currency: "LBP",
        ipcChannel: "loto:cash-prize:create",
        formData: prizeData,
      });

      setCashPrizeAmount("");
      setCashPrizeTicketNumber("");
      return;
    }

    setIsSubmittingCashPrize(true);

    try {
      const result = await lotoApi.cashPrize.create(prizeData);

      if (result.success) {
        appEvents.emit(
          "notification:show",
          "Cash prize recorded successfully!",
          "success",
        );
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
            <button
              onClick={() => setShowTicketHistoryModal(true)}
              className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white"
            >
              <Receipt size={16} />
              <span className="font-medium">Ticket History</span>
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
                  <DecimalInput
                    value={parseFloat(saleAmount) || 0}
                    onChange={(n) => setSaleAmount(n ? String(n) : "")}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors"
                    placeholder="Enter sale amount"
                  />
                </div>

                {/* Client Name + Phone */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Client
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <ClientAutocompleteInput
                      type="text"
                      value={clientName}
                      onChange={(v) => {
                        setClientName(v);
                        if (!v) {
                          setClientId(null);
                          setClientPhone("");
                        }
                      }}
                      onClientSelect={(c) => {
                        setClientId(c.id);
                        setClientName(c.full_name || "");
                        setClientPhone(c.phone_number || "");
                        setInitialPaymentMethod("CUSTOMER_ACCOUNT");
                        setPaymentInputKey((k) => k + 1);
                      }}
                      placeholder="Client name (optional)"
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                    />
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                        <Phone size={14} />
                      </div>
                      <input
                        type="tel"
                        inputMode="numeric"
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        placeholder="Phone"
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500"
                      />
                    </div>
                  </div>
                  {clientName.trim() && clientPhone.trim() && !clientId && (
                    <p className="text-xs text-orange-300/80 px-1">
                      New client will be created on confirm.
                    </p>
                  )}
                </div>

                {/* For Partner — sells this ticket on a partner's behalf.
                    No counter cash is collected; the partner owes the full
                    sale amount, settled later on the Partners page. */}
                <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-3">
                  <ForPartnerToggle
                    testId="loto-for-partner-toggle"
                    checked={forPartner}
                    onChange={setForPartner}
                    selectedPartnerId={selectedPartnerId}
                    onPartnerChange={setSelectedPartnerId}
                    textClassName="text-sm font-medium text-slate-300"
                  />
                </div>

                {/* Payment Method — hidden for a partner ticket: no counter
                    cash is collected, the full sale amount goes on the
                    selected partner's tab instead. */}
                {forPartner ? (
                  <ForPartnerNotice
                    testId="loto-partner-no-payment-notice"
                    className="text-sm text-orange-200 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3"
                  >
                    No payment is collected for a partner ticket. The full{" "}
                    <span className="font-bold">
                      {saleAmount ? parseFloat(saleAmount).toLocaleString() : 0}{" "}
                      LBP
                    </span>{" "}
                    goes on the selected partner&apos;s account, settled later
                    on the Partners page.
                  </ForPartnerNotice>
                ) : (
                  <div>
                    <MultiPaymentInput
                      key={paymentInputKey}
                      totals={[
                        {
                          amount: saleAmount ? parseFloat(saleAmount) : 0,
                          currency: "LBP",
                        },
                      ]}
                      totalAmountCurrency="LBP"
                      currency="LBP"
                      onChange={setPaymentLines}
                      onReturnChange={setReturnLegs}
                      onKeptChange={setKeptChange}
                      showPmFee={false}
                      paymentMethods={methods}
                      currencies={[
                        { code: "USD", symbol: "$" },
                        { code: "LBP", symbol: "LBP" },
                      ]}
                      exchangeRate={exchangeRate}
                      initialMethod={initialPaymentMethod}
                      hasClient={
                        !!clientId ||
                        (!!clientName.trim() && !!clientPhone.trim())
                      }
                      // Ticket sale (charge flow): shortfall → client debt.
                      autoDebtRemainder={
                        !!clientId ||
                        (!!clientName.trim() && !!clientPhone.trim())
                      }
                    />
                  </div>
                )}

                <TransactionTimeOverride
                  value={transactionTime}
                  onChange={setTransactionTime}
                />

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
                  <DecimalInput
                    value={parseFloat(cashPrizeAmount) || 0}
                    onChange={(n) => setCashPrizeAmount(n ? String(n) : "")}
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

      {/* Ticket History Modal (LIRA-100) */}
      {showTicketHistoryModal && (
        <TicketHistoryModal
          onClose={() => setShowTicketHistoryModal(false)}
        />
      )}
    </div>
  );
}

export default LotoPage;
