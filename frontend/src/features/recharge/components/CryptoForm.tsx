import { useEffect, useState } from "react";
import { User, Hash, Phone } from "lucide-react";
import {
  ServiceTypeTabs,
  DecimalInput,
  hasNewClientInfo,
  useApi,
  appEvents,
  type PaymentLine,
} from "@liratek/ui";
import { PaymentSheet } from "./PaymentSheet";
import { useSession } from "@/features/sessions/context/SessionContext";
import type {
  ProviderConfig,
  BinanceTransaction,
  FinancialTransaction,
} from "../types";
import { HistoryModal } from "./HistoryModal";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import { PartnerSelector } from "@/features/partners/components/PartnerSelector";
import logger from "@/utils/logger";

interface CryptoFormProps {
  activeConfig: ProviderConfig | undefined;
  cryptoType: "SEND" | "RECEIVE";
  setCryptoType: (type: "SEND" | "RECEIVE") => void;
  cryptoAmount: string;
  setCryptoAmount: (val: string) => void;
  cryptoClientName: string;
  setCryptoClientName: (val: string) => void;
  cryptoClientPhone: string;
  setCryptoClientPhone: (val: string) => void;
  cryptoClientId: number | null;
  setCryptoClientId: (val: number | null) => void;
  cryptoDescription: string;
  setCryptoDescription: (val: string) => void;
  cryptoFee: string;
  setCryptoFee: (val: string) => void;
  feeIncluded: boolean;
  setFeeIncluded: (val: boolean) => void;
  handleCryptoSubmit: () => void;
  isSubmitting: boolean;
  binanceTransactions: BinanceTransaction[];
  loadCryptoData: () => void;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  paymentMethods: Array<{ code: string; label: string; drawer_name?: string }>;
  onPaymentLinesChange: (lines: PaymentLine[]) => void;
  onReturnChange?: (returnLegs: PaymentLine[]) => void;
  /** T3 keep-change opt-in (plumbed to PaymentSheet → MultiPaymentInput). */
  onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
  onDiscountChange?: (discount: number) => void;
  exchangeRate: number;
  onTransactionTimeChange?: (time: string | undefined) => void;
}

export function CryptoForm({
  activeConfig,
  cryptoType,
  setCryptoType,
  cryptoAmount,
  setCryptoAmount,
  cryptoClientName,
  setCryptoClientName,
  cryptoClientPhone,
  setCryptoClientPhone,
  cryptoClientId,
  setCryptoClientId,
  cryptoDescription,
  setCryptoDescription,
  cryptoFee,
  setCryptoFee,
  feeIncluded,
  setFeeIncluded,
  handleCryptoSubmit,
  isSubmitting,
  binanceTransactions,
  loadCryptoData,
  showHistory,
  setShowHistory,
  paymentMethods,
  onPaymentLinesChange,
  onReturnChange,
  onKeptChange,
  onDiscountChange,
  exchangeRate,
  onTransactionTimeChange,
}: CryptoFormProps) {
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState("CASH");
  const { activeSession } = useSession();
  const api = useApi();

  // PFT-3b: a "for partner" Binance transaction has NO walk-in customer —
  // it never opens the PaymentSheet and takes no counter payment. The
  // partner owes (SEND) or is owed (RECEIVE) on their ledger, settled later
  // on the Partners page.
  const [forPartner, setForPartner] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(
    null,
  );
  const [isSubmittingPartner, setIsSubmittingPartner] = useState(false);

  // Auto-promote CUSTOMER_ACCOUNT once name+phone are filled for a new client
  useEffect(() => {
    const newClientReady = hasNewClientInfo({
      clientId: cryptoClientId,
      name: cryptoClientName,
      phone: cryptoClientPhone,
    });
    if (newClientReady && initialPaymentMethod !== "CUSTOMER_ACCOUNT") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitialPaymentMethod("CUSTOMER_ACCOUNT");

      setPaymentInputKey((k) => k + 1);
    }
  }, [
    cryptoClientId,
    cryptoClientName,
    cryptoClientPhone,
    initialPaymentMethod,
  ]);

  if (!activeConfig) return null;

  const parsedAmount = parseFloat(cryptoAmount || "0");
  const fee = parseFloat(cryptoFee || "0");

  // feeIncluded: the entered amount already contains the shop fee
  // SEND:    feeIncluded → USDT out = amount-fee, customer pays amount
  //         !feeIncluded → USDT out = amount,     customer pays amount+fee
  // RECEIVE: feeIncluded → USDT in  = amount,     payout = amount-fee
  //         !feeIncluded → USDT in  = amount+fee,  payout = amount
  const sendUsdt = feeIncluded ? parsedAmount - fee : parsedAmount;
  const sendTotal = feeIncluded ? parsedAmount : parsedAmount + fee;
  const payout = feeIncluded ? parsedAmount - fee : parsedAmount;
  const receiveUsdt = feeIncluded ? parsedAmount : parsedAmount + fee;

  // PFT-3b direct submission for a "for partner" Binance transaction —
  // bypasses handleCryptoSubmit (the parent's normal path) and the
  // PaymentSheet entirely. payments is always [] here: the backend moves
  // the Binance/USDT drawer itself and books the partner's USD debt
  // (SEND: amount+fee) or credit (RECEIVE: amount-fee) — see
  // FinancialServiceRepository's isForPartner BINANCE branch.
  const handleForPartnerSubmit = async () => {
    if (!cryptoAmount || parsedAmount <= 0) return;
    if (!selectedPartnerId) {
      appEvents.emit(
        "notification:show",
        "Select a partner for this transaction.",
        "warning",
      );
      return;
    }

    setIsSubmittingPartner(true);
    try {
      const result = await api.addOMTTransaction({
        provider: "BINANCE",
        serviceType: cryptoType,
        amount: cryptoType === "RECEIVE" ? receiveUsdt : sendUsdt,
        currency: "USDT",
        commission: fee,
        payments: [],
        partnerId: selectedPartnerId,
        partnerMode: "FOR" as const,
        note: cryptoDescription || undefined,
        transaction_time: transactionTime,
      });

      if (!result?.success) {
        appEvents.emit(
          "notification:show",
          result?.error || "Failed to process partner transaction",
          "error",
        );
        return;
      }

      setCryptoAmount("");
      setCryptoFee("");
      setCryptoDescription("");
      loadCryptoData();
    } catch (err) {
      logger.error("Failed to submit partner crypto transaction:", err);
      appEvents.emit(
        "notification:show",
        err instanceof Error
          ? err.message
          : "Failed to process partner transaction",
        "error",
      );
    } finally {
      setIsSubmittingPartner(false);
    }
  };

  const submitDisabled =
    !cryptoAmount ||
    parsedAmount <= 0 ||
    isSubmittingPartner ||
    (forPartner && !selectedPartnerId);

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">
      {/* Send / Cash Out Tabs */}
      <ServiceTypeTabs
        options={[
          { id: "SEND", label: "Send Crypto", iconKey: "Send" },
          { id: "RECEIVE", label: "Cash Out", iconKey: "Package" },
        ]}
        value={cryptoType}
        onChange={(val) => setCryptoType(val as "SEND" | "RECEIVE")}
        accentColor="amber"
        customColor="#f59e0b"
        size="sm"
      />
      <p className="text-xs text-slate-400 text-center -mt-3 mb-1">
        {cryptoType === "SEND"
          ? "Sending USDT from shop Binance account"
          : "Receiving USDT to shop Binance account"}
      </p>

      {/* Amount Input */}
      <div>
        <label
          htmlFor="crypto-amount"
          className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
        >
          Amount (USDT)
        </label>
        <div className="relative">
          <DecimalInput
            id="crypto-amount"
            value={parseFloat(cryptoAmount) || 0}
            onChange={(n) => setCryptoAmount(n ? String(n) : "")}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-4 pr-16 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-all"
            placeholder="0.00"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-400 font-bold text-xs">
            USDT
          </span>
        </div>
      </div>

      {/* Fee + Summary */}
      <div className="rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-2">
          Transaction Fee
        </h3>

        <div>
          <label
            htmlFor="crypto-fee"
            className="block text-xs text-slate-400 mb-1"
          >
            Fee Amount — Optional
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
              $
            </span>
            <DecimalInput
              id="crypto-fee"
              value={parseFloat(cryptoFee) || 0}
              onChange={(n) => setCryptoFee(n ? String(n) : "")}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-8 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-all"
              placeholder="0.00"
            />
          </div>
        </div>

        {/* Fee included checkbox */}
        <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={feeIncluded}
            onChange={(e) => setFeeIncluded(e.target.checked)}
            className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-amber-500 focus:ring-amber-500"
          />
          <span className="text-sm font-medium">Fee included in amount</span>
        </label>

        {/* Totals */}
        {cryptoType === "RECEIVE" ? (
          <>
            <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-700/50">
              <span className="text-slate-300 font-medium">USDT Received:</span>
              <span className="text-white font-mono font-bold">
                {receiveUsdt.toFixed(2)} USDT
              </span>
            </div>
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-slate-400">Shop Fee:</span>
              <span
                className={`font-mono font-bold ${fee > 0 ? "text-emerald-400" : "text-slate-500"}`}
              >
                ${fee.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-slate-300 font-medium">
                Customer Payout:
              </span>
              <span className="text-white font-mono font-bold">
                ${payout.toFixed(2)}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-700/50">
              <span className="text-slate-300 font-medium">USDT Sent:</span>
              <span className="text-white font-mono font-bold">
                {sendUsdt.toFixed(2)} USDT
              </span>
            </div>
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-slate-400">Shop Profit (Fee):</span>
              <span
                className={`font-mono font-bold ${fee > 0 ? "text-emerald-400" : "text-slate-500"}`}
              >
                ${fee.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-slate-300 font-medium">Customer Pays:</span>
              <span className="text-white font-mono font-bold">
                ${sendTotal.toFixed(2)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* For Partner opt-in — routes this Binance transaction to a
          partner's ledger instead of a walk-in customer. No counter
          payment is ever collected in this mode (backend rejects any IN
          leg); the PaymentSheet below is replaced with a notice. */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            data-testid="crypto-for-partner-toggle"
            checked={forPartner}
            onChange={(e) => {
              const checked = e.target.checked;
              setForPartner(checked);
              if (!checked) setSelectedPartnerId(null);
            }}
            className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
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

      {/* Client Name + Phone + Description — Client Name/Phone are hidden
          in partner mode (the backend rejects clientId/clientName once
          partnerMode is "FOR"); Notes stays available for a wallet/ref note. */}
      <div
        className={`grid gap-2 ${forPartner ? "grid-cols-1" : "grid-cols-3"}`}
      >
        {!forPartner && (
          <>
            <div>
              <label
                htmlFor="crypto-client"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
              >
                <User size={12} /> Client Name {activeSession && "• Session"}
              </label>
              <ClientAutocompleteInput
                id="crypto-client"
                type="text"
                value={cryptoClientName}
                onChange={(v) => {
                  setCryptoClientName(v);
                  if (!v) {
                    setCryptoClientId(null);
                    setCryptoClientPhone("");
                  }
                }}
                onClientSelect={(c) => {
                  setCryptoClientId(c.id);
                  setCryptoClientPhone(c.phone_number || "");
                  setInitialPaymentMethod("CUSTOMER_ACCOUNT");
                  setPaymentInputKey((k) => k + 1);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-all"
                placeholder="Optional"
              />
            </div>
            <div>
              <label
                htmlFor="crypto-client-phone"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
              >
                <Phone size={12} /> Phone
              </label>
              <ClientAutocompleteInput
                id="crypto-client-phone"
                type="tel"
                value={cryptoClientPhone}
                onChange={(v) => {
                  setCryptoClientPhone(v);
                  if (!v) setCryptoClientId(null);
                }}
                onClientSelect={(c) => {
                  setCryptoClientId(c.id);
                  setCryptoClientName(c.full_name);
                  setInitialPaymentMethod("CUSTOMER_ACCOUNT");
                  setPaymentInputKey((k) => k + 1);
                }}
                searchByPhone
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-amber-500 transition-all"
                placeholder="Registers new client"
              />
            </div>
          </>
        )}
        <div>
          <label
            htmlFor="crypto-description"
            className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
          >
            <Hash size={12} /> Notes
          </label>
          <input
            id="crypto-description"
            type="text"
            value={cryptoDescription}
            onChange={(e) => setCryptoDescription(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-all"
            placeholder="Wallet, reference..."
          />
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      <TransactionTimeOverride
        value={transactionTime}
        onChange={(t) => {
          setTransactionTime(t);
          onTransactionTimeChange?.(t);
        }}
      />

      {/* Sticky Bottom Trigger Bar */}
      <div className="sticky bottom-0 bg-slate-800/95 backdrop-blur-sm rounded-xl border border-slate-700/50 p-3 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="leading-tight">
            <div className="text-xs text-slate-400">
              {cryptoType === "RECEIVE" ? "Payout" : "Total"}:{" "}
              <span className="text-emerald-400 font-mono font-semibold">
                $
                {cryptoType === "RECEIVE"
                  ? payout.toFixed(2)
                  : sendTotal.toFixed(2)}
              </span>
            </div>
            {exchangeRate > 0 && parsedAmount > 0 && (
              <div className="text-xs text-slate-500 font-mono">
                ≈{" "}
                {(
                  (cryptoType === "RECEIVE" ? payout : sendTotal) * exchangeRate
                ).toLocaleString()}{" "}
                LBP
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                // PFT-3b: a partner transaction bypasses the PaymentSheet AND
                // handleCryptoSubmit entirely — no walk-in customer, no
                // counter cash, so it never opens the sheet or adds to the
                // active session's cart either.
                if (forPartner) {
                  handleForPartnerSubmit();
                  return;
                }
                // Session mode: add to cart directly (basket owns the payment),
                // skipping the PaymentSheet. Non-session: open the PaymentSheet.
                if (activeSession) {
                  handleCryptoSubmit();
                } else {
                  setShowPaymentSheet(true);
                }
              }}
              disabled={submitDisabled}
              className={`px-5 py-2.5 rounded-lg font-bold text-sm transition-all ${
                submitDisabled
                  ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                  : "bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-500/20"
              }`}
            >
              {forPartner
                ? "Submit to Partner"
                : cryptoType === "RECEIVE"
                  ? "Confirm Cash Out"
                  : "Proceed to Pay"}
            </button>
          </div>
        </div>
      </div>

      {/* PaymentSheet is skipped entirely for a partner transaction: it
          collects no cash, so show a short notice instead. */}
      {forPartner ? (
        <div
          data-testid="crypto-partner-no-payment-notice"
          className="text-sm text-orange-200 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-4"
        >
          No payment is collected for a partner transaction. The partner will{" "}
          {cryptoType === "RECEIVE" ? "be credited" : "owe"}{" "}
          <span className="font-bold">
            ${(cryptoType === "RECEIVE" ? payout : sendTotal).toFixed(2)}
          </span>{" "}
          on their ledger, settled later on the Partners page.
        </div>
      ) : (
        <PaymentSheet
          open={showPaymentSheet}
          onClose={() => setShowPaymentSheet(false)}
          onConfirm={handleCryptoSubmit}
          isSubmitting={isSubmitting}
          title={
            cryptoType === "RECEIVE" ? "Confirm Cash Out" : "Confirm Payment"
          }
          subtitle={
            cryptoType === "RECEIVE"
              ? `Cash Out — Payout $${payout.toFixed(2)}`
              : `Crypto — $${sendTotal.toFixed(2)}`
          }
          accentColor="bg-amber-600 hover:bg-amber-500 text-white"
          confirmLabel={
            cryptoType === "RECEIVE"
              ? `Confirm Cash Out $${payout.toFixed(2)}`
              : `Pay $${sendTotal.toFixed(2)}`
          }
          summary={
            cryptoType === "RECEIVE"
              ? [
                  ...(cryptoClientName.trim()
                    ? [{ label: "Client", value: cryptoClientName.trim() }]
                    : []),
                  ...(cryptoClientPhone.trim()
                    ? [{ label: "Phone", value: cryptoClientPhone.trim() }]
                    : []),
                  {
                    label: "USDT Received",
                    value: `${receiveUsdt.toFixed(2)} USDT`,
                  },
                  ...(fee > 0
                    ? [
                        {
                          label: "Shop Fee",
                          value: `−$${fee.toFixed(2)}`,
                          color: "text-emerald-400",
                        },
                      ]
                    : []),
                  {
                    label: "Customer Payout",
                    value: `$${payout.toFixed(2)}`,
                  },
                ]
              : [
                  ...(cryptoClientName.trim()
                    ? [{ label: "Client", value: cryptoClientName.trim() }]
                    : []),
                  ...(cryptoClientPhone.trim()
                    ? [{ label: "Phone", value: cryptoClientPhone.trim() }]
                    : []),
                  { label: "USDT Sent", value: `${sendUsdt.toFixed(2)} USDT` },
                  ...(fee > 0
                    ? [
                        {
                          label: "Fee",
                          value: `$${fee.toFixed(2)}`,
                          color: "text-amber-400",
                        },
                      ]
                    : []),
                  {
                    label: "Customer Pays",
                    value: `$${sendTotal.toFixed(2)}`,
                  },
                ]
          }
          totalAmount={cryptoType === "RECEIVE" ? payout : sendTotal}
          currency="USD"
          paymentMethods={paymentMethods}
          exchangeRate={exchangeRate}
          showDiscount={true}
          maxDiscount={fee}
          onDiscountChange={(d) => {
            onDiscountChange?.(d);
          }}
          requiresClientForDebt={true}
          hasClient={
            !!cryptoClientId ||
            (!!cryptoClientName.trim() && !!cryptoClientPhone.trim())
          }
          paymentInputKey={paymentInputKey}
          initialPaymentMethod={initialPaymentMethod}
          onPaymentChange={onPaymentLinesChange}
          {...(onReturnChange ? { onReturnChange } : {})}
          {...(onKeptChange ? { onKeptChange } : {})}
        >
          {cryptoClientName.trim() &&
            cryptoClientPhone.trim() &&
            !cryptoClientId && (
              <p className="text-xs text-orange-300/80 px-1">
                New client will be created on confirm.
              </p>
            )}
        </PaymentSheet>
      )}

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          transactions={binanceTransactions.map((tx) => {
            const result: FinancialTransaction = {
              id: tx.id,
              provider: "BINANCE",
              service_type: tx.type,
              amount: tx.amount,
              currency: tx.currency_code,
              cost: 0,
              commission: tx.commission ?? 0,
              client_name: tx.client_name ?? "",
              note: tx.description ?? "",
              paid_by: tx.paid_by ?? undefined,
              created_at: tx.created_at,
            };
            return result;
          })}
          provider="Binance"
          onClose={() => setShowHistory(false)}
          onRefresh={loadCryptoData}
          profitLabel="Fees"
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
