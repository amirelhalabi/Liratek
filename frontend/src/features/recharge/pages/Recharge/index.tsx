import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import * as api from "../../../../api/backendApi";
import { Select } from "@liratek/ui";
import { useSession } from "../../../sessions/context/SessionContext";
import { usePaymentMethods } from "../../../../hooks/usePaymentMethods";
import { useModules } from "../../../../contexts/ModuleContext";

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
    formMode: "financial",
    color: "text-fuchsia-400",
    bgTint: "bg-fuchsia-400/10",
    activeBg: "bg-fuchsia-500",
    activeText: "text-white",
    badgeCls: "bg-fuchsia-400/10 text-fuchsia-400",
    icon: Zap,
    hasSupplier: false,
  },
  {
    key: "OMT_APP",
    label: "OMT App",
    module: "ipec_katch",
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

// =============================================================================
// Component
// =============================================================================

export default function MobileRecharge() {
  const { activeSession, linkTransaction } = useSession();
  const { drawerAffectingMethods } = usePaymentMethods();
  const { isModuleEnabled } = useModules();

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
  const [stock, setStock] = useState({ mtc: 0, alfa: 0 });
  const [phoneNumber, setPhoneNumber] = useState("");
  const [paidBy, setPaidBy] = useState("CASH");
  const [telecomAmount, setTelecomAmount] = useState("");
  const [telecomPrice, setTelecomPrice] = useState("");
  const [topUpAmount, setTopUpAmount] = useState("");

  // Financial state
  const [serviceType, setServiceType] = useState<ServiceType>("SEND");
  const [finAmount, setFinAmount] = useState("");
  const [finCommission, setFinCommission] = useState("");
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

  // Populate client name from session
  useEffect(() => {
    if (activeSession?.customer_name) {
      setClientName(activeSession.customer_name);
      setCryptoClientName(activeSession.customer_name);
    }
  }, [activeSession]);

  // ─── Data Loading ───
  const loadTelecomData = useCallback(async () => {
    try {
      const s = await api.getRechargeStock();
      setStock(s);
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
      const owed: Record<string, SupplierOwed> = {};
      for (const s of suppliers) {
        if (s.provider && ["IPEC", "KATCH", "OMT_APP"].includes(s.provider)) {
          const bal = balances.find((b: any) => b.supplier_id === s.id);
          owed[s.provider] = {
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
    setIsSubmitting(true);
    try {
      const result = await api.processRecharge({
        provider: activeProvider,
        type: rechargeType,
        amount: parseFloat(telecomAmount),
        cost: parseFloat(telecomAmount) * 0.9,
        price: parseFloat(telecomPrice),
        paid_by_method: paidBy,
        phoneNumber,
      });
      if (result.success) {
        if (activeSession && result.saleId) {
          try {
            await linkTransaction({
              transactionType: "recharge",
              transactionId: result.saleId,
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
    if (!finAmount) {
      alert("Please enter an amount.");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await api.addOMTTransaction({
        provider: activeProvider,
        serviceType,
        amount: parseFloat(finAmount),
        currency: "USD",
        commission: parseFloat(finCommission) || 0,
        ...(clientName ? { clientName } : {}),
        ...(referenceNumber ? { referenceNumber } : {}),
        note: `${activeConfig?.label} - ${serviceType}`,
      });
      if (result.success) {
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "financial_service",
              transactionId: result.id,
              amountUsd: parseFloat(finAmount) || 0,
              amountLbp: 0,
            });
          } catch (err) {
            logger.error("Failed to link to session:", err);
          }
        }
        setFinAmount("");
        setFinCommission("");
        setClientName("");
        setReferenceNumber("");
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
  const formatAmount = (val: number, currency: string) => {
    if (currency === "USD" || currency === "USDT") return `$${val.toFixed(2)}`;
    if (currency === "LBP") return `${val.toLocaleString()} LBP`;
    if (currency === "EUR") return `€${val.toFixed(2)}`;
    return `${val} ${currency}`;
  };

  if (enabledProviders.length === 0 || !activeConfig) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        No mobile recharge modules are enabled. Enable them in Settings &gt;
        Modules.
      </div>
    );
  }

  const isMTC = activeProvider === "MTC";

  // Suppliers with debt among enabled providers
  const supplierProviders = enabledProviders.filter((p) => p.hasSupplier);

  return (
    <div className="h-full min-h-0 flex flex-col gap-5 animate-in fade-in duration-500">
      {/* ─── Provider Cards ─── */}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${Math.min(enabledProviders.length, 7)}, minmax(0, 1fr))`,
        }}
      >
        {enabledProviders.map((p) => {
          const isActive = activeProvider === p.key;
          const Icon = p.icon;

          // Balance display for telecom providers
          let balanceText: string | null = null;
          if (p.key === "MTC") balanceText = `$${stock.mtc.toFixed(2)}`;
          if (p.key === "Alfa") balanceText = `$${stock.alfa.toFixed(2)}`;

          // Stats for financial/crypto
          if (p.formMode === "financial") {
            const stats = finAnalytics.byProvider.find(
              (bp) => bp.provider === p.key,
            );
            balanceText = `$${(stats?.commission ?? 0).toFixed(2)}`;
          }
          if (p.key === "BINANCE") {
            balanceText = `${binanceStats.count} txns`;
          }

          return (
            <button
              key={p.key}
              onClick={() => setActiveProvider(p.key)}
              className={`relative overflow-hidden rounded-2xl p-4 transition-all duration-300 ${
                isActive
                  ? `${p.activeBg} shadow-lg ring-2 ring-white/20 scale-[1.02]`
                  : "bg-slate-800 border border-slate-700/50 hover:border-slate-600"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-xl ${isActive ? "bg-white/20" : p.bgTint}`}
                >
                  <Icon
                    className={isActive ? "text-white" : p.color}
                    size={20}
                  />
                </div>
                <div className="text-left min-w-0">
                  <div
                    className={`font-bold text-sm truncate ${isActive ? "text-white" : "text-slate-300"}`}
                  >
                    {p.label}
                  </div>
                  {balanceText && (
                    <div
                      className={`text-xs font-mono ${isActive ? "text-white/80" : "text-slate-500"}`}
                    >
                      {balanceText}
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ─── Supplier Debt Banners ─── */}
      {supplierProviders.length > 0 && (
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${Math.min(supplierProviders.length, 4)}, minmax(0, 1fr))`,
          }}
        >
          {supplierProviders.map((p) => {
            const owed = owedByProvider[p.key];
            const hasDebt = owed && (owed.usd !== 0 || owed.lbp !== 0);
            return (
              <div
                key={p.key}
                className="bg-slate-800 border border-slate-700/50 rounded-xl p-3 flex items-center gap-3"
              >
                <div className={`p-1.5 rounded-lg ${p.bgTint}`}>
                  <AlertTriangle
                    className={`w-4 h-4 ${hasDebt ? "text-red-400" : "text-slate-500"}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                    Owed to {p.label}
                  </div>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span
                      className={`text-sm font-bold font-mono ${hasDebt ? "text-red-400" : "text-slate-500"}`}
                    >
                      ${(owed?.usd ?? 0).toFixed(2)}
                    </span>
                    <span
                      className={`text-xs font-mono ${hasDebt ? "text-red-400/70" : "text-slate-600"}`}
                    >
                      {(owed?.lbp ?? 0).toLocaleString()} LBP
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Form Area ─── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {formMode === "telecom" && <TelecomForm />}
        {formMode === "financial" && <FinancialForm />}
        {formMode === "crypto" && <CryptoForm />}
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // TELECOM FORM (MTC / Alfa)
  // ═══════════════════════════════════════════════════════════════════════════
  function TelecomForm() {
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
                <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">
                  Amount (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-400 font-bold text-2xl">
                    $
                  </span>
                  <input
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
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider flex items-center gap-1.5">
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
                    type="text"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className={`w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-20 pr-4 py-4 text-2xl font-bold text-white focus:outline-none focus:border-${accent}-500 focus:ring-1 focus:ring-${accent}-500/30 transition-all tracking-widest font-mono`}
                    placeholder="XX XXX XXX"
                    maxLength={8}
                  />
                </div>
              </div>
              {rechargeType === "CREDIT_TRANSFER" && (
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-500 mb-3 uppercase tracking-wider">
                    Quick Amount
                  </label>
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
                <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider flex items-center gap-1.5">
                  <Wallet size={12} />
                  Paid By
                </label>
                <Select
                  value={paidBy}
                  onChange={(value) => setPaidBy(value)}
                  options={drawerAffectingMethods.map((m) => ({
                    value: m.code,
                    label: m.label,
                  }))}
                  ringColor={`ring-${accent}-500`}
                  buttonClassName="py-3 text-sm font-bold rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">
                  Amount / Value
                </label>
                <div className="relative">
                  <span
                    className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold text-${accent}-400`}
                  >
                    $
                  </span>
                  <input
                    type="number"
                    value={telecomAmount}
                    onChange={(e) => setTelecomAmount(e.target.value)}
                    className={`w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-9 pr-4 py-3 text-white font-bold focus:outline-none focus:border-${accent}-500 focus:ring-1 focus:ring-${accent}-500/30 transition-all`}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">
                  Price to Client
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-emerald-400">
                    $
                  </span>
                  <input
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
                        parseFloat(telecomPrice) - parseFloat(telecomAmount) >=
                        0
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

  // ═══════════════════════════════════════════════════════════════════════════
  // FINANCIAL FORM (IPEC / Katch / Whish App / OMT App)
  // ═══════════════════════════════════════════════════════════════════════════
  function FinancialForm() {
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
          <div className="w-1/3 min-w-[360px] bg-slate-800 rounded-xl border border-slate-700/50 p-4 flex flex-col">
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
              {/* Amount */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                  Amount USD
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sky-400 font-bold">
                    $
                  </span>
                  <input
                    type="number"
                    value={finAmount}
                    onChange={(e) => setFinAmount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-8 pr-4 py-3 text-white focus:outline-none focus:border-violet-500 transition-colors"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Commission */}
              <div className="p-4 rounded-xl bg-sky-400/5 border border-sky-400/20">
                <label className="block text-xs font-medium text-sky-400 mb-2 uppercase tracking-wider">
                  Commission / Profit
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sky-400 font-bold">
                    $
                  </span>
                  <input
                    type="number"
                    value={finCommission}
                    onChange={(e) => setFinCommission(e.target.value)}
                    className="w-full bg-slate-900 border border-sky-400/30 rounded-lg pl-8 pr-4 py-3 text-sky-400 font-bold focus:outline-none focus:border-sky-400 transition-colors"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Client Info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1">
                    <User size={12} /> Client
                  </label>
                  <input
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 transition-colors"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1">
                    <Hash size={12} /> Ref #
                  </label>
                  <input
                    type="text"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 transition-colors"
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
              <table className="w-full">
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
                          ${tx.commission.toFixed(2)}
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

  // ═══════════════════════════════════════════════════════════════════════════
  // CRYPTO FORM (Binance)
  // ═══════════════════════════════════════════════════════════════════════════
  function CryptoForm() {
    return (
      <div className="flex gap-5 h-full">
        {/* Left: Form */}
        <div className="w-[340px] flex-shrink-0 flex flex-col gap-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-800 p-3 rounded-xl border border-slate-700/50 text-center">
              <TrendingUp size={14} className="text-red-400 mx-auto mb-1" />
              <p className="text-xs text-slate-400">Sent</p>
              <p className="text-sm font-bold text-red-400">
                $
                {binanceStats.totalSent.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
            <div className="bg-slate-800 p-3 rounded-xl border border-slate-700/50 text-center">
              <ArrowDownLeft
                size={14}
                className="text-emerald-400 mx-auto mb-1"
              />
              <p className="text-xs text-slate-400">Received</p>
              <p className="text-sm font-bold text-emerald-400">
                $
                {binanceStats.totalReceived.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
            <div className="bg-slate-800 p-3 rounded-xl border border-slate-700/50 text-center">
              <Hash size={14} className="text-violet-400 mx-auto mb-1" />
              <p className="text-xs text-slate-400">Today</p>
              <p className="text-sm font-bold text-violet-400">
                {binanceStats.count}
              </p>
            </div>
          </div>

          {/* Transaction Form */}
          <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 flex flex-col gap-4">
            <h3 className="text-md font-bold text-white flex items-center gap-2">
              <Plus size={16} className="text-amber-400" />
              New Transaction
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => setCryptoType("SEND")}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                  cryptoType === "SEND"
                    ? "bg-red-500/20 text-red-400 border border-red-500/50"
                    : "bg-slate-700/50 text-slate-400 border border-slate-600/50 hover:bg-slate-700"
                }`}
              >
                <ArrowUpRight size={16} />
                Send
              </button>
              <button
                onClick={() => setCryptoType("RECEIVE")}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                  cryptoType === "RECEIVE"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50"
                    : "bg-slate-700/50 text-slate-400 border border-slate-600/50 hover:bg-slate-700"
                }`}
              >
                <ArrowDownLeft size={16} />
                Receive
              </button>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Amount (USDT)
              </label>
              <input
                type="number"
                value={cryptoAmount}
                onChange={(e) => setCryptoAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Client Name (optional)
              </label>
              <input
                type="text"
                value={cryptoClientName}
                onChange={(e) => setCryptoClientName(e.target.value)}
                placeholder="Client name"
                className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Description (optional)
              </label>
              <textarea
                value={cryptoDescription}
                onChange={(e) => setCryptoDescription(e.target.value)}
                placeholder="Notes, reference, reason..."
                rows={3}
                className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50 resize-none"
              />
            </div>
            <button
              onClick={handleCryptoSubmit}
              className={`w-full py-3 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
                cryptoType === "SEND"
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "bg-emerald-500 hover:bg-emerald-600 text-white"
              }`}
            >
              {cryptoType === "SEND" ? (
                <ArrowUpRight size={16} />
              ) : (
                <ArrowDownLeft size={16} />
              )}
              Confirm {cryptoType === "SEND" ? "Send" : "Receive"}
            </button>
          </div>
        </div>

        {/* Right: History */}
        <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700/50 flex flex-col overflow-hidden">
          <div className="p-5 border-b border-slate-700/50 flex items-center gap-2">
            <History size={16} className="text-amber-400" />
            <h3 className="text-md font-bold text-white">Binance History</h3>
            <span className="text-xs text-slate-500 ml-auto">
              Last {binanceTransactions.length} transactions
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {binanceTransactions.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                No transactions yet
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-800/95 backdrop-blur">
                  <tr className="text-slate-400 text-xs border-b border-slate-700/50">
                    <th className="text-left px-5 py-3 font-medium">Time</th>
                    <th className="text-left px-3 py-3 font-medium">Type</th>
                    <th className="text-right px-3 py-3 font-medium">Amount</th>
                    <th className="text-left px-3 py-3 font-medium">Client</th>
                    <th className="text-left px-5 py-3 font-medium">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {binanceTransactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors"
                    >
                      <td className="px-5 py-3 text-slate-300 whitespace-nowrap">
                        {new Date(tx.created_at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
                            tx.type === "SEND"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-emerald-500/20 text-emerald-400"
                          }`}
                        >
                          {tx.type === "SEND" ? (
                            <ArrowUpRight size={12} />
                          ) : (
                            <ArrowDownLeft size={12} />
                          )}
                          {tx.type}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-semibold text-white">
                        $
                        {Number(tx.amount).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-3 text-slate-300">
                        {tx.client_name || "—"}
                      </td>
                      <td className="px-5 py-3 text-slate-400 max-w-[250px] truncate">
                        {tx.description || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    );
  }
}
