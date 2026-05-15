import { useState, useEffect } from "react";
import { User, Phone } from "lucide-react";
import { useApi, DoubleTab } from "@liratek/ui";
import { PaymentSheet } from "./PaymentSheet";
import { useSession } from "@/features/sessions/context/SessionContext";
import type { FinancialTransaction } from "../types";
import { HistoryModal } from "./HistoryModal";
import { getExchangeRates } from "@/utils/exchangeRates";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import logger from "@/utils/logger";
import { useSaveAsClient } from "@/shared/hooks/useSaveAsClient";
import { SaveAsClientCheckbox } from "@/shared/components/SaveAsClientCheckbox";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import { PartnerSelector } from "@/features/partners/components/PartnerSelector";

type ServiceType = "SEND" | "RECEIVE";
type ProviderKey = "OMT_APP" | "WISH_APP";

interface OmtWhishAppTransferFormProps {
  activeProvider: ProviderKey;
  transactions: FinancialTransaction[];
  loadFinancialData: () => void;
  formatAmount: (val: number, currency: string) => string;
  customerName?: string | undefined;
  customerPhone?: string | undefined;
  showHistory?: boolean;
  onCloseHistory?: () => void;
}

export function OmtWhishAppTransferForm({
  activeProvider,
  transactions,
  loadFinancialData,
  formatAmount,
  customerName,
  customerPhone,
  showHistory: showHistoryProp,
  onCloseHistory,
}: OmtWhishAppTransferFormProps) {
  const api = useApi();
  const {
    activeSession,
    linkTransaction,
    addToCart: addToSessionCart,
  } = useSession();
  const { methods: allPaymentMethods } = usePaymentMethods();
  const [serviceType, setServiceType] = useState<ServiceType>("SEND");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [senderName, setSenderName] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const showHistory = showHistoryProp ?? false;
  const [exchangeRate, setExchangeRate] = useState(89500);
  const [paymentLines, setPaymentLines] = useState<any[]>([]);
  const isSplitPayment = paymentLines.length > 1;
  const [paidByMethod, setPaidByMethod] = useState("CASH");
  const [includingFees, setIncludingFees] = useState(false);
  const [manualFee, setManualFee] = useState("");
  const [discount, setDiscount] = useState(0);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();
  const [partnerId, setPartnerId] = useState<number | null>(null);

  // Save-as-client: use sender for SEND, receiver for RECEIVE
  const saveClientName = serviceType === "SEND" ? senderName : receiverName;
  const saveClientPhone = serviceType === "SEND" ? senderPhone : receiverPhone;
  const {
    saveAsClient,
    setSaveAsClient,
    showCheckbox: showSaveAsClient,
    trySaveAsClient,
    resetSaveAsClient,
  } = useSaveAsClient(saveClientName, saveClientPhone);

  // Load exchange rate
  useEffect(() => {
    const loadRate = async () => {
      try {
        const rates = await api.getRates();
        const { sellRate } = getExchangeRates(rates);
        setExchangeRate(sellRate);
      } catch (error) {
        logger.error("Failed to load exchange rate:", error);
      }
    };
    loadRate();
  }, [api]);

  // Autofill sender/receiver from customer session based on service type
  useEffect(() => {
    if (serviceType === "SEND") {
      setSenderName(customerName || "");
      setSenderPhone(customerPhone || "");
    } else {
      setReceiverName(customerName || "");
      setReceiverPhone(customerPhone || "");
    }
  }, [serviceType, customerName, customerPhone]);

  // Calculate fees — Whish App uses 1% fee on RECEIVE (USD only, no fees for LBP)
  const parsedAmount = parseFloat(amount || "0");
  const autoFee =
    activeProvider === "WISH_APP" &&
    serviceType === "RECEIVE" &&
    currency === "USD" &&
    parsedAmount > 0
      ? parsedAmount * 0.01
      : 0;
  const providerFee =
    parseFloat(manualFee || "0") > 0 ? parseFloat(manualFee) : autoFee;

  // When includingFees: entered amount is total, fee is subtracted
  // When not includingFees: fee is added on top
  const sentAmount = includingFees ? parsedAmount - providerFee : parsedAmount;
  const totalAmount =
    serviceType === "SEND"
      ? parsedAmount + providerFee
      : includingFees
        ? parsedAmount
        : parsedAmount + providerFee;
  // Profit rules:
  // - OMT App: $0 profit (all types)
  // - Whish App SEND: $0 profit
  // - Whish App RECEIVE: 10% of fee (1% of amount)
  const shopProfit =
    activeProvider === "WISH_APP" && serviceType === "RECEIVE"
      ? providerFee * 0.1
      : 0;

  const handleSubmit = async () => {
    const finalSenderName = senderName.trim();
    const finalSenderPhone = senderPhone.trim();
    const finalReceiverName = receiverName.trim();
    const finalReceiverPhone = receiverPhone.trim();

    // Save as client if checkbox is checked
    await trySaveAsClient();

    // If session is active, add to cart instead of submitting
    if (activeSession) {
      const providerLabel =
        activeProvider === "OMT_APP" ? "OMT App" : "Whish App";
      const clientLabel =
        serviceType === "SEND" ? finalSenderName : finalReceiverName;
      const amtLabel =
        currency === "LBP"
          ? `${parseFloat(amount).toLocaleString()} LBP`
          : `$${parseFloat(amount).toFixed(2)}`;
      const label = `${providerLabel} ${serviceType} - ${clientLabel} - ${amtLabel}`;

      addToSessionCart({
        module: activeProvider === "OMT_APP" ? "omt_app" : "whish_app",
        label,
        amount: serviceType === "SEND" ? totalAmount : -totalAmount,
        currency,
        ipcChannel: "financial:create",
        formData: {
          provider: activeProvider,
          serviceType,
          amount: includingFees ? sentAmount : parseFloat(amount),
          currency,
          commission: Math.max(0, shopProfit - discount),
          ...(activeProvider === "OMT_APP" ? { omtFee: providerFee } : {}),
          ...(activeProvider === "WISH_APP" ? { whishFee: providerFee } : {}),
          clientName: clientLabel,
          referenceNumber: "",
          phoneNumber:
            serviceType === "SEND" ? finalSenderPhone : finalReceiverPhone,
          note: `${serviceType} transfer via ${providerLabel}`,
          paidByMethod: isSplitPayment ? "MULTI" : paidByMethod,
          payments: isSplitPayment ? paymentLines : undefined,
          includingFees,
        },
      });

      setAmount("");
      setSenderName("");
      setSenderPhone("");
      setReceiverName("");
      setReceiverPhone("");
      setPaymentLines([]);
      setManualFee("");
      resetSaveAsClient();
      return;
    }

    setIsSubmitting(true);

    try {
      const paymentMethod = isSplitPayment ? "MULTI" : paidByMethod;

      const result = await api.addOMTTransaction({
        provider: activeProvider,
        serviceType,
        amount: includingFees ? sentAmount : parseFloat(amount),
        currency,
        commission: Math.max(0, shopProfit - discount),
        ...(activeProvider === "OMT_APP" ? { omtFee: providerFee } : {}),
        ...(activeProvider === "WISH_APP" ? { whishFee: providerFee } : {}),
        clientName:
          serviceType === "SEND" ? finalSenderName : finalReceiverName,
        referenceNumber: "",
        phoneNumber:
          serviceType === "SEND" ? finalSenderPhone : finalReceiverPhone,
        note: `${serviceType} transfer via ${activeProvider === "OMT_APP" ? "OMT App" : "Whish App"}`,
        paidByMethod: paymentMethod,
        payments: isSplitPayment ? paymentLines : undefined,
        includingFees,
        partnerId: partnerId || undefined,
        transaction_time: transactionTime,
      });

      if (result.success) {
        // Link to active customer session
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "financial_service",
              transactionId: result.id,
              amountUsd: currency === "USD" ? totalAmount : 0,
              amountLbp: currency === "LBP" ? totalAmount : 0,
              profitUsd:
                currency === "USD" ? Math.max(0, shopProfit - discount) : 0,
            });
          } catch (err) {
            logger.error("Failed to link app transfer to session:", err);
          }
        }

        alert(
          `${activeProvider === "OMT_APP" ? "OMT App" : "Whish App"} transfer completed successfully!`,
        );
        setAmount("");
        setSenderName("");
        setSenderPhone("");
        setReceiverName("");
        setReceiverPhone("");
        setPaymentLines([]);
        setManualFee("");
        setTransactionTime(undefined);
        resetSaveAsClient();
        loadFinancialData();
      } else {
        alert(result.error || "Failed to process transfer");
      }
    } catch (error) {
      logger.error("Transfer failed:", error);
      alert("Failed to process transfer");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">
      {/* Header with SEND/RECEIVE Tabs */}
      <DoubleTab
        leftOption={{ id: "SEND", label: "Send", iconKey: "Send" }}
        rightOption={{
          id: "RECEIVE",
          label: "Receive",
          iconKey: "Package",
        }}
        value={serviceType}
        onChange={(val) => setServiceType(val as ServiceType)}
        accentColor={activeProvider === "OMT_APP" ? "amber" : "red"}
        customColor={activeProvider === "OMT_APP" ? "#ffde00" : "#ff0a46"}
        customTextColor={activeProvider === "OMT_APP" ? "black" : "white"}
      />
      <div className="flex items-center justify-between -mt-3 mb-1">
        <p className="text-xs text-slate-400">
          {serviceType === "SEND"
            ? "Sending transfer from shop to customer"
            : "Shop receiving transfer from customer"}
        </p>
        <PartnerSelector
          selectedPartnerId={partnerId}
          onSelect={setPartnerId}
        />
      </div>

      {/* Amount Input */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label
            htmlFor="transfer-amount"
            className="block text-xs font-medium text-slate-400 uppercase tracking-wider"
          >
            Amount ({currency})
          </label>
          {/* Currency selector */}
          <div className="flex items-center gap-1 bg-slate-900 rounded-lg border border-slate-600 p-0.5">
            {(["USD", "LBP"] as const).map((cur) => (
              <button
                key={cur}
                type="button"
                onClick={() => {
                  setCurrency(cur);
                  setAmount("");
                }}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                  currency === cur
                    ? "bg-violet-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {cur}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          {currency === "USD" && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
              $
            </span>
          )}
          <input
            id="transfer-amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`w-full bg-slate-900 border border-slate-700 rounded-lg ${currency === "USD" ? "pl-8" : "pl-4"} pr-14 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all`}
            placeholder={currency === "LBP" ? "0" : "0.00"}
            step={currency === "LBP" ? "1000" : "0.01"}
            min="0"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-medium">
            {currency}
          </span>
        </div>
      </div>

      {/* Fee Breakdown — hidden for Whish App SEND (no fees, no profit) and Whish App LBP RECEIVE (no fees) */}
      {!(activeProvider === "WISH_APP" && serviceType === "SEND") &&
        !(
          activeProvider === "WISH_APP" &&
          serviceType === "RECEIVE" &&
          currency === "LBP"
        ) && (
          <div className="rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Fee Breakdown
            </h3>

            {/* Manual Fee Input */}
            <div>
              <label
                htmlFor="transfer-fee"
                className="block text-xs text-slate-400 mb-1"
              >
                Fee Amount (USD)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                  $
                </span>
                <input
                  id="transfer-fee"
                  type="number"
                  value={manualFee}
                  onChange={(e) => setManualFee(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-8 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
                  placeholder={
                    autoFee > 0 ? autoFee.toFixed(2) + " (auto)" : "0.00"
                  }
                  min="0"
                  step="0.01"
                />
              </div>
              {/* Auto-fee hint */}
              {autoFee > 0 && !manualFee && (
                <p className="text-xs text-slate-400 mt-1">
                  Auto-calculated fee:{" "}
                  <span className="text-white font-medium">
                    ${autoFee.toFixed(2)}
                  </span>{" "}
                  (1% of amount)
                </p>
              )}
            </div>

            {/* Provider Fee */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Provider Fee:</span>
              <span className="text-white font-mono">
                ${providerFee.toFixed(2)}
              </span>
            </div>

            {/* Fee included in amount checkbox (Whish App RECEIVE) */}
            {activeProvider === "WISH_APP" && serviceType === "RECEIVE" && (
              <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-3 space-y-2">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includingFees}
                    onChange={(e) => setIncludingFees(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium">
                    Fee included in amount
                  </span>
                </label>
                {parsedAmount > 0 && (
                  <div className="text-xs space-y-0.5 pl-6 border-l border-slate-600 ml-2">
                    {includingFees ? (
                      <>
                        <p className="text-slate-400">
                          Customer paid:{" "}
                          <span className="text-white font-mono font-medium">
                            ${parsedAmount.toFixed(2)}
                          </span>
                        </p>
                        <p className="text-slate-400">
                          Fee:{" "}
                          <span className="text-amber-400 font-mono font-medium">
                            -${providerFee.toFixed(2)}
                          </span>
                        </p>
                        <p className="text-slate-400">
                          Customer receives:{" "}
                          <span className="text-emerald-400 font-mono font-medium">
                            ${sentAmount.toFixed(2)}
                          </span>
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-slate-400">
                          Transfer amount:{" "}
                          <span className="text-white font-mono font-medium">
                            ${parsedAmount.toFixed(2)}
                          </span>
                        </p>
                        <p className="text-slate-400">
                          Fee (extra):{" "}
                          <span className="text-amber-400 font-mono font-medium">
                            +${providerFee.toFixed(2)}
                          </span>
                        </p>
                        <p className="text-slate-400">
                          Customer pays total:{" "}
                          <span className="text-emerald-400 font-mono font-medium">
                            ${totalAmount.toFixed(2)}
                          </span>
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Shop Profit */}
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-slate-400">Shop Profit:</span>
              <span
                className={`font-mono font-bold ${shopProfit > 0 ? "text-emerald-400" : "text-slate-500"}`}
              >
                ${shopProfit.toFixed(2)}
              </span>
            </div>
          </div>
        )}

      {/* Sender / Receiver Info — always show all four fields in one row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label
            htmlFor="sender-name"
            className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
          >
            <User size={12} /> Sender Name{" "}
            {activeSession && serviceType === "SEND" && "• Session"}
          </label>
          <ClientAutocompleteInput
            id="sender-name"
            type="text"
            value={senderName}
            onChange={(v) => setSenderName(v)}
            onClientSelect={(c) => setSenderPhone(c.phone_number || "")}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
            placeholder="Sender name"
          />
        </div>
        <div>
          <label
            htmlFor="sender-phone"
            className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
          >
            <Phone size={12} /> Sender Phone{" "}
            {activeSession && serviceType === "SEND" && "• Session"}
          </label>
          <ClientAutocompleteInput
            id="sender-phone"
            type="tel"
            value={senderPhone}
            onChange={(v) => setSenderPhone(v)}
            onClientSelect={(c) => setSenderName(c.full_name)}
            searchByPhone
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
            placeholder="Sender phone"
          />
        </div>
        <div>
          <label
            htmlFor="receiver-name"
            className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
          >
            <User size={12} /> Receiver Name{" "}
            {activeSession && serviceType === "RECEIVE" && "• Session"}
          </label>
          <ClientAutocompleteInput
            id="receiver-name"
            type="text"
            value={receiverName}
            onChange={(v) => setReceiverName(v)}
            onClientSelect={(c) => setReceiverPhone(c.phone_number || "")}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
            placeholder="Receiver name"
          />
        </div>
        <div>
          <label
            htmlFor="receiver-phone"
            className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
          >
            <Phone size={12} /> Receiver Phone{" "}
            {activeSession && serviceType === "RECEIVE" && "• Session"}
          </label>
          <ClientAutocompleteInput
            id="receiver-phone"
            type="tel"
            value={receiverPhone}
            onChange={(v) => setReceiverPhone(v)}
            onClientSelect={(c) => setReceiverName(c.full_name)}
            searchByPhone
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
            placeholder="Receiver phone"
          />
        </div>
      </div>
      <SaveAsClientCheckbox
        checked={saveAsClient}
        onChange={setSaveAsClient}
        hidden={!showSaveAsClient}
      />

      <TransactionTimeOverride
        value={transactionTime}
        onChange={setTransactionTime}
      />

      {/* Spacer to ensure content scrolls above sticky bar */}
      <div className="flex-1" />

      {/* Sticky Bottom Trigger Bar */}
      <div className="sticky bottom-0 bg-slate-800/95 backdrop-blur-sm rounded-xl border border-slate-700/50 p-3 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-400">
              {isSplitPayment ? "Split" : paidByMethod}
              <span className="text-slate-600 mx-1">·</span>
              <span className="text-white font-mono font-semibold">
                ${totalAmount.toFixed(2)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              // Validate before opening sheet
              if (!amount || parseFloat(amount) <= 0) {
                alert("Please enter a valid amount");
                return;
              }
              if (
                serviceType === "SEND" &&
                (!senderName.trim() || !senderPhone.trim())
              ) {
                alert(
                  "Please enter sender name and phone for SEND transactions",
                );
                return;
              }
              if (
                serviceType === "RECEIVE" &&
                (!receiverName.trim() || !receiverPhone.trim())
              ) {
                alert(
                  "Please enter receiver name and phone for RECEIVE transactions",
                );
                return;
              }
              setShowPaymentSheet(true);
            }}
            disabled={!amount || parseFloat(amount) <= 0}
            className={`px-5 py-2.5 rounded-lg font-bold text-sm transition-all ${
              !amount || parseFloat(amount) <= 0
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : activeProvider === "OMT_APP"
                  ? "bg-[#ffde00] hover:bg-[#ffde00]/80 text-black shadow-lg shadow-[#ffde00]/20"
                  : "bg-[#ff0a46] hover:bg-[#ff0a46]/80 text-white shadow-lg shadow-[#ff0a46]/20"
            }`}
          >
            {activeSession ? "Add to Cart" : "Proceed to Pay"}
          </button>
        </div>
      </div>

      {/* Payment Sheet (Right Drawer) */}
      <PaymentSheet
        open={showPaymentSheet}
        onClose={() => setShowPaymentSheet(false)}
        onConfirm={handleSubmit}
        isSubmitting={isSubmitting}
        title={activeSession ? "Add to Cart" : "Confirm Payment"}
        subtitle={`${activeProvider === "OMT_APP" ? "OMT App" : "Whish App"} ${serviceType === "SEND" ? "Send" : "Receive"} — $${parsedAmount.toFixed(2)}`}
        accentColor={
          activeProvider === "OMT_APP"
            ? "bg-[#ffde00] hover:bg-[#ffde00]/90 text-black"
            : "bg-[#ff0a46] hover:bg-[#ff0a46]/90 text-white"
        }
        confirmLabel={
          activeSession ? "Add to Cart" : `Pay $${totalAmount.toFixed(2)}`
        }
        summary={[
          { label: "Transfer Amount", value: `$${parsedAmount.toFixed(2)}` },
          ...(providerFee > 0
            ? [
                {
                  label: "Provider Fee",
                  value: `$${providerFee.toFixed(2)}`,
                  color: "text-amber-400",
                },
              ]
            : []),
          ...(shopProfit > 0
            ? [
                {
                  label: "Shop Profit",
                  value: `$${shopProfit.toFixed(2)}`,
                  color: "text-emerald-400",
                },
              ]
            : []),
          { label: "Total", value: `$${totalAmount.toFixed(2)}` },
        ]}
        totalAmount={totalAmount}
        currency="USD"
        paymentMethods={allPaymentMethods}
        exchangeRate={exchangeRate}
        showDiscount={true}
        maxDiscount={shopProfit}
        onDiscountChange={setDiscount}
        requiresClientForDebt={true}
        hasClient={
          serviceType === "SEND"
            ? !!(senderName || senderPhone)
            : !!(receiverName || receiverPhone)
        }
        onPaymentChange={(lines) => {
          setPaymentLines(lines);
          if (lines.length === 1) {
            setPaidByMethod(lines[0].method);
          }
        }}
      />

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          transactions={transactions}
          provider={activeProvider === "OMT_APP" ? "OMT App" : "Whish App"}
          onClose={() => onCloseHistory?.()}
          onRefresh={loadFinancialData}
          formatAmount={formatAmount}
          showFeeAndProfit
          onUpdateMetadata={async (id, data) => {
            const result = await window.api.financial.updateMetadata({
              id,
              ...(data.client_name !== undefined && {
                customer_name: data.client_name,
              }),
              ...(data.phone_number !== undefined && {
                phone_number: data.phone_number,
              }),
              ...(data.note !== undefined && { note: data.note }),
            });
            return result;
          }}
        />
      )}
    </div>
  );
}
