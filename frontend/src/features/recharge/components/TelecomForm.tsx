import { useState, useEffect } from "react";
import { Phone, Wallet, User, Search, X, CheckCircle } from "lucide-react";
import {
  Select,
  ServiceTypeTabs,
  type ServiceTypeOption,
  useApi,
} from "@liratek/ui";
import type { ProviderConfig, RechargeType } from "../types";
import { TELECOM_SERVICE_TYPES, ALFA_GIFT_TIERS } from "../types";
import { HistoryModal } from "./HistoryModal";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";
import { getExchangeRates } from "@/utils/exchangeRates";

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
  rechargeHistory: any[];
  telecomAmount: string;
  setTelecomAmount: (val: string) => void;
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
  useMultiPayment: boolean;
  setUseMultiPayment: (val: boolean) => void;
  paymentLines: PaymentLine[];
  setPaymentLines: (lines: PaymentLine[]) => void;
  clientName: string;
  setClientName: (val: string) => void;
  voucherItems?: VoucherItem[];
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
  telecomAmount,
  setTelecomAmount,
  telecomPrice,
  setTelecomPrice,
  phoneNumber,
  setPhoneNumber,
  paidBy,
  setPaidBy,
  methods,
  showClientSearch,
  setShowClientSearch,
  telecomClientId,
  setTelecomClientId,
  telecomClientName,
  setTelecomClientName,
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
  useMultiPayment,
  setUseMultiPayment,
  setPaymentLines,
  clientName,
  setClientName,
  voucherItems,
}: TelecomFormProps) {
  const api = useApi();
  const [rates, setRates] = useState({ buyRate: 89000, sellRate: 89500 });
  const [costRate, setCostRate] = useState(85000);

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

  // Required for API compatibility but not used in this component
  void clientName;
  void setClientName;

  const accent = isMTC ? "cyan" : "red";

  return (
    <div className="flex flex-col gap-5 h-full">
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
      />

      {rechargeType === "ALFA_GIFT" ? (
        /* Alfa Gift Form - Card Grid Selection */
        <div className="flex flex-col gap-5 h-full">
          {/* Tier Grid */}
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-3">
              {Object.entries(ALFA_GIFT_TIERS).map(([key, tier]) => {
                const isSelected = giftTierKey === key;
                const sellRate =
                  Number(
                    localStorage.getItem("alfa_credit_sell_rate_lbp") ||
                      "100000",
                  ) / 1000;
                const priceLbp = (tier.usd * sellRate * 1000).toFixed(0);
                const costLbp = tier.usd * costRate;
                const profitLbp = parseFloat(priceLbp) - costLbp;

                return (
                  <div
                    key={key}
                    onClick={() => {
                      setGiftTierKey(key as keyof typeof ALFA_GIFT_TIERS | "");
                      setGiftAmountUsd(tier.usd.toString());
                      setGiftPriceLbp(priceLbp);
                    }}
                    className={`relative p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? "border-red-500/40 bg-red-500/5 ring-2 ring-red-500/50"
                        : "border-slate-700 bg-slate-800 hover:border-slate-600"
                    }`}
                  >
                    {/* Selected Checkmark */}
                    {isSelected && (
                      <div className="absolute top-2 right-2 text-red-400">
                        <CheckCircle size={16} />
                      </div>
                    )}

                    {/* Tier Label */}
                    <div className="text-white font-bold text-lg mb-1">
                      {tier.label}
                    </div>

                    {/* USD Value */}
                    <div className="text-sm text-slate-400 mb-2">
                      Value: ${tier.usd}
                    </div>

                    {/* Price Preview */}
                    <div className="text-xs text-emerald-400 font-mono mb-1">
                      Price: {parseFloat(priceLbp).toLocaleString()} LBP
                    </div>

                    {/* Profit Preview */}
                    <div
                      className={`text-xs font-mono ${profitLbp >= 0 ? "text-green-400" : "text-red-400"}`}
                    >
                      Profit: {profitLbp.toLocaleString()} LBP
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sticky Bottom Bar */}
          <div className="sticky bottom-0 bg-slate-800 rounded-xl border border-slate-700/50 p-4 shadow-2xl">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">
                    Payment Method
                  </label>
                  <button
                    type="button"
                    onClick={() => setUseMultiPayment(!useMultiPayment)}
                    className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                  >
                    {useMultiPayment ? "Single Payment" : "Split Payment"}
                  </button>
                </div>
                {useMultiPayment ? (
                  <MultiPaymentInput
                    totalAmount={parseFloat(giftPriceLbp) || 0}
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
                ) : (
                  <select
                    value={paidBy}
                    onChange={(e) => setPaidBy(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
                  >
                    {methods.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="text-right">
                <div className="text-xs text-slate-400">
                  Value:{" "}
                  <span className="text-white font-bold">
                    ${giftAmountUsd || "0"}
                  </span>
                </div>
                <div className="text-xs text-slate-400">
                  Price:{" "}
                  <span className="text-emerald-400 font-mono">
                    {parseFloat(giftPriceLbp || "0").toLocaleString()} LBP
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2 min-w-[200px]">
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setTelecomClientName(e.target.value)}
                  placeholder="Client name (optional)"
                  className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <button
                onClick={handleAlfaGiftSubmit}
                disabled={isSubmitting || !giftTierKey}
                className={`px-6 py-3 rounded-lg font-bold text-white transition-all ${
                  isSubmitting || !giftTierKey
                    ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                    : "bg-red-600 hover:bg-red-500 shadow-lg shadow-red-500/20"
                }`}
              >
                {isSubmitting ? "Processing..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      ) : rechargeType === "VOUCHER" && isMTC ? (
        /* Voucher Form - MTC Card Grid */
        <div className="flex flex-col gap-5 h-full">
          {/* MTC Voucher Card Grid - loaded from DB */}
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="text-sm text-slate-400 mb-3">
              Select MTC Voucher:
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {(voucherItems ?? []).map((item) => (
                <div
                  key={item.label}
                  onClick={() => setTelecomAmount(item.label)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer ${
                    telecomAmount === item.label
                      ? "border-cyan-500/40 bg-cyan-500/5 ring-2 ring-cyan-500/50"
                      : "border-slate-700 bg-slate-800 hover:border-slate-600"
                  }`}
                >
                  <div className="text-white font-bold text-sm mb-1">
                    {item.label}
                  </div>
                  <div className="text-xs text-slate-400">
                    Cost: {item.cost_lbp.toLocaleString()} LBP
                  </div>
                  <div className="text-xs text-emerald-400 font-mono">
                    Sell: {item.sell_lbp.toLocaleString()} LBP
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sticky Bottom Bar */}
          <div className="sticky bottom-0 bg-slate-800 rounded-xl border border-slate-700/50 p-4 shadow-2xl">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-xs text-slate-400">Payment Method</label>
                <select
                  value={paidBy}
                  onChange={(e) => setPaidBy(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 mt-1"
                >
                  {methods.map((method) => (
                    <option key={method.code} value={method.code}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-right">
                <div className="text-xs text-slate-400">Amount:</div>
                <div className="text-sm text-emerald-400 font-mono font-bold">
                  {telecomAmount || "0"}
                </div>
              </div>

              <button
                onClick={handleTelecomSubmit}
                disabled={isSubmitting || !telecomAmount}
                className={`px-6 py-3 rounded-lg font-bold text-white transition-all ${
                  isSubmitting || !telecomAmount
                    ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                    : "bg-cyan-600 hover:bg-cyan-500 shadow-lg shadow-cyan-500/20"
                }`}
              >
                {isSubmitting ? "Processing..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
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
                  {[5, 10, 15, 20, 25, 30, 50, 100].map((amt) => (
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
                htmlFor="telecom-paid-by"
                className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider flex items-center gap-1.5"
              >
                <Wallet size={12} />
                Paid By
              </label>
              <Select
                value={paidBy}
                onChange={(value) => {
                  setPaidBy(value);
                  if (value !== "DEBT") {
                    setShowClientSearch(false);
                  }
                }}
                options={methods.map((m) => ({
                  value: m.code,
                  label: m.label,
                }))}
                ringColor={`ring-${accent}-500`}
                buttonClassName="py-3 text-sm font-bold rounded-xl"
              />
            </div>

            {/* Client selector for DEBT */}
            {paidBy === "DEBT" && (
              <div className="relative">
                <label
                  htmlFor="telecom-debt-client"
                  className="block text-xs font-medium text-orange-400 mb-2 uppercase tracking-wider flex items-center gap-1.5"
                >
                  <User size={12} />
                  Client (required for debt)
                </label>
                {telecomClientId ? (
                  <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3">
                    <User size={16} className="text-orange-400" />
                    <span className="text-white font-medium flex-1">
                      {telecomClientName}
                    </span>
                    <button
                      onClick={() => {
                        setTelecomClientId(null);
                        setTelecomClientName("");
                      }}
                      className="text-slate-400 hover:text-white transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
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
                      className="w-full bg-slate-900/80 border border-orange-500/30 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                      placeholder="Search client by name..."
                    />
                    {showClientSearch && clientSearchResults.length > 0 && (
                      <div className="absolute z-10 top-full mt-1 w-full bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-h-48 overflow-auto">
                        {clientSearchResults.map((c: any) => (
                          <button
                            key={c.id}
                            onClick={() => selectClient(c)}
                            className="w-full text-left px-4 py-2.5 hover:bg-slate-700 text-sm text-white transition-colors first:rounded-t-xl last:rounded-b-xl"
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
                      <p className={`text-xs font-mono ${activeConfig?.color}`}>
                        ${telecomAmount}
                      </p>
                    </div>
                  </div>
                );
              })()}
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
            <div>
              <label
                htmlFor="telecom-price"
                className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider"
              >
                Price to Client
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-emerald-400">
                  $
                </span>
                <input
                  id="telecom-price"
                  type="number"
                  value={telecomPrice}
                  onChange={(e) => setTelecomPrice(e.target.value)}
                  className="w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-9 pr-4 py-3 text-emerald-400 font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-all"
                  placeholder="0.00"
                />
              </div>
            </div>
            {telecomAmount && telecomPrice && (
              <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/50">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Profit</span>
                  <span
                    className={`font-bold font-mono ${
                      parseFloat(telecomPrice) - parseFloat(telecomAmount) >= 0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    $
                    {(
                      parseFloat(telecomPrice || "0") -
                      parseFloat(telecomAmount || "0")
                    ).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
            <button
              onClick={handleTelecomSubmit}
              disabled={isSubmitting}
              className={`w-full mt-auto py-4 rounded-xl font-bold text-lg text-white shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${
                isSubmitting
                  ? "bg-slate-600 cursor-not-allowed"
                  : `bg-${accent}-600 hover:bg-${accent}-500`
              }`}
            >
              {isSubmitting ? (
                "Processing..."
              ) : (
                <>
                  <CheckCircle size={20} />
                  Confirm Recharge
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          transactions={rechargeHistory.map((r) => ({
            id: r.id,
            provider: r.carrier,
            service_type: "SEND" as const,
            amount: r.amount,
            currency: r.currency_code,
            cost: r.cost,
            commission: r.price - r.cost,
            client_name: r.client_name,
            reference_number: r.phone_number || undefined,
            created_at: r.created_at,
          }))}
          provider={isMTC ? "MTC" : "Alfa"}
          onClose={() => setShowHistory(false)}
          onRefresh={() => {}}
          formatAmount={(val, currency) => `${val.toFixed(2)} ${currency}`}
        />
      )}
    </div>
  );
}
