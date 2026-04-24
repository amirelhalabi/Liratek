import { useState, useEffect } from "react";
import { User, Phone } from "lucide-react";
import { MultiPaymentInput, useApi, DoubleTab } from "@liratek/ui";
import { useSession } from "@/features/sessions/context/SessionContext";
import type { FinancialTransaction } from "../types";
import { HistoryModal } from "./HistoryModal";
import { getExchangeRates } from "@/utils/exchangeRates";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import logger from "@/utils/logger";

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
  const [senderName, setSenderName] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const showHistory = showHistoryProp ?? false;
  const [exchangeRate, setExchangeRate] = useState(89500);
  const [paymentLines, setPaymentLines] = useState<any[]>([]);
  const isSplitPayment = paymentLines.length > 1;
  const [paidByMethod, setPaidByMethod] = useState("CASH");
  const [optionalFeeEnabled, setOptionalFeeEnabled] = useState(false);
  const [manualFee, setManualFee] = useState("");

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

  // Calculate fees
  const calculateProviderFee = (): number => {
    // Manual fee takes priority if entered
    const manual = parseFloat(manualFee || "0");
    if (manual > 0) return manual;

    if (
      serviceType === "RECEIVE" &&
      activeProvider === "WISH_APP" &&
      optionalFeeEnabled
    ) {
      return parseFloat(amount || "0") * 0.01;
    }
    return 0;
  };

  const providerFee = calculateProviderFee();
  const parsedAmount = parseFloat(amount || "0");
  const totalAmount =
    serviceType === "SEND"
      ? parsedAmount + providerFee
      : parsedAmount - providerFee;
  const shopProfit = providerFee;

  const handleSubmit = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    const finalSenderName = senderName.trim();
    const finalSenderPhone = senderPhone.trim();
    const finalReceiverName = receiverName.trim();
    const finalReceiverPhone = receiverPhone.trim();

    if (serviceType === "SEND" && (!finalSenderName || !finalSenderPhone)) {
      alert("Please enter sender name and phone for SEND transactions");
      return;
    }

    if (
      serviceType === "RECEIVE" &&
      (!finalReceiverName || !finalReceiverPhone)
    ) {
      alert("Please enter receiver name and phone for RECEIVE transactions");
      return;
    }

    // If session is active, add to cart instead of submitting
    if (activeSession) {
      const providerLabel =
        activeProvider === "OMT_APP" ? "OMT App" : "Whish App";
      const clientLabel =
        serviceType === "SEND" ? finalSenderName : finalReceiverName;
      const label = `${providerLabel} ${serviceType} - ${clientLabel} - $${parseFloat(amount).toFixed(2)}`;

      addToSessionCart({
        module: activeProvider === "OMT_APP" ? "omt_app" : "whish_app",
        label,
        amount: serviceType === "SEND" ? totalAmount : -totalAmount,
        currency: "USD",
        ipcChannel: "financial:create",
        formData: {
          provider: activeProvider,
          serviceType,
          amount: parseFloat(amount),
          currency: "USD",
          commission: shopProfit,
          ...(activeProvider === "OMT_APP" ? { omtFee: providerFee } : {}),
          ...(activeProvider === "WISH_APP" ? { whishFee: providerFee } : {}),
          clientName: clientLabel,
          referenceNumber: "",
          phoneNumber:
            serviceType === "SEND" ? finalSenderPhone : finalReceiverPhone,
          note: `${serviceType} transfer via ${providerLabel}`,
          paidByMethod: isSplitPayment ? "MULTI" : paidByMethod,
          payments: isSplitPayment ? paymentLines : undefined,
        },
      });

      setAmount("");
      setSenderName("");
      setSenderPhone("");
      setReceiverName("");
      setReceiverPhone("");
      setPaymentLines([]);
      setManualFee("");
      return;
    }

    setIsSubmitting(true);

    try {
      const paymentMethod = isSplitPayment ? "MULTI" : paidByMethod;

      const result = await api.addOMTTransaction({
        provider: activeProvider,
        serviceType,
        amount: parseFloat(amount),
        currency: "USD",
        commission: shopProfit,
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
      });

      if (result.success) {
        // Link to active customer session
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "financial_service",
              transactionId: result.id,
              amountUsd: parseFloat(amount) || 0,
              amountLbp: 0,
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
      <p className="text-xs text-slate-400 text-center -mt-3 mb-1">
        {serviceType === "SEND"
          ? "Sending transfer from shop to customer"
          : "Shop receiving transfer from customer"}
      </p>

      {/* Amount Input */}
      <div>
        <label
          htmlFor="transfer-amount"
          className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
        >
          Amount (USD)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
            $
          </span>
          <input
            id="transfer-amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
            placeholder="0.00"
            step="0.01"
            min="0"
          />
        </div>
      </div>

      {/* Fee Breakdown */}
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
            Fee Amount (USD) — Optional
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
              placeholder="0.00"
              min="0"
              step="0.01"
            />
          </div>
        </div>

        {/* Provider Fee */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Provider Fee:</span>
          <span className="text-white font-mono">
            ${providerFee.toFixed(2)}
          </span>
        </div>

        {/* Optional Fee Toggle (Whish App RECEIVE only) */}
        {activeProvider === "WISH_APP" && serviceType === "RECEIVE" && (
          <div className="flex items-center justify-between text-xs py-2 border-t border-slate-700/50">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Optional 1% Fee:</span>
              <button
                type="button"
                onClick={() => setOptionalFeeEnabled(!optionalFeeEnabled)}
                className={`relative w-8 h-4 rounded-full transition-colors ${
                  optionalFeeEnabled ? "bg-[#ff0a46]" : "bg-slate-600"
                }`}
              >
                <span
                  className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
                  style={{
                    left: optionalFeeEnabled ? "18px" : "2px",
                  }}
                />
              </button>
            </div>
            <span className="text-white font-mono">
              $
              {optionalFeeEnabled
                ? (parseFloat(amount || "0") * 0.01).toFixed(2)
                : "0.00"}
            </span>
          </div>
        )}

        {/* Customer Receives (RECEIVE only, when fee is applied) */}
        {serviceType === "RECEIVE" && providerFee > 0 && (
          <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-700/50">
            <span className="text-emerald-300 font-semibold">
              Customer Receives:
            </span>
            <span className="text-emerald-400 font-mono font-bold text-base">
              ${totalAmount.toFixed(2)}
            </span>
          </div>
        )}

        {/* Total */}
        <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-700/50">
          <span className="text-slate-300 font-medium">
            {serviceType === "RECEIVE" ? "Gross Amount:" : "Total:"}
          </span>
          <span className="text-emerald-400 font-mono font-bold">
            ${parsedAmount.toFixed(2)}
          </span>
        </div>

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

      {/* Sender/Receiver Info */}
      {serviceType === "SEND" ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="sender-name"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
              >
                <User size={12} /> Sender Name
              </label>
              <input
                id="sender-name"
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
                placeholder="Sender name"
              />
            </div>
            <div>
              <label
                htmlFor="sender-phone"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
              >
                <Phone size={12} /> Sender Phone
              </label>
              <input
                id="sender-phone"
                type="tel"
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
                placeholder="Sender phone"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="receiver-name"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
              >
                <User size={12} /> Receiver Name
              </label>
              <input
                id="receiver-name"
                type="text"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
                placeholder="Receiver name"
              />
            </div>
            <div>
              <label
                htmlFor="receiver-phone"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
              >
                <Phone size={12} /> Receiver Phone
              </label>
              <input
                id="receiver-phone"
                type="tel"
                value={receiverPhone}
                onChange={(e) => setReceiverPhone(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
                placeholder="Receiver phone"
              />
            </div>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor="receiver-name"
              className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
            >
              <User size={12} /> Receiver Name
            </label>
            <input
              id="receiver-name"
              type="text"
              value={receiverName}
              onChange={(e) => setReceiverName(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
              placeholder="Receiver name"
            />
          </div>
          <div>
            <label
              htmlFor="receiver-phone"
              className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
            >
              <Phone size={12} /> Receiver Phone
            </label>
            <input
              id="receiver-phone"
              type="tel"
              value={receiverPhone}
              onChange={(e) => setReceiverPhone(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
              placeholder="Receiver phone"
            />
          </div>
        </div>
      )}

      {/* Spacer to ensure content scrolls above sticky bar */}
      <div className="flex-1" />

      {/* Sticky Bottom Bar - Payment Method + Submit */}
      <div className="sticky bottom-0 bg-slate-800 rounded-xl border border-slate-700/50 p-4 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <MultiPaymentInput
              totalAmount={totalAmount}
              currency="USD"
              onChange={(lines) => {
                setPaymentLines(lines);
                if (lines.length === 1) {
                  setPaidByMethod(lines[0].method);
                }
              }}
              requiresClientForDebt={true}
              hasClient={
                serviceType === "SEND"
                  ? !!(senderName || senderPhone)
                  : !!(receiverName || receiverPhone)
              }
              showPmFee={false}
              paymentMethods={allPaymentMethods}
              currencies={[
                { code: "USD", symbol: "$" },
                { code: "LBP", symbol: "LBP" },
              ]}
              exchangeRate={exchangeRate}
            />
          </div>

          <div className="text-right min-w-[150px]">
            <div className="text-xs text-slate-400">Amount:</div>
            <div className="text-sm text-emerald-400 font-mono font-bold">
              ${totalAmount.toFixed(2)}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !amount || parseFloat(amount) <= 0}
            className={`px-6 py-3 rounded-lg font-bold text-white transition-all min-w-[140px] ${
              isSubmitting || !amount || parseFloat(amount) <= 0
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : activeProvider === "OMT_APP"
                  ? "bg-[#ffde00] hover:bg-[#ffde00]/80 text-black shadow-lg shadow-[#ffde00]/20"
                  : "bg-[#ff0a46] hover:bg-[#ff0a46]/80 shadow-lg shadow-[#ff0a46]/20"
            }`}
          >
            {isSubmitting ? "Processing..." : "Submit"}
          </button>
        </div>
      </div>

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          transactions={transactions}
          provider={activeProvider === "OMT_APP" ? "OMT App" : "Whish App"}
          onClose={() => onCloseHistory?.()}
          onRefresh={loadFinancialData}
          formatAmount={formatAmount}
          showFeeAndProfit
        />
      )}
    </div>
  );
}
