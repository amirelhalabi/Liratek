import { useState, useEffect } from "react";
import { User, Phone } from "lucide-react";
import { MultiPaymentInput, useApi, DoubleTab } from "@liratek/ui";
import type { FinancialTransaction } from "../types";
import { HistoryModal } from "./HistoryModal";
import { getExchangeRates } from "@/utils/exchangeRates";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";

type ServiceType = "SEND" | "RECEIVE";
type ProviderKey = "OMT_APP" | "WISH_APP";

interface OmtWhishAppTransferFormProps {
  activeProvider: ProviderKey;
  transactions: FinancialTransaction[];
  loadFinancialData: () => void;
  formatAmount: (val: number, currency: string) => string;
}

export function OmtWhishAppTransferForm({
  activeProvider,
  transactions,
  loadFinancialData,
  formatAmount,
}: OmtWhishAppTransferFormProps) {
  const api = useApi();
  const { drawerAffectingMethods } = usePaymentMethods();
  const [serviceType, setServiceType] = useState<ServiceType>("SEND");
  const [amount, setAmount] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(89500);
  const [useMultiPayment, setUseMultiPayment] = useState(false);
  const [paymentLines, setPaymentLines] = useState<any[]>([]);
  const [paidByMethod, setPaidByMethod] = useState("CASH");
  const [optionalFeeEnabled, setOptionalFeeEnabled] = useState(false);

  // Load exchange rate
  useEffect(() => {
    const loadRate = async () => {
      try {
        const rates = await api.getRates();
        const { sellRate } = getExchangeRates(rates);
        setExchangeRate(sellRate);
      } catch (error) {
        console.error("Failed to load exchange rate:", error);
      }
    };
    loadRate();
  }, [api]);

  // Calculate fees
  const calculateProviderFee = (): number => {
    if (serviceType === "SEND") {
      return 0;
    }
    if (activeProvider === "WISH_APP" && optionalFeeEnabled) {
      return parseFloat(amount || "0") * 0.01;
    }
    return 0;
  };

  const providerFee = calculateProviderFee();
  const totalAmount =
    serviceType === "SEND"
      ? parseFloat(amount || "0") + providerFee
      : parseFloat(amount || "0");
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

    setIsSubmitting(true);

    try {
      const paymentMethod = useMultiPayment ? "MULTI" : paidByMethod;

      const result = await api.addOMTTransaction({
        provider: activeProvider,
        service_type: serviceType,
        amount: parseFloat(amount),
        currency: "USD",
        commission: shopProfit,
        omt_fee: activeProvider === "OMT_APP" ? providerFee : null,
        whish_fee: activeProvider === "WISH_APP" ? providerFee : null,
        is_settled: 1,
        client_name:
          serviceType === "SEND" ? finalSenderName : finalReceiverName,
        reference_number: "",
        phone_number:
          serviceType === "SEND" ? finalSenderPhone : finalReceiverPhone,
        omt_service_type: null,
        note: `${serviceType} transfer via ${activeProvider === "OMT_APP" ? "OMT App" : "Whish App"}`,
        payment_method: paymentMethod,
        payment_lines: useMultiPayment ? paymentLines : undefined,
        exchange_rate: exchangeRate,
      });

      if (result.success) {
        alert(
          `${activeProvider === "OMT_APP" ? "OMT App" : "Whish App"} transfer completed successfully!`,
        );
        setAmount("");
        setSenderName("");
        setSenderPhone("");
        setReceiverName("");
        setReceiverPhone("");
        setPaymentLines([]);
        loadFinancialData();
      } else {
        alert(result.error || "Failed to process transfer");
      }
    } catch (error) {
      console.error("Transfer failed:", error);
      alert("Failed to process transfer");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* Header with SEND/RECEIVE Tabs */}
      <DoubleTab
        leftOption={{ id: "SEND", label: "Money In", iconKey: "Send" }}
        rightOption={{
          id: "RECEIVE",
          label: "Money Out",
          iconKey: "Package",
        }}
        value={serviceType}
        onChange={(val) => setServiceType(val as ServiceType)}
        accentColor={activeProvider === "OMT_APP" ? "lime" : "violet"}
      />

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
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-lime-500 transition-all"
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
                  optionalFeeEnabled ? "bg-violet-600" : "bg-slate-600"
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

        {/* Total */}
        <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-700/50">
          <span className="text-slate-300 font-medium">Total:</span>
          <span className="text-emerald-400 font-mono font-bold">
            ${totalAmount.toFixed(2)}
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
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-lime-500 transition-all"
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
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-lime-500 transition-all"
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
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-lime-500 transition-all"
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
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-lime-500 transition-all"
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
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-lime-500 transition-all"
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
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-lime-500 transition-all"
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
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-400">Payment Method</label>
              <button
                type="button"
                onClick={() => setUseMultiPayment(!useMultiPayment)}
                className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
              >
                {useMultiPayment ? "Single Payment" : "Split Payment"}
              </button>
            </div>
            {!useMultiPayment ? (
              <select
                value={paidByMethod}
                onChange={(e) => setPaidByMethod(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-lime-500"
              >
                {drawerAffectingMethods.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label}
                  </option>
                ))}
              </select>
            ) : (
              <MultiPaymentInput
                totalAmount={totalAmount}
                currency="USD"
                onChange={setPaymentLines}
                requiresClientForDebt={true}
                hasClient={
                  serviceType === "SEND"
                    ? !!(senderName || senderPhone)
                    : !!(receiverName || receiverPhone)
                }
                showPmFee={false}
                paymentMethods={drawerAffectingMethods}
                currencies={[
                  { code: "USD", symbol: "$" },
                  { code: "LBP", symbol: "LBP" },
                ]}
                exchangeRate={exchangeRate}
              />
            )}
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
                  ? "bg-lime-600 hover:bg-lime-500 shadow-lg shadow-lime-500/20"
                  : "bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-500/20"
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
          onClose={() => setShowHistory(false)}
          onRefresh={loadFinancialData}
          formatAmount={formatAmount}
        />
      )}
    </div>
  );
}
