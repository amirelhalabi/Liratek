import { useState, useEffect } from "react";
import { Phone, User, Search, X, CreditCard } from "lucide-react";
import {
  ServiceTypeTabs,
  type ServiceTypeOption,
  useApi,
  type PaymentLine,
} from "@liratek/ui";
import type {
  FinancialTransaction,
  ProviderConfig,
  RechargeType,
} from "../types";
import { TELECOM_SERVICE_TYPES, ALFA_GIFT_TIERS } from "../types";
import { HistoryModal } from "./HistoryModal";
import { getExchangeRates } from "@/utils/exchangeRates";
import { PaymentSheet } from "./PaymentSheet";
import { CardGridPayView, type CardGridPayItem } from "./CardGridPayView";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";

interface VoucherItem {
  label: string;
  cost_lbp: number;
  sell_lbp: number;
}

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
  resolveVoucherImage: (provider: string, amount: number) => string | null;
  activeProvider: string | null;
  activeConfig: ProviderConfig | undefined;
  handleTelecomSubmit: () => void;
  giftTierKey: keyof typeof ALFA_GIFT_TIERS | "";
  setGiftTierKey: (val: keyof typeof ALFA_GIFT_TIERS | "") => void;
  giftAmountUsd: string;
  setGiftAmountUsd: (val: string) => void;
  giftPriceLbp: string;
  setGiftPriceLbp: (val: string) => void;
  handleAlfaGiftSubmit: () => void;
  paymentLines: PaymentLine[];
  setPaymentLines: (lines: PaymentLine[]) => void;
  clientName: string;
  setClientName: (val: string) => void;
  voucherItems?: VoucherItem[];
  alfaCreditCostRate?: number;
  /** Admin sees cost + profit margin on gift/voucher cards. */
  isAdmin?: boolean;
  onDiscountChange?: (discount: number) => void;
  onReturnChange?: (returnLegs: PaymentLine[]) => void;
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
  setTelecomAmount,
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
  resolveVoucherImage,
  activeProvider,
  activeConfig,
  handleTelecomSubmit,
  giftTierKey,
  setGiftTierKey,
  giftAmountUsd,
  setGiftAmountUsd,
  giftPriceLbp,
  setGiftPriceLbp,
  handleAlfaGiftSubmit,
  paymentLines,
  setPaymentLines,
  clientName,
  setClientName,
  voucherItems,
  alfaCreditCostRate = 85000,
  isAdmin = false,
  onDiscountChange,
  onReturnChange,
  onRefreshHistory,
  onTransactionTimeChange,
}: TelecomFormProps) {
  const api = useApi();
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState("CASH");
  const [rates, setRates] = useState({ buyRate: 89000, sellRate: 89500 });
  const [costRate, setCostRate] = useState(85000);
  const [discount, setDiscount] = useState(0);
  void discount; // surfaced to parent via onDiscountChange; kept locally for future use
  const [sheetOpen, setSheetOpen] = useState(false);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();

  // Fetch exchange rates and cost rate on mount
  useEffect(() => {
    const loadRates = async () => {
      try {
        const [list, settings] = await Promise.all([
          api.getRates(),
          api.getAllSettings(),
        ]);
        const { buyRate, sellRate } = getExchangeRates(list);
        setRates({ buyRate, sellRate });

        const settingsMap = new Map(
          settings.map((s: { key_name: string; value: string }) => [
            s.key_name,
            s.value,
          ]),
        );
        const costVal = Number(settingsMap.get("alfa_credit_cost_lbp"));
        if (costVal > 0) setCostRate(costVal);
      } catch (error) {
        console.error("Failed to load exchange rates:", error);
      }
    };
    loadRates();
  }, [api]);

  // Alfa Gift is always money IN (customer pays us)
  // So we always use SELL rate
  const exchangeRate = rates.sellRate;

  const handleDiscountChange = (d: number) => {
    setDiscount(d);
    onDiscountChange?.(d);
  };

  // When the user types both a name and phone for a brand-new client (no
  // existing client ID), promote CUSTOMER_ACCOUNT to the active payment method
  // so they can tap "Pay" immediately — the parent will create the client on
  // submit. Mirrors the existing select-from-search auto-switch.
  useEffect(() => {
    const hasNewClientInfo =
      !telecomClientId &&
      telecomClientName.trim().length > 0 &&
      telecomClientPhone.trim().length > 0;
    if (hasNewClientInfo && initialPaymentMethod !== "CUSTOMER_ACCOUNT") {
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
  // Gift price/value are derived into giftItems and written via their setters in
  // onSelect; the raw prop values are no longer read directly here.
  void giftAmountUsd;
  void giftPriceLbp;

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

  const voucherCardItems: CardGridPayItem[] = (voucherItems ?? []).map(
    (item) => ({
      id: item.label,
      label: item.label,
      costLbp: item.cost_lbp,
      sellLbp: item.sell_lbp,
    }),
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
            // Hide Voucher for Alfa (Alfa has Alfa Gift instead)
            if (svc.id === "VOUCHER" && !isMTC) return false;
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
          onDiscountChange={handleDiscountChange}
          clientName={telecomClientName}
          onClientNameChange={setTelecomClientName}
          transactionTime={transactionTime}
          onTransactionTimeChange={handleCardTransactionTime}
        />
      ) : rechargeType === "VOUCHER" && isMTC ? (
        /* MTC Voucher — shared card-grid pay flow */
        <CardGridPayView
          heading="Select MTC Voucher"
          items={voucherCardItems}
          selectedId={telecomAmount || null}
          onSelect={(item) => setTelecomAmount(item.id)}
          accent={accent}
          showProfit={isAdmin}
          sheetTitle="MTC Voucher Payment"
          onConfirm={handleTelecomSubmit}
          isSubmitting={isSubmitting}
          paymentMethods={methods}
          clientId={telecomClientId}
          exchangeRate={exchangeRate}
          onPaymentChange={handleCardPaymentChange}
          onDiscountChange={handleDiscountChange}
          clientName={telecomClientName}
          onClientNameChange={setTelecomClientName}
          transactionTime={transactionTime}
          onTransactionTimeChange={handleCardTransactionTime}
        />
      ) : rechargeType === "VOUCHER" ? (
        /* Voucher Form - Only for MTC (fallback) */
        <div className="bg-slate-800 rounded-2xl border border-slate-700/50 p-6">
          <div className="max-w-lg mx-auto space-y-6">
            <div>
              <label
                htmlFor="telecom-amount"
                className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider"
              >
                Amount / Value
              </label>
              <div className="relative">
                <span
                  className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold text-${accent}-400`}
                >
                  $
                </span>
                <input
                  id="telecom-amount"
                  type="number"
                  value={telecomAmount}
                  onChange={(e) => setTelecomAmount(e.target.value)}
                  className={`w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-9 pr-4 py-3 text-white font-bold focus:outline-none focus:border-${accent}-500 focus:ring-1 focus:ring-${accent}-500/30 transition-all`}
                  placeholder="0.00"
                />
              </div>
            </div>

            <button
              onClick={handleTelecomSubmit}
              disabled={isSubmitting || !telecomAmount}
              className={`w-full py-4 rounded-xl font-bold text-lg text-white shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${
                isSubmitting || !telecomAmount
                  ? "bg-slate-600 cursor-not-allowed"
                  : `bg-${accent}-600 hover:bg-${accent}-500`
              }`}
            >
              {isSubmitting ? "Processing..." : "Confirm Voucher Sale"}
            </button>
          </div>
        </div>
      ) : (
        /* Recharge Form */
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
          </div>
          <div className="col-span-5 bg-slate-800 rounded-2xl border border-slate-700/50 p-6 flex flex-col gap-5">
            <div>
              <label
                htmlFor="telecom-amount"
                className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider"
              >
                Amount / Value
              </label>
              <div className="relative">
                <span
                  className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold text-${accent}-400`}
                >
                  $
                </span>
                <input
                  id="telecom-amount"
                  type="number"
                  value={telecomAmount}
                  onChange={(e) => onTelecomAmountChange(e.target.value)}
                  className={`w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-9 pr-4 py-3 text-white font-bold focus:outline-none focus:border-${accent}-500 focus:ring-1 focus:ring-${accent}-500/30 transition-all`}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="telecom-price"
                className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider"
              >
                Price to Client
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-emerald-400">
                  LBP
                </span>
                <input
                  id="telecom-price"
                  type="text"
                  inputMode="decimal"
                  value={
                    telecomPrice ? Number(telecomPrice).toLocaleString() : ""
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
            </div>
            {telecomAmount && telecomPrice && (
              <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/50">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Profit</span>
                  <span
                    className={`font-bold font-mono ${
                      parseFloat(telecomPrice) -
                        parseFloat(telecomAmount) * alfaCreditCostRate >=
                      0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    {(
                      parseFloat(telecomPrice || "0") -
                      parseFloat(telecomAmount || "0") * alfaCreditCostRate
                    ).toLocaleString()}{" "}
                    LBP
                  </span>
                </div>
              </div>
            )}

            {/* Voucher Image Preview */}
            {rechargeType === ("VOUCHER" as RechargeType) &&
              telecomAmount &&
              (() => {
                const imgPath = resolveVoucherImage(
                  activeProvider || "",
                  parseFloat(telecomAmount),
                );
                if (!imgPath) return null;
                return (
                  <div className="flex items-center gap-3 bg-slate-900/60 rounded-xl p-3 border border-slate-700/50">
                    <img
                      src={imgPath}
                      alt={`${activeConfig?.label} ${telecomAmount} voucher`}
                      className="w-24 h-16 object-contain rounded-lg border border-slate-600 bg-white/5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">
                        {activeConfig?.label} Voucher
                      </p>
                      <p className={`text-sm font-mono ${activeConfig?.color}`}>
                        ${telecomAmount}
                      </p>
                    </div>
                  </div>
                );
              })()}

            <button
              onClick={() => setSheetOpen(true)}
              disabled={isSubmitting || !telecomAmount}
              className={`w-full mt-auto py-4 rounded-xl font-bold text-lg text-white shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${
                isSubmitting || !telecomAmount
                  ? "bg-slate-600 cursor-not-allowed"
                  : `bg-${accent}-600 hover:bg-${accent}-500`
              }`}
            >
              <CreditCard size={20} />
              Proceed to Pay
            </button>

            {/* Payment Sheet */}
            <PaymentSheet
              open={sheetOpen}
              onClose={() => setSheetOpen(false)}
              onConfirm={handleTelecomSubmit}
              isSubmitting={isSubmitting}
              title={`${isMTC ? "MTC" : "Alfa"} ${rechargeType === "CREDIT_TRANSFER" ? "Credit Transfer" : "Voucher"}`}
              accentColor={`bg-${accent}-600 hover:bg-${accent}-500 text-white`}
              totalAmount={
                telecomPrice
                  ? parseFloat(telecomPrice)
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
                  parseFloat(telecomAmount || "0") * alfaCreditCostRate,
              )}
              onPaymentChange={(lines) => {
                setPaymentLines(lines);
                if (lines.length === 1) {
                  setPaidBy(lines[0].method);
                }
              }}
              onDiscountChange={handleDiscountChange}
              {...(onReturnChange ? { onReturnChange } : {})}
              hasClient={!!telecomClientId}
              paymentInputKey={paymentInputKey}
              initialPaymentMethod={initialPaymentMethod}
              summary={[
                { label: "Amount", value: `$${telecomAmount || "0"}` },
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
