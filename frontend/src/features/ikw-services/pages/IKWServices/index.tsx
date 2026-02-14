import { useState, useEffect } from "react";
import {
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
} from "lucide-react";
import * as api from "../../../../api/backendApi";
import { useSession } from "../../../sessions/context/SessionContext";

type Provider = "IPEC" | "KATCH" | "WISH_APP";
type ServiceType = "SEND" | "RECEIVE" | "BILL_PAYMENT";

interface Analytics {
  today: { commissionUSD: number; commissionLBP: number; count: number };
  month: { commissionUSD: number; commissionLBP: number; count: number };
  byProvider: {
    provider: string;
    commission_usd: number;
    commission_lbp: number;
    count: number;
  }[];
}

interface Transaction {
  id: number;
  provider: Provider;
  service_type: ServiceType;
  amount_usd: number;
  amount_lbp: number;
  commission_usd: number;
  commission_lbp: number;
  client_name?: string;
  reference_number?: string;
  note?: string;
  created_at: string;
}

const PROVIDERS: Provider[] = ["IPEC", "KATCH", "WISH_APP"];

const providerMeta: Record<
  Provider,
  {
    label: string;
    color: string;
    bgTint: string;
    activeBg: string;
    activeText: string;
    badgeCls: string;
  }
> = {
  IPEC: {
    label: "IPEC",
    color: "text-sky-400",
    bgTint: "bg-sky-400/10",
    activeBg: "bg-sky-500",
    activeText: "text-white",
    badgeCls: "bg-sky-400/10 text-sky-400",
  },
  KATCH: {
    label: "Katch",
    color: "text-orange-400",
    bgTint: "bg-orange-400/10",
    activeBg: "bg-orange-500",
    activeText: "text-white",
    badgeCls: "bg-orange-400/10 text-orange-400",
  },
  WISH_APP: {
    label: "Wish App",
    color: "text-fuchsia-400",
    bgTint: "bg-fuchsia-400/10",
    activeBg: "bg-fuchsia-500",
    activeText: "text-white",
    badgeCls: "bg-fuchsia-400/10 text-fuchsia-400",
  },
};

const serviceTypeIcons: Record<ServiceType, typeof Send> = {
  SEND: Send,
  RECEIVE: ArrowDownToLine,
  BILL_PAYMENT: Receipt,
};

export default function IKWServices() {
  const { activeSession, linkTransaction } = useSession();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>({
    today: { commissionUSD: 0, commissionLBP: 0, count: 0 },
    month: { commissionUSD: 0, commissionLBP: 0, count: 0 },
    byProvider: [],
  });

  // Form State
  const [provider, setProvider] = useState<Provider>("IPEC");
  const [serviceType, setServiceType] = useState<ServiceType>("SEND");
  const [amountUSD, setAmountUSD] = useState("");
  const [amountLBP, setAmountLBP] = useState("");
  const [commissionUSD, setCommissionUSD] = useState("");
  const [commissionLBP, setCommissionLBP] = useState("");
  const [clientName, setClientName] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadData();
    if (activeSession && activeSession.customer_name) {
      setClientName(activeSession.customer_name);
    }
  }, [activeSession]);

  const loadData = async () => {
    try {
      // Fetch history for all 3 IKW providers
      const [ipecH, katchH, wishH, stats] = await Promise.all([
        api.getOMTHistory("IPEC"),
        api.getOMTHistory("KATCH"),
        api.getOMTHistory("WISH_APP"),
        api.getOMTAnalytics(),
      ]);
      const allHistory = [...ipecH, ...katchH, ...wishH]
        .map((h: any) => ({
          ...h,
          provider: h.provider as Provider,
          service_type: h.service_type as ServiceType,
        }))
        .sort(
          (a: Transaction, b: Transaction) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime(),
        );
      setTransactions(allHistory);

      // Filter analytics to only IKW providers
      const ikwProviders = new Set(["IPEC", "KATCH", "WISH_APP"]);
      const ikwByProvider = (stats.byProvider || []).filter(
        (p: any) => ikwProviders.has(p.provider),
      );
      const ikwTodayUSD = ikwByProvider.reduce(
        (s: number, p: any) => s + (p.commission_usd || 0),
        0,
      );
      const ikwTodayLBP = ikwByProvider.reduce(
        (s: number, p: any) => s + (p.commission_lbp || 0),
        0,
      );
      const ikwTodayCount = ikwByProvider.reduce(
        (s: number, p: any) => s + (p.count || 0),
        0,
      );
      setAnalytics({
        today: {
          commissionUSD: ikwTodayUSD,
          commissionLBP: ikwTodayLBP,
          count: ikwTodayCount,
        },
        month: stats.month || {
          commissionUSD: 0,
          commissionLBP: 0,
          count: 0,
        },
        byProvider: ikwByProvider,
      });
    } catch (error) {
      console.error("Failed to load IKW data:", error);
    }
  };

  const handleSubmit = async () => {
    if (!amountUSD && !amountLBP) {
      alert("Please enter an amount.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await api.addOMTTransaction({
        provider: provider as any,
        serviceType,
        amountUSD: parseFloat(amountUSD) || 0,
        amountLBP: parseFloat(amountLBP) || 0,
        commissionUSD: parseFloat(commissionUSD) || 0,
        commissionLBP: parseFloat(commissionLBP) || 0,
        ...(clientName ? { clientName } : {}),
        ...(referenceNumber ? { referenceNumber } : {}),
        note: `${providerMeta[provider].label} - ${serviceType}`,
      });

      if (result.success) {
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "financial_service",
              transactionId: result.id,
              amountUsd: parseFloat(amountUSD) || 0,
              amountLbp: parseFloat(amountLBP) || 0,
            });
          } catch (err) {
            console.error("Failed to link IKW service to session:", err);
          }
        }

        setAmountUSD("");
        setAmountLBP("");
        setCommissionUSD("");
        setCommissionLBP("");
        setClientName("");
        setReferenceNumber("");
        loadData();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      console.error(error);
      alert("Transaction failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (usd: number, lbp: number) => {
    const parts = [];
    if (usd > 0) parts.push(`$${usd.toFixed(2)}`);
    if (lbp > 0) parts.push(`${lbp.toLocaleString()} LBP`);
    return parts.join(" + ") || "$0.00";
  };

  const meta = providerMeta[provider];

  return (
    <div className="h-full min-h-0 flex flex-col gap-6 animate-in fade-in duration-500">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <Zap className="text-sky-400" />
        IPEC / Katch / Wish App
      </h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Today's Earnings */}
        <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-sky-400/10">
              <TrendingUp className="w-5 h-5 text-sky-400" />
            </div>
          </div>
          <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
            Today's Earnings
          </h3>
          <p className="text-2xl font-bold text-white mt-1">
            ${analytics.today.commissionUSD.toFixed(2)}
          </p>
          {analytics.today.commissionLBP > 0 && (
            <p className="text-xs text-slate-400 mt-1">
              + {analytics.today.commissionLBP.toLocaleString()} LBP
            </p>
          )}
          <p className="text-xs text-slate-500 mt-1">
            {analytics.today.count} transactions
          </p>
        </div>

        {/* Monthly Earnings */}
        <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-blue-400/10">
              <Calendar className="w-5 h-5 text-blue-400" />
            </div>
          </div>
          <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
            Monthly Earnings
          </h3>
          <p className="text-2xl font-bold text-white mt-1">
            ${analytics.month.commissionUSD.toFixed(2)}
          </p>
          {analytics.month.commissionLBP > 0 && (
            <p className="text-xs text-slate-400 mt-1">
              + {analytics.month.commissionLBP.toLocaleString()} LBP
            </p>
          )}
          <p className="text-xs text-slate-500 mt-1">
            {analytics.month.count} total this month
          </p>
        </div>

        {/* Per-Provider breakdown cards */}
        {PROVIDERS.map((p) => {
          const stats = analytics.byProvider.find((bp) => bp.provider === p);
          const pm = providerMeta[p];
          return (
            <div
              key={p}
              className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`p-2 rounded-lg ${pm.bgTint}`}>
                  <Zap className={`w-5 h-5 ${pm.color}`} />
                </div>
              </div>
              <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
                {pm.label} Today
              </h3>
              <p className="text-2xl font-bold text-white mt-1">
                ${(stats?.commission_usd ?? 0).toFixed(2)}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {stats?.count ?? 0} transactions
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 flex gap-6">
        {/* Left: Form */}
        <div className="w-1/3 min-w-[380px] bg-slate-800 rounded-xl border border-slate-700/50 shadow-lg p-4 flex flex-col">
          {/* Provider Selector – 3 pills */}
          <div className="flex gap-2 p-1 bg-slate-900 rounded-xl mb-6">
            {PROVIDERS.map((p) => {
              const pm = providerMeta[p];
              return (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-all ${
                    provider === p
                      ? `${pm.activeBg} ${pm.activeText} shadow-lg`
                      : "text-slate-400 hover:text-white hover:bg-slate-800"
                  }`}
                >
                  {pm.label}
                </button>
              );
            })}
          </div>

          {/* Service Type */}
          <div className="flex gap-2 mb-6">
            {(["SEND", "RECEIVE", "BILL_PAYMENT"] as ServiceType[]).map(
              (type) => {
                const Icon = serviceTypeIcons[type];
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
            {/* Amount Fields */}
            <div className="grid grid-cols-2 gap-3">
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
                    value={amountUSD}
                    onChange={(e) => setAmountUSD(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-8 pr-4 py-3 text-white focus:outline-none focus:border-violet-500 transition-colors"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                  Amount LBP
                </label>
                <input
                  type="number"
                  value={amountLBP}
                  onChange={(e) => setAmountLBP(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 transition-colors"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Commission Fields */}
            <div className="p-4 rounded-xl bg-sky-400/5 border border-sky-400/20">
              <label className="block text-xs font-medium text-sky-400 mb-3 uppercase tracking-wider">
                Commission / Profit
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sky-400 font-bold">
                    $
                  </span>
                  <input
                    type="number"
                    value={commissionUSD}
                    onChange={(e) => setCommissionUSD(e.target.value)}
                    className="w-full bg-slate-900 border border-sky-400/30 rounded-lg pl-8 pr-4 py-3 text-sky-400 font-bold focus:outline-none focus:border-sky-400 transition-colors"
                    placeholder="0.00"
                  />
                </div>
                <input
                  type="number"
                  value={commissionLBP}
                  onChange={(e) => setCommissionLBP(e.target.value)}
                  className="w-full bg-slate-900 border border-sky-400/30 rounded-lg px-4 py-3 text-sky-400 font-bold focus:outline-none focus:border-sky-400 transition-colors"
                  placeholder="LBP"
                />
              </div>
            </div>

            {/* Client Info */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1">
                  <User size={12} /> Client Name
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
                  <Hash size={12} /> Reference #
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

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={`w-full mt-6 py-4 rounded-xl font-bold text-lg shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 ${
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
        <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700/50 shadow-lg overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-700 bg-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-white flex items-center gap-2">
              <History className="text-slate-400" size={18} />
              Transaction History
            </h2>
            <button
              onClick={loadData}
              className="text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full">
              <thead className="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="px-6 py-3">Provider</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Commission</th>
                  <th className="px-6 py-3">Client</th>
                  <th className="px-6 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {transactions.map((tx) => {
                  const Icon = serviceTypeIcons[tx.service_type];
                  const pm =
                    providerMeta[tx.provider] ?? providerMeta["IPEC"];
                  return (
                    <tr
                      key={tx.id}
                      className="hover:bg-slate-700/20 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${pm.badgeCls}`}
                        >
                          {pm.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
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
                      <td className="px-6 py-4 text-sm font-medium text-white">
                        {formatCurrency(tx.amount_usd, tx.amount_lbp)}
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-emerald-400">
                        {formatCurrency(tx.commission_usd, tx.commission_lbp)}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-300">
                        {tx.client_name || "-"}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-400">
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
                {transactions.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-8 text-center text-slate-500 text-sm"
                    >
                      No transactions yet today.
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
