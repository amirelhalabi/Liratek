import { useState, useEffect, useCallback, useRef } from "react";
import logger from "../../../../utils/logger";
import {
  Signal,
  Wifi,
  DollarSign,
  CheckCircle,
  Plus,
  Clock,
  ArrowUpCircle,
  CreditCard,
  Phone,
  Wallet,
  Send,
  ArrowDownToLine,
  Receipt,
  History,
  TrendingUp,
  Calendar,
  User,
  Hash,
  RefreshCw,
  Zap,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  Bitcoin,
  Search,
  X,
} from "lucide-react";
import { Select, useApi } from "@liratek/ui";
import { useCurrencyContext } from "../../../../contexts/CurrencyContext";
import CurrencySelect from "../../../../components/CurrencySelect";
import { useSession } from "../../../sessions/context/SessionContext";
import { usePaymentMethods } from "../../../../hooks/usePaymentMethods";
import { useModules } from "../../../../contexts/ModuleContext";
import { ExportBar } from "@/shared/components/ExportBar";
import {
  useMobileServiceItems,
  type ServiceItem,
  type ProviderKey,
} from "../../hooks/useMobileServiceItems";

// =============================================================================
// Types
// =============================================================================

type TelecomProvider = "MTC" | "Alfa";
type FinancialProvider = "IPEC" | "KATCH" | "WISH_APP" | "OMT_APP";
type CryptoProvider = "BINANCE";
type AnyProvider = TelecomProvider | FinancialProvider | CryptoProvider;

type RechargeType = "CREDIT_TRANSFER" | "VOUCHER" | "DAYS" | "TOP_UP";
type ServiceType = "SEND" | "RECEIVE" | "BILL_PAYMENT";

type FormMode = "telecom" | "financial" | "crypto";

interface SupplierOwed {
  usd: number;
  lbp: number;
}

interface FinancialTransaction {
  id: number;
  provider: string;
  service_type: ServiceType;
  amount: number;
  currency: string;
  commission: number;
  client_name?: string;
  reference_number?: string;
  note?: string;
  created_at: string;
}

interface BinanceTransaction {
  id: number;
  type: "SEND" | "RECEIVE";
  amount: number;
  currency_code: string;
  description: string | null;
  client_name: string | null;
  created_at: string;
}

// =============================================================================
// Provider Configuration
// =============================================================================

interface ProviderConfig {
  key: AnyProvider;
  label: string;
  module: string;
  drawer: string;
  formMode: FormMode;
  color: string;
  bgTint: string;
  activeBg: string;
  activeText: string;
  badgeCls: string;
  icon: typeof Zap;
  hasSupplier: boolean;
}

const PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    key: "MTC",
    label: "Touch / MTC",
    module: "recharge",
    drawer: "MTC",
    formMode: "telecom",
    color: "text-cyan-400",
    bgTint: "bg-cyan-400/10",
    activeBg: "bg-cyan-600",
    activeText: "text-white",
    badgeCls: "bg-cyan-400/10 text-cyan-400",
    icon: Signal,
    hasSupplier: false,
  },
  {
    key: "Alfa",
    label: "Alfa",
    module: "recharge",
    drawer: "Alfa",
    formMode: "telecom",
    color: "text-red-400",
    bgTint: "bg-red-400/10",
    activeBg: "bg-red-600",
    activeText: "text-white",
    badgeCls: "bg-red-400/10 text-red-400",
    icon: Wifi,
    hasSupplier: false,
  },
  {
    key: "IPEC",
    label: "IPEC",
    module: "ipec_katch",
    drawer: "IPEC",
    formMode: "financial",
    color: "text-sky-400",
    bgTint: "bg-sky-400/10",
    activeBg: "bg-sky-500",
    activeText: "text-white",
    badgeCls: "bg-sky-400/10 text-sky-400",
    icon: Zap,
    hasSupplier: true,
  },
  {
    key: "KATCH",
    label: "Katch",
    module: "ipec_katch",
    drawer: "Katch",
    formMode: "financial",
    color: "text-orange-400",
    bgTint: "bg-orange-400/10",
    activeBg: "bg-orange-500",
    activeText: "text-white",
    badgeCls: "bg-orange-400/10 text-orange-400",
    icon: Zap,
    hasSupplier: true,
  },
  {
    key: "WISH_APP",
    label: "Whish App",
    module: "ipec_katch",
    drawer: "Whish_App",
    formMode: "financial",
    color: "text-fuchsia-400",
    bgTint: "bg-fuchsia-400/10",
    activeBg: "bg-fuchsia-500",
    activeText: "text-white",
    badgeCls: "bg-fuchsia-400/10 text-fuchsia-400",
    icon: Zap,
    hasSupplier: true,
  },
  {
    key: "OMT_APP",
    label: "OMT App",
    module: "ipec_katch",
    drawer: "OMT_App",
    formMode: "financial",
    color: "text-lime-400",
    bgTint: "bg-lime-400/10",
    activeBg: "bg-lime-500",
    activeText: "text-white",
    badgeCls: "bg-lime-400/10 text-lime-400",
    icon: Zap,
    hasSupplier: true,
  },
  {
    key: "BINANCE",
    label: "Binance",
    module: "binance",
    drawer: "Binance",
    formMode: "crypto",
    color: "text-amber-400",
    bgTint: "bg-amber-400/10",
    activeBg: "bg-amber-500",
    activeText: "text-white",
    badgeCls: "bg-amber-400/10 text-amber-400",
    icon: Bitcoin,
    hasSupplier: false,
  },
];

const TELECOM_SERVICE_TYPES: {
  id: RechargeType;
  label: string;
  icon: typeof DollarSign;
}[] = [
  { id: "CREDIT_TRANSFER", label: "Credit", icon: DollarSign },
  { id: "DAYS", label: "Days", icon: Clock },
  { id: "VOUCHER", label: "Voucher", icon: CreditCard },
  { id: "TOP_UP", label: "Top Up", icon: ArrowUpCircle },
];

const FINANCIAL_SERVICE_ICONS: Record<ServiceType, typeof Send> = {
  SEND: Send,
  RECEIVE: ArrowDownToLine,
  BILL_PAYMENT: Receipt,
};

interface FinancialFormProps {
  activeConfig: ProviderConfig | undefined;
  finTransactions: FinancialTransaction[];
  activeProvider: AnyProvider | null;
  finAnalytics: {
    today: { commission: number; count: number };
    byProvider: { provider: string; commission: number; count: number }[];
  };
  owedByProvider: Record<string, SupplierOwed>;
  serviceType: ServiceType;
  setServiceType: (type: ServiceType) => void;
  getCategoriesForProvider: (provider: ProviderKey) => string[];
  getServiceItems: (provider: ProviderKey, category: string) => ServiceItem[];
  selectedCategory: string;
  setSelectedCategory: (val: string) => void;
  selectedItem: ServiceItem | null;
  setSelectedItem: (item: ServiceItem | null) => void;
  finCost: string;
  setFinCost: (val: string) => void;
  finPaidBy: string;
  setFinPaidBy: (val: string) => void;
  showFinClientSearch: boolean;
  setShowFinClientSearch: (val: boolean) => void;
  methods: { code: string; label: string }[];
  finClientId: number | null;
  setFinClientId: (val: number | null) => void;
  finClientName: string;
  setFinClientName: (val: string) => void;
  clientName: string;
  setClientName: (val: string) => void;
  searchFinClients: (query: string) => void;
  finClientSearchResults: any[];
  selectFinClient: (client: any) => void;
  finPrice: string;
  setFinPrice: (val: string) => void;
  finAmount: string;
  setFinAmount: (val: string) => void;
  finCommission: string;
  setFinCommission: (val: string) => void;
  referenceNumber: string;
  setReferenceNumber: (val: string) => void;
  handleFinancialSubmit: () => void;
  isSubmitting: boolean;
  loadFinancialData: () => void;
  formatAmount: (val: number, currency: string) => string;
  finCurrency: string;
  setFinCurrency: (val: string) => void;
  moduleCurrencies: Array<{ code: string; name: string; symbol: string }>;
  getSymbol: (code: string) => string;
}

function FinancialForm({
  activeConfig,
  finTransactions,
  activeProvider,
  finAnalytics,
  owedByProvider,
  serviceType,
  setServiceType,
  getCategoriesForProvider,
  getServiceItems,
  selectedCategory,
  setSelectedCategory,
  selectedItem,
  setSelectedItem,
  finCost,
  setFinCost,
  finPaidBy,
  setFinPaidBy,
  showFinClientSearch,
  setShowFinClientSearch,
  methods,
  finClientId,
  setFinClientId,
  finClientName,
  setFinClientName,
  clientName,
  setClientName,
  searchFinClients,
  finClientSearchResults,
  selectFinClient,
  finPrice,
  setFinPrice,
  finAmount,
  setFinAmount,
  finCommission,
  setFinCommission,
  referenceNumber,
  setReferenceNumber,
  handleFinancialSubmit,
  isSubmitting,
  loadFinancialData,
  formatAmount,
  finCurrency,
  setFinCurrency,
  moduleCurrencies,
  getSymbol,
}: FinancialFormProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  if (!activeConfig) return null;
  const meta = activeConfig;

  // Filter transactions & stats to currently selected provider
  const providerTx = finTransactions.filter(
    (tx) => tx.provider === activeProvider,
  );
  const providerStats = finAnalytics.byProvider.find(
    (bp) => bp.provider === activeProvider,
  );

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <div className={`p-1.5 rounded-lg ${meta.bgTint}`}>
              <TrendingUp className={`w-4 h-4 ${meta.color}`} />
            </div>
            <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
              {meta.label} Today
            </span>
          </div>
          <p className="text-xl font-bold text-white">
            ${(providerStats?.commission ?? 0).toFixed(2)}
          </p>
          <p className="text-xs text-slate-500">
            {providerStats?.count ?? 0} transactions
          </p>
        </div>
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-violet-400/10">
              <Calendar className="w-4 h-4 text-violet-400" />
            </div>
            <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
              All Providers Today
            </span>
          </div>
          <p className="text-xl font-bold text-white">
            ${finAnalytics.today.commission.toFixed(2)}
          </p>
          <p className="text-xs text-slate-500">
            {finAnalytics.today.count} transactions
          </p>
        </div>
        {meta.hasSupplier && owedByProvider[meta.key] && (
          <div className="bg-slate-800 p-4 rounded-xl border border-slate-700/50">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-lg bg-red-400/10">
                <AlertTriangle className="w-4 h-4 text-red-400" />
              </div>
              <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                Owed to {meta.label}
              </span>
            </div>
            <p className="text-xl font-bold text-red-400">
              ${(owedByProvider[meta.key]?.usd ?? 0).toFixed(2)}
            </p>
            <p className="text-xs text-red-400/70">
              {(owedByProvider[meta.key]?.lbp ?? 0).toLocaleString()} LBP
            </p>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex gap-5">
        {/* Left: Form */}
        <div className="w-1/3 min-w-[360px] bg-slate-800 rounded-xl border border-slate-700/50 p-4 flex flex-col overflow-auto">
          {/* Service Type */}
          <div className="flex gap-2 mb-5">
            {(["SEND", "RECEIVE", "BILL_PAYMENT"] as ServiceType[]).map(
              (type) => {
                const Icon = FINANCIAL_SERVICE_ICONS[type];
                return (
                  <button
                    key={type}
                    onClick={() => setServiceType(type)}
                    className={`flex-1 py-3 rounded-lg font-medium text-sm transition-all flex flex-col items-center gap-1 ${
                      serviceType === type
                        ? "bg-violet-600 text-white shadow-lg shadow-violet-900/20"
                        : "bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700"
                    }`}
                  >
                    <Icon size={18} />
                    {type === "BILL_PAYMENT"
                      ? "Bill"
                      : type.charAt(0) + type.slice(1).toLowerCase()}
                  </button>
                );
              },
            )}
          </div>

          <div className="space-y-4 flex-1">
            {/* Item Picker (categories + items from mobileServices) */}
            {activeProvider &&
              (activeProvider === "IPEC" ||
                activeProvider === "KATCH" ||
                activeProvider === "WISH_APP") &&
              (() => {
                const categories = getCategoriesForProvider(
                  activeProvider as ProviderKey,
                );
                const categoryItems = selectedCategory
                  ? getServiceItems(
                      activeProvider as ProviderKey,
                      selectedCategory,
                    )
                  : [];
                if (categories.length === 0) return null;
                return (
                  <div className="space-y-3">
                    <div>
                      <label
                        htmlFor="fin-category"
                        className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                      >
                        Category
                      </label>
                      <Select
                        value={selectedCategory}
                        onChange={(val) => {
                          setSelectedCategory(val);
                          setSelectedItem(null);
                        }}
                        options={[
                          { value: "", label: "— None —" },
                          ...categories.map((c) => ({
                            value: c,
                            label: c,
                          })),
                        ]}
                        buttonClassName="py-2.5 text-sm rounded-lg"
                      />
                    </div>
                    {categoryItems.length > 0 && (
                      <div>
                        <span
                          aria-hidden="true"
                          className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                        >
                          Item
                        </span>
                        <div className="max-h-32 overflow-auto space-y-1">
                          {categoryItems.map((item) => (
                            <button
                              key={item.key}
                              onClick={() => {
                                setSelectedItem(item);
                                const cost = item.savedCost ?? item.catalogCost;
                                if (cost !== undefined) {
                                  setFinCost(cost.toString());
                                }
                              }}
                              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                                selectedItem?.key === item.key
                                  ? `${meta.activeBg} text-white`
                                  : "bg-slate-900/50 text-slate-300 hover:bg-slate-700"
                              }`}
                            >
                              <span className="font-medium">{item.label}</span>
                              {item.catalogCost !== undefined && (
                                <span className="text-xs text-slate-500 ml-2">
                                  {item.catalogCost.toLocaleString()}
                                </span>
                              )}
                              {item.savedCost !== undefined && (
                                <span className="text-xs text-emerald-400 ml-2">
                                  {item.savedCost.toLocaleString()}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

            {/* Paid By */}
            <div>
              <label
                htmlFor="fin-paid-by"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
              >
                <Wallet size={12} /> Paid By
              </label>
              <Select
                value={finPaidBy}
                onChange={(value) => {
                  setFinPaidBy(value);
                  if (value !== "DEBT") {
                    setShowFinClientSearch(false);
                  }
                }}
                options={methods.map((m) => ({
                  value: m.code,
                  label: m.label,
                }))}
                buttonClassName="py-2.5 text-sm font-bold rounded-lg"
              />
            </div>

            {/* DEBT: Client selector */}
            {finPaidBy === "DEBT" && (
              <div className="relative">
                <label
                  htmlFor="fin-debt-client"
                  className="block text-xs font-medium text-orange-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                >
                  <User size={12} /> Client (required)
                </label>
                {finClientId ? (
                  <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 rounded-lg px-4 py-2.5">
                    <User size={14} className="text-orange-400" />
                    <span className="text-white font-medium text-sm flex-1">
                      {finClientName}
                    </span>
                    <button
                      onClick={() => {
                        setFinClientId(null);
                        setFinClientName("");
                        setClientName("");
                      }}
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
                      type="text"
                      value={finClientName}
                      onChange={(e) => {
                        setFinClientName(e.target.value);
                        setShowFinClientSearch(true);
                        searchFinClients(e.target.value);
                      }}
                      onFocus={() => {
                        if (finClientName.length >= 2) {
                          setShowFinClientSearch(true);
                          searchFinClients(finClientName);
                        }
                      }}
                      className="w-full bg-slate-900/80 border border-orange-500/30 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500 transition-all"
                      placeholder="Search client..."
                    />
                    {showFinClientSearch &&
                      finClientSearchResults.length > 0 && (
                        <div className="absolute z-10 top-full mt-1 w-full bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-h-40 overflow-auto">
                          {finClientSearchResults.map((c: any) => (
                            <button
                              key={c.id}
                              onClick={() => selectFinClient(c)}
                              className="w-full text-left px-4 py-2 hover:bg-slate-700 text-sm text-white transition-colors first:rounded-t-xl last:rounded-b-xl"
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

            {/* Cost / Price / Profit */}
            <div className="p-4 rounded-xl bg-sky-400/5 border border-sky-400/20 space-y-3">
              <div className="flex items-center justify-between">
                <span
                  aria-hidden="true"
                  className="text-xs font-medium text-sky-400 uppercase tracking-wider"
                >
                  Cost / Price
                </span>
                <CurrencySelect
                  value={finCurrency}
                  onChange={setFinCurrency}
                  {...(moduleCurrencies.length > 0
                    ? { currencies: moduleCurrencies }
                    : {})}
                  className="text-xs py-1 px-2 rounded-md bg-slate-800 border-slate-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="fin-cost"
                    className="block text-[10px] text-slate-500 mb-1 uppercase"
                  >
                    Cost ({getSymbol(finCurrency)})
                  </label>
                  <input
                    id="fin-cost"
                    type="number"
                    value={finCost}
                    onChange={(e) => setFinCost(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-sky-500 transition-colors"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label
                    htmlFor="fin-price"
                    className="block text-[10px] text-slate-500 mb-1 uppercase"
                  >
                    Price ({getSymbol(finCurrency)})
                  </label>
                  <input
                    id="fin-price"
                    type="number"
                    value={finPrice}
                    onChange={(e) => setFinPrice(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-emerald-400 font-bold focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="0.00"
                  />
                </div>
              </div>
              {(finCost || finPrice) && (
                <div className="flex items-center justify-between text-sm pt-1 border-t border-slate-700/50">
                  <span className="text-slate-400 text-xs">Profit</span>
                  <span
                    className={`font-bold font-mono text-sm ${
                      parseFloat(finPrice || "0") -
                        parseFloat(finCost || "0") >=
                      0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    {formatAmount(
                      parseFloat(finPrice || "0") - parseFloat(finCost || "0"),
                      finCurrency,
                    )}
                  </span>
                </div>
              )}
            </div>

            {/* Legacy Amount + Commission (fallback) */}
            {!finCost && !finPrice && (
              <>
                <div>
                  <label
                    htmlFor="fin-amount"
                    className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                  >
                    Amount ({getSymbol(finCurrency)})
                  </label>
                  <input
                    id="fin-amount"
                    type="number"
                    value={finAmount}
                    onChange={(e) => setFinAmount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 transition-colors"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label
                    htmlFor="fin-commission"
                    className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                  >
                    Commission
                  </label>
                  <input
                    id="fin-commission"
                    type="number"
                    value={finCommission}
                    onChange={(e) => setFinCommission(e.target.value)}
                    className="w-full bg-slate-900 border border-sky-400/30 rounded-lg px-4 py-3 text-sky-400 font-bold focus:outline-none focus:border-sky-400 transition-colors"
                    placeholder="0.00"
                  />
                </div>
              </>
            )}

            {/* Client Info */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="fin-client-name"
                  className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                >
                  <User size={12} /> Client
                </label>
                <input
                  id="fin-client-name"
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-colors"
                  placeholder="Optional"
                />
              </div>
              <div>
                <label
                  htmlFor="fin-ref"
                  className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                >
                  <Hash size={12} /> Ref #
                </label>
                <input
                  id="fin-ref"
                  type="text"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-colors"
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleFinancialSubmit}
            disabled={isSubmitting}
            className={`w-full mt-5 py-4 rounded-xl font-bold text-lg shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 ${
              isSubmitting
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : `${meta.activeBg} text-white hover:opacity-90`
            }`}
          >
            {isSubmitting ? (
              "Processing..."
            ) : (
              <>
                {serviceType === "SEND" && <Send size={20} />}
                {serviceType === "RECEIVE" && <ArrowDownToLine size={20} />}
                {serviceType === "BILL_PAYMENT" && <Receipt size={20} />}
                Record Transaction
              </>
            )}
          </button>
        </div>

        {/* Right: History */}
        <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-700 flex items-center justify-between">
            <h2 className="font-bold text-white flex items-center gap-2">
              <History className="text-slate-400" size={18} />
              {meta.label} History
            </h2>
            <button
              onClick={loadFinancialData}
              className="text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700"
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <ExportBar
              exportExcel
              exportPdf
              exportFilename="recharge-history"
              tableRef={tableRef}
              rowCount={providerTx.length}
            />
            <table ref={tableRef} className="w-full">
              <thead className="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Commission</th>
                  <th className="px-5 py-3">Client</th>
                  <th className="px-5 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {providerTx.map((tx) => {
                  const Icon = FINANCIAL_SERVICE_ICONS[tx.service_type];
                  return (
                    <tr
                      key={tx.id}
                      className="hover:bg-slate-700/20 transition-colors"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 text-slate-300">
                          <Icon size={14} />
                          <span className="text-sm">
                            {tx.service_type === "BILL_PAYMENT"
                              ? "Bill"
                              : tx.service_type.charAt(0) +
                                tx.service_type.slice(1).toLowerCase()}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm font-medium text-white">
                        {formatAmount(tx.amount, tx.currency)}
                      </td>
                      <td className="px-5 py-3 text-sm font-bold text-emerald-400">
                        {formatAmount(tx.commission, tx.currency)}
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-300">
                        {tx.client_name || "—"}
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-400">
                        {new Date(tx.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        <div className="text-xs text-slate-500">
                          {new Date(tx.created_at).toLocaleDateString()}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {providerTx.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-8 text-center text-slate-500 text-sm"
                    >
                      No {meta.label} transactions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

interface TelecomFormProps {
  isMTC: boolean;
  rechargeType: RechargeType;
  setRechargeType: (type: RechargeType) => void;
  topUpAmount: string;
  setTopUpAmount: (val: string) => void;
  handleTopUp: () => void;
  isSubmitting: boolean;
  handleQuickAmount: (val: number) => void;
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
  activeProvider: AnyProvider | null;
  activeConfig: ProviderConfig | undefined;
  handleTelecomSubmit: () => void;
}

function TelecomForm({
  isMTC,
  rechargeType,
  setRechargeType,
  topUpAmount,
  setTopUpAmount,
  handleTopUp,
  isSubmitting,
  handleQuickAmount,
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
}: TelecomFormProps) {
  const accent = isMTC ? "cyan" : "red";

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* Service Type Tabs */}
      <div className="flex gap-2 p-1.5 bg-slate-800 rounded-2xl border border-slate-700/50">
        {TELECOM_SERVICE_TYPES.map((svc) => {
          const Icon = svc.icon;
          const active = rechargeType === svc.id;
          return (
            <button
              key={svc.id}
              onClick={() => setRechargeType(svc.id)}
              className={`flex-1 py-3 px-2 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                active
                  ? svc.id === "TOP_UP"
                    ? "bg-emerald-600 text-white shadow-lg"
                    : `bg-${accent}-600 text-white shadow-lg`
                  : "text-slate-400 hover:text-white hover:bg-slate-700/60"
              }`}
            >
              <Icon size={16} />
              {svc.label}
            </button>
          );
        })}
      </div>

      {rechargeType === "TOP_UP" ? (
        /* Top Up Form */
        <div className="bg-slate-800 rounded-2xl border border-slate-700/50 p-6">
          <div className="max-w-lg mx-auto space-y-6">
            <div>
              <label
                htmlFor="topup-amount"
                className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider"
              >
                Amount (USD)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-400 font-bold text-2xl">
                  $
                </span>
                <input
                  id="topup-amount"
                  type="number"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  className="w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-12 pr-4 py-4 text-3xl font-bold text-white text-center focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-all"
                  placeholder="0.00"
                  step="0.01"
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[50, 100, 200, 500, 1000, 2000, 3000, 5000].map((amt) => (
                <button
                  key={amt}
                  onClick={() => setTopUpAmount(amt.toString())}
                  className={`py-2.5 rounded-xl font-bold text-sm transition-all border ${
                    topUpAmount === amt.toString()
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                      : "bg-slate-900/50 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
                  }`}
                >
                  ${amt.toLocaleString()}
                </button>
              ))}
            </div>
            <button
              onClick={handleTopUp}
              disabled={isSubmitting}
              className={`w-full py-4 rounded-xl font-bold text-lg text-white shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-3 ${
                isSubmitting
                  ? "bg-slate-600 cursor-not-allowed"
                  : "bg-emerald-600 hover:bg-emerald-500"
              }`}
            >
              {isSubmitting ? (
                "Processing..."
              ) : (
                <>
                  <Plus size={20} />
                  Confirm Top Up
                </>
              )}
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
            {rechargeType === "VOUCHER" &&
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
    </div>
  );
}

interface CryptoFormProps {
  activeConfig: ProviderConfig | undefined;
  binanceStats: { totalSent: number; totalReceived: number; count: number };
  cryptoType: "SEND" | "RECEIVE";
  setCryptoType: (type: "SEND" | "RECEIVE") => void;
  cryptoAmount: string;
  setCryptoAmount: (val: string) => void;
  cryptoClientName: string;
  setCryptoClientName: (val: string) => void;
  cryptoDescription: string;
  setCryptoDescription: (val: string) => void;
  handleCryptoSubmit: () => void;
  isSubmitting: boolean;
  binanceTransactions: BinanceTransaction[];
  loadCryptoData: () => void;
}

function CryptoForm({
  activeConfig,
  binanceStats,
  cryptoType,
  setCryptoType,
  cryptoAmount,
  setCryptoAmount,
  cryptoClientName,
  setCryptoClientName,
  cryptoDescription,
  setCryptoDescription,
  handleCryptoSubmit,
  isSubmitting,
  binanceTransactions,
  loadCryptoData,
}: CryptoFormProps) {
  const cryptoTableRef = useRef<HTMLTableElement>(null);
  if (!activeConfig) return null;
  const meta = activeConfig;

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-red-400/10">
              <ArrowUpRight className="w-4 h-4 text-red-400" />
            </div>
            <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
              Sent Today
            </span>
          </div>
          <p className="text-xl font-bold text-white">
            $
            {binanceStats.totalSent.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </p>
          <p className="text-xs text-slate-500">outgoing</p>
        </div>
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-emerald-400/10">
              <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
            </div>
            <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
              Received Today
            </span>
          </div>
          <p className="text-xl font-bold text-white">
            $
            {binanceStats.totalReceived.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </p>
          <p className="text-xs text-slate-500">incoming</p>
        </div>
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <div className={`p-1.5 rounded-lg ${meta.bgTint}`}>
              <TrendingUp className={`w-4 h-4 ${meta.color}`} />
            </div>
            <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
              Transactions
            </span>
          </div>
          <p className="text-xl font-bold text-white">{binanceStats.count}</p>
          <p className="text-xs text-slate-500">today</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-5">
        {/* Left: Form */}
        <div className="w-1/3 min-w-[360px] bg-slate-800 rounded-xl border border-slate-700/50 p-4 flex flex-col">
          {/* Type Selector */}
          <div className="flex gap-2 mb-5">
            <button
              onClick={() => setCryptoType("SEND")}
              className={`flex-1 py-3 rounded-lg font-medium text-sm transition-all flex flex-col items-center gap-1 ${
                cryptoType === "SEND"
                  ? "bg-red-500/20 text-red-400 shadow-lg shadow-red-900/20"
                  : "bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              <ArrowUpRight size={18} />
              Send
            </button>
            <button
              onClick={() => setCryptoType("RECEIVE")}
              className={`flex-1 py-3 rounded-lg font-medium text-sm transition-all flex flex-col items-center gap-1 ${
                cryptoType === "RECEIVE"
                  ? "bg-emerald-500/20 text-emerald-400 shadow-lg shadow-emerald-900/20"
                  : "bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              <ArrowDownLeft size={18} />
              Receive
            </button>
          </div>

          <div className="space-y-4 flex-1">
            {/* Amount */}
            <div>
              <label
                htmlFor="crypto-amount"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
              >
                Amount (USDT)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-400 font-bold">
                  $
                </span>
                <input
                  id="crypto-amount"
                  type="number"
                  value={cryptoAmount}
                  onChange={(e) => setCryptoAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-8 pr-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            {/* Client & Description */}
            <div>
              <label
                htmlFor="crypto-client"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
              >
                <User size={12} /> Client
              </label>
              <input
                id="crypto-client"
                type="text"
                value={cryptoClientName}
                onChange={(e) => setCryptoClientName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
                placeholder="Optional"
              />
            </div>
            <div>
              <label
                htmlFor="crypto-description"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
              >
                <Hash size={12} /> Description
              </label>
              <textarea
                id="crypto-description"
                value={cryptoDescription}
                onChange={(e) => setCryptoDescription(e.target.value)}
                placeholder="Notes, reference, reason..."
                rows={3}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors resize-none"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleCryptoSubmit}
            disabled={isSubmitting}
            className={`w-full mt-5 py-4 rounded-xl font-bold text-lg shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 ${
              isSubmitting
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : `${meta.activeBg} text-white hover:opacity-90`
            }`}
          >
            {isSubmitting ? (
              "Processing..."
            ) : (
              <>
                {cryptoType === "SEND" ? (
                  <ArrowUpRight size={20} />
                ) : (
                  <ArrowDownLeft size={20} />
                )}
                Record Transaction
              </>
            )}
          </button>
        </div>

        {/* Right: History */}
        <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-700 flex items-center justify-between">
            <h2 className="font-bold text-white flex items-center gap-2">
              <History className="text-slate-400" size={18} />
              Binance History
            </h2>
            <button
              onClick={loadCryptoData}
              className="text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700"
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <ExportBar
              exportExcel
              exportPdf
              exportFilename="binance-history"
              tableRef={cryptoTableRef}
              rowCount={binanceTransactions.length}
            />
            <table ref={cryptoTableRef} className="w-full">
              <thead className="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Client</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {binanceTransactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 text-slate-300">
                        {tx.type === "SEND" ? (
                          <ArrowUpRight size={14} />
                        ) : (
                          <ArrowDownLeft size={14} />
                        )}
                        <span className="text-sm">
                          {tx.type.charAt(0) + tx.type.slice(1).toLowerCase()}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm font-medium text-white">
                      $
                      {Number(tx.amount).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-300">
                      {tx.client_name || "—"}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-400 max-w-[250px] truncate">
                      {tx.description || "—"}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-400">
                      {new Date(tx.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      <div className="text-xs text-slate-500">
                        {new Date(tx.created_at).toLocaleDateString()}
                      </div>
                    </td>
                  </tr>
                ))}
                {binanceTransactions.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-8 text-center text-slate-500 text-sm"
                    >
                      No Binance transactions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export default function MobileRecharge() {
  const api = useApi();
  const { activeSession, linkTransaction } = useSession();
  const { methods } = usePaymentMethods();
  const { isModuleEnabled } = useModules();
  const { formatAmount, getSymbol, getCurrenciesForDrawer } =
    useCurrencyContext();
  const { getItems: getServiceItems, getCategoriesForProvider } =
    useMobileServiceItems();

  // Which providers are visible based on enabled modules
  const enabledProviders = PROVIDER_CONFIGS.filter((p) =>
    isModuleEnabled(p.module),
  );

  const [activeProvider, setActiveProvider] = useState<AnyProvider | null>(
    null,
  );

  // Set initial provider to first enabled one
  useEffect(() => {
    if (enabledProviders.length > 0 && !activeProvider) {
      setActiveProvider(enabledProviders[0].key);
    }
  }, [enabledProviders, activeProvider]);

  // Telecom state
  const [rechargeType, setRechargeType] =
    useState<RechargeType>("CREDIT_TRANSFER");
  const [stock, setStock] = useState<Record<string, number>>({});
  const [phoneNumber, setPhoneNumber] = useState("");
  const [paidBy, setPaidBy] = useState("CASH");
  const [telecomAmount, setTelecomAmount] = useState("");
  const [telecomPrice, setTelecomPrice] = useState("");
  const [topUpAmount, setTopUpAmount] = useState("");
  const [telecomClientName, setTelecomClientName] = useState("");
  const [telecomClientId, setTelecomClientId] = useState<number | null>(null);
  const [clientSearchResults, setClientSearchResults] = useState<any[]>([]);
  const [showClientSearch, setShowClientSearch] = useState(false);

  // Financial state
  const [serviceType, setServiceType] = useState<ServiceType>("SEND");
  const [finAmount, setFinAmount] = useState("");
  const [finCommission, setFinCommission] = useState("");
  const [finCost, setFinCost] = useState("");
  const [finPrice, setFinPrice] = useState("");
  const [finCurrency, setFinCurrency] = useState("LBP");
  const [finPaidBy, setFinPaidBy] = useState("CASH");
  const [finClientId, setFinClientId] = useState<number | null>(null);
  const [finClientName, setFinClientName] = useState("");
  const [finClientSearchResults, setFinClientSearchResults] = useState<any[]>(
    [],
  );
  const [showFinClientSearch, setShowFinClientSearch] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ServiceItem | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");

  // Crypto state
  const [cryptoType, setCryptoType] = useState<"SEND" | "RECEIVE">("SEND");
  const [cryptoAmount, setCryptoAmount] = useState("");
  const [cryptoDescription, setCryptoDescription] = useState("");
  const [cryptoClientName, setCryptoClientName] = useState("");

  // Shared state
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Data state
  const [finTransactions, setFinTransactions] = useState<
    FinancialTransaction[]
  >([]);
  const [binanceTransactions, setBinanceTransactions] = useState<
    BinanceTransaction[]
  >([]);
  const [finAnalytics, setFinAnalytics] = useState({
    today: { commission: 0, count: 0 },
    byProvider: [] as { provider: string; commission: number; count: number }[],
  });
  const [binanceStats, setBinanceStats] = useState({
    totalSent: 0,
    totalReceived: 0,
    count: 0,
  });
  const [owedByProvider, setOwedByProvider] = useState<
    Record<string, SupplierOwed>
  >({});

  const activeConfig = PROVIDER_CONFIGS.find((p) => p.key === activeProvider);
  const formMode = activeConfig?.formMode ?? "telecom";

  // Load currencies enabled for the active provider's module
  const [moduleCurrencies, setModuleCurrencies] = useState<
    Array<{ code: string; name: string; symbol: string }>
  >([]);

  useEffect(() => {
    if (!activeConfig?.drawer) {
      setModuleCurrencies([]);
      return;
    }
    let cancelled = false;
    getCurrenciesForDrawer(activeConfig.drawer).then((currencies) => {
      if (cancelled) return;
      setModuleCurrencies(currencies);
      // Default to first enabled currency if current selection isn't in the list
      if (
        currencies.length > 0 &&
        !currencies.some((c) => c.code === finCurrency)
      ) {
        setFinCurrency(currencies[0].code);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeConfig?.drawer, getCurrenciesForDrawer]);

  // Populate client name from session
  useEffect(() => {
    if (activeSession?.customer_name) {
      setClientName(activeSession.customer_name);
      setCryptoClientName(activeSession.customer_name);
      setTelecomClientName(activeSession.customer_name);
    }
  }, [activeSession]);

  // ─── Client Search (for DEBT payment) ───
  const searchClients = useCallback(async (query: string) => {
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
  }, []);

  const selectClient = (client: any) => {
    setTelecomClientName(client.name);
    setTelecomClientId(client.id);
    setShowClientSearch(false);
    setClientSearchResults([]);
  };

  // ─── Financial Client Search (for DEBT payment) ───
  const searchFinClients = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setFinClientSearchResults([]);
      return;
    }
    try {
      const results = await api.getClients(query);
      setFinClientSearchResults(results.slice(0, 8));
    } catch {
      setFinClientSearchResults([]);
    }
  }, []);

  const selectFinClient = (client: any) => {
    setFinClientName(client.name);
    setFinClientId(client.id);
    setClientName(client.name);
    setShowFinClientSearch(false);
    setFinClientSearchResults([]);
  };

  // ─── Static Voucher Image Path ───
  const getVoucherImagePath = (provider: string, amount: string) => {
    const p = provider.toLowerCase();
    const specificPath = `/vouchers/${p}-${amount}.png`;
    return specificPath;
  };

  const [voucherImageExists, setVoucherImageExists] = useState<
    Record<string, boolean>
  >({});

  // Pre-check which voucher images exist
  useEffect(() => {
    if (formMode !== "telecom" || rechargeType !== "VOUCHER") return;
    const controller = new AbortController();
    const provider = (activeProvider || "").toLowerCase();
    const amounts = [5, 10, 15, 20, 25, 30, 50, 100];
    const checks: Record<string, boolean> = {};

    Promise.all(
      amounts.map(async (amt) => {
        const key = `${provider}-${amt}`;
        try {
          const res = await fetch(`/vouchers/${key}.png`, {
            method: "HEAD",
            signal: controller.signal,
          });
          checks[key] = res.ok;
        } catch {
          checks[key] = false;
        }
        // Also try jpg/webp fallbacks
        if (!checks[key]) {
          for (const ext of ["jpg", "jpeg", "webp"]) {
            try {
              const res = await fetch(`/vouchers/${key}.${ext}`, {
                method: "HEAD",
                signal: controller.signal,
              });
              if (res.ok) {
                checks[key] = true;
                break;
              }
            } catch {
              /* ignore */
            }
          }
        }
      }),
    ).then(() => {
      if (!controller.signal.aborted) setVoucherImageExists(checks);
    });

    return () => controller.abort();
  }, [activeProvider, formMode, rechargeType]);

  // Resolve full image path with format fallback
  const resolveVoucherImage = (
    provider: string,
    amount: number,
  ): string | null => {
    const key = `${provider.toLowerCase()}-${amount}`;
    if (!voucherImageExists[key]) return null;
    return getVoucherImagePath(provider, amount.toString());
  };

  // ─── Data Loading ───
  const loadTelecomData = useCallback(async () => {
    try {
      const rows = await api.getRechargeStock();
      const totals: Record<string, number> = {};
      for (const r of rows) {
        totals[r.carrier] = (totals[r.carrier] ?? 0) + r.stock * r.denomination;
      }
      setStock(totals);
    } catch (error) {
      logger.error("Failed to load stock", error);
    }
  }, []);

  const loadFinancialData = useCallback(async () => {
    try {
      const enabledFinProviders = PROVIDER_CONFIGS.filter(
        (p) => p.formMode === "financial" && isModuleEnabled(p.module),
      ).map((p) => p.key);

      const [historyResults, stats, suppliers, balances] = await Promise.all([
        Promise.all(enabledFinProviders.map((p) => api.getOMTHistory(p))),
        api.getOMTAnalytics(),
        api.getSuppliers(),
        api.getSupplierBalances(),
      ]);

      const allHistory = historyResults
        .flat()
        .sort(
          (a: any, b: any) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ) as FinancialTransaction[];
      setFinTransactions(allHistory);

      const provSet = new Set(enabledFinProviders);
      const filteredByProvider = (stats.byProvider || []).filter((p: any) =>
        provSet.has(p.provider),
      );
      setFinAnalytics({
        today: {
          commission: filteredByProvider.reduce(
            (s: number, p: any) => s + (p.commission || 0),
            0,
          ),
          count: filteredByProvider.reduce(
            (s: number, p: any) => s + (p.count || 0),
            0,
          ),
        },
        byProvider: filteredByProvider,
      });

      // Supplier owed amounts
      // Map from supplier provider codes to recharge page config keys
      const SUPPLIER_TO_CONFIG: Record<string, string> = {
        IPEC: "IPEC",
        KATCH: "KATCH",
        OMT_APP: "OMT_APP",
        WHISH_APP: "WISH_APP",
      };
      const owed: Record<string, SupplierOwed> = {};
      for (const s of suppliers) {
        const configKey = s.provider ? SUPPLIER_TO_CONFIG[s.provider] : null;
        if (configKey) {
          const bal = balances.find((b: any) => b.supplier_id === s.id);
          owed[configKey] = {
            usd: Number(bal?.total_usd || 0),
            lbp: Number(bal?.total_lbp || 0),
          };
        }
      }
      setOwedByProvider(owed);
    } catch (error) {
      logger.error("Failed to load financial data:", error);
    }
  }, [isModuleEnabled]);

  const loadCryptoData = useCallback(async () => {
    try {
      const [history, todayStats] = await Promise.all([
        api.getBinanceHistory(),
        api.getBinanceTodayStats(),
      ]);
      setBinanceTransactions(history);
      if (todayStats) setBinanceStats(todayStats);
    } catch (error) {
      logger.error("Failed to load Binance data:", error);
    }
  }, []);

  useEffect(() => {
    if (isModuleEnabled("recharge")) loadTelecomData();
    if (isModuleEnabled("ipec_katch")) loadFinancialData();
    if (isModuleEnabled("binance")) loadCryptoData();
  }, [isModuleEnabled, loadTelecomData, loadFinancialData, loadCryptoData]);

  // ─── Telecom Handlers ───
  const handleQuickAmount = (val: number) => {
    setTelecomAmount(val.toString());
    setTelecomPrice(val.toString());
  };

  const handleTopUp = async () => {
    const amt = parseFloat(topUpAmount);
    if (!amt || amt <= 0) {
      alert("Please enter a valid top-up amount");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await api.topUpRecharge({
        provider: activeProvider as TelecomProvider,
        amount: amt,
      });
      if (result.success) {
        setTopUpAmount("");
        loadTelecomData();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Top-up failed", { error });
      alert("Top-up failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTelecomSubmit = async () => {
    if (!telecomAmount || !telecomPrice) {
      alert("Please enter amount and price");
      return;
    }
    if (paidBy === "DEBT" && !telecomClientId) {
      alert("Please select a client for debt payment");
      return;
    }
    setIsSubmitting(true);
    try {
      const payload: any = {
        provider: activeProvider,
        type: rechargeType,
        amount: parseFloat(telecomAmount),
        cost: parseFloat(telecomAmount) * 0.9,
        price: parseFloat(telecomPrice),
        paid_by_method: paidBy,
      };
      if (phoneNumber) payload.phoneNumber = phoneNumber;
      if (telecomClientId) payload.clientId = telecomClientId;

      const result = await api.processRecharge(payload);
      if (result.success) {
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "recharge",
              transactionId: result.id,
              amountUsd: parseFloat(telecomPrice) || 0,
              amountLbp: 0,
            });
          } catch (err) {
            logger.error("Failed to link recharge to session:", err);
          }
        }
        setTelecomAmount("");
        setTelecomPrice("");
        setPhoneNumber("");
        if (paidBy === "DEBT") {
          setTelecomClientName("");
          setTelecomClientId(null);
        }
        loadTelecomData();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Recharge failed", { error });
      alert("Failed to process");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Financial Handlers ───
  const handleFinancialSubmit = async () => {
    if (!finAmount && !finCost) {
      alert("Please enter an amount or cost.");
      return;
    }
    if (finPaidBy === "DEBT" && !finClientId) {
      alert("Please select a client for debt payment.");
      return;
    }
    setIsSubmitting(true);
    try {
      const costVal = parseFloat(finCost) || 0;
      const priceVal = parseFloat(finPrice) || parseFloat(finAmount) || 0;
      const amountVal = parseFloat(finAmount) || priceVal;
      const commissionVal =
        costVal > 0 ? priceVal - costVal : parseFloat(finCommission) || 0;

      const result = await api.addOMTTransaction({
        provider: activeProvider,
        serviceType,
        amount: amountVal,
        currency: finCurrency,
        commission: commissionVal,
        ...(costVal > 0 ? { cost: costVal } : {}),
        ...(priceVal > 0 ? { price: priceVal } : {}),
        ...(finPaidBy !== "CASH" ? { paidByMethod: finPaidBy } : {}),
        ...(finClientId ? { clientId: finClientId } : {}),
        ...(clientName ? { clientName } : {}),
        ...(referenceNumber ? { referenceNumber } : {}),
        ...(selectedItem ? { itemKey: selectedItem.key } : {}),
        ...(selectedCategory ? { itemCategory: selectedCategory } : {}),
        note: `${activeConfig?.label} - ${serviceType}`,
      });
      if (result.success) {
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "financial_service",
              transactionId: result.id,
              amountUsd: priceVal || amountVal,
              amountLbp: 0,
            });
          } catch (err) {
            logger.error("Failed to link to session:", err);
          }
        }
        setFinAmount("");
        setFinCommission("");
        setFinCost("");
        setFinPrice("");
        setClientName("");
        setReferenceNumber("");
        setSelectedItem(null);
        setSelectedCategory("");
        if (finPaidBy === "DEBT") {
          setFinClientName("");
          setFinClientId(null);
        }
        loadFinancialData();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Financial tx failed", { error });
      alert("Transaction failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Crypto Handlers ───
  const handleCryptoSubmit = async () => {
    const amt = parseFloat(cryptoAmount);
    if (!amt || amt <= 0) {
      alert("Please enter a valid amount.");
      return;
    }
    try {
      const payload: {
        type: "SEND" | "RECEIVE";
        amount: number;
        currencyCode: string;
        description?: string;
        clientName?: string;
      } = { type: cryptoType, amount: amt, currencyCode: "USDT" };
      if (cryptoDescription) payload.description = cryptoDescription;
      if (cryptoClientName) payload.clientName = cryptoClientName;

      const result = await api.addBinanceTransaction(payload);
      if (result.success) {
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "binance",
              transactionId: result.id,
              amountUsd: amt,
              amountLbp: 0,
            });
          } catch (err) {
            logger.error("Failed to link Binance tx to session:", err);
          }
        }
        setCryptoAmount("");
        setCryptoDescription("");
        setCryptoClientName("");
        loadCryptoData();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Binance tx failed", { error });
      alert("Transaction failed");
    }
  };

  // ─── Helpers ───
  // formatAmount is now provided by CurrencyContext

  if (enabledProviders.length === 0 || !activeConfig) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        No mobile recharge modules are enabled. Enable them in Settings &gt;
        Modules.
      </div>
    );
  }

  const isMTC = activeProvider === "MTC";

  return (
    <div className="h-full min-h-0 flex flex-col gap-5 animate-in fade-in duration-500">
      {/* ─── Provider Tabs ─── */}
      <div className="flex gap-1.5 p-1 bg-slate-800/80 rounded-xl border border-slate-700/50">
        {enabledProviders.map((p) => {
          const isActive = activeProvider === p.key;
          const Icon = p.icon;

          // Compact balance display
          let balanceText: string | null = null;
          if (p.formMode === "telecom" && stock[p.key] !== undefined)
            balanceText = `$${stock[p.key].toFixed(2)}`;
          if (p.formMode === "financial") {
            const stats = finAnalytics.byProvider.find(
              (bp) => bp.provider === p.key,
            );
            balanceText = `$${(stats?.commission ?? 0).toFixed(2)}`;
          }
          if (p.key === "BINANCE") {
            balanceText = `$${(binanceStats.totalSent + binanceStats.totalReceived).toFixed(2)}`;
          }

          return (
            <button
              key={p.key}
              onClick={() => setActiveProvider(p.key)}
              className={`flex-1 py-2.5 px-3 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 ${
                isActive
                  ? `${p.activeBg} shadow-md ring-1 ring-white/10 ${p.activeText}`
                  : "text-slate-400 hover:text-white hover:bg-slate-700/50"
              }`}
            >
              <Icon size={16} className={isActive ? "text-white" : p.color} />
              <span
                className={`font-semibold text-sm ${isActive ? "text-white" : ""}`}
              >
                {p.label}
              </span>
              {balanceText && (
                <span
                  className={`text-xs font-mono ml-1 ${isActive ? "text-white/70" : "text-slate-500"}`}
                >
                  {balanceText}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─── Form Area ─── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {formMode === "telecom" && (
          <TelecomForm
            isMTC={isMTC}
            rechargeType={rechargeType}
            setRechargeType={setRechargeType}
            topUpAmount={topUpAmount}
            setTopUpAmount={setTopUpAmount}
            handleTopUp={handleTopUp}
            isSubmitting={isSubmitting}
            handleQuickAmount={handleQuickAmount}
            telecomAmount={telecomAmount}
            setTelecomAmount={setTelecomAmount}
            telecomPrice={telecomPrice}
            setTelecomPrice={setTelecomPrice}
            phoneNumber={phoneNumber}
            setPhoneNumber={setPhoneNumber}
            paidBy={paidBy}
            setPaidBy={setPaidBy}
            methods={methods}
            showClientSearch={showClientSearch}
            setShowClientSearch={setShowClientSearch}
            telecomClientId={telecomClientId}
            setTelecomClientId={setTelecomClientId}
            telecomClientName={telecomClientName}
            setTelecomClientName={setTelecomClientName}
            searchClients={searchClients}
            clientSearchResults={clientSearchResults}
            selectClient={selectClient}
            resolveVoucherImage={resolveVoucherImage}
            activeProvider={activeProvider}
            activeConfig={activeConfig}
            handleTelecomSubmit={handleTelecomSubmit}
          />
        )}
        {formMode === "financial" && (
          <FinancialForm
            activeConfig={activeConfig}
            finTransactions={finTransactions}
            activeProvider={activeProvider}
            finAnalytics={finAnalytics}
            owedByProvider={owedByProvider}
            serviceType={serviceType}
            setServiceType={setServiceType}
            getCategoriesForProvider={getCategoriesForProvider}
            getServiceItems={getServiceItems}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            selectedItem={selectedItem}
            setSelectedItem={setSelectedItem}
            finCost={finCost}
            setFinCost={setFinCost}
            finPaidBy={finPaidBy}
            setFinPaidBy={setFinPaidBy}
            showFinClientSearch={showFinClientSearch}
            setShowFinClientSearch={setShowFinClientSearch}
            methods={methods}
            finClientId={finClientId}
            setFinClientId={setFinClientId}
            finClientName={finClientName}
            setFinClientName={setFinClientName}
            clientName={clientName}
            setClientName={setClientName}
            searchFinClients={searchFinClients}
            finClientSearchResults={finClientSearchResults}
            selectFinClient={selectFinClient}
            finPrice={finPrice}
            setFinPrice={setFinPrice}
            finAmount={finAmount}
            setFinAmount={setFinAmount}
            finCommission={finCommission}
            setFinCommission={setFinCommission}
            referenceNumber={referenceNumber}
            setReferenceNumber={setReferenceNumber}
            handleFinancialSubmit={handleFinancialSubmit}
            isSubmitting={isSubmitting}
            loadFinancialData={loadFinancialData}
            formatAmount={formatAmount}
            finCurrency={finCurrency}
            setFinCurrency={setFinCurrency}
            moduleCurrencies={moduleCurrencies}
            getSymbol={getSymbol}
          />
        )}
        {formMode === "crypto" && (
          <CryptoForm
            activeConfig={activeConfig}
            binanceStats={binanceStats}
            cryptoType={cryptoType}
            setCryptoType={setCryptoType}
            cryptoAmount={cryptoAmount}
            setCryptoAmount={setCryptoAmount}
            cryptoClientName={cryptoClientName}
            setCryptoClientName={setCryptoClientName}
            cryptoDescription={cryptoDescription}
            setCryptoDescription={setCryptoDescription}
            handleCryptoSubmit={handleCryptoSubmit}
            isSubmitting={isSubmitting}
            binanceTransactions={binanceTransactions}
            loadCryptoData={loadCryptoData}
          />
        )}
      </div>
    </div>
  );
}
