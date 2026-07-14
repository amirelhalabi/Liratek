import { useState, useEffect, memo } from "react";
import { User, Phone } from "lucide-react";
import {
  useApi,
  ServiceTypeTabs,
  DecimalInput,
  hasNewClientInfo,
  Select,
} from "@liratek/ui";
import { PaymentSheet } from "./PaymentSheet";
import { useSession } from "@/features/sessions/context/SessionContext";
import type { FinancialTransaction } from "../types";
import { HistoryModal } from "./HistoryModal";
import { useSellRate } from "@/hooks/useSellRate";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import logger from "@/utils/logger";
import { useSaveAsClient } from "@/shared/hooks/useSaveAsClient";
import { SaveAsClientCheckbox } from "@/shared/components/SaveAsClientCheckbox";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import { PartnerSelector } from "@/features/partners/components/PartnerSelector";
import { ensureRechargeClient } from "../utils/ensureClient";
import { calculateOmtWhishAppFees } from "../utils/omtWhishAppFees";
import { toCamelLegs } from "@/utils/paymentUtils";

type ServiceType = "SEND" | "RECEIVE";
type ProviderKey = "OMT_APP" | "WHISH_APP";

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

function OmtWhishAppTransferFormInner({
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
  const { methods: allPaymentMethods, drawerAffectingMethods } =
    usePaymentMethods();
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
  const { sellRate, buyRate } = useSellRate();
  // SEND is Money IN (customer pays us) → sell rate. RECEIVE is Money OUT
  // (we pay the customer's cashout) → buy rate; paying out at the sell rate
  // would hand the customer our exchange margin on cross-currency legs.
  const exchangeRate = serviceType === "RECEIVE" ? buyRate : sellRate;
  const [paymentLines, setPaymentLines] = useState<any[]>([]);
  const [returnLegs, setReturnLegs] = useState<any[]>([]);
  // T3 keep-change: kept change → financial-service profit stamp.
  const [keptChange, setKeptChange] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);
  const isSplitPayment = paymentLines.length > 1;
  // Forward structured legs whenever the payment is split OR the customer got
  // change back (a return/OUT leg); otherwise single payment + change drops the
  // returned cash so it's never recorded.
  const useStructuredPayments = isSplitPayment || returnLegs.length > 0;
  const [paidByMethod, setPaidByMethod] = useState("CASH");
  const [includingFees, setIncludingFees] = useState(false);
  const [manualFee, setManualFee] = useState("");
  const [discount, setDiscount] = useState(0);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();
  const [clientId, setClientId] = useState<number | null>(null);
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState("CASH");

  // PFT-3b: "for partner" transfer — no walk-in customer, no counter cash.
  // SEND fronts the disbursement via an OUT payment leg (the partner owes
  // exactly what the shop paid out); RECEIVE takes no payment leg at all
  // (the backend credits the app drawer and books the partner CREDIT). This
  // bypasses handleSubmit/PaymentSheet entirely — mirrors TelecomForm's
  // handleForPartnerSubmit (PFT-3a).
  const [forPartner, setForPartner] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(
    null,
  );
  const [isSubmittingPartner, setIsSubmittingPartner] = useState(false);
  const [partnerPayFromMethod, setPartnerPayFromMethod] = useState("CASH");

  // Auto-promote CUSTOMER_ACCOUNT when name+phone are present for a new client
  const activeClientName = serviceType === "SEND" ? senderName : receiverName;
  const activeClientPhone =
    serviceType === "SEND" ? senderPhone : receiverPhone;
  useEffect(() => {
    const newClientReady = hasNewClientInfo({
      clientId,
      name: activeClientName,
      phone: activeClientPhone,
    });
    if (newClientReady && initialPaymentMethod !== "CUSTOMER_ACCOUNT") {
      setInitialPaymentMethod("CUSTOMER_ACCOUNT");
      setPaymentInputKey((k) => k + 1);
    }
  }, [clientId, activeClientName, activeClientPhone, initialPaymentMethod]);

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

  // Autofill sender/receiver from customer session based on service type
  useEffect(() => {
    if (serviceType === "SEND") {
      setSenderName(customerName || "");
      setSenderPhone(customerPhone || "");
      // A2: the receiver fields are hidden in SEND — clear stale values
      setReceiverName("");
      setReceiverPhone("");
    } else {
      setReceiverName(customerName || "");
      setReceiverPhone(customerPhone || "");
      setSenderName("");
      setSenderPhone("");
    }
  }, [serviceType, customerName, customerPhone]);

  // Fee/amount math — see calculateOmtWhishAppFees for the full contract.
  // App-wallet RECEIVE (OMT App or Whish App): customer sends money INTO the
  // shop's wallet, shop pays CASH OUT — walletAmount (the wallet inflow, sent
  // to the API as `data.amount`) and totalAmount (the cash payout) diverge;
  // the shop keeps the entire fee as profit (LEFT_TO_DO.md 2026-07-04).
  const parsedAmount = parseFloat(amount || "0");
  const {
    autoFee,
    providerFee,
    isAppWalletReceive,
    walletAmount,
    totalAmount,
    shopProfit,
  } = calculateOmtWhishAppFees({
    activeProvider,
    serviceType,
    currency,
    parsedAmount,
    manualFee,
    includingFees,
  });

  const handleSubmit = async () => {
    const finalSenderName = senderName.trim();
    const finalSenderPhone = senderPhone.trim();
    const finalReceiverName = receiverName.trim();
    const finalReceiverPhone = receiverPhone.trim();

    const clientResult = await ensureRechargeClient({
      clientId,
      name: activeClientName,
      phone: activeClientPhone,
      paymentLines,
    });
    if (!clientResult.ok) {
      alert(clientResult.error);
      return;
    }
    const resolvedClientId = clientResult.id;
    if (resolvedClientId && resolvedClientId !== clientId) {
      setClientId(resolvedClientId);
    }

    // Save as client if checkbox is checked (only relevant when no auto-creation happened)
    if (!resolvedClientId) {
      await trySaveAsClient();
    }

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

      // Session mode: the basket owns the payment, so the cart item carries NO
      // payment fields (paidByMethod / payments / discount). The Session Checkout
      // modal collects payment once for the whole basket.
      addToSessionCart({
        module: activeProvider === "OMT_APP" ? "omt_app" : "whish_app",
        label,
        amount: serviceType === "SEND" ? totalAmount : -totalAmount,
        currency,
        ipcChannel: "financial:create",
        formData: {
          provider: activeProvider,
          serviceType,
          amount: walletAmount,
          currency,
          commission: shopProfit,
          ...(activeProvider === "OMT_APP" ? { omtFee: providerFee } : {}),
          ...(activeProvider === "WHISH_APP" ? { whishFee: providerFee } : {}),
          clientId: resolvedClientId || undefined,
          clientName: clientLabel,
          referenceNumber: "",
          phoneNumber:
            serviceType === "SEND" ? finalSenderPhone : finalReceiverPhone,
          note: `${serviceType} transfer via ${providerLabel}`,
          includingFees,
        },
      });

      setAmount("");
      setSenderName("");
      setSenderPhone("");
      setReceiverName("");
      setReceiverPhone("");
      setClientId(null);
      setPaymentLines([]);
      setReturnLegs([]);
      setKeptChange(null);
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
        amount: walletAmount,
        currency,
        commission: Math.max(0, shopProfit - discount),
        ...(activeProvider === "OMT_APP" ? { omtFee: providerFee } : {}),
        ...(activeProvider === "WHISH_APP" ? { whishFee: providerFee } : {}),
        clientId: resolvedClientId || undefined,
        clientName:
          serviceType === "SEND" ? finalSenderName : finalReceiverName,
        referenceNumber: "",
        phoneNumber:
          serviceType === "SEND" ? finalSenderPhone : finalReceiverPhone,
        note: `${serviceType} transfer via ${activeProvider === "OMT_APP" ? "OMT App" : "Whish App"}`,
        paidByMethod: paymentMethod,
        payments: useStructuredPayments
          ? toCamelLegs(paymentLines, returnLegs)
          : undefined,
        includingFees,
        // T3 keep-change: kept amounts join the profit stamp.
        ...(keptChange && (keptChange.usd > 0 || keptChange.lbp > 0)
          ? {
              kept_change_usd: keptChange.usd,
              kept_change_lbp: keptChange.lbp,
            }
          : {}),
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
        setClientId(null);
        setPaymentLines([]);
        setReturnLegs([]);
        setKeptChange(null);
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

  // PFT-3b: direct submission for a "for partner" transfer — bypasses
  // handleSubmit (client resolution / save-as-client / session cart) and the
  // PaymentSheet entirely. SEND fronts the disbursement as a single OUT leg
  // (totalAmount = walletAmount + full fee, since includingFees never
  // applies to SEND); RECEIVE sends no payment legs at all — the backend
  // credits the app drawer and books the partner CREDIT (amount − fee).
  const handleForPartnerSubmit = async () => {
    if (!amount || parsedAmount <= 0) return;
    if (!selectedPartnerId) {
      alert("Select a partner for this transfer.");
      return;
    }

    const providerLabel =
      activeProvider === "OMT_APP" ? "OMT App" : "Whish App";

    setIsSubmittingPartner(true);
    try {
      const result = await api.addOMTTransaction({
        provider: activeProvider,
        serviceType,
        amount: walletAmount,
        currency,
        commission: shopProfit,
        ...(activeProvider === "OMT_APP" ? { omtFee: providerFee } : {}),
        ...(activeProvider === "WHISH_APP" ? { whishFee: providerFee } : {}),
        partnerId: selectedPartnerId,
        partnerMode: "FOR" as const,
        payments:
          serviceType === "SEND"
            ? [
                {
                  method: partnerPayFromMethod,
                  currencyCode: currency,
                  amount: totalAmount,
                  direction: "OUT" as const,
                },
              ]
            : [],
        note: `${serviceType} transfer via ${providerLabel}`,
        transaction_time: transactionTime,
      });

      if (!result.success) {
        alert(result.error || "Failed to process partner transfer");
        return;
      }

      setAmount("");
      setManualFee("");
      loadFinancialData();
    } catch (error) {
      logger.error("Partner transfer failed:", error);
      alert("Failed to process partner transfer");
    } finally {
      setIsSubmittingPartner(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">
      {/* Header with SEND/RECEIVE Tabs */}
      <ServiceTypeTabs
        options={[
          { id: "SEND", label: "Send", iconKey: "Send" },
          { id: "RECEIVE", label: "Receive", iconKey: "Package" },
        ]}
        value={serviceType}
        onChange={(val) => setServiceType(val as ServiceType)}
        accentColor={activeProvider === "OMT_APP" ? "amber" : "red"}
        customColor={activeProvider === "OMT_APP" ? "#ffde00" : "#ff0a46"}
        customTextColor={activeProvider === "OMT_APP" ? "black" : "white"}
        size="sm"
      />
      <div className="flex items-center justify-between -mt-3 mb-1">
        <p className="text-xs text-slate-400">
          {serviceType === "SEND"
            ? "Sending transfer from shop to customer"
            : "Shop receiving transfer from customer"}
        </p>
      </div>

      {/* PFT-3b: "For Partner" opt-in — routes the transfer to a selected
          partner's ledger instead of collecting counter cash. Gated behind
          the checkbox (never auto-selected on the page) to avoid the
          previous unconditional-header bug where a single-partner shop
          silently painted "Partner: <name>" on every transaction. */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            data-testid="omt-whish-transfer-for-partner-toggle"
            checked={forPartner}
            onChange={(e) => {
              const checked = e.target.checked;
              setForPartner(checked);
              if (!checked) setSelectedPartnerId(null);
            }}
            className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
          <span className="text-xs text-slate-400">For Partner</span>
        </label>
        {forPartner && (
          <PartnerSelector
            required
            autoSelectSingle
            selectedPartnerId={selectedPartnerId}
            onSelect={setSelectedPartnerId}
            className="mt-2"
          />
        )}
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
          <DecimalInput
            id="transfer-amount"
            value={parseFloat(amount) || 0}
            onChange={(n) => setAmount(n ? String(n) : "")}
            className={`w-full bg-slate-900 border border-slate-700 rounded-lg ${currency === "USD" ? "pl-8" : "pl-4"} pr-14 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all`}
            placeholder={currency === "LBP" ? "0" : "0.00"}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-medium">
            {currency}
          </span>
        </div>
      </div>

      {/* Fee Breakdown — hidden for Whish App SEND (no fees, no profit) and Whish App LBP RECEIVE (no fees) */}
      {!(activeProvider === "WHISH_APP" && serviceType === "SEND") &&
        !(
          activeProvider === "WHISH_APP" &&
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
                <DecimalInput
                  id="transfer-fee"
                  value={parseFloat(manualFee) || 0}
                  onChange={(n) => setManualFee(String(n))}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-8 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
                  placeholder={
                    autoFee > 0 ? autoFee.toFixed(2) + " (auto)" : "0.00"
                  }
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

            {/* App-wallet RECEIVE (OMT App or Whish App): wallet-vs-payout
                breakdown. The "fee included" toggle only applies to Whish
                App — OMT App always charges the fee on top (no UI to net it
                out of the entered amount). */}
            {isAppWalletReceive && (
              <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-3 space-y-2">
                {activeProvider === "WHISH_APP" && (
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
                )}
                {parsedAmount > 0 && (
                  <div className="text-xs space-y-0.5 pl-6 border-l border-slate-600 ml-2">
                    <p className="text-slate-400">
                      Received into wallet:{" "}
                      <span className="text-white font-mono font-medium">
                        ${walletAmount.toFixed(2)}
                      </span>
                    </p>
                    <p className="text-slate-400">
                      Fee:{" "}
                      <span className="text-amber-400 font-mono font-medium">
                        {includingFees ? "-" : "+"}${providerFee.toFixed(2)}
                      </span>
                    </p>
                    <p className="text-slate-400">
                      Customer receives:{" "}
                      <span className="text-emerald-400 font-mono font-medium">
                        ${totalAmount.toFixed(2)}
                      </span>
                    </p>
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

      {/* PFT-3b: a partner transfer has no walk-in customer — the sender/
          receiver capture + save-as-client UI is replaced by a short notice
          (+ a "Paid from" method picker for SEND, which needs an OUT leg). */}
      {forPartner ? (
        <div className="space-y-3">
          {serviceType === "SEND" && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                Paid From
              </label>
              <Select
                value={partnerPayFromMethod}
                onChange={setPartnerPayFromMethod}
                options={drawerAffectingMethods.map((m) => ({
                  value: m.code,
                  label: m.label,
                }))}
                buttonClassName="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500"
              />
            </div>
          )}
          <div
            data-testid="omt-whish-transfer-partner-no-payment-notice"
            className="text-sm text-orange-200 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-4"
          >
            {serviceType === "SEND" ? (
              <>
                No counter payment is collected for a partner transfer. The shop
                disburses{" "}
                <span className="font-bold">${totalAmount.toFixed(2)}</span> via
                the method above; the partner is billed for the full amount,
                settled later on the Partners page.
              </>
            ) : (
              <>
                No payout is made to a walk-in customer. The wallet is credited{" "}
                <span className="font-bold">${walletAmount.toFixed(2)}</span>,
                and the partner&apos;s account is credited accordingly, settled
                later on the Partners page.
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Sender / Receiver Info — only the mode's own party (A2):
            SEND collects the sender, RECEIVE collects the receiver. */}
          <div className="grid grid-cols-2 gap-3">
            {serviceType === "SEND" && (
              <>
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
                    onChange={(v) => {
                      setSenderName(v);
                      if (serviceType === "SEND") setClientId(null);
                    }}
                    onClientSelect={(c) => {
                      setSenderPhone(c.phone_number || "");
                      if (serviceType === "SEND") {
                        setClientId(c.id);
                        setInitialPaymentMethod("CUSTOMER_ACCOUNT");
                        setPaymentInputKey((k) => k + 1);
                      }
                    }}
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
                    onChange={(v) => {
                      setSenderPhone(v);
                      if (serviceType === "SEND") setClientId(null);
                    }}
                    onClientSelect={(c) => {
                      setSenderName(c.full_name);
                      if (serviceType === "SEND") {
                        setClientId(c.id);
                        setInitialPaymentMethod("CUSTOMER_ACCOUNT");
                        setPaymentInputKey((k) => k + 1);
                      }
                    }}
                    searchByPhone
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
                    placeholder="Sender phone"
                  />
                </div>
              </>
            )}
            {serviceType === "RECEIVE" && (
              <>
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
                    onChange={(v) => {
                      setReceiverName(v);
                      if (serviceType === "RECEIVE") setClientId(null);
                    }}
                    onClientSelect={(c) => {
                      setReceiverPhone(c.phone_number || "");
                      if (serviceType === "RECEIVE") {
                        setClientId(c.id);
                        setInitialPaymentMethod("CUSTOMER_ACCOUNT");
                        setPaymentInputKey((k) => k + 1);
                      }
                    }}
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
                    onChange={(v) => {
                      setReceiverPhone(v);
                      if (serviceType === "RECEIVE") setClientId(null);
                    }}
                    onClientSelect={(c) => {
                      setReceiverName(c.full_name);
                      if (serviceType === "RECEIVE") {
                        setClientId(c.id);
                        setInitialPaymentMethod("CUSTOMER_ACCOUNT");
                        setPaymentInputKey((k) => k + 1);
                      }
                    }}
                    searchByPhone
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
                    placeholder="Receiver phone"
                  />
                </div>
              </>
            )}
          </div>
          <SaveAsClientCheckbox
            checked={saveAsClient}
            onChange={setSaveAsClient}
            hidden={!showSaveAsClient}
          />
        </>
      )}

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
              // Validate amount — name/phone are optional for both OMT App and
              // Whish App (persisted when provided).
              if (!amount || parseFloat(amount) <= 0) {
                alert("Please enter a valid amount");
                return;
              }
              // PFT-3b: a partner transfer bypasses handleSubmit/PaymentSheet
              // and the active session's cart entirely — no walk-in
              // customer, no counter cash.
              if (forPartner) {
                handleForPartnerSubmit();
                return;
              }
              // Session mode: add to cart directly (basket owns the payment),
              // skipping the PaymentSheet. Non-session: open the PaymentSheet.
              if (activeSession) {
                handleSubmit();
              } else {
                setShowPaymentSheet(true);
              }
            }}
            disabled={
              !amount ||
              parseFloat(amount) <= 0 ||
              isSubmittingPartner ||
              (forPartner && !selectedPartnerId)
            }
            className={`px-5 py-2.5 rounded-lg font-bold text-sm transition-all ${
              !amount ||
              parseFloat(amount) <= 0 ||
              isSubmittingPartner ||
              (forPartner && !selectedPartnerId)
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : activeProvider === "OMT_APP"
                  ? "bg-[#ffde00] hover:bg-[#ffde00]/80 text-black shadow-lg shadow-[#ffde00]/20"
                  : "bg-[#ff0a46] hover:bg-[#ff0a46]/80 text-white shadow-lg shadow-[#ff0a46]/20"
            }`}
          >
            {forPartner
              ? "Submit to Partner"
              : activeSession
                ? "Add to Cart"
                : "Proceed to Pay"}
          </button>
        </div>
      </div>

      {/* Payment Sheet (Right Drawer) — skipped entirely for a partner
          transfer (PFT-3b): it collects no cash, so the notice above stands
          in for it. */}
      {!forPartner && (
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
            // Client details in the confirm step (A3)
            ...(activeClientName.trim()
              ? [
                  {
                    label: serviceType === "SEND" ? "Sender" : "Receiver",
                    value: activeClientName.trim(),
                  },
                ]
              : []),
            ...(activeClientPhone.trim()
              ? [{ label: "Phone", value: activeClientPhone.trim() }]
              : []),
            isAppWalletReceive
              ? {
                  label: "Received into Wallet",
                  value: `$${walletAmount.toFixed(2)}`,
                }
              : {
                  label: "Transfer Amount",
                  value: `$${parsedAmount.toFixed(2)}`,
                },
            ...(providerFee > 0
              ? [
                  {
                    label: isAppWalletReceive ? "Fee" : "Provider Fee",
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
            {
              label: isAppWalletReceive ? "Customer Receives" : "Total",
              value: `$${totalAmount.toFixed(2)}`,
              ...(isAppWalletReceive ? { color: "text-emerald-400" } : {}),
            },
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
            !!clientId ||
            (!!activeClientName.trim() && !!activeClientPhone.trim())
          }
          paymentInputKey={paymentInputKey}
          initialPaymentMethod={initialPaymentMethod}
          onPaymentChange={(lines) => {
            setPaymentLines(lines);
            if (lines.length === 1) {
              setPaidByMethod(lines[0].method);
            }
          }}
          onReturnChange={setReturnLegs}
          onKeptChange={setKeptChange}
        >
          {(activeClientName.trim() || activeClientPhone.trim()) && (
            <div className="rounded-lg bg-slate-800/60 border border-slate-700/40 p-3 space-y-1">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {serviceType === "SEND" ? "Sender" : "Receiver"} (linked client)
              </div>
              {activeClientName.trim() && (
                <div className="text-sm text-white truncate">
                  {activeClientName}
                </div>
              )}
              {activeClientPhone.trim() && (
                <div className="text-xs font-mono text-slate-300 truncate">
                  {activeClientPhone}
                </div>
              )}
              {activeClientName.trim() &&
                activeClientPhone.trim() &&
                !clientId && (
                  <p className="text-xs text-orange-300/80">
                    New client will be created on confirm.
                  </p>
                )}
            </div>
          )}
        </PaymentSheet>
      )}

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

export const OmtWhishAppTransferForm = memo(OmtWhishAppTransferFormInner);
