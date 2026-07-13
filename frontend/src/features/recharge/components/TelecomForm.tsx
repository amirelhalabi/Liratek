import { useState, useEffect } from "react";
import logger from "@/utils/logger";
import { Phone, User, Search, X, CreditCard } from "lucide-react";
import {
  ServiceTypeTabs,
  type ServiceTypeOption,
  useApi,
  hasNewClientInfo,
  type PaymentLine,
  Select,
} from "@liratek/ui";
import type {
  FinancialTransaction,
  ProviderConfig,
  RechargeType,
} from "../types";
import { TELECOM_SERVICE_TYPES, ALFA_GIFT_TIERS } from "../types";
import { HistoryModal } from "./HistoryModal";
import { useSellRate } from "@/hooks/useSellRate";
import { PaymentSheet } from "./PaymentSheet";
import { CardGridPayView, type CardGridPayItem } from "./CardGridPayView";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { convertLBPToUSD } from "@/utils/paymentUtils";
import { useSession } from "@/features/sessions/context/SessionContext";

interface TelecomFormProps {
  isMTC: boolean;
  rechargeType: RechargeType;
  setRechargeType: (type: RechargeType) => void;
  isSubmitting: boolean;
  handleQuickAmount: (val: number) => void;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  rechargeHistory: FinancialTransaction[];
  marginAlertThreshold?: number;
  telecomAmount: string;
  setTelecomAmount: (val: string) => void;
  /** Sets the amount AND re-derives the suggested client price (like Quick Amount). */
  onTelecomAmountChange: (val: string) => void;
  telecomPrice: string;
  setTelecomPrice: (val: string) => void;
  phoneNumber: string;
  setPhoneNumber: (val: string) => void;
  paidBy: string;
  setPaidBy: (val: string) => void;
  methods: { code: string; label: string }[];
  showClientSearch: boolean;
  setShowClientSearch: (val: boolean) => void;
  telecomClientId: number | null;
  setTelecomClientId: (val: number | null) => void;
  telecomClientName: string;
  setTelecomClientName: (val: string) => void;
  telecomClientPhone: string;
  setTelecomClientPhone: (val: string) => void;
  searchClients: (query: string) => void;
  clientSearchResults: any[];
  selectClient: (client: any) => void;
  activeProvider: string | null;
  activeConfig: ProviderConfig | undefined;
  handleTelecomSubmit: () => void;
  giftTierKey: keyof typeof ALFA_GIFT_TIERS | "";
  setGiftTierKey: (val: keyof typeof ALFA_GIFT_TIERS | "") => void;
  giftAmountUsd: string;
  setGiftAmountUsd: (val: string) => void;
  giftPriceLbp: string;
  setGiftPriceLbp: (val: string) => void;
  giftCostLbp: string;
  setGiftCostLbp: (val: string) => void;
  handleAlfaGiftSubmit: () => void;
  paymentLines: PaymentLine[];
  setPaymentLines: (lines: PaymentLine[]) => void;
  clientName: string;
  setClientName: (val: string) => void;
  alfaCreditCostRate?: number;
  telecomDaysCostUsd: string;
  setTelecomDaysCostUsd: (val: string) => void;
  /** Admin sees cost + profit margin on gift/voucher cards. */
  isAdmin?: boolean;
  onDiscountChange?: (discount: number) => void;
  onReturnChange?: (returnLegs: PaymentLine[]) => void;
  /** T3 keep-change opt-in (plumbed to PaymentSheet → MultiPaymentInput). */
  onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
  /** Called after a successful metadata edit to reload the history list */
  onRefreshHistory?: () => void;
  onTransactionTimeChange?: (time: string | undefined) => void;
}

export function TelecomForm({
  isMTC,
  rechargeType,
  setRechargeType,
  isSubmitting,
  handleQuickAmount,
  showHistory,
  setShowHistory,
  rechargeHistory,
  marginAlertThreshold = 100000,
  telecomAmount,
  setTelecomAmount: _setTelecomAmount,
  onTelecomAmountChange,
  telecomPrice,
  setTelecomPrice,
  phoneNumber,
  setPhoneNumber,
  paidBy: _paidBy,
  setPaidBy,
  methods,
  showClientSearch,
  setShowClientSearch,
  telecomClientId,
  setTelecomClientId,
  telecomClientName,
  setTelecomClientName,
  telecomClientPhone,
  setTelecomClientPhone,
  searchClients,
  clientSearchResults,
  selectClient,
  activeProvider: _activeProvider,
  activeConfig: _activeConfig,
  handleTelecomSubmit,
  giftTierKey,
  setGiftTierKey,
  giftAmountUsd,
  setGiftAmountUsd,
  giftPriceLbp,
  setGiftPriceLbp,
  giftCostLbp,
  setGiftCostLbp,
  handleAlfaGiftSubmit,
  paymentLines,
  setPaymentLines,
  clientName,
  setClientName,
  alfaCreditCostRate = 85000,
  telecomDaysCostUsd,
  setTelecomDaysCostUsd,
  isAdmin = false,
  onDiscountChange,
  onReturnChange,
  onKeptChange,
  onRefreshHistory,
  onTransactionTimeChange,
}: TelecomFormProps) {
  const api = useApi();
  const { activeSession } = useSession();
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState("CASH");
  const [daysPriceCurrency, setDaysPriceCurrency] = useState<"USD" | "LBP">(
    "USD",
  );
  const [daysPriceUsdInput, setDaysPriceUsdInput] = useState("");
  // Payments use the BUY rate (owner decision 2026-07-06): the MultiPaymentInput
  // converts LBP↔USD at buyRate. (The tier-price `sellRate` local below is a
  // separate pricing rate and is unaffected.)
  const { buyRate: exchangeRate } = useSellRate();
  const [costRate, setCostRate] = useState(85000);
  const [discount, setDiscount] = useState(0);
  void discount; // surfaced to parent via onDiscountChange; kept locally for future use
  const [sheetOpen, setSheetOpen] = useState(false);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();

  // Fetch the Alfa credit cost rate on mount (the USD→LBP rate now comes from
  // the shared useSellRate hook above).
  useEffect(() => {
    const loadCostRate = async () => {
      try {
        const settings = await api.getAllSettings();
        const settingsMap = new Map(
          settings.map((s: { key_name: string; value: string }) => [
            s.key_name,
            s.value,
          ]),
        );
        const costVal = Number(settingsMap.get("alfa_credit_cost_lbp"));
        if (costVal > 0) setCostRate(costVal);
      } catch (error) {
        logger.error("Failed to load Alfa credit cost rate:", error);
      }
    };
    loadCostRate();
  }, [api]);

  // Reset Days price currency toggle when switching tabs
  useEffect(() => {
    setDaysPriceCurrency("USD");
    setDaysPriceUsdInput("");
  }, [rechargeType]);

  const handleDiscountChange = (d: number) => {
    setDiscount(d);
    onDiscountChange?.(d);
  };

  // When the user types both a name and phone for a brand-new client (no
  // existing client ID), promote CUSTOMER_ACCOUNT to the active payment method
  // so they can tap "Pay" immediately — the parent will create the client on
  // submit. Mirrors the existing select-from-search auto-switch.
  useEffect(() => {
    const newClientReady = hasNewClientInfo({
      clientId: telecomClientId,
      name: telecomClientName,
      phone: telecomClientPhone,
    });
    if (newClientReady && initialPaymentMethod !== "CUSTOMER_ACCOUNT") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitialPaymentMethod("CUSTOMER_ACCOUNT");

      setPaymentInputKey((k) => k + 1);
    }
  }, [
    telecomClientId,
    telecomClientName,
    telecomClientPhone,
    initialPaymentMethod,
  ]);

  // Required for API compatibility but not used in this component
  void _paidBy;
  void clientName;
  void setClientName;
  // Gift price/value/cost are derived into giftItems and written via their
  // setters in onSelect; the raw prop values are no longer read directly here.
  void giftAmountUsd;
  void giftPriceLbp;
  void giftCostLbp;

  const accent = isMTC ? "cyan" : "red";

  // Normalized card models for the shared CardGridPayView. Only one of these is
  // rendered at a time (gift for Alfa, vouchers for MTC).
  const giftItems: CardGridPayItem[] = Object.entries(ALFA_GIFT_TIERS).map(
    ([key, tier]) => {
      const sellRate =
        Number(localStorage.getItem("alfa_credit_sell_rate_lbp") || "100000") /
        1000;
      return {
        id: key,
        label: tier.label,
        valueUsd: tier.usd,
        costLbp: tier.usd * costRate,
        sellLbp: Math.round(tier.usd * sellRate * 1000),
      };
    },
  );

  const handleCardTransactionTime = (t: string | undefined) => {
    setTransactionTime(t);
    onTransactionTimeChange?.(t);
  };

  const handleCardPaymentChange = (lines: PaymentLine[]) => {
    setPaymentLines(lines);
    if (lines.length === 1) setPaidBy(lines[0].method);
  };

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">
      {/* Service Type Tabs */}
      <ServiceTypeTabs
        options={
          TELECOM_SERVICE_TYPES.filter((svc) => {
            // Hide Alfa Gift for MTC
            if (svc.id === "ALFA_GIFT" && isMTC) return false;
            return true;
          }) as ServiceTypeOption[]
        }
        value={rechargeType}
        onChange={(val) => setRechargeType(val as RechargeType)}
        accentColor={isMTC ? "cyan" : "red"}
        size="sm"
      />

      {rechargeType === "ALFA_GIFT" ? (
        /* Alfa Gift — shared card-grid pay flow */
        <CardGridPayView
          heading="Select Alfa Gift"
          items={giftItems}
          selectedId={giftTierKey || null}
          onSelect={(item) => {
            setGiftTierKey(item.id as keyof typeof ALFA_GIFT_TIERS);
            setGiftAmountUsd(String(item.valueUsd ?? ""));
            setGiftPriceLbp(String(item.sellLbp));
            setGiftCostLbp(String(item.costLbp));
          }}
          accent={accent}
          showProfit={isAdmin}
          sheetTitle="Alfa Gift Payment"
          onConfirm={handleAlfaGiftSubmit}
          isSubmitting={isSubmitting}
          paymentMethods={methods}
          clientId={telecomClientId}
          exchangeRate={exchangeRate}
          onPaymentChange={handleCardPaymentChange}
          {...(onReturnChange ? { onReturnChange } : {})}
          onDiscountChange={handleDiscountChange}
          clientName={telecomClientName}
          onClientNameChange={setTelecomClientName}
          transactionTime={transactionTime}
          onTransactionTimeChange={handleCardTransactionTime}
        />
      ) : (
        /* Recharge Form */
        <div className="flex flex-col gap-3 flex-1">
          <div className="grid grid-cols-12 gap-5 flex-1">
            <div className="col-span-7 bg-slate-800 rounded-2xl border border-slate-700/50 p-6 flex flex-col gap-6">
              {rechargeType === "CREDIT_TRANSFER" && (
                <div>
                  <label
                    htmlFor="telecom-phone"
                    className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider flex items-center gap-1.5"
                  >
                    <Phone size={12} />
                    Phone Number
                  </label>
                  <div className="relative">
                    <div
                      className={`absolute left-0 top-0 bottom-0 flex items-center pl-4 pr-3 rounded-l-xl bg-${accent}-500/10 border-r border-slate-700`}
                    >
                      <span className={`text-${accent}-400 font-bold text-sm`}>
                        +961
                      </span>
                    </div>
                    <input
                      id="telecom-phone"
                      type="text"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className={`w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-20 pr-4 py-4 text-2xl font-bold text-white focus:outline-none focus:border-${accent}-500 focus:ring-1 focus:ring-${accent}-500/30 transition-all tracking-widest font-mono`}
                      placeholder="XX XXX XXX"
                      maxLength={8}
                    />
                  </div>
                </div>
              )}
              {rechargeType === "CREDIT_TRANSFER" && (
                <div className="flex-1">
                  <span
                    aria-hidden="true"
                    className="block text-xs font-medium text-slate-500 mb-3 uppercase tracking-wider"
                  >
                    Quick Amount
                  </span>
                  <div className="grid grid-cols-4 gap-3">
                    {[3, 6, 9, 12, 15, 18, 21, 30].map((amt) => (
                      <button
                        key={amt}
                        onClick={() => handleQuickAmount(amt)}
                        className={`py-4 rounded-xl font-bold text-lg transition-all border ${
                          telecomAmount === amt.toString()
                            ? `bg-${accent}-500/15 text-${accent}-400 border-${accent}-500/40 shadow-lg`
                            : "bg-slate-900/50 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
                        }`}
                      >
                        ${amt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {rechargeType === "DAYS" && (
                <div className="flex-1">
                  <span
                    aria-hidden="true"
                    className="block text-xs font-medium text-slate-500 mb-3 uppercase tracking-wider"
                  >
                    Quick Days
                  </span>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { days: 10, label: "10d" },
                      { days: 20, label: "20d" },
                      { days: 30, label: "1mo" },
                      { days: 60, label: "2mo" },
                      { days: 90, label: "3mo" },
                      { days: 120, label: "4mo" },
                      { days: 180, label: "6mo" },
                      { days: 360, label: "12mo" },
                    ].map(({ days, label }) => (
                      <button
                        key={days}
                        onClick={() => handleQuickAmount(days)}
                        className={`py-4 rounded-xl font-bold text-base transition-all border ${
                          telecomAmount === days.toString()
                            ? `bg-${accent}-500/15 text-${accent}-400 border-${accent}-500/40 shadow-lg`
                            : "bg-slate-900/50 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="col-span-5 bg-slate-800 rounded-2xl border border-slate-700/50 p-6 flex flex-col gap-5">
              <div>
                <label
                  htmlFor="telecom-amount"
                  className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider"
                >
                  {rechargeType === "DAYS" ? "Days" : "Amount / Value"}
                </label>
                <div className="relative">
                  {rechargeType !== "DAYS" && (
                    <span
                      className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold text-${accent}-400`}
                    >
                      $
                    </span>
                  )}
                  <input
                    id="telecom-amount"
                    type="number"
                    value={telecomAmount}
                    onChange={(e) => onTelecomAmountChange(e.target.value)}
                    className={`w-full bg-slate-900/80 border border-slate-600 rounded-xl ${rechargeType !== "DAYS" ? "pl-9" : "pl-4"} pr-4 py-3 text-white font-bold focus:outline-none focus:border-${accent}-500 focus:ring-1 focus:ring-${accent}-500/30 transition-all`}
                    placeholder={rechargeType === "DAYS" ? "0" : "0.00"}
                  />
                </div>
              </div>

              {/* Cost field — manual entry for Days type */}
              {rechargeType === "DAYS" && (
                <div>
                  <label
                    htmlFor="telecom-days-cost"
                    className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider"
                  >
                    Cost ($)
                  </label>
                  <div className="relative mb-1.5">
                    <span
                      className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold text-${accent}-400`}
                    >
                      $
                    </span>
                    <input
                      id="telecom-days-cost"
                      type="number"
                      value={telecomDaysCostUsd}
                      onChange={(e) => setTelecomDaysCostUsd(e.target.value)}
                      className={`w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-9 pr-4 py-3 text-white font-bold focus:outline-none focus:border-${accent}-500 focus:ring-1 focus:ring-${accent}-500/30 transition-all`}
                      placeholder="0.00"
                      min="0"
                      step="0.1"
                    />
                  </div>
                  <div className="text-xs text-slate-500 font-mono pl-1">
                    {parseFloat(telecomDaysCostUsd) > 0
                      ? `≈ ${(parseFloat(telecomDaysCostUsd) * alfaCreditCostRate).toLocaleString()} LBP`
                      : ""}
                  </div>
                </div>
              )}

              {/* Dual-currency price display */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Price to Client
                  </label>
                  {rechargeType === "DAYS" && (
                    <div className="flex items-center gap-1 bg-slate-900 rounded-lg border border-slate-600 p-0.5">
                      {(["USD", "LBP"] as const).map((cur) => (
                        <button
                          key={cur}
                          type="button"
                          onClick={() => {
                            if (cur === daysPriceCurrency) return;
                            setDaysPriceCurrency(cur);
                            setDaysPriceUsdInput("");
                            setTelecomPrice("");
                          }}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                            daysPriceCurrency === cur
                              ? `bg-${accent}-600 text-white`
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          {cur}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {rechargeType === "DAYS" && daysPriceCurrency === "USD" ? (
                  <>
                    <div className="relative mb-1.5">
                      <span
                        className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold text-${accent}-400`}
                      >
                        $
                      </span>
                      <input
                        id="telecom-price"
                        type="number"
                        value={daysPriceUsdInput}
                        onChange={(e) => {
                          setDaysPriceUsdInput(e.target.value);
                          const num = parseFloat(e.target.value);
                          setTelecomPrice(
                            num > 0 ? (num * exchangeRate).toString() : "",
                          );
                        }}
                        className={`w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-9 pr-4 py-3 text-white font-bold focus:outline-none focus:border-${accent}-500 focus:ring-1 focus:ring-${accent}-500/30 transition-all`}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="text-xs text-slate-500 font-mono pl-1">
                      {parseFloat(daysPriceUsdInput) > 0
                        ? `≈ ${(parseFloat(daysPriceUsdInput) * exchangeRate).toLocaleString()} LBP`
                        : ""}
                    </div>
                  </>
                ) : (
                  <>
                    {/* LBP field — editable */}
                    <div className="relative mb-2">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-emerald-400 text-xs">
                        LBP
                      </span>
                      <input
                        id="telecom-price"
                        type="text"
                        inputMode="decimal"
                        value={
                          telecomPrice
                            ? Number(telecomPrice).toLocaleString()
                            : ""
                        }
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/,/g, "");
                          if (/^[0-9]*\.?[0-9]*$/.test(cleaned)) {
                            setTelecomPrice(cleaned);
                          }
                        }}
                        className="w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-14 pr-4 py-3 text-emerald-400 font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-all"
                        placeholder="0"
                      />
                    </div>
                    {/* USD equivalent — read-only */}
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xs">
                        USD
                      </span>
                      <div className="w-full bg-slate-900/40 border border-slate-700/50 rounded-xl pl-14 pr-4 py-3 text-slate-300 font-bold font-mono text-sm select-none">
                        {telecomPrice && exchangeRate > 0
                          ? `$${convertLBPToUSD(parseFloat(telecomPrice), exchangeRate).toFixed(2)}`
                          : "$0.00"}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {telecomPrice &&
                (rechargeType === "DAYS"
                  ? parseFloat(telecomDaysCostUsd) > 0
                  : !!telecomAmount) && (
                  <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/50">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-400">Profit</span>
                      <span
                        className={`font-bold font-mono ${
                          parseFloat(telecomPrice) -
                            (rechargeType === "DAYS"
                              ? parseFloat(telecomDaysCostUsd) *
                                alfaCreditCostRate
                              : parseFloat(telecomAmount) *
                                alfaCreditCostRate) >=
                          0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {(
                          parseFloat(telecomPrice || "0") -
                          (rechargeType === "DAYS"
                            ? parseFloat(telecomDaysCostUsd || "0") *
                              alfaCreditCostRate
                            : parseFloat(telecomAmount || "0") *
                              alfaCreditCostRate)
                        ).toLocaleString()}{" "}
                        LBP
                      </span>
                    </div>
                  </div>
                )}

              {/* Payment method dropdown — quick inline selection */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">
                  Payment Method
                </label>
                <Select
                  value={initialPaymentMethod}
                  onChange={(v) => {
                    setInitialPaymentMethod(v);
                    setPaymentInputKey((k) => k + 1);
                    setPaidBy(v);
                  }}
                  options={methods.map((m) => ({
                    value: m.code,
                    label: m.label,
                  }))}
                  buttonClassName={`w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-4 pr-10 py-3 text-white font-medium focus:outline-none focus:border-${accent}-500 focus:ring-1 focus:ring-${accent}-500/30 transition-all cursor-pointer`}
                />
              </div>

              {/* Payment Sheet */}
              <PaymentSheet
                open={sheetOpen}
                onClose={() => setSheetOpen(false)}
                onConfirm={handleTelecomSubmit}
                isSubmitting={isSubmitting}
                title={`${isMTC ? "MTC" : "Alfa"} ${rechargeType === "DAYS" ? "Days" : "Credit Transfer"}`}
                accentColor={`bg-${accent}-600 hover:bg-${accent}-500 text-white`}
                totalAmount={
                  telecomPrice
                    ? parseFloat(telecomPrice)
                    : rechargeType === "DAYS"
                      ? 0
                      : parseFloat(telecomAmount || "0") * alfaCreditCostRate
                }
                totalAmountCurrency="LBP"
                currency="LBP"
                paymentMethods={methods}
                clientId={telecomClientId}
                fetchClientVouchers={fetchClientVouchers}
                exchangeRate={exchangeRate}
                showDiscount={true}
                maxDiscount={Math.max(
                  0,
                  (telecomPrice ? parseFloat(telecomPrice) : 0) -
                    (rechargeType === "DAYS"
                      ? parseFloat(telecomDaysCostUsd || "0") *
                        alfaCreditCostRate
                      : parseFloat(telecomAmount || "0") * alfaCreditCostRate),
                )}
                onPaymentChange={(lines) => {
                  setPaymentLines(lines);
                  if (lines.length === 1) {
                    setPaidBy(lines[0].method);
                  }
                }}
                onDiscountChange={handleDiscountChange}
                {...(onReturnChange ? { onReturnChange } : {})}
                {...(onKeptChange ? { onKeptChange } : {})}
                hasClient={!!telecomClientId}
                paymentInputKey={paymentInputKey}
                initialPaymentMethod={initialPaymentMethod}
                summary={[
                  {
                    label: rechargeType === "DAYS" ? "Days" : "Amount",
                    value:
                      rechargeType === "DAYS"
                        ? `${telecomAmount || "0"} days`
                        : `$${telecomAmount || "0"}`,
                  },
                  {
                    label: "Price",
                    value: `${(telecomPrice ? parseFloat(telecomPrice) : parseFloat(telecomAmount || "0") * alfaCreditCostRate).toLocaleString()} LBP`,
                    color: "text-emerald-400",
                  },
                ]}
              >
                {/* Client selector - always visible; auto-selects CUSTOMER_ACCOUNT when a registered client is picked or a new name+phone is entered */}
                <div className="relative">
                  <label
                    htmlFor="telecom-debt-client"
                    className={`block text-xs font-medium mb-2 uppercase tracking-wider flex items-center gap-1.5 ${
                      paymentLines.some((l) => l.method === "CUSTOMER_ACCOUNT")
                        ? "text-orange-400"
                        : "text-slate-400"
                    }`}
                  >
                    <User size={12} />
                    {paymentLines.some((l) => l.method === "CUSTOMER_ACCOUNT")
                      ? "Client (required for debt)"
                      : "Client (optional)"}
                  </label>
                  {telecomClientId ? (
                    <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3">
                      <User size={16} className="text-orange-400" />
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium truncate">
                          {telecomClientName}
                        </div>
                        {telecomClientPhone && (
                          <div className="text-xs text-orange-300/80 font-mono truncate">
                            {telecomClientPhone}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setTelecomClientId(null);
                          setTelecomClientName("");
                          setTelecomClientPhone("");
                        }}
                        className="text-slate-400 hover:text-white transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                          <Search size={16} />
                        </div>
                        <input
                          type="text"
                          value={telecomClientName}
                          onChange={(e) => {
                            setTelecomClientName(e.target.value);
                            setShowClientSearch(true);
                            searchClients(e.target.value);
                          }}
                          onFocus={() => {
                            if (telecomClientName.length >= 2) {
                              setShowClientSearch(true);
                              searchClients(telecomClientName);
                            }
                          }}
                          className="w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                          placeholder="Search client by name..."
                        />
                        {showClientSearch && clientSearchResults.length > 0 && (
                          <div className="absolute z-10 top-full mt-1 w-full bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-h-48 overflow-auto">
                            {clientSearchResults.map((c: any) => (
                              <button
                                key={c.id}
                                onClick={() => {
                                  selectClient(c);
                                  setInitialPaymentMethod("CUSTOMER_ACCOUNT");
                                  setPaymentInputKey((k) => k + 1);
                                }}
                                className="w-full text-left px-4 py-2.5 hover:bg-slate-700 text-sm text-white transition-colors first:rounded-t-xl last:rounded-b-xl flex items-center justify-between gap-2"
                              >
                                <span className="truncate">
                                  {c.full_name || c.name}
                                </span>
                                {c.phone_number && (
                                  <span className="text-xs text-slate-400 font-mono shrink-0">
                                    {c.phone_number}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                          <Phone size={14} />
                        </div>
                        <input
                          type="tel"
                          inputMode="numeric"
                          value={telecomClientPhone}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTelecomClientPhone(val);
                            // Search by phone too — backend matches name OR phone
                            if (val.trim().length >= 3) {
                              setShowClientSearch(true);
                              searchClients(val.trim());
                            }
                          }}
                          className="w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-10 pr-4 py-3 text-white font-mono focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                          placeholder="Phone number (registers a new client)"
                        />
                      </div>
                      {telecomClientName.trim() &&
                        telecomClientPhone.trim() &&
                        !telecomClientId && (
                          <p className="text-xs text-orange-300/80 px-1">
                            New client will be created on confirm.
                          </p>
                        )}
                    </div>
                  )}
                </div>
                <TransactionTimeOverride
                  value={transactionTime}
                  onChange={(t) => {
                    setTransactionTime(t);
                    onTransactionTimeChange?.(t);
                  }}
                />
              </PaymentSheet>
            </div>
          </div>

          {/* Bottom bar — amount summary + Proceed to Pay */}
          <div className="flex items-center justify-end gap-3 pt-1">
            {telecomAmount && (
              <div className="text-right leading-tight">
                {telecomPrice && (
                  <div className="text-xs text-emerald-400 font-mono font-semibold">
                    {Number(telecomPrice).toLocaleString()} LBP
                    {exchangeRate > 0 && (
                      <span className="text-slate-400 ml-1.5">
                        ($
                        {convertLBPToUSD(
                          parseFloat(telecomPrice),
                          exchangeRate,
                        ).toFixed(2)}
                        )
                      </span>
                    )}
                  </div>
                )}
                <div
                  className={`text-xs text-${accent}-400 font-mono font-semibold`}
                >
                  {rechargeType === "DAYS"
                    ? `${telecomAmount} days`
                    : `$${telecomAmount}`}
                </div>
              </div>
            )}
            <button
              onClick={() => {
                // Session mode: add to cart directly (basket owns the payment),
                // skipping the PaymentSheet. Non-session: open the PaymentSheet.
                if (activeSession) {
                  handleTelecomSubmit();
                } else {
                  setSheetOpen(true);
                }
              }}
              disabled={
                isSubmitting ||
                !telecomAmount ||
                (rechargeType === "DAYS" &&
                  (!(parseFloat(telecomDaysCostUsd) > 0) || !telecomPrice))
              }
              className={`px-4 py-2.5 rounded-lg font-bold text-sm transition-all whitespace-nowrap flex items-center gap-1.5 ${
                isSubmitting ||
                !telecomAmount ||
                (rechargeType === "DAYS" &&
                  (!(parseFloat(telecomDaysCostUsd) > 0) || !telecomPrice))
                  ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                  : `bg-${accent}-600 hover:bg-${accent}-500 text-white shadow-lg shadow-${accent}-500/20`
              }`}
            >
              <CreditCard size={15} />
              {activeSession ? "Add to Cart" : "Proceed to Pay"}
            </button>
          </div>
        </div>
      )}

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          transactions={rechargeHistory}
          provider={isMTC ? "MTC" : "Alfa"}
          amountLabel="Credits"
          amountAlwaysUsd
          marginAlertThreshold={marginAlertThreshold}
          onClose={() => setShowHistory(false)}
          onRefresh={onRefreshHistory ?? (() => {})}
          formatAmount={(val, currency) =>
            currency === "LBP"
              ? `${val.toLocaleString()} LBP`
              : `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          }
          onUpdateMetadata={async (id, data) => {
            const result = await window.api.recharge.updateMetadata({
              id,
              ...data,
            });
            if (result.success) {
              onRefreshHistory?.();
            }
            return result;
          }}
        />
      )}
    </div>
  );
}
