/**
 * Custom Services Page
 *
 * Standalone module for recording any ad-hoc shop service with cost, price,
 * payment method, and customer details. Uses the dedicated custom_services API.
 *
 * Customer details (name, phone, save-as-client) are available for ALL
 * payment methods — not just DEBT.
 */

import { useState, useCallback, useEffect } from "react";
import {
  Briefcase,
  Plus,
  History,
  TrendingUp,
  User,
  Phone,
  Search,
  X,
  RefreshCw,
  UserPlus,
} from "lucide-react";
import { PageHeader, Select, useApi } from "@liratek/ui";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSession } from "@/features/sessions/context/SessionContext";
import { useCustomServices } from "../../hooks/useCustomServices";
import logger from "@/utils/logger";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";
import { HistoryModal } from "./components/HistoryModal";
import { StatsCards } from "../../components/StatsCards";

// =============================================================================
// Helper
// =============================================================================

function formatCurrency(usd: number, lbp: number): string {
  const parts: string[] = [];
  if (usd > 0) parts.push(`$${usd.toFixed(2)}`);
  if (lbp > 0) parts.push(`${lbp.toLocaleString()} LBP`);
  return parts.join(" + ") || "$0.00";
}

// =============================================================================
// Component
// =============================================================================

export default function CustomServices() {
  const api = useApi();
  const { methods } = usePaymentMethods();
  const { activeSession, linkTransaction } = useSession();
  const {
    history,
    summary,
    loading: historyLoading,
    reload,
  } = useCustomServices();

  // ─── Form State ───
  const [description, setDescription] = useState("");
  const [costUsd, setCostUsd] = useState("");
  const [costLbp, setCostLbp] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [priceLbp, setPriceLbp] = useState("");
  const [paidBy, setPaidBy] = useState("CASH");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ─── Multi-payment support ───
  const [useMultiPayment, setUseMultiPayment] = useState(false);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);

  // ─── History Modal ───
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // ─── Customer Details (for ALL payment methods) ───
  const [clientId, setClientId] = useState<number | null>(null);
  const [clientName, setClientName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [clientSearchResults, setClientSearchResults] = useState<any[]>([]);
  const [showClientSearch, setShowClientSearch] = useState(false);
  const [saveAsClient, setSaveAsClient] = useState(false);

  // Populate client name from session
  useEffect(() => {
    if (activeSession?.customer_name) {
      setClientName(activeSession.customer_name);
    }
    if (activeSession?.customer_phone) {
      setPhoneNumber(activeSession.customer_phone);
    }
  }, [activeSession]);

  const searchClients = useCallback(
    async (query: string) => {
      if (!query || query.length < 2) {
        setClientSearchResults([]);
        return;
      }
      try {
        const results = await api.getClients(query);
        setClientSearchResults(results.slice(0, 8));
      } catch {
        setClientSearchResults([]);
      }
    },
    [api],
  );

  const selectClient = (client: any) => {
    setClientName(client.full_name || client.name);
    setClientId(client.id);
    if (client.phone_number) setPhoneNumber(client.phone_number);
    setShowClientSearch(false);
    setClientSearchResults([]);
    setSaveAsClient(false);
  };

  const clearClient = () => {
    setClientId(null);
    setClientName("");
    setPhoneNumber("");
    setShowClientSearch(false);
    setClientSearchResults([]);
    setSaveAsClient(false);
  };

  // ─── Computed ───
  const costUsdVal = parseFloat(costUsd) || 0;
  const costLbpVal = parseFloat(costLbp) || 0;
  const priceUsdVal = parseFloat(priceUsd) || 0;
  const priceLbpVal = parseFloat(priceLbp) || 0;
  const profitUsd = priceUsdVal - costUsdVal;
  const profitLbp = priceLbpVal - costLbpVal;

  // ─── Submit ───
  const handleSubmit = async () => {
    if (!description.trim()) {
      alert("Please enter a service description.");
      return;
    }
    if (
      costUsdVal <= 0 &&
      costLbpVal <= 0 &&
      priceUsdVal <= 0 &&
      priceLbpVal <= 0
    ) {
      alert("Please enter a cost or price.");
      return;
    }
    if (paidBy === "DEBT" && !clientId) {
      alert("Please select a client for debt payment.");
      return;
    }

    setIsSubmitting(true);
    try {
      // Auto-create client if "Save as client" is checked and no existing client selected
      let finalClientId = clientId;
      if (saveAsClient && !clientId && clientName.trim()) {
        try {
          const createResult = await api.getClients(clientName.trim());
          // Check if client already exists
          const existing = createResult.find(
            (c: any) =>
              (c.full_name || c.name)?.toLowerCase() ===
              clientName.trim().toLowerCase(),
          );
          if (existing) {
            finalClientId = existing.id;
          } else {
            // Create new client
            const newClient = await (api as any).createClient?.({
              full_name: clientName.trim(),
              phone_number: phoneNumber.trim() || undefined,
            });
            if (newClient?.id) {
              finalClientId = newClient.id;
            }
          }
        } catch (err) {
          logger.error("Failed to save client:", err);
        }
      }

      const payload: Parameters<typeof api.addCustomService>[0] = {
        description: description.trim(),
        cost_usd: costUsdVal,
        cost_lbp: costLbpVal,
        price_usd: priceUsdVal,
        price_lbp: priceLbpVal,
        ...(useMultiPayment && paymentLines.length > 0
          ? {
              payments: paymentLines.map((p) => ({
                method: p.method,
                currency_code: p.currencyCode,
                amount: p.amount,
              })),
            }
          : { paid_by: paidBy }),
      };
      if (finalClientId) payload.client_id = finalClientId;
      if (clientName.trim()) payload.client_name = clientName.trim();
      if (phoneNumber.trim()) payload.phone_number = phoneNumber.trim();
      if (note.trim()) payload.note = note.trim();

      const result = await api.addCustomService(payload);

      if (result.success) {
        // Link to session if active
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "custom_service",
              transactionId: result.id,
              amountUsd: priceUsdVal || costUsdVal,
              amountLbp: priceLbpVal || costLbpVal,
            });
          } catch (err) {
            logger.error("Failed to link to session:", err);
          }
        }
        // Reset form
        setDescription("");
        setCostUsd("");
        setCostLbp("");
        setPriceUsd("");
        setPriceLbp("");
        setNote("");
        setUseMultiPayment(false);
        setPaymentLines([]);
        clearClient();
        reload();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Custom service submit failed:", error);
      alert("Failed to record service.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Void ───
  const handleVoid = async (id: number) => {
    if (!confirm("Void this service? Payments will be reversed.")) return;
    try {
      const result = await api.deleteCustomService(id);
      if (result.success) {
        reload();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Void failed:", error);
      alert("Failed to void service.");
    }
  };

  // ─── Render ───
  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 min-h-0 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      {/* Header with Stats and History */}
      <PageHeader
        icon={Briefcase}
        title="Services"
        actions={
          <div className="flex items-center gap-2">
            <StatsCards
              count={summary.count}
              totalPriceUsd={summary.totalPriceUsd}
              totalPriceLbp={summary.totalPriceLbp}
              totalProfitUsd={summary.totalProfitUsd}
              totalProfitLbp={summary.totalProfitLbp}
            />
            <button
              onClick={() => setShowHistoryModal(true)}
              className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white"
            >
              <History size={16} />
              <span className="font-medium">History</span>
            </button>
          </div>
        }
      />

      {/* Main: Form */}
      <div className="flex-1 min-h-0 overflow-auto">
        {/* New Service Form */}
        <div className="w-full bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl p-5 flex flex-col">
          <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Plus className="text-teal-400" size={20} />
            New Service
          </h2>

          <div className="space-y-4">
            {/* Description */}
            <div>
              <label
                htmlFor="svc-description"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
              >
                Description *
              </label>
              <input
                id="svc-description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/50 outline-none transition-all"
                placeholder="e.g., Phone screen repair, SIM activation"
                maxLength={500}
              />
            </div>

            {/* Cost & Price — Dual Currency */}
            <div className="p-4 rounded-xl bg-teal-400/5 border border-teal-400/20 space-y-3">
              <span className="block text-xs font-medium text-teal-400 uppercase tracking-wider">
                Cost / Price
              </span>

              {/* USD Row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="svc-cost-usd"
                    className="block text-[10px] text-slate-500 mb-1 uppercase"
                  >
                    Cost USD
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                      $
                    </span>
                    <input
                      id="svc-cost-usd"
                      type="number"
                      value={costUsd}
                      onChange={(e) => setCostUsd(e.target.value)}
                      className="w-full bg-slate-900/80 border border-slate-700 rounded-lg pl-8 pr-3 py-2.5 text-white font-mono text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="svc-price-usd"
                    className="block text-[10px] text-slate-500 mb-1 uppercase"
                  >
                    Price USD
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                      $
                    </span>
                    <input
                      id="svc-price-usd"
                      type="number"
                      value={priceUsd}
                      onChange={(e) => setPriceUsd(e.target.value)}
                      className="w-full bg-slate-900/80 border border-slate-700 rounded-lg pl-8 pr-3 py-2.5 text-white font-mono text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>
              </div>

              {/* LBP Row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="svc-cost-lbp"
                    className="block text-[10px] text-slate-500 mb-1 uppercase"
                  >
                    Cost LBP
                  </label>
                  <input
                    id="svc-cost-lbp"
                    type="number"
                    value={costLbp}
                    onChange={(e) => setCostLbp(e.target.value)}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2.5 text-white font-mono text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                    placeholder="0"
                    min="0"
                    step="1000"
                  />
                </div>
                <div>
                  <label
                    htmlFor="svc-price-lbp"
                    className="block text-[10px] text-slate-500 mb-1 uppercase"
                  >
                    Price LBP
                  </label>
                  <input
                    id="svc-price-lbp"
                    type="number"
                    value={priceLbp}
                    onChange={(e) => setPriceLbp(e.target.value)}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2.5 text-white font-mono text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                    placeholder="0"
                    min="0"
                    step="1000"
                  />
                </div>
              </div>

              {/* Profit indicator */}
              {(costUsdVal > 0 ||
                priceUsdVal > 0 ||
                costLbpVal > 0 ||
                priceLbpVal > 0) && (
                <div className="flex items-center gap-2 pt-1">
                  <TrendingUp
                    size={14}
                    className={
                      profitUsd >= 0 && profitLbp >= 0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }
                  />
                  <span
                    className={`text-sm font-bold ${profitUsd >= 0 && profitLbp >= 0 ? "text-emerald-400" : "text-red-400"}`}
                  >
                    Profit: {formatCurrency(profitUsd, profitLbp)}
                  </span>
                </div>
              )}
            </div>

            {/* Payment Method */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Payment Method
                </label>
                <button
                  type="button"
                  onClick={() => setUseMultiPayment(!useMultiPayment)}
                  className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                >
                  {useMultiPayment ? "Single Payment" : "Split Payment"}
                </button>
              </div>

              {!useMultiPayment ? (
                <Select
                  value={paidBy}
                  onChange={(value) => setPaidBy(value)}
                  options={methods.map((m) => ({
                    value: m.code,
                    label: m.label,
                  }))}
                  ringColor="ring-teal-500"
                  buttonClassName="py-2.5 text-sm font-bold rounded-lg"
                />
              ) : (
                <MultiPaymentInput
                  totalAmount={priceUsdVal || costUsdVal}
                  currency="USD"
                  onChange={setPaymentLines}
                  requiresClientForDebt={true}
                  hasClient={!!clientId || !!clientName}
                  paymentMethods={methods}
                  currencies={[
                    { code: "USD", symbol: "$" },
                    { code: "LBP", symbol: "L£" },
                  ]}
                  exchangeRate={Number(
                    localStorage.getItem("alfa_credit_sell_rate_lbp") ||
                      "100000",
                  )}
                />
              )}
            </div>

            {/* Customer Details — available for ALL payment methods */}
            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-700/50 space-y-3">
              <span className="block text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <User size={12} /> Customer Details
                {paidBy === "DEBT" && (
                  <span className="text-red-400 ml-1">(required for DEBT)</span>
                )}
              </span>

              {/* Client Search / Name */}
              <div className="relative">
                <label
                  htmlFor="svc-client"
                  className="block text-[10px] text-slate-500 mb-1 uppercase"
                >
                  Name
                </label>
                {clientId ? (
                  <div className="flex items-center gap-2 bg-teal-500/10 border border-teal-500/30 rounded-lg px-4 py-2.5">
                    <User size={14} className="text-teal-400" />
                    <span className="text-white font-medium text-sm flex-1">
                      {clientName}
                    </span>
                    <button
                      onClick={clearClient}
                      className="text-slate-400 hover:text-white transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                      <Search size={14} />
                    </div>
                    <input
                      id="svc-client"
                      type="text"
                      value={clientName}
                      onChange={(e) => {
                        setClientName(e.target.value);
                        setShowClientSearch(true);
                        searchClients(e.target.value);
                      }}
                      onFocus={() => {
                        if (clientName.length >= 2) {
                          setShowClientSearch(true);
                          searchClients(clientName);
                        }
                      }}
                      className="w-full bg-slate-900/80 border border-slate-700 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-all"
                      placeholder="Search or type name..."
                    />
                    {showClientSearch && clientSearchResults.length > 0 && (
                      <div className="absolute z-10 top-full mt-1 w-full bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-h-40 overflow-auto">
                        {clientSearchResults.map((c: any) => (
                          <button
                            key={c.id}
                            onClick={() => selectClient(c)}
                            className="w-full text-left px-4 py-2 hover:bg-slate-700 text-sm text-white transition-colors first:rounded-t-xl last:rounded-b-xl"
                          >
                            <span>{c.full_name || c.name}</span>
                            {c.phone_number && (
                              <span className="text-slate-500 ml-2 text-xs">
                                {c.phone_number}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Phone Number */}
              <div>
                <label
                  htmlFor="svc-phone"
                  className="block text-[10px] text-slate-500 mb-1 uppercase"
                >
                  Phone Number
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                    <Phone size={14} />
                  </div>
                  <input
                    id="svc-phone"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-all"
                    placeholder="e.g., 03 123 456"
                    disabled={!!clientId}
                  />
                </div>
              </div>

              {/* Save as Client checkbox — only shown when not already an existing client */}
              {!clientId && clientName.trim() && (
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-400 hover:text-white transition-colors">
                  <input
                    type="checkbox"
                    checked={saveAsClient}
                    onChange={(e) => setSaveAsClient(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-900 text-teal-500 focus:ring-teal-500 focus:ring-offset-0"
                  />
                  <UserPlus size={14} />
                  Save as client
                </label>
              )}
            </div>

            {/* Note */}
            <div>
              <label
                htmlFor="svc-note"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
              >
                Note (optional)
              </label>
              <input
                id="svc-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/50 outline-none transition-all"
                placeholder="Additional details..."
                maxLength={1000}
              />
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full py-4 mt-6 rounded-xl font-bold text-lg bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-900/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={18} className="animate-spin" /> Submitting...
              </>
            ) : (
              <>
                <Plus size={18} /> Submit Service
              </>
            )}
          </button>
        </div>
      </div>

      {/* History Modal */}
      {showHistoryModal && (
        <HistoryModal
          history={history}
          loading={historyLoading}
          onClose={() => setShowHistoryModal(false)}
          onRefresh={reload}
          onVoid={handleVoid}
        />
      )}
    </div>
  );
}
